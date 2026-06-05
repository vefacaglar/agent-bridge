import type { Run, RunStatus, RunMessage, ChatMessage } from "@bridgemind/shared";
import type { ModelProvider } from "../providers/ModelProvider.js";
import { RunRepository, MessageRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";
import { db } from "../database/db.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { WORKSPACE_TOOLS, executeWorkspaceTool, buildPermissionPreview } from "./workspaceTools.js";

type PermissionDecision = "allow_once" | "allow_project" | "allow_always" | "deny";

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

export class Orchestrator {
  private activeRuns: Set<string> = new Set();
  private pendingPermissions = new Map<string, {
    resolve: (decision: PermissionDecision) => void;
    toolCall: any;
  }>();

  constructor(
    private runRepo: RunRepository,
    private messageRepo: MessageRepository,
    private registry: ProviderRegistry
  ) {}

  // --- Permission handling -------------------------------------------------

  resolvePermission(runId: string, decision: PermissionDecision): boolean {
    const pending = this.pendingPermissions.get(runId);
    if (pending) {
      pending.resolve(decision);
      this.pendingPermissions.delete(runId);
      return true;
    }
    return false;
  }

  getPendingPermission(runId: string) {
    return this.pendingPermissions.get(runId);
  }

  private checkPermission(projectPath?: string): boolean {
    try {
      const globalPerm = db.prepare("SELECT * FROM permissions WHERE scope = 'global' AND status = 'allowed'").get();
      if (globalPerm) return true;

      if (projectPath) {
        const projectPerm = db
          .prepare("SELECT * FROM permissions WHERE scope = 'project' AND project_path = ? AND status = 'allowed'")
          .get(projectPath);
        if (projectPerm) return true;
      }
    } catch (err) {
      console.error("[Orchestrator] Error checking permissions:", err);
    }
    return false;
  }

  private async requestPermission(runId: string, run: Run, toolCall: any): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pendingPermissions.set(runId, { resolve, toolCall });
      this.emitStatus(runId, "awaiting_permission");
      eventBus.emit(`run:${runId}`, {
        type: "permission_requested",
        runId,
        toolCall,
        preview: buildPermissionPreview(run, toolCall)
      });
    });
  }

  // --- Event helpers -------------------------------------------------------

  private emitStatus(runId: string, status: RunStatus, extraUpdates?: Partial<Run>) {
    this.runRepo.update(runId, { status, ...extraUpdates });
    eventBus.emit(`run:${runId}`, { type: "status_changed", status });
  }

  private emitMessage(runId: string, msg: RunMessage) {
    this.messageRepo.create(msg);
    eventBus.emit(`run:${runId}`, { type: "message_created", message: msg });
  }

  private updateMessage(runId: string, msg: RunMessage) {
    this.messageRepo.update(msg.id, {
      content: msg.content,
      reasoningContent: msg.reasoningContent,
      rawResponse: msg.rawResponse
    });
    eventBus.emit(`run:${runId}`, { type: "message_updated", message: msg });
  }

  // --- Run lifecycle -------------------------------------------------------

  cancel(runId: string): boolean {
    // Unblock any pending permission promise so the run loop can unwind.
    const pending = this.pendingPermissions.get(runId);
    if (pending) {
      pending.resolve("deny");
      this.pendingPermissions.delete(runId);
    }

    if (this.activeRuns.has(runId)) {
      this.activeRuns.delete(runId);
      this.emitStatus(runId, "cancelled");
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Chat generation cancelled by user." });
      console.log(`[Orchestrator] Run ${runId} has been cancelled by user.`);
      return true;
    }

    // Fallback for runs marked active in DB but not in memory (e.g. after restart).
    const run = this.runRepo.getById(runId);
    if (run && (run.status === "created" || run.status === "generating" || run.status === "awaiting_permission")) {
      this.emitStatus(runId, "cancelled");
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Chat generation cancelled by user." });
      console.log(`[Orchestrator] Run ${runId} (inactive in memory) has been marked as cancelled.`);
      return true;
    }

    return false;
  }

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  /** Starts a brand new chat session for a freshly created run. */
  async run(runId: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run) {
      console.error(`[Orchestrator] Run with id "${runId}" not found in database.`);
      return;
    }

    console.log(`[Orchestrator] Starting single-model chat session: ${runId} ("${run.title}")`);
    this.activeRuns.add(runId);

    eventBus.emit(`run:${runId}`, { type: "run_started", runId });
    eventBus.emit(`run:${runId}`, {
      type: "model_snapshot_locked",
      snapshot: {
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model
      }
    });

    await this.drive(runId, run, [{ role: "user", content: run.task }]);
  }

  /** Continues an existing run with new user input, replaying stored history. */
  async continueRun(runId: string, _newUserMessage: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run) {
      console.error(`[Orchestrator] Run with id "${runId}" not found for continuation.`);
      return;
    }

    console.log(`[Orchestrator] Continuing single-model chat session: ${runId}`);
    this.activeRuns.add(runId);

    const history = this.rebuildHistory(runId, run.task);
    await this.drive(runId, run, history);
  }

  /**
   * Reconstructs the provider-facing message list from persisted messages,
   * reattaching tool_call ids so tool results line up with their calls.
   */
  private rebuildHistory(runId: string, task: string): ChatMessage[] {
    const allMessages = this.messageRepo.listByRunId(runId);
    const chatMessages: ChatMessage[] = [{ role: "user", content: task }];

    for (const m of allMessages) {
      const chatMsg: ChatMessage = { role: m.role, content: m.content };

      if (m.role === "tool") {
        const precedingAssistant = allMessages
          .slice(0, allMessages.indexOf(m))
          .reverse()
          .find(msg => msg.role === "assistant" && msg.rawResponse);

        if (precedingAssistant && precedingAssistant.rawResponse) {
          try {
            const tcList = JSON.parse(precedingAssistant.rawResponse);
            if (Array.isArray(tcList) && tcList.length > 0) {
              const toolIndex = allMessages
                .slice(allMessages.indexOf(precedingAssistant) + 1, allMessages.indexOf(m))
                .filter(msg => msg.role === "tool").length;
              if (tcList[toolIndex]) {
                chatMsg.tool_call_id = tcList[toolIndex].id;
                chatMsg.name = tcList[toolIndex].function.name;
              }
            }
          } catch (e) { /* ignore malformed raw response */ }
        }

        if (!chatMsg.tool_call_id) {
          chatMsg.tool_call_id = "call_fallback";
          chatMsg.name = "write_file";
        }
      } else if (m.role === "assistant" && m.rawResponse) {
        try {
          const tcs = JSON.parse(m.rawResponse);
          if (Array.isArray(tcs)) {
            chatMsg.toolCalls = tcs;
          }
        } catch (e) { /* ignore malformed raw response */ }
      }

      chatMessages.push(chatMsg);
    }

    return chatMessages;
  }

  /**
   * Shared generation loop used by both fresh runs and continuations:
   * calls the model, executes any tool calls (gated by permissions), and
   * repeats until the model returns a final answer with no tool calls.
   */
  private async drive(runId: string, run: Run, initialMessages: ChatMessage[]): Promise<void> {
    const checkCancelled = () => {
      if (!this.activeRuns.has(runId)) {
        throw new Error("ORCHESTRATION_CANCELLED");
      }
    };

    try {
      const provider = this.registry.getProvider(run.providerId);
      const currentMessages: ChatMessage[] = [...initialMessages];

      console.log(`[Orchestrator] Run ${runId} - Entering GENERATING state`);
      this.emitStatus(runId, "generating");

      let completionDone = false;
      while (!completionDone) {
        checkCancelled();

        const msgId = randomId("msg-res");
        let accumulatedContent = "";
        let accumulatedReasoning = "";
        let hasCreatedMessage = false;

        const response = await provider.complete({
          model: run.model,
          systemPrompt: buildSystemPrompt(run.projectName, run.projectPath, run.mode),
          messages: currentMessages,
          tools: WORKSPACE_TOOLS
        }, (chunk) => {
          checkCancelled();
          if (chunk.content) accumulatedContent += chunk.content;
          if (chunk.reasoningContent) accumulatedReasoning += chunk.reasoningContent;

          const assistantMsg: RunMessage = {
            id: msgId,
            runId,
            role: "assistant",
            providerId: run.providerId,
            providerDisplayName: run.providerDisplayName,
            model: run.model,
            content: accumulatedContent,
            reasoningContent: accumulatedReasoning || undefined,
            createdAt: new Date().toISOString()
          };

          if (!hasCreatedMessage) {
            this.emitMessage(runId, assistantMsg);
            hasCreatedMessage = true;
          } else {
            this.updateMessage(runId, assistantMsg);
          }
        });

        checkCancelled();

        const finalMsg: RunMessage = {
          id: msgId,
          runId,
          role: "assistant",
          providerId: run.providerId,
          providerDisplayName: run.providerDisplayName,
          model: run.model,
          content: response.content || (response.toolCalls ? "Calling workspace tools..." : ""),
          reasoningContent: response.reasoningContent,
          rawResponse: response.toolCalls ? JSON.stringify(response.toolCalls) : undefined,
          createdAt: new Date().toISOString()
        };

        if (!hasCreatedMessage) {
          this.emitMessage(runId, finalMsg);
        } else {
          this.updateMessage(runId, finalMsg);
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          currentMessages.push({
            role: "assistant",
            content: response.content || "",
            toolCalls: response.toolCalls
          });

          for (const tc of response.toolCalls) {
            checkCancelled();
            const result = await this.runToolCall(runId, run, tc);

            const toolMsg: RunMessage = {
              id: randomId("msg-tool"),
              runId,
              role: "tool",
              content: result,
              createdAt: new Date().toISOString()
            };
            this.emitMessage(runId, toolMsg);

            currentMessages.push({
              role: "tool",
              content: result,
              tool_call_id: tc.id,
              name: tc.function.name
            });
          }
        } else {
          completionDone = true;
        }
      }

      this.emitStatus(runId, "done");
      const lastContent = currentMessages[currentMessages.length - 1]?.content || "";
      eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: lastContent });
      console.log(`[Orchestrator] Run ${runId} - Completed successfully.`);
    } catch (error: any) {
      if (error.message === "ORCHESTRATION_CANCELLED") {
        console.log(`[Orchestrator] Run ${runId} - Process safely stopped by cancellation.`);
      } else {
        console.error(`[Orchestrator] Run ${runId} - Failed with error:`, error.message);

        const errorMsg: RunMessage = {
          id: randomId("msg-err"),
          runId,
          role: "system",
          content: error.message || "Failed to query provider.",
          createdAt: new Date().toISOString()
        };
        this.emitMessage(runId, errorMsg);

        this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /**
   * Resolves a single tool call: gates it behind the permission flow when the
   * run is in ask_permissions mode, then runs it against the workspace.
   */
  private async runToolCall(runId: string, run: Run, toolCall: any): Promise<string> {
    if (run.mode === "ask_permissions" && !this.checkPermission(run.projectPath)) {
      const decision = await this.requestPermission(runId, run, toolCall);
      if (decision === "deny") {
        return JSON.stringify({ success: false, error: "Permission denied by user." });
      }
      this.emitStatus(runId, "generating");
    }
    return executeWorkspaceTool(run, toolCall);
  }
}
