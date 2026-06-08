import type { UserQuestion } from "@agent-bridge/shared";
import { eventBus } from "./eventBus.js";
import type { RunMessageStream } from "./RunMessageStream.js";
import type { QuestionAnswerInput } from "./tools/index.js";

/** A pending ask_user_question request: the resolver plus the asked questions. */
interface PendingQuestion {
  resolve: (answer: QuestionAnswerInput) => void;
  questions: UserQuestion[];
}

/**
 * Owns the ask_user_question flow for a run: pausing the run, surfacing the
 * questions over SSE, and resolving with the user's selections. Unlike
 * permissions it needs no serialization chain — only the main agent (a single
 * sequential loop) ever asks questions; sub-agents never get the tool.
 */
export class QuestionCoordinator {
  private pending = new Map<string, PendingQuestion>();

  constructor(
    private activeRuns: Set<string>,
    private messages: RunMessageStream
  ) {}

  /** Resolves a pending request with the user's answer. Returns false if none. */
  resolve(runId: string, answer: QuestionAnswerInput): boolean {
    const pending = this.pending.get(runId);
    if (pending) {
      pending.resolve(answer);
      this.pending.delete(runId);
      return true;
    }
    return false;
  }

  getPending(runId: string) {
    return this.pending.get(runId);
  }

  /** Resolves a pending request with no selections so the loop can unwind (cancel). */
  cancelPending(runId: string) {
    const pending = this.pending.get(runId);
    if (pending) {
      pending.resolve({ selections: [], notes: [] });
      this.pending.delete(runId);
    }
  }

  /**
   * Pauses the run and asks the user one or more multiple-choice questions,
   * resolving with their selections (one string[] per question). Mirrors the
   * permission flow: emits the request, flips status to awaiting_input, and waits.
   */
  async request(runId: string, questions: UserQuestion[]): Promise<QuestionAnswerInput> {
    if (!this.activeRuns.has(runId)) return { selections: [], notes: [] };
    return await new Promise<QuestionAnswerInput>((resolve) => {
      this.pending.set(runId, { resolve, questions });
      void this.messages.emitStatus(runId, "awaiting_input");
      eventBus.emit(`run:${runId}`, { type: "question_requested", runId, questions });
    });
  }
}
