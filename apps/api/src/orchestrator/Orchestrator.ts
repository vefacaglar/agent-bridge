import type { Run, RunStatus, RunMessage, ChatMessage } from "@bridgemind/shared";
import { RunRepository, MessageRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";

export class Orchestrator {
  private activeRuns: Set<string> = new Set();

  constructor(
    private runRepo: RunRepository,
    private messageRepo: MessageRepository,
    private registry: ProviderRegistry
  ) {}

  private emitStatus(runId: string, status: RunStatus, extraUpdates?: Partial<Run>) {
    this.runRepo.update(runId, { status, ...extraUpdates });
    eventBus.emit(`run:${runId}`, { type: "status_changed", status });
  }

  private emitMessage(runId: string, msg: RunMessage) {
    this.messageRepo.create(msg);
    eventBus.emit(`run:${runId}`, { type: "message_created", message: msg });
  }

  cancel(runId: string): boolean {
    if (this.activeRuns.has(runId)) {
      this.activeRuns.delete(runId);
      this.emitStatus(runId, "cancelled");
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Chat generation cancelled by user." });
      console.log(`[Orchestrator] Run ${runId} has been cancelled by user.`);
      return true;
    }
    return false;
  }

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  async run(runId: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run) {
      console.error(`[Orchestrator] Run with id "${runId}" not found in database.`);
      return;
    }

    console.log(`[Orchestrator] Starting single-model chat session: ${runId} ("${run.title}")`);
    this.activeRuns.add(runId);

    // Broadcast starting event
    eventBus.emit(`run:${runId}`, { type: "run_started", runId });
    eventBus.emit(`run:${runId}`, {
      type: "model_snapshot_locked",
      snapshot: {
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model
      }
    });

    try {
      const provider = this.registry.getProvider(run.providerId);

      const checkCancelled = () => {
        if (!this.activeRuns.has(runId)) {
          throw new Error("ORCHESTRATION_CANCELLED");
        }
      };

      checkCancelled();

      console.log(`[Orchestrator] Run ${runId} - Entering GENERATING state`);
      this.emitStatus(runId, "generating");

      const chatMessages: ChatMessage[] = [
        { role: "user", content: run.task }
      ];

      // Request completion
      const response = await provider.complete({
        model: run.model,
        messages: chatMessages
      });

      checkCancelled();

      // Save assistant message
      const assistantMsg: RunMessage = {
        id: `msg-res-${Date.now()}`,
        runId,
        role: "assistant",
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model,
        content: response.content,
        createdAt: new Date().toISOString()
      };

      this.emitMessage(runId, assistantMsg);
      this.emitStatus(runId, "done");
      eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: response.content });
      console.log(`[Orchestrator] Run ${runId} - Completed successfully.`);

    } catch (error: any) {
      if (error.message === "ORCHESTRATION_CANCELLED") {
        console.log(`[Orchestrator] Run ${runId} - Process safely stopped by cancellation.`);
      } else {
        console.error(`[Orchestrator] Run ${runId} - Failed with error:`, error.message);
        this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async continueRun(runId: string, newUserMessage: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run) {
      console.error(`[Orchestrator] Run with id "${runId}" not found for continuation.`);
      return;
    }

    console.log(`[Orchestrator] Continuing single-model chat session: ${runId}`);
    this.activeRuns.add(runId);

    try {
      const provider = this.registry.getProvider(run.providerId);

      const checkCancelled = () => {
        if (!this.activeRuns.has(runId)) {
          throw new Error("ORCHESTRATION_CANCELLED");
        }
      };

      // Fetch all messages (this includes the user message created in server.ts)
      const allMessages = this.messageRepo.listByRunId(runId);
      
      const chatMessages: ChatMessage[] = [
        { role: "user", content: run.task },
        ...allMessages.map(m => ({
          role: m.role,
          content: m.content
        }))
      ];

      console.log(`[Orchestrator] Run ${runId} - Entering GENERATING state for continuation`);
      this.emitStatus(runId, "generating");

      const response = await provider.complete({
        model: run.model,
        messages: chatMessages
      });

      checkCancelled();

      // Save assistant message
      const assistantMsg: RunMessage = {
        id: `msg-res-${Date.now()}`,
        runId,
        role: "assistant",
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model,
        content: response.content,
        createdAt: new Date().toISOString()
      };

      this.emitMessage(runId, assistantMsg);
      this.emitStatus(runId, "done");
      eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: response.content });
      console.log(`[Orchestrator] Run ${runId} continuation completed successfully.`);

    } catch (error: any) {
      if (error.message === "ORCHESTRATION_CANCELLED") {
        console.log(`[Orchestrator] Run ${runId} - Continuation safely cancelled.`);
      } else {
        console.error(`[Orchestrator] Run ${runId} - Continuation failed:`, error.message);
        this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }
}
