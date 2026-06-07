import type { Run, RunStatus, RunMessage, ChatMessage, PlanTask, UserQuestion, ReasoningEffort } from "@agent-bridge/shared";
import type { ModelProvider } from "../providers/ModelProvider.js";
import { RunRepository, MessageRepository, PlanRepository, MemoryRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";
import { appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { db } from "../database/db.js";
import { buildSystemPrompt, buildCoderSystemPrompt, buildUtilitySystemPrompt, formatMemoryContext } from "./systemPrompt.js";
import { WORKSPACE_TOOLS, UPDATE_PLAN_TOOL, DELEGATE_TASKS_TOOL, DELEGATE_UTILITY_TOOL, UTILITY_TOOLS, UTILITY_TOOL_NAMES, SET_TITLE_TOOL, ASK_QUESTION_TOOL, REMEMBER_TOOL, executeWorkspaceToolAsync, buildPermissionPreview, DANGEROUS_TOOLS, READONLY_TOOLS, MODIFYING_TOOLS, permissionKey, commandEscapesWorkspace } from "./workspaceTools.js";

type PermissionDecision = "allow_once" | "allow_project" | "allow_always" | "deny";

/** The user's reply to an ask_user_question request, aligned to the questions order. */
interface QuestionAnswerInput {
  selections: string[][];  // chosen option labels per question
  notes: string[];         // free-text comment per question ("" if none)
}

/** One execution attempt for a delegated task: a model paired with its toolset. */
interface SubAgentTier {
  providerId: string;
  providerDisplayName: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  tools: any[];
  agentRole: RunMessage["agentRole"];
  systemPrompt: string;
  agentName: string;
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
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

export class Orchestrator {
  private activeRuns: Set<string> = new Set();
  private pendingPermissions = new Map<string, {
    resolve: (decision: PermissionDecision) => void;
    toolCall: any;
  }>();
  // Serializes concurrent permission prompts for the same run. Parallel coder
  // sub-agents share one runId and the pending-permission slot is single, so
  // their approval prompts must be shown one at a time, not overwrite each other.
  private permissionChain = new Map<string, Promise<void>>();
  // Pending ask_user_question requests, keyed by runId. Resolved with the user's
  // answer: chosen option labels AND a free-text note per question (both aligned
  // to the questions order).
  private pendingQuestions = new Map<string, {
    resolve: (answer: QuestionAnswerInput) => void;
    questions: UserQuestion[];
  }>();

  // Throttles high-frequency SQLite writes during live message token streaming
  private pendingMessageDbUpdates = new Map<string, {
    msg: RunMessage;
    lastWriteTime: number;
    timer: NodeJS.Timeout | null;
  }>();
  private pendingDbWrites = new Set<Promise<unknown>>();

  constructor(
    private runRepo: RunRepository,
    private messageRepo: MessageRepository,
    private registry: ProviderRegistry,
    private planRepo: PlanRepository,
    private memoryRepo: MemoryRepository
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

  // --- User question handling ----------------------------------------------

  resolveQuestion(runId: string, answer: QuestionAnswerInput): boolean {
    const pending = this.pendingQuestions.get(runId);
    if (pending) {
      pending.resolve(answer);
      this.pendingQuestions.delete(runId);
      return true;
    }
    return false;
  }

  getPendingQuestion(runId: string) {
    return this.pendingQuestions.get(runId);
  }

  /**
   * Pauses the run and asks the user one or more multiple-choice questions,
   * resolving with their selections (one string[] per question). Mirrors the
   * permission flow: emits the request, flips status to awaiting_input, and waits.
   * No serialization chain is needed — only the main agent (a single sequential
   * loop) ever asks questions; sub-agents never get the tool.
   */
  private async requestUserAnswer(runId: string, questions: UserQuestion[]): Promise<QuestionAnswerInput> {
    if (!this.activeRuns.has(runId)) return { selections: [], notes: [] };
    return await new Promise<QuestionAnswerInput>((resolve) => {
      this.pendingQuestions.set(runId, { resolve, questions });
      void this.emitStatus(runId, "awaiting_input");
      eventBus.emit(`run:${runId}`, { type: "question_requested", runId, questions });
    });
  }

  /**
   * Whether a standing grant covers this tool call. Grants are scoped per tool.
   * For run_command the match is by PREFIX: approving "go build ./internal/config/"
   * also covers "go build ./internal/config/..." (the new command starts with the
   * granted one). This lets one approval cover closely-related invocations without
   * re-prompting. Other tools (e.g. fetch_url host) still match exactly.
   */
  private checkPermission(run: Run, toolCall: any): boolean {
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

  private async requestPermission(runId: string, run: Run, toolCall: any): Promise<PermissionDecision> {
    // Acquire the per-run permission lock so only one prompt is outstanding at a
    // time (parallel sub-agents would otherwise clobber the single pending slot).
    const prev = this.permissionChain.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    this.permissionChain.set(runId, prev.then(() => gate));
    await prev;

    try {
      // If the run was cancelled while we waited in line, deny without prompting.
      if (!this.activeRuns.has(runId)) return "deny";

      return await new Promise<PermissionDecision>((resolve) => {
        this.pendingPermissions.set(runId, { resolve, toolCall });
        void this.emitStatus(runId, "awaiting_permission");
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

  // --- Event helpers -------------------------------------------------------

  private trackDbWrite<T>(promise: Promise<T>): Promise<T> {
    this.pendingDbWrites.add(promise);
    void promise.then(
      () => this.pendingDbWrites.delete(promise),
      () => this.pendingDbWrites.delete(promise)
    );
    return promise;
  }

  private async emitStatus(runId: string, status: RunStatus, extraUpdates?: Partial<Run>) {
    await this.trackDbWrite(this.runRepo.update(runId, { status, ...extraUpdates }));
    eventBus.emit(`run:${runId}`, { type: "status_changed", status });
  }

  private emitMessage(runId: string, msg: RunMessage) {
    this.trackDbWrite(this.messageRepo.create(msg)).catch((err) => {
      console.error(`[Orchestrator] Failed to persist message ${msg.id}:`, err.message);
    });
    eventBus.emit(`run:${runId}`, { type: "message_created", message: msg });
  }

  private updateMessage(runId: string, msg: RunMessage) {
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

  private async flushMessageDbUpdate(msgId: string) {
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

  private async flushAllPendingDbUpdates() {
    for (const msgId of this.pendingMessageDbUpdates.keys()) {
      await this.flushMessageDbUpdate(msgId);
    }
    if (this.pendingDbWrites.size > 0) {
      await Promise.allSettled([...this.pendingDbWrites]);
    }
  }

  // --- Run lifecycle -------------------------------------------------------

  async cancel(runId: string): Promise<boolean> {
    await this.flushAllPendingDbUpdates();
    // Unblock any pending permission promise so the run loop can unwind.
    const pending = this.pendingPermissions.get(runId);
    if (pending) {
      pending.resolve("deny");
      this.pendingPermissions.delete(runId);
    }
    // Likewise resolve any pending question (with no selections) so its tool call
    // returns and the loop can unwind.
    const pendingQ = this.pendingQuestions.get(runId);
    if (pendingQ) {
      pendingQ.resolve({ selections: [], notes: [] });
      this.pendingQuestions.delete(runId);
    }

    if (this.activeRuns.has(runId)) {
      this.activeRuns.delete(runId);
      await this.emitStatus(runId, "cancelled");
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Chat generation cancelled by user." });
      console.log(`[Orchestrator] Run ${runId} has been cancelled by user.`);
      return true;
    }

    // Fallback for runs marked active in DB but not in memory (e.g. after restart).
    const run = this.runRepo.getById(runId);
    if (run && (run.status === "created" || run.status === "generating" || run.status === "awaiting_permission")) {
      await this.emitStatus(runId, "cancelled");
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
        model: run.model,
        reasoningEffort: run.reasoningEffort
      }
    });

    await this.drive(runId, run, [{ role: "user", content: run.task }], true);
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
    await this.drive(runId, run, history, false);
  }

  /**
   * Reconstructs the provider-facing message list from persisted messages,
   * pairing each assistant tool_call with its results so the history is valid
   * for strict providers ("a tool result must immediately follow its call").
   *
   * Replays ONLY top-level (architect/main) messages: coder & utility sub-agent
   * messages are internal to a delegate_tasks/delegate_to_utility call — the
   * architect never saw them, only the summarized tool result — and including
   * them would interleave their messages between the architect's delegate
   * tool_call and its result.
   */
  private rebuildHistory(runId: string, task: string): ChatMessage[] {
    const messages = this.messageRepo
      .listByRunId(runId)
      .filter(m => m.agentRole !== "coder" && m.agentRole !== "utility");
    const chatMessages: ChatMessage[] = [{ role: "user", content: task }];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];

      // A tool message reached here directly is an orphan result: its assistant
      // tool_call (if any) consumes its results in the assistant branch below, so
      // anything left over has no matching call. Drop it — sending it would make
      // a provider reject the whole request.
      if (m.role === "tool") continue;

      if (m.role === "assistant") {
        let toolCalls: any[] | undefined;
        if (m.rawResponse) {
          try {
            const parsed = JSON.parse(m.rawResponse);
            if (Array.isArray(parsed) && parsed.length > 0) toolCalls = parsed;
          } catch { /* ignore malformed raw response */ }
        }

        if (!toolCalls) {
          chatMessages.push({ role: "assistant", content: m.content });
          continue;
        }

        // The N tool results for this call are the next N consecutive tool
        // messages. Collect them in order.
        const results: RunMessage[] = [];
        let j = i + 1;
        while (j < messages.length && messages[j].role === "tool" && results.length < toolCalls.length) {
          results.push(messages[j]);
          j++;
        }

        if (results.length < toolCalls.length) {
          // Results are missing (e.g. the run was cancelled mid tool execution).
          // Drop the tool_calls rather than send calls without results.
          chatMessages.push({ role: "assistant", content: m.content });
          continue;
        }

        chatMessages.push({ role: "assistant", content: m.content || "", toolCalls });
        for (let k = 0; k < toolCalls.length; k++) {
          chatMessages.push({
            role: "tool",
            content: results[k].content,
            tool_call_id: toolCalls[k].id,
            name: toolCalls[k].function?.name
          });
        }
        i = j - 1; // skip the consumed result messages
        continue;
      }

      // system / user messages pass through unchanged
      chatMessages.push({ role: m.role, content: m.content });
    }

    return chatMessages;
  }

  /** Resolves how many coder sub-agents this run may launch (preset-bound, 1..3). */
  private maxSubAgentsFor(run: Run): number {
    const preset = run.agentPreset ? this.registry.getAgentPreset(run.agentPreset) : undefined;
    return Math.min(3, Math.max(1, preset?.maxSubAgents ?? 3));
  }

  /**
   * Whether this run's preset opts into the sub-agent fallback chain. When on, a
   * delegated task that errors out escalates (utility -> coder -> architect), and
   * the architect can take over directly as a last resort. Resolved live from the
   * preset; absent/deleted preset => off.
   */
  private fallbackEnabled(run: Run): boolean {
    const preset = run.agentPreset ? this.registry.getAgentPreset(run.agentPreset) : undefined;
    return !!preset?.fallback;
  }

  /**
   * Top-level run driver used by both fresh runs and continuations. Sets up the
   * architect/main agent loop (advertising delegate_tasks when a coder model is
   * configured), then finalizes run status. The generation loop itself lives in
   * runAgentLoop, which is reused by coder sub-agents.
   */
  private async drive(
    runId: string,
    run: Run,
    initialMessages: ChatMessage[],
    shouldReadProjectGuidance: boolean
  ): Promise<void> {
    try {
      console.log(`[Orchestrator] Run ${runId} - Entering GENERATING state`);
      await this.emitStatus(runId, "generating");

      // Dual-model: when a coder model is wired up, the main model is the
      // architect — it gets the delegate_tasks tool and architect instructions.
      // Delegation means implementation, so it is only offered in build-type
      // modes — never in plan mode (planning only) or chat mode (lightweight).
      const canDelegate = run.mode !== "plan" && run.mode !== "chat";
      // An optional utility tier (cheap lookups/renames) rides alongside the
      // coder; it is only offered when the preset configured a utility model.
      const hasUtility = !!(run.utilityModel && run.utilityProviderId);
      const delegation = (canDelegate && run.coderModel && run.coderProviderId)
        ? {
            coderModel: run.coderModel,
            maxSubAgents: this.maxSubAgentsFor(run),
            utilityModel: hasUtility ? run.utilityModel : undefined
          }
        : undefined;

      // Plan mode is planning-only: expose ONLY read-only tools plus update_plan,
      // so the model literally cannot mutate the workspace or run commands there.
      // When a coder is configured the architect is also held to read-only tools:
      // it physically cannot write code / run commands itself, so the only way to
      // implement is to delegate (weak models otherwise ignore the soft "prefer
      // delegating" instruction and do all the work directly).
      // Plain single-model runs get the full toolset.
      const readonlyTools = WORKSPACE_TOOLS.filter(t => READONLY_TOOLS.has(t.function.name));
      const baseTools = run.mode === "plan"
        ? [...readonlyTools, UPDATE_PLAN_TOOL]
        : run.mode === "chat"
          ? WORKSPACE_TOOLS.filter(t => !MODIFYING_TOOLS.has(t.function.name))
          : delegation
            ? [...readonlyTools]
            : [...WORKSPACE_TOOLS];
      const withDelegate = delegation ? [...baseTools, DELEGATE_TASKS_TOOL] : baseTools;
      // The utility-delegation tool is offered only when a utility model is
      // configured (and the run can delegate at all).
      const withUtility = delegation?.utilityModel ? [...withDelegate, DELEGATE_UTILITY_TOOL] : withDelegate;
      // set_chat_title, ask_user_question and remember are available to the main
      // agent in every mode (they only rename the run / ask the user / save a
      // memory row); sub-agents never get them.
      const tools = [...withUtility, SET_TITLE_TOOL, ASK_QUESTION_TOOL, REMEMBER_TOOL];

      // Durable memories for this run's context (all global + this project's),
      // injected into the system prompt so the model honors them from the start.
      const memoryContext = formatMemoryContext(this.memoryRepo.listForContext(run.projectPath));

      const systemPrompt = buildSystemPrompt(
        run.projectName,
        run.projectPath,
        run.mode,
        run.mode !== "chat" && shouldReadProjectGuidance,
        delegation,
        memoryContext
      );

      const finalText = await this.runAgentLoop(runId, run, [...initialMessages], {
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model,
        reasoningEffort: run.reasoningEffort,
        systemPrompt,
        tools,
        agentRole: delegation ? "planner" : undefined
      });

      await this.emitStatus(runId, "done");
      eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: finalText });
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

        await this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      await this.flushAllPendingDbUpdates();
      this.activeRuns.delete(runId);
      this.permissionChain.delete(runId);
      this.pendingQuestions.delete(runId);
    }
  }

  /**
   * Model-agnostic generation loop: calls the given model, streams + persists its
   * messages (tagged with the supplied agentRole), executes any tool calls (gated
   * by permissions), and repeats until the model returns a final answer with no
   * tool calls. Used for the architect/main agent AND for each coder sub-agent.
   * Returns the model's final text. Does not change run-level status — the caller
   * owns generating/done/failed transitions.
   */
  private async runAgentLoop(
    runId: string,
    run: Run,
    messages: ChatMessage[],
    opts: {
      providerId: string;
      providerDisplayName: string;
      model: string;
      reasoningEffort?: ReasoningEffort;
      systemPrompt: string;
      tools: any[];
      agentRole?: RunMessage["agentRole"];
      agentName?: string;
    }
  ): Promise<string> {
    const checkCancelled = () => {
      if (!this.activeRuns.has(runId)) {
        throw new Error("ORCHESTRATION_CANCELLED");
      }
    };

    const provider = this.registry.getProvider(opts.providerId);
    const currentMessages = messages;
    let lastText = "";

    let completionDone = false;
    while (!completionDone) {
      checkCancelled();

      const msgId = randomId("msg-res");
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      let hasCreatedMessage = false;

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
          this.emitMessage(runId, assistantMsg);
          hasCreatedMessage = true;
        } else {
          this.updateMessage(runId, assistantMsg);
        }
      });

      checkCancelled();
      await this.flushMessageDbUpdate(msgId);

      // Prompt-cache measurement: one line per model call so cache hit-rate is
      // observable live in the server console during a run. inputTokens is the
      // fresh (full-rate) prompt; cacheRead is served cheaply from cache.
      if (response.usage) {
        const u = response.usage;
        const fresh = u.inputTokens ?? 0;
        const cacheRead = u.cacheReadInputTokens ?? 0;
        const cacheWrite = u.cacheWriteInputTokens ?? 0;
        const promptTotal = fresh + cacheRead + cacheWrite;
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
        this.emitMessage(runId, finalMsg);
      } else {
        this.updateMessage(runId, finalMsg);
      }

      if (response.content) lastText = response.content;

      if (response.toolCalls && response.toolCalls.length > 0) {
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

    return lastText;
  }

  /**
   * Runs a delegated task through an ordered list of execution tiers, escalating
   * to the next tier only when one throws a provider/network error (cancellation
   * is never swallowed). This is the resilience chain: utility -> coder ->
   * architect. If a cheap model is unavailable the work retries on a stronger
   * one, and as a last resort the architect executes it directly with the full
   * workspace toolset. Normal tool failures are NOT thrown — they come back
   * inside the sub-agent's summary — so they never trigger escalation here.
   */
  private async runTaskWithFallback(
    runId: string,
    run: Run,
    task: { title: string; instructions: string },
    tiers: SubAgentTier[]
  ): Promise<{ title: string; summary: string }> {
    let lastError: any;
    for (let t = 0; t < tiers.length; t++) {
      const tier = tiers[t];
      try {
        const summary = await this.runAgentLoop(runId, run, [{ role: "user", content: task.instructions }], {
          providerId: tier.providerId,
          providerDisplayName: tier.providerDisplayName,
          model: tier.model,
          reasoningEffort: tier.reasoningEffort,
          systemPrompt: tier.systemPrompt,
          tools: tier.tools,
          agentRole: tier.agentRole,
          agentName: tier.agentName
        });
        return { title: task.title, summary: summary || "(no summary returned)" };
      } catch (err: any) {
        // Cancellation must unwind the whole run — never swallow it as a tier failure.
        if (err?.message === "ORCHESTRATION_CANCELLED") throw err;
        lastError = err;
        const next = t + 1 < tiers.length ? `escalating to "${tiers[t + 1].agentName}"` : "no tiers left";
        console.warn(`[Orchestrator] Run ${runId} - tier "${tier.agentName}" failed (${err?.message}); ${next}.`);
      }
    }
    return {
      title: task.title,
      summary: `(could not complete — all execution tiers failed: ${lastError?.message ?? "unknown error"})`
    };
  }

  /** Builds the architect "last resort" tier: the run's own model + full toolset. */
  private architectTier(run: Run, task: { title: string }): SubAgentTier {
    return {
      providerId: run.providerId,
      providerDisplayName: run.providerDisplayName,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
      tools: [...WORKSPACE_TOOLS],
      agentRole: "coder",
      systemPrompt: buildCoderSystemPrompt(run.projectName, run.projectPath, task.title),
      agentName: `${task.title} (architect fallback)`
    };
  }

  /**
   * Executes a delegate_tasks call from the architect: spins up 1..maxSubAgents
   * coder sub-agents (each its own runAgentLoop on the coder model, in the same
   * workspace) and returns their result summaries to the architect. Runs them in
   * parallel only when the architect explicitly requested it; otherwise sequential.
   * If the coder model is unavailable, each task falls back to the architect.
   */
  private async executeDelegateTasks(runId: string, run: Run, toolCall: any): Promise<string> {
    if (!run.coderModel || !run.coderProviderId) {
      return JSON.stringify({ success: false, error: "No coder model is configured for this run, so tasks cannot be delegated." });
    }
    // Safety net: delegation is implementation, which is forbidden in plan/chat
    // mode. The tool is normally not even advertised in those modes, but guard
    // here too in case the model calls it from replayed history.
    if (run.mode === "plan" || run.mode === "chat") {
      return JSON.stringify({ success: false, error: `Cannot delegate tasks in ${run.mode} mode. Switch to Build mode to implement.` });
    }

    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (e: any) {
      return JSON.stringify({ success: false, error: `Invalid delegate_tasks arguments: ${e.message}` });
    }

    const limit = this.maxSubAgentsFor(run);
    const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
    const tasks = rawTasks
      .filter((t: any) => t && typeof t.instructions === "string" && t.instructions.trim())
      .slice(0, limit)
      .map((t: any, i: number) => ({
        title: typeof t.title === "string" && t.title.trim() ? t.title.trim() : `Subtask ${i + 1}`,
        instructions: String(t.instructions)
      }));

    if (tasks.length === 0) {
      return JSON.stringify({ success: false, error: "No valid tasks to delegate (each task needs non-empty instructions)." });
    }

    const coderMeta = this.registry.getSafeMetadata().find(p => p.id === run.coderProviderId);
    const coderDisplayName = coderMeta ? coderMeta.displayName : run.coderProviderId;
    const parallel = !!args.parallel && tasks.length > 1;

    const fallback = this.fallbackEnabled(run);
    const runOne = (task: { title: string; instructions: string }) => {
      const tiers: SubAgentTier[] = [
        {
          providerId: run.coderProviderId!,
          providerDisplayName: coderDisplayName,
          model: run.coderModel!,
          reasoningEffort: run.coderReasoningEffort,
          tools: [...WORKSPACE_TOOLS],
          agentRole: "coder",
          systemPrompt: buildCoderSystemPrompt(run.projectName, run.projectPath, task.title),
          // Tag every message with the sub-task title so the UI can render each
          // coder sub-agent in its own window instead of merging them.
          agentName: task.title
        }
      ];
      // Last resort (only when the preset enables fallback): the architect takes
      // control and does it directly.
      if (fallback) tiers.push(this.architectTier(run, task));
      return this.runTaskWithFallback(runId, run, task, tiers);
    };

    let results: { title: string; summary: string }[];
    if (parallel) {
      results = await Promise.all(tasks.map(runOne));
    } else {
      results = [];
      for (const task of tasks) {
        results.push(await runOne(task));
      }
    }

    return JSON.stringify({ success: true, parallel, results });
  }

  /**
   * Executes a delegate_to_utility call: spins up 1..3 cheap "utility" sub-agents
   * (each its own runAgentLoop on the utility model) restricted to read/list/search
   * + move_file, and returns their short summaries to the architect. Mirrors
   * executeDelegateTasks but with the utility model and a lighter toolset.
   */
  private async executeUtilityTasks(runId: string, run: Run, toolCall: any): Promise<string> {
    if (!run.utilityModel || !run.utilityProviderId) {
      return JSON.stringify({ success: false, error: "No utility model is configured for this run." });
    }
    if (run.mode === "plan" || run.mode === "chat") {
      return JSON.stringify({ success: false, error: `Cannot delegate in ${run.mode} mode. Switch to Build mode.` });
    }

    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (e: any) {
      return JSON.stringify({ success: false, error: `Invalid delegate_to_utility arguments: ${e.message}` });
    }

    const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
    const tasks = rawTasks
      .filter((t: any) => t && typeof t.instructions === "string" && t.instructions.trim())
      .slice(0, 3)
      .map((t: any, i: number) => ({
        title: typeof t.title === "string" && t.title.trim() ? t.title.trim() : `Lookup ${i + 1}`,
        instructions: String(t.instructions)
      }));

    if (tasks.length === 0) {
      return JSON.stringify({ success: false, error: "No valid tasks to delegate (each task needs non-empty instructions)." });
    }

    const utilityMeta = this.registry.getSafeMetadata().find(p => p.id === run.utilityProviderId);
    const utilityDisplayName = utilityMeta ? utilityMeta.displayName : run.utilityProviderId;
    const coderMeta = this.registry.getSafeMetadata().find(p => p.id === run.coderProviderId);
    const coderDisplayName = coderMeta?.displayName ?? run.coderProviderId ?? "Coder";
    const parallel = !!args.parallel && tasks.length > 1;

    const fallback = this.fallbackEnabled(run);
    const runOne = (task: { title: string; instructions: string }) => {
      const tiers: SubAgentTier[] = [
        {
          providerId: run.utilityProviderId!,
          providerDisplayName: utilityDisplayName,
          model: run.utilityModel!,
          reasoningEffort: run.utilityReasoningEffort,
          tools: [...UTILITY_TOOLS],
          agentRole: "utility",
          systemPrompt: buildUtilitySystemPrompt(run.projectName, run.projectPath, task.title),
          agentName: task.title
        }
      ];
      // Resilience chain (only when the preset enables fallback): if the cheap
      // utility errors out, escalate to the coder (full toolset, so it can
      // actually write/delete), then to the architect doing it directly.
      if (fallback) {
        if (run.coderModel && run.coderProviderId) {
          tiers.push({
            providerId: run.coderProviderId,
            providerDisplayName: coderDisplayName,
            model: run.coderModel,
            reasoningEffort: run.coderReasoningEffort,
            tools: [...WORKSPACE_TOOLS],
            agentRole: "coder",
            systemPrompt: buildCoderSystemPrompt(run.projectName, run.projectPath, task.title),
            agentName: `${task.title} (coder fallback)`
          });
        }
        tiers.push(this.architectTier(run, task));
      }
      return this.runTaskWithFallback(runId, run, task, tiers);
    };

    let results: { title: string; summary: string }[];
    if (parallel) {
      results = await Promise.all(tasks.map(runOne));
    } else {
      results = [];
      for (const task of tasks) {
        results.push(await runOne(task));
      }
    }

    return JSON.stringify({ success: true, parallel, results });
  }

  /**
   * Resolves a single tool call: gates it behind the permission flow when the
   * run is in ask_permissions mode or the tool is inherently dangerous (e.g.
   * run_command always asks before executing), then runs it.
   */
  private async runToolCall(runId: string, run: Run, toolCall: any, agentRole?: string): Promise<string> {
    // update_plan is an internal bookkeeping tool (no filesystem/network side
    // effects), so it runs silently without any permission prompt. The stable
    // plan PANEL belongs to Plan mode only — in any other mode (Build/Chat) we
    // reject the call (some models invoke it out of habit even though it isn't
    // offered) and tell the model to write the plan as plain inline text instead.
    if (toolCall.function?.name === "update_plan") {
      if (run.mode !== "plan") {
        return JSON.stringify({
          success: false,
          error: `update_plan is only available in Plan mode. In ${run.mode} mode, do not create a plan panel — write any plan as plain text directly in your reply, then proceed.`
        });
      }
      return this.executePlanUpdate(runId, toolCall);
    }

    // set_chat_title only renames the run (no filesystem/network I/O), so it is
    // allowed in every mode and runs silently without a permission prompt.
    if (toolCall.function?.name === "set_chat_title") {
      return this.executeSetTitle(runId, toolCall);
    }

    // ask_user_question pauses the run for user input (no filesystem/network
    // I/O); allowed in every mode and never goes through the permission flow.
    if (toolCall.function?.name === "ask_user_question") {
      return this.executeAskQuestion(runId, toolCall);
    }

    // remember writes a durable memory row (no filesystem/network I/O); allowed
    // in every mode and runs silently without a permission prompt.
    if (toolCall.function?.name === "remember") {
      return this.executeRemember(run, toolCall);
    }

    // delegate_tasks fans out to coder sub-agents; the orchestrator runs their
    // loops itself (the sub-agents' own tool calls are gated normally).
    if (toolCall.function?.name === "delegate_tasks") {
      return this.executeDelegateTasks(runId, run, toolCall);
    }

    // delegate_to_utility fans out to cheap utility sub-agents (lookups/renames).
    if (toolCall.function?.name === "delegate_to_utility") {
      return this.executeUtilityTasks(runId, run, toolCall);
    }

    const toolName = toolCall.function?.name;
    const isDelegated = !!(run.coderModel && run.coderProviderId);

    // Block the Architect (non-coder/non-utility role in a delegation setup) from calling write/delete/run_command directly.
    if (isDelegated && agentRole !== "coder" && agentRole !== "utility" && !READONLY_TOOLS.has(toolName) && toolName !== "delegate_tasks" && toolName !== "delegate_to_utility" && toolName !== "update_plan" && toolName !== "set_chat_title" && toolName !== "ask_user_question" && toolName !== "remember") {
      return JSON.stringify({
        success: false,
        error: `Blocked: Architect model is not allowed to run mutating or command tools directly when a coder preset is configured. You must delegate this implementation task to a coder sub-agent using delegate_tasks.`
      });
    }

    // Block the Utility sub-agent from calling tools outside the utility set.
    if (agentRole === "utility" && !UTILITY_TOOL_NAMES.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: Utility sub-agent is not allowed to execute "${toolName}". It is restricted to: read_file, list_directory, search_files, and move_file.`
      });
    }

    // HARD RULE: plan mode is read-only. No file mutation, no run_command, no
    // fetch_url — even if the user approves. The model must switch to Build mode
    // before anything changes. We block here regardless of any permission grant.
    const isBuildMode = run.mode === "accept_edits" || run.mode === "auto" || run.mode === "ask_permissions" || run.mode === "full_access";
    if (!isBuildMode && MODIFYING_TOOLS.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: "${toolName}" is not allowed in ${run.mode} mode. ${run.mode === "chat" ? "Chat" : "Plan"} mode makes NO changes to the workspace and runs NO commands. Ask the user to switch to Build mode to implement.`
      });
    }

    if (run.mode === "plan" && !READONLY_TOOLS.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: "${toolName}" is not allowed in Plan mode. Plan mode makes NO changes and runs NO commands. Ask the user to switch to Build mode to implement.`
      });
    }

    const isDangerous = DANGEROUS_TOOLS.has(toolCall.function?.name);
    // run_command / fetch_url require approval in most modes — but NOT in Full
    // Access mode, where the user has explicitly opted in to autonomous operation
    // with no interruptions. A matching standing grant also lets them run silently
    // in any mode. Other tools gate only in ask_permissions mode.
    const mustGate = run.mode !== "full_access" && (isDangerous || run.mode === "ask_permissions");
    const needsPermission = mustGate && !this.checkPermission(run, toolCall);

    if (needsPermission) {
      const decision = await this.requestPermission(runId, run, toolCall);
      if (decision === "deny") {
        return JSON.stringify({ success: false, error: "Permission denied by user." });
      }
      await this.emitStatus(runId, "generating");
    }
    return executeWorkspaceToolAsync(run, toolCall);
  }

  /**
   * Renames the run from the model's set_chat_title call and broadcasts the new
   * title to the UI. Never throws — failures come back as a JSON error.
   */
  private async executeSetTitle(runId: string, toolCall: any): Promise<string> {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      let title = typeof args.title === "string" ? args.title.trim() : "";
      // Strip wrapping quotes the model sometimes adds, and cap the length.
      title = title.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, 80);
      if (!title) {
        return JSON.stringify({ success: false, error: "Title was empty." });
      }

      await this.runRepo.update(runId, { title });
      eventBus.emit(`run:${runId}`, { type: "run_title_changed", runId, title });

      return JSON.stringify({ success: true, title });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err?.message ?? "Failed to set title." });
    }
  }

  /**
   * Handles an ask_user_question call: validates/normalizes the questions, pauses
   * the run for the user's selections, and returns those selections to the model
   * as the tool result. Never throws — failures come back as a JSON error.
   */
  private async executeAskQuestion(runId: string, toolCall: any): Promise<string> {
    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (e: any) {
      return JSON.stringify({ success: false, error: `Invalid ask_user_question arguments: ${e.message}` });
    }

    // In plan mode, once a plan exists the plan panel already carries the
    // approve/revise/reject controls ("Start building"). Block ask_user_question
    // here so the model can't pop a redundant approval card alongside the panel;
    // it should simply end its turn and let the user approve via the panel.
    const run = this.runRepo.getById(runId);
    if (run?.mode === "plan" && this.planRepo.getActive(runId)) {
      return JSON.stringify({
        success: false,
        error:
          "Do not ask for approval here. A plan already exists; the plan panel provides the approve/revise/reject controls. End your turn and let the user decide via the panel."
      });
    }

    const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
    const questions: UserQuestion[] = rawQuestions
      .filter((q: any) => q && typeof q.question === "string" && q.question.trim() && Array.isArray(q.options))
      .slice(0, 4)
      .map((q: any) => ({
        question: String(q.question),
        header: typeof q.header === "string" ? q.header.trim().slice(0, 12) : "",
        multiSelect: !!q.multiSelect,
        options: q.options
          .map((o: any) =>
            typeof o === "string"
              ? { label: o }
              : o && typeof o.label === "string"
                ? { label: String(o.label), description: typeof o.description === "string" ? o.description : undefined }
                : null
          )
          .filter((o: any): o is { label: string; description?: string } => !!o && !!o.label.trim())
          .slice(0, 4)
      }))
      .filter((q: UserQuestion) => q.options.length > 0);

    if (questions.length === 0) {
      return JSON.stringify({ success: false, error: "No valid questions (each needs a question and at least one option)." });
    }

    const { selections, notes } = await this.requestUserAnswer(runId, questions);

    // If the run was cancelled while waiting, don't flip status back — let the
    // loop's next cancellation check unwind it.
    if (!this.activeRuns.has(runId)) {
      return JSON.stringify({ success: false, error: "Cancelled before the user answered." });
    }
    await this.emitStatus(runId, "generating");

    const answers = questions.map((q, i) => {
      const note = (notes[i] ?? "").trim();
      return {
        question: q.question,
        header: q.header,
        selected: selections[i] ?? [],
        ...(note ? { note } : {})
      };
    });
    return JSON.stringify({ success: true, answers });
  }

  /**
   * Saves (or revises) a durable memory from the model's remember call. Silent —
   * no permission prompt, no SSE; the user manages memories in Settings. A
   * "project" memory is scoped to this run's project path. Never throws.
   */
  private async executeRemember(run: Run, toolCall: any): Promise<string> {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!content) {
        return JSON.stringify({ success: false, error: "Nothing to remember: content was empty." });
      }

      // Revise an existing memory in place when the model passes update_id.
      const updateId = typeof args.update_id === "number" ? args.update_id : Number(args.update_id);
      if (Number.isInteger(updateId) && updateId > 0) {
        const updated = await this.memoryRepo.update(updateId, content);
        if (updated) {
          return JSON.stringify({ success: true, action: "updated", memory: updated });
        }
        // Fall through to create if the id no longer exists.
      }

      const scope = args.scope === "global" ? "global" : "project";
      const memory = await this.memoryRepo.create({
        scope,
        projectPath: scope === "project" ? (run.projectPath || "") : "",
        category: args.category,
        content
      });
      return JSON.stringify({ success: true, action: "created", memory });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err?.message ?? "Failed to save memory." });
    }
  }

  /**
   * Persists the assistant's plan for a run and broadcasts it to the UI. Called
   * when the model invokes update_plan; never throws — failures are returned to
   * the model as a JSON error so it can react.
   */
  private async executePlanUpdate(runId: string, toolCall: any): Promise<string> {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
      const tasks: PlanTask[] = rawTasks.map((t: any) => ({
        text: typeof t?.text === "string" ? t.text : "",
        status: t?.status === "in_progress" || t?.status === "completed" ? t.status : "pending"
      }));

      const plan = await this.planRepo.upsert(runId, {
        title: typeof args.title === "string" ? args.title : undefined,
        body: typeof args.body === "string" ? args.body : undefined,
        tasks,
        startNew: !!args.start_new
      });

      eventBus.emit(`run:${runId}`, { type: "plan_updated", plan });

      return JSON.stringify({
        success: true,
        planId: plan.id,
        version: plan.version,
        taskCount: plan.tasks.length,
        completed: plan.tasks.filter(t => t.status === "completed").length
      });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }
  }
}
