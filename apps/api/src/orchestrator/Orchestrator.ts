import type { Run, RunStatus, RunMessage } from "@bridgemind/shared";
import { RunRepository, MessageRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";
import {
  PLANNER_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  compilePlanningMessages,
  compileCoderMessages,
  compileReviewMessages,
  compileCoderFixMessages
} from "./prompts.js";

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
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Orchestration cancelled by user." });
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

    console.log(`[Orchestrator] Starting run: ${runId} ("${run.title}")`);
    this.activeRuns.add(runId);

    // Broadcast starting event
    eventBus.emit(`run:${runId}`, { type: "run_started", runId });
    eventBus.emit(`run:${runId}`, {
      type: "model_snapshot_locked",
      snapshot: {
        plannerProviderId: run.plannerProviderId,
        plannerProviderDisplayName: run.plannerProviderDisplayName,
        plannerModel: run.plannerModel,
        coderProviderId: run.coderProviderId,
        coderProviderDisplayName: run.coderProviderDisplayName,
        coderModel: run.coderModel,
        maxRounds: run.maxRounds
      }
    });

    try {
      // Initialize model provider connections
      const plannerProvider = this.registry.getProvider(run.plannerProviderId);
      const coderProvider = this.registry.getProvider(run.coderProviderId);

      // Helper to check for user cancellation
      const checkCancelled = () => {
        if (!this.activeRuns.has(runId)) {
          throw new Error("ORCHESTRATION_CANCELLED");
        }
      };

      checkCancelled();

      // ==========================================
      // STEP 1 — Planning Phase / Reusing Plan
      // ==========================================
      let planText = "";

      if (run.retryType === "retry-coder" && run.sourceRunId) {
        console.log(`[Orchestrator] Run ${runId} - Copying plan from source run ${run.sourceRunId}`);
        // Fetch plan message from source run
        const sourceMessages = this.messageRepo.listByRunId(run.sourceRunId);
        const planMsg = sourceMessages.find(m => m.agentRole === "planner");
        if (!planMsg) {
          throw new Error(`Planner plan message not found in source run ${run.sourceRunId}`);
        }
        planText = planMsg.content;

        // Copy plan message as a new message under current run in DB and SSE
        this.emitMessage(runId, {
          id: `msg-plan-copied-${Date.now()}`,
          runId,
          role: "assistant",
          agentRole: "planner",
          providerId: run.plannerProviderId,
          providerDisplayName: run.plannerProviderDisplayName,
          model: run.plannerModel,
          content: planText,
          createdAt: new Date().toISOString()
        });
      } else {
        console.log(`[Orchestrator] Run ${runId} - Entering PLANNING state`);
        this.emitStatus(runId, "planning", { currentRound: 0 });

        const planningMsgs = compilePlanningMessages(run.task);
        const plannerRes = await plannerProvider.complete({
          model: run.plannerModel,
          systemPrompt: PLANNER_SYSTEM_PROMPT,
          messages: planningMsgs
        });

        checkCancelled();

        planText = plannerRes.content;
        this.emitMessage(runId, {
          id: `msg-plan-${Date.now()}`,
          runId,
          role: "assistant",
          agentRole: "planner",
          providerId: run.plannerProviderId,
          providerDisplayName: run.plannerProviderDisplayName,
          model: run.plannerModel,
          content: planText,
          createdAt: new Date().toISOString()
        });
      }

      // ==========================================
      // STEP 2 & 3 — Coder-Reviewer Loop
      // ==========================================
      let round = 1;
      let coderOutput = "";
      let reviewOutput = "";
      let isAccepted = false;

      while (round <= run.maxRounds && !isAccepted) {
        checkCancelled();

        // Broadcast round start
        eventBus.emit(`run:${runId}`, { type: "round_started", round });

        // --- Coder Output ---
        const activeStatus: RunStatus = round === 1 ? "implementing" : "fixing";
        console.log(`[Orchestrator] Run ${runId} - Entering ${activeStatus.toUpperCase()} state (Round ${round}/${run.maxRounds})`);
        this.emitStatus(runId, activeStatus, { currentRound: round });

        const coderMsgs = round === 1 
          ? compileCoderMessages(run.task, planText)
          : compileCoderFixMessages(run.task, planText, coderOutput, reviewOutput);

        const coderRes = await coderProvider.complete({
          model: run.coderModel,
          systemPrompt: CODER_SYSTEM_PROMPT,
          messages: coderMsgs
        });

        checkCancelled();

        coderOutput = coderRes.content;
        this.emitMessage(runId, {
          id: `msg-code-r${round}-${Date.now()}`,
          runId,
          role: "assistant",
          agentRole: "coder",
          providerId: run.coderProviderId,
          providerDisplayName: run.coderProviderDisplayName,
          model: run.coderModel,
          content: coderOutput,
          createdAt: new Date().toISOString()
        });

        checkCancelled();

        // --- Reviewer Output ---
        console.log(`[Orchestrator] Run ${runId} - Entering REVIEWING state (Round ${round}/${run.maxRounds})`);
        this.emitStatus(runId, "reviewing");

        const reviewMsgs = compileReviewMessages(run.task, planText, coderOutput);
        const reviewRes = await plannerProvider.complete({
          model: run.plannerModel,
          systemPrompt: PLANNER_SYSTEM_PROMPT,
          messages: reviewMsgs
        });

        checkCancelled();

        reviewOutput = reviewRes.content;
        this.emitMessage(runId, {
          id: `msg-rev-r${round}-${Date.now()}`,
          runId,
          role: "assistant",
          agentRole: "reviewer",
          providerId: run.plannerProviderId,
          providerDisplayName: run.plannerProviderDisplayName,
          model: run.plannerModel,
          content: reviewOutput,
          createdAt: new Date().toISOString()
        });

        // Parse acceptance marker
        if (reviewOutput.includes("FINAL_ACCEPTED")) {
          isAccepted = true;
          console.log(`[Orchestrator] Run ${runId} - ACCEPTED in round ${round}`);
        } else {
          console.log(`[Orchestrator] Run ${runId} - CHANGES REQUIRED in round ${round}`);
          round++;
        }
      }

      checkCancelled();

      // ==========================================
      // STEP 4 — Loop Termination
      // ==========================================
      if (isAccepted) {
        this.emitStatus(runId, "done", { finalOutput: coderOutput });
        eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: coderOutput });
        console.log(`[Orchestrator] Run ${runId} - Completed successfully.`);
      } else {
        this.emitStatus(runId, "max_rounds_reached", { finalOutput: coderOutput });
        eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: coderOutput });
        console.log(`[Orchestrator] Run ${runId} - Loop stopped due to max rounds reached.`);
      }

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
}
