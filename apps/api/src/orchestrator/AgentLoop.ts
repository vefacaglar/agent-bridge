import type { Run, RunMessage, ChatMessage, ReasoningEffort } from "@locagens/shared";
import type { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getModeStrategy } from "./systemPrompt.js";
import { executeWorkspaceToolAsync, DANGEROUS_TOOLS, READONLY_TOOLS, MODIFYING_TOOLS, UTILITY_TOOL_NAMES } from "./workspaceTools.js";
import { getOrchestratorTool } from "./tools/index.js";
import type { OrchestratorToolContext } from "./tools/index.js";
import type { RunMessageStream } from "./RunMessageStream.js";
import type { PermissionCoordinator } from "./PermissionCoordinator.js";
import { randomId } from "./ids.js";
import type { IUsageLogRepository } from "../database/repositories.js";
import { calculateCost } from "./pricing.js";
import { estimateTokens, compactHistory, COMPACT_TRIGGER_RATIO, COMPACT_TARGET_RATIO, DEFAULT_CONTEXT_LIMIT } from "./contextWindow.js";

/** The model + toolset + prompt a single agent loop runs with. */
export interface AgentRunOptions {
  providerId: string;
  providerDisplayName: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt: string;
  tools: any[];
  agentRole?: RunMessage["agentRole"];
  agentName?: string;
  /**
   * Weak architects sometimes announce that they will start ("I'll begin now")
   * and then end the turn with NO tool call, which the loop would treat as a
   * finished run. When this nudge text is set and the agent ends the run having
   * made ZERO tool calls, the loop injects this reminder (invisibly) and lets the
   * model try again, up to maxIdleNudges times. Tying it to zero tool calls caps
   * the extra turns hard and prevents an infinite loop.
   */
  idleNudge?: string;
  maxIdleNudges?: number;
  /**
   * When the architect delegates tasks and then tries to end the run without
   * verifying the results (no read_file/inspect calls after delegation), this
   * nudge is injected to remind it to verify. Capped at maxPostDelegationNudges.
   */
  postDelegationNudge?: string;
  maxPostDelegationNudges?: number;
}

/**
 * Handles the delegate_tasks / delegate_to_utility tool calls. Injected into the
 * AgentLoop (rather than imported) so the loop depends only on this small
 * interface — breaking the loop ↔ delegation recursion cycle. Implemented by
 * DelegationCoordinator.
 */
export interface Delegator {
  executeDelegateTasks(runId: string, run: Run, toolCall: any): Promise<string>;
  executeUtilityTasks(runId: string, run: Run, toolCall: any): Promise<string>;
}

// One-shot reminder injected when the agent ends its turn mid-run with unchecked
// <task_list> items and no tool call — the classic weak-model "I'll do X next"
// stall, after it has already started working (the idle nudge only covers the
// zero-tool-call case). Capped at one per run to avoid loops.
const OPEN_TASK_LIST_NUDGE =
  "Your <task_list> still has unchecked '- [ ]' items, but you ended your turn without calling any tool. " +
  "Either continue the work with your tools NOW, or — if you are blocked or the remaining items are intentionally out of scope — say so explicitly and update the list.";
const MAX_TASK_LIST_NUDGES = 1;

/** True when the reply carries a <task_list> with at least one unchecked item. */
function hasOpenTaskListItems(text: string): boolean {
  const match = text.match(/<task_list>([\s\S]*?)(?:<\/task_list>|$)/);
  return !!match && /-\s*\[\s\]/.test(match[1]);
}

function usageLogPath(): string | null {
  if (process.env.LOCAGENS_USAGE_LOG_PATH) {
    return resolve(process.env.LOCAGENS_USAGE_LOG_PATH);
  }
  if (process.env.LOCAGENS_DB_PATH) {
    return join(dirname(resolve(process.env.LOCAGENS_DB_PATH)), "usage.log");
  }
  return null;
}

/**
 * The model-agnostic generation loop and per-tool-call gating, shared by the
 * main/architect agent and every coder/utility sub-agent. It calls the model,
 * streams + persists its messages, gates and executes each tool call, and repeats
 * until the model returns a final answer with no tool calls. It owns no run-level
 * status transitions — the caller (Orchestrator.drive) owns generating/done/failed.
 */
export class AgentLoop {
  private delegator!: Delegator;

  constructor(
    private activeRuns: Set<string>,
    private messages: RunMessageStream,
    private permissions: PermissionCoordinator,
    private toolContext: OrchestratorToolContext,
    private registry: ProviderRegistry,
    private usageLogRepo: IUsageLogRepository
  ) {}

  /** Wires the delegation handler. Called once during orchestrator setup. */
  setDelegator(delegator: Delegator): void {
    this.delegator = delegator;
  }

  /**
   * Runs the generation loop with the given model/tools, tagging persisted
   * messages with the supplied agentRole. Returns the model's final text.
   */
  async run(runId: string, run: Run, messages: ChatMessage[], opts: AgentRunOptions): Promise<string> {
    const checkCancelled = () => {
      if (!this.activeRuns.has(runId)) {
        throw new Error("ORCHESTRATION_CANCELLED");
      }
    };

    const provider = this.registry.getProvider(opts.providerId);
    const currentMessages = messages;
    let lastText = "";
    // Tracks whether the agent has taken ANY action this run, and how many idle
    // nudges we've already spent (see AgentRunOptions.idleNudge).
    let toolCallsMade = 0;
    let nudgesUsed = 0;
    let taskListNudgesUsed = 0;
    // Tracks delegation state for post-delegation verification nudges.
    let lastToolWasDelegation = false;
    let postDelegationNudgesUsed = 0;
    let verifiedAfterDelegation = false;
    let filesToVerify: string[] = [];
    let filesVerified: Set<string> = new Set();

    // Context-window enforcement: compact the history in chunks when the prompt
    // nears the model's configured limit. lastPromptTotal carries the REAL token
    // count from the previous response's usage; the chars estimate only covers
    // the cold start (first call of a continuation). Models without a configured
    // limit fall back to a conservative default — no model runs unprotected.
    const contextLimit = this.registry.resolveContextLimit(opts.providerId, opts.model) || DEFAULT_CONTEXT_LIMIT;
    let lastPromptTotal = 0;

    let completionDone = false;
    while (!completionDone) {
      checkCancelled();

      {
        const estimated = lastPromptTotal || estimateTokens(currentMessages, opts.systemPrompt);
        if (estimated >= COMPACT_TRIGGER_RATIO * contextLimit) {
          const compacted = compactHistory(currentMessages, Math.floor(COMPACT_TARGET_RATIO * contextLimit));
          if (compacted) {
            // In place: the array reference is shared with the caller and pushed
            // to throughout this method.
            currentMessages.length = 0;
            currentMessages.push(...compacted.messages);
            lastPromptTotal = 0; // stale after compaction; re-estimate until fresh usage arrives
            console.log(`[context] compacted run=${runId} role=${opts.agentRole ?? "main"} evicted=${compacted.evictedCount} clipped=${compacted.clippedCount} limit=${contextLimit}`);
          }
        }
      }

      const msgId = randomId("msg-res");
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      let hasCreatedMessage = false;

      const startTime = Date.now();
      const response = await provider.complete({
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        reasoning: this.registry.resolveReasoning(opts.providerId, opts.model, opts.reasoningEffort),
        systemPrompt: opts.systemPrompt,
        messages: currentMessages,
        tools: opts.tools
      }, (chunk) => {
        checkCancelled();
        if (chunk.content) accumulatedContent += chunk.content;
        if (chunk.reasoningContent) accumulatedReasoning += chunk.reasoningContent;

        const assistantMsg: RunMessage = {
          id: msgId,
          runId,
          role: "assistant",
          agentRole: opts.agentRole,
          agentName: opts.agentName,
          providerId: opts.providerId,
          providerDisplayName: opts.providerDisplayName,
          model: opts.model,
          content: accumulatedContent,
          reasoningContent: accumulatedReasoning || undefined,
          createdAt: new Date().toISOString()
        };

        if (!hasCreatedMessage) {
          this.messages.emitMessage(runId, assistantMsg);
          hasCreatedMessage = true;
        } else {
          this.messages.updateMessage(runId, assistantMsg);
        }
      });

      checkCancelled();
      await this.messages.flushMessageDbUpdate(msgId);

      // Prompt-cache measurement: one line per model call so cache hit-rate is
      // observable live in the server console during a run. inputTokens is the
      // fresh (full-rate) prompt; cacheRead is served cheaply from cache.
      let usage = response.usage;
      if (!usage) {
        // Fallback estimation (e.g. for streaming OpenAI calls where usage chunk is omitted)
        const promptText = (opts.systemPrompt || "") + messages.map(m => m.content || "").join("\n");
        const estIn = Math.round(promptText.length / 3.5) || 1;
        const estOut = Math.round((response.content || "").length / 3.5) || 1;
        usage = {
          inputTokens: estIn,
          outputTokens: estOut,
          totalTokens: estIn + estOut
        };
      }

      if (usage) {
        const u = usage;
        const fresh = u.inputTokens ?? 0;
        const cacheRead = u.cacheReadInputTokens ?? 0;
        const cacheWrite = u.cacheWriteInputTokens ?? 0;
        const promptTotal = fresh + cacheRead + cacheWrite;
        lastPromptTotal = promptTotal;
        const hitPct = promptTotal > 0 ? Math.round((cacheRead / promptTotal) * 100) : 0;
        const line =
          `[usage] ${new Date().toISOString()} run=${runId} role=${opts.agentRole ?? "main"} model=${opts.model} ` +
          `in=${fresh} cacheRead=${cacheRead} cacheWrite=${cacheWrite} out=${u.outputTokens ?? 0} cacheHit=${hitPct}%`;
        console.log(line);
        // Also append to a local log file so token/cache usage can be inspected
        // after the fact (the console stream is otherwise lost in the dev terminal).
        try {
          const logPath = usageLogPath();
          if (logPath) appendFileSync(logPath, line + "\n");
        } catch {
          // Best-effort only; never let logging break a run.
        }

        // Cost comes solely from the model's user-entered pricing (no built-in
        // table, no name-based guessing). Unpriced models cost 0.
        const pricing = this.registry.resolvePricing(opts.providerId, opts.model);
        const cost = calculateCost(pricing, fresh, u.outputTokens ?? 0, cacheRead, cacheWrite);

        // Write to SQLite database usage_logs table asynchronously
        this.usageLogRepo.create({
          runId,
          agentRole: opts.agentRole ?? "main",
          providerId: opts.providerId,
          model: opts.model,
          inputTokens: fresh,
          outputTokens: u.outputTokens ?? 0,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          cacheHitRate: hitPct,
          cost,
          createdAt: new Date().toISOString(),
          durationMs: Date.now() - startTime
        }).catch(err => {
          console.error(`[Database] Failed to write usage log to database: ${err.message}`);
        });
      }

      const finalMsg: RunMessage = {
        id: msgId,
        runId,
        role: "assistant",
        agentRole: opts.agentRole,
        agentName: opts.agentName,
        providerId: opts.providerId,
        providerDisplayName: opts.providerDisplayName,
        model: opts.model,
        content: response.content || (response.toolCalls ? "Calling workspace tools..." : ""),
        reasoningContent: response.reasoningContent,
        rawResponse: response.toolCalls ? JSON.stringify(response.toolCalls) : undefined,
        createdAt: new Date().toISOString()
      };

      if (!hasCreatedMessage) {
        this.messages.emitMessage(runId, finalMsg);
      } else {
        this.messages.updateMessage(runId, finalMsg);
      }

      if (response.content) lastText = response.content;

      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCallsMade += response.toolCalls.length;
        currentMessages.push({
          role: "assistant",
          content: response.content || "",
          toolCalls: response.toolCalls
        });

        for (const tc of response.toolCalls) {
          checkCancelled();
          const result = await this.runToolCall(runId, run, tc, opts.agentRole);

          const toolMsg: RunMessage = {
            id: randomId("msg-tool"),
            runId,
            role: "tool",
            agentRole: opts.agentRole,
            agentName: opts.agentName,
            content: result,
            createdAt: new Date().toISOString()
          };
          this.messages.emitMessage(runId, toolMsg);

          currentMessages.push({
            role: "tool",
            content: result,
            tool_call_id: tc.id,
            name: tc.function.name
          });

          // Track delegation state for post-delegation verification nudge.
          const toolName = tc.function?.name;
          if (toolName === "delegate_tasks") {
            lastToolWasDelegation = true;
            verifiedAfterDelegation = false;
            // Extract files to verify from the delegation result
            try {
              const delegationResult = JSON.parse(result);
              if (delegationResult._is_verification === true) {
                // The call WAS the verification (verify:true tasks on the coder,
                // read-only). Like the utility path: count it as verified and
                // disable the per-file completeness check.
                verifiedAfterDelegation = true;
                filesToVerify = [];
                filesVerified = new Set();
              } else if (Array.isArray(delegationResult._files_to_verify)) {
                filesToVerify = delegationResult._files_to_verify;
                filesVerified = new Set();
              }
            } catch {
              // If parsing fails, skip tracking
            }
          } else if (toolName === "delegate_to_utility") {
            // The architect offloaded verification to the cheap utility tier
            // (one call covers all changed files). Treat that as full
            // verification — we can't match individual files through it, so
            // disable the per-file completeness check.
            verifiedAfterDelegation = true;
            filesToVerify = [];
            filesVerified = new Set();
          } else if (toolName === "read_file" || toolName === "list_directory" || toolName === "search_files") {
            verifiedAfterDelegation = true;
            // Track which specific file was verified
            if (toolName === "read_file" && filesToVerify.length > 0) {
              try {
                const args = JSON.parse(tc.function?.arguments || "{}");
                if (typeof args.path === "string") {
                  const baseOf = (p: string) => p.split("/").pop() ?? p;
                  const verifiedBase = baseOf(args.path);
                  for (const f of filesToVerify) {
                    if (baseOf(f) === verifiedBase) {
                      filesVerified.add(f);
                    }
                  }
                }
              } catch {
                // If parsing fails, skip tracking
              }
            }
          }
        }
      } else if (
        opts.idleNudge &&
        toolCallsMade === 0 &&
        nudgesUsed < (opts.maxIdleNudges ?? 0)
      ) {
        // The agent ended its turn without ever acting, despite work being
        // expected. Re-add its text and inject one invisible reminder (not
        // persisted, so it stays out of the UI) so it actually calls a tool.
        nudgesUsed++;
        currentMessages.push({ role: "assistant", content: response.content || "" });
        currentMessages.push({ role: "user", content: opts.idleNudge });
      } else if (
        opts.postDelegationNudge &&
        lastToolWasDelegation &&
        !verifiedAfterDelegation &&
        postDelegationNudgesUsed < (opts.maxPostDelegationNudges ?? 0)
      ) {
        // The architect delegated but did not verify the results at all.
        postDelegationNudgesUsed++;
        currentMessages.push({ role: "assistant", content: response.content || "" });
        currentMessages.push({ role: "user", content: opts.postDelegationNudge });
      } else if (
        opts.postDelegationNudge &&
        lastToolWasDelegation &&
        verifiedAfterDelegation &&
        filesToVerify.length > 0 &&
        filesVerified.size < filesToVerify.length &&
        postDelegationNudgesUsed < (opts.maxPostDelegationNudges ?? 0)
      ) {
        // The architect verified SOME but not ALL files.
        postDelegationNudgesUsed++;
        const remaining = filesToVerify.filter(f => !filesVerified.has(f));
        const completenessNudge = `You verified ${filesVerified.size}/${filesToVerify.length} files. Please also verify: ${remaining.join(", ")} before marking tasks complete.`;
        currentMessages.push({ role: "assistant", content: response.content || "" });
        currentMessages.push({ role: "user", content: completenessNudge });
      } else if (
        toolCallsMade > 0 &&
        taskListNudgesUsed < MAX_TASK_LIST_NUDGES &&
        hasOpenTaskListItems(response.content || "")
      ) {
        // The agent worked, then stopped mid-task-list without acting or
        // declaring a blocker. Remind it once (invisibly, like the other nudges).
        taskListNudgesUsed++;
        currentMessages.push({ role: "assistant", content: response.content || "" });
        currentMessages.push({ role: "user", content: OPEN_TASK_LIST_NUDGE });
      } else {
        completionDone = true;
      }
    }

    return lastText;
  }

  /**
   * Resolves a single tool call: dispatches orchestrator-native tools and
   * delegation, enforces the mode's gating policy, then runs workspace tools
   * (prompting for permission when required).
   */
  private async runToolCall(runId: string, run: Run, toolCall: any, agentRole?: string): Promise<string> {
    // This run's mode strategy: it owns the gating policy (which tools are
    // allowed, what must be approved) so the checks below read its flags instead
    // of branching on run.mode directly.
    const strategy = getModeStrategy(run.mode);

    // Orchestrator-native tools (set_chat_title / update_plan / ask_user_question
    // / remember) run silently here — no filesystem/network I/O, no permission
    // gating. Each is a registered handler that owns its own per-mode rules (e.g.
    // update_plan rejects outside plan mode). See orchestrator/tools.
    const nativeTool = getOrchestratorTool(toolCall.function?.name);
    if (nativeTool) {
      return nativeTool.execute(this.toolContext, runId, run, toolCall);
    }

    // delegate_tasks fans out to coder sub-agents; the orchestrator runs their
    // loops itself (the sub-agents' own tool calls are gated normally). Gated by
    // mode FIRST: runs can switch modes mid-thread, so a model continuing a
    // build-mode thread in plan mode may imitate the delegate calls in its
    // history — without this check those would actually launch sub-agents.
    if (toolCall.function?.name === "delegate_tasks" || toolCall.function?.name === "delegate_to_utility") {
      if (!strategy.allowsDelegation) {
        return JSON.stringify({
          success: false,
          error: `Blocked: "${toolCall.function.name}" is not available in ${run.mode} mode. Delegation only runs in build-type modes. Ask the user to switch to Build mode to implement.`
        });
      }
      if (toolCall.function.name === "delegate_tasks") {
        return this.delegator.executeDelegateTasks(runId, run, toolCall);
      }
      // delegate_to_utility fans out to cheap utility sub-agents (lookups/renames).
      return this.delegator.executeUtilityTasks(runId, run, toolCall);
    }

    const toolName = toolCall.function?.name;
    const isDelegated = !!(run.coderModel && run.coderProviderId);

    // Block the Architect (non-coder/non-utility role in a delegation setup) from calling write/delete/run_command directly.
    if (isDelegated && agentRole !== "coder" && agentRole !== "utility" && !READONLY_TOOLS.has(toolName) && toolName !== "search_web" && toolName !== "fetch_url" && toolName !== "delegate_tasks" && toolName !== "delegate_to_utility" && toolName !== "update_plan" && toolName !== "set_chat_title" && toolName !== "ask_user_question" && toolName !== "remember") {
      return JSON.stringify({
        success: false,
        error: `You are the ARCHITECT and cannot run "${toolName}" directly — this is by design, not a missing permission. Delegate it to a coder with delegate_tasks. Example: delegate_tasks({ tasks: [{ title: "<short title>", instructions: "<self-contained English instructions; include any shell command to run>" }] }). For a tiny read-only lookup use delegate_to_utility instead.`
      });
    }

    // Block the Utility sub-agent from calling tools outside the utility set.
    if (agentRole === "utility" && !UTILITY_TOOL_NAMES.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: Utility sub-agent cannot run "${toolName}". Utility is read-only (read_file/list_directory/search_files) plus move_file. Deletes, edits, writes, and shell commands must be delegated to a coder via delegate_tasks — not to utility.`
      });
    }

    // HARD RULE: non-build modes are read-only. No file mutation, no run_command,
    // no fetch_url/search_web — even if the user approves. The model must switch to Build
    // mode before anything changes. We block here regardless of any grant.
    if (!strategy.allowsMutation && MODIFYING_TOOLS.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: "${toolName}" is not allowed in ${run.mode} mode. ${run.mode === "chat" ? "Chat" : "Plan"} mode makes NO changes to the workspace and runs NO commands. Ask the user to switch to Build mode to implement.`
      });
    }

    // Plan mode additionally allows ONLY read-only tools (it offers update_plan,
    // handled above, plus inspection) — block anything else outright.
    if (strategy.allowsPlanTool && !READONLY_TOOLS.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: "${toolName}" is not allowed in Plan mode. Plan mode makes NO changes and runs NO commands. Ask the user to switch to Build mode to implement.`
      });
    }

    const isDangerous = DANGEROUS_TOOLS.has(toolCall.function?.name);
    // run_command / search_web / fetch_url require approval in most modes — but NOT in Full
    // Access mode, where the user has explicitly opted in to autonomous operation
    // with no interruptions. A matching standing grant also lets them run silently
    // in any mode. Other tools gate only in ask_permissions mode (gatesEveryTool).
    const mustGate = !strategy.bypassDangerousGating && (isDangerous || strategy.gatesEveryTool);
    const needsPermission = mustGate && !this.permissions.check(run, toolCall);

    if (needsPermission) {
      const decision = await this.permissions.request(runId, run, toolCall);
      if (decision === "deny") {
        return JSON.stringify({ success: false, error: "Permission denied by user." });
      }
      await this.messages.emitStatus(runId, "generating");
    }
    return executeWorkspaceToolAsync(run, toolCall);
  }
}
