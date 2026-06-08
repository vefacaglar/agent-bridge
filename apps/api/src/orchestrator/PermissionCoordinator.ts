import type { Run } from "@agent-bridge/shared";
import { db } from "../database/db.js";
import { eventBus } from "./eventBus.js";
import { buildPermissionPreview, permissionKey, commandEscapesWorkspace } from "./workspaceTools.js";
import type { RunMessageStream } from "./RunMessageStream.js";

export type PermissionDecision = "allow_once" | "allow_project" | "allow_always" | "deny";

/** A pending permission request: the awaited resolver plus the gated tool call. */
interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  toolCall: any;
}

/**
 * Owns the tool-permission flow for a run: checking standing grants, prompting
 * the user, and serializing concurrent prompts. Parallel coder sub-agents share
 * one runId and a single pending slot, so their approval prompts are chained one
 * at a time. The orchestrator delegates all permission decisions here.
 */
export class PermissionCoordinator {
  private pending = new Map<string, PendingPermission>();
  // Serializes concurrent permission prompts for the same run. Parallel coder
  // sub-agents share one runId and the pending slot is single, so their approval
  // prompts must be shown one at a time, not overwrite each other.
  private chain = new Map<string, Promise<void>>();

  constructor(
    private activeRuns: Set<string>,
    private messages: RunMessageStream
  ) {}

  /** Resolves a pending request with the user's decision. Returns false if none. */
  resolve(runId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(runId);
    if (pending) {
      pending.resolve(decision);
      this.pending.delete(runId);
      return true;
    }
    return false;
  }

  getPending(runId: string) {
    return this.pending.get(runId);
  }

  /** Unblocks a pending request as a denial so the run loop can unwind (cancel). */
  cancelPending(runId: string) {
    const pending = this.pending.get(runId);
    if (pending) {
      pending.resolve("deny");
      this.pending.delete(runId);
    }
  }

  /** Drops any chain bookkeeping for a finished run. */
  clear(runId: string) {
    this.chain.delete(runId);
  }

  /**
   * Whether a standing grant covers this tool call. Grants are scoped per tool.
   * For run_command the match is by PREFIX: approving "go build ./internal/config/"
   * also covers "go build ./internal/config/..." (the new command starts with the
   * granted one). This lets one approval cover closely-related invocations without
   * re-prompting. Other tools (e.g. fetch_url host) still match exactly.
   */
  check(run: Run, toolCall: any): boolean {
    try {
      const { tool, command } = permissionKey(toolCall);

      if (tool === "run_command") {
        // Commands that navigate outside the workspace always ask, regardless of
        // any grant — so a folder-escaping command can never run silently.
        if (commandEscapesWorkspace(command)) return false;
        return this.hasRunCommandPrefixGrant(run, command);
      }

      // fetch_url falls through to the exact match below: grants are scoped per
      // host (a new host still asks; an approved host runs silently).

      const globalPerm = db
        .prepare("SELECT 1 FROM permissions WHERE scope = 'global' AND tool = ? AND command = ? AND status = 'allowed'")
        .get(tool, command);
      if (globalPerm) return true;

      if (run.projectPath) {
        const projectPerm = db
          .prepare("SELECT 1 FROM permissions WHERE scope = 'project' AND project_path = ? AND tool = ? AND command = ? AND status = 'allowed'")
          .get(run.projectPath, tool, command);
        if (projectPerm) return true;
      }
    } catch (err) {
      console.error("[Orchestrator] Error checking permissions:", err);
    }
    return false;
  }

  /**
   * A run_command grant covers the current command when the command starts with
   * a granted command string. Empty grants are ignored so a blank grant can never
   * match everything.
   */
  private hasRunCommandPrefixGrant(run: Run, command: string): boolean {
    if (!command) return false;
    const covers = (rows: { command: string }[]) =>
      rows.some(r => r.command && command.startsWith(r.command));

    const globalGrants = db
      .prepare("SELECT command FROM permissions WHERE scope = 'global' AND tool = 'run_command' AND status = 'allowed'")
      .all() as { command: string }[];
    if (covers(globalGrants)) return true;

    if (run.projectPath) {
      const projectGrants = db
        .prepare("SELECT command FROM permissions WHERE scope = 'project' AND project_path = ? AND tool = 'run_command' AND status = 'allowed'")
        .all(run.projectPath) as { command: string }[];
      if (covers(projectGrants)) return true;
    }
    return false;
  }

  /** Prompts the user for a decision, serialized behind any in-flight prompt. */
  async request(runId: string, run: Run, toolCall: any): Promise<PermissionDecision> {
    // Acquire the per-run permission lock so only one prompt is outstanding at a
    // time (parallel sub-agents would otherwise clobber the single pending slot).
    const prev = this.chain.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    this.chain.set(runId, prev.then(() => gate));
    await prev;

    try {
      // If the run was cancelled while we waited in line, deny without prompting.
      if (!this.activeRuns.has(runId)) return "deny";

      return await new Promise<PermissionDecision>((resolve) => {
        this.pending.set(runId, { resolve, toolCall });
        void this.messages.emitStatus(runId, "awaiting_permission");
        eventBus.emit(`run:${runId}`, {
          type: "permission_requested",
          runId,
          toolCall,
          preview: buildPermissionPreview(run, toolCall)
        });
      });
    } finally {
      release();
    }
  }
}
