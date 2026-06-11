import type { Run, RunStatus, RunMessage } from "@locagens/shared";
import type { IRunRepository, IMessageRepository } from "../database/repositories.js";
import { eventBus } from "./eventBus.js";

/**
 * Owns a run's outbound message/status persistence and SSE fan-out. It buffers
 * high-frequency token-streaming updates so SQLite is written at most ~once a
 * second per message, tracks every in-flight DB write, and can flush all pending
 * work before a run finishes or is cancelled. The orchestrator and the
 * permission/question coordinators emit through this single stream so DB writes
 * and SSE events stay consistent.
 */
export class RunMessageStream {
  // Throttles high-frequency SQLite writes during live message token streaming.
  private pendingMessageDbUpdates = new Map<string, {
    msg: RunMessage;
    lastWriteTime: number;
    timer: NodeJS.Timeout | null;
  }>();
  private pendingDbWrites = new Set<Promise<unknown>>();

  constructor(
    private runRepo: IRunRepository,
    private messageRepo: IMessageRepository
  ) {}

  /** Registers an in-flight DB write so flushAll can await it later. */
  trackDbWrite<T>(promise: Promise<T>): Promise<T> {
    this.pendingDbWrites.add(promise);
    void promise.then(
      () => this.pendingDbWrites.delete(promise),
      () => this.pendingDbWrites.delete(promise)
    );
    return promise;
  }

  /** Persists a run's status change and broadcasts it over SSE. */
  async emitStatus(runId: string, status: RunStatus, extraUpdates?: Partial<Run>) {
    await this.trackDbWrite(this.runRepo.update(runId, { status, ...extraUpdates }));
    eventBus.emit(`run:${runId}`, { type: "status_changed", status });
  }

  /** Persists a newly created message and broadcasts it. */
  emitMessage(runId: string, msg: RunMessage) {
    this.trackDbWrite(this.messageRepo.create(msg)).catch((err) => {
      console.error(`[Orchestrator] Failed to persist message ${msg.id}:`, err.message);
    });
    eventBus.emit(`run:${runId}`, { type: "message_created", message: msg });
  }

  /** Broadcasts a message update immediately; schedules a throttled DB write. */
  updateMessage(runId: string, msg: RunMessage) {
    this.scheduleMessageDbUpdate(msg);
    eventBus.emit(`run:${runId}`, { type: "message_updated", message: msg });
  }

  private scheduleMessageDbUpdate(msg: RunMessage) {
    const now = Date.now();
    const existing = this.pendingMessageDbUpdates.get(msg.id);

    if (existing) {
      existing.msg = msg;
      if (!existing.timer) {
        const elapsed = now - existing.lastWriteTime;
        const delay = Math.max(0, 1000 - elapsed);
        existing.timer = setTimeout(() => {
          void this.flushMessageDbUpdate(msg.id).catch((err) => {
            console.error(`[Orchestrator] Failed to flush message update ${msg.id}:`, err.message);
          });
        }, delay);
      }
    } else {
      // First update for this message: write immediately
      this.trackDbWrite(this.messageRepo.update(msg.id, {
        content: msg.content,
        reasoningContent: msg.reasoningContent,
        rawResponse: msg.rawResponse
      })).catch((err) => {
        console.error(`[Orchestrator] Failed to persist message update ${msg.id}:`, err.message);
      });
      this.pendingMessageDbUpdates.set(msg.id, {
        msg,
        lastWriteTime: now,
        timer: null
      });
    }
  }

  /** Forces the buffered write for one message to land now. */
  async flushMessageDbUpdate(msgId: string) {
    const entry = this.pendingMessageDbUpdates.get(msgId);
    if (!entry) return;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    await this.trackDbWrite(this.messageRepo.update(msgId, {
      content: entry.msg.content,
      reasoningContent: entry.msg.reasoningContent,
      rawResponse: entry.msg.rawResponse
    }));
    this.pendingMessageDbUpdates.delete(msgId);
  }

  /** Flushes every buffered message write and awaits all tracked DB writes. */
  async flushAllPendingDbUpdates() {
    for (const msgId of this.pendingMessageDbUpdates.keys()) {
      await this.flushMessageDbUpdate(msgId);
    }
    if (this.pendingDbWrites.size > 0) {
      await Promise.allSettled([...this.pendingDbWrites]);
    }
  }
}
