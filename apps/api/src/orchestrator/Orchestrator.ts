import type { Run, RunMessage, ChatMessage, ReasoningEffort } from "@agent-bridge/shared";
import type { ModelProvider } from "../providers/ModelProvider.js";
import { RunRepository, MessageRepository, PlanRepository, MemoryRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";
import { appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildSystemPrompt, buildCoderSystemPrompt, buildUtilitySystemPrompt, formatMemoryContext, getModeStrategy } from "./systemPrompt.js";
import { WORKSPACE_TOOLS, DELEGATE_TASKS_TOOL, DELEGATE_UTILITY_TOOL, UTILITY_TOOLS, UTILITY_TOOL_NAMES, executeWorkspaceToolAsync, DANGEROUS_TOOLS, READONLY_TOOLS, MODIFYING_TOOLS } from "./workspaceTools.js";
import { getOrchestratorTool, availableSchemas } from "./tools/index.js";
import type { OrchestratorToolContext } from "./tools/index.js";
import { RunMessageStream } from "./RunMessageStream.js";
import { PermissionCoordinator, type PermissionDecision } from "./PermissionCoordinator.js";
import { QuestionCoordinator } from "./QuestionCoordinator.js";

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

  // Outbound persistence + SSE for this orchestrator's runs.
  private messages: RunMessageStream;
  // Tool-permission flow (standing grants, prompts, serialization).
  private permissions: PermissionCoordinator;
  // ask_user_question flow (pause the run, collect the user's answer).
  private questions: QuestionCoordinator;
  // The capability surface passed to orchestrator-native tool handlers
  // (set_chat_title / update_plan / ask_user_question / remember).
  private toolContext: OrchestratorToolContext;

  constructor(
    private runRepo: RunRepository,
    private messageRepo: MessageRepository,
    private registry: ProviderRegistry,
    private planRepo: PlanRepository,
    private memoryRepo: MemoryRepository
  ) {
    this.messages = new RunMessageStream(this.runRepo, this.messageRepo);
    this.permissions = new PermissionCoordinator(this.activeRuns, this.messages);
    this.questions = new QuestionCoordinator(this.activeRuns, this.messages);
    this.toolContext = {
      runRepo: this.runRepo,
      planRepo: this.planRepo,
      memoryRepo: this.memoryRepo,
      eventBus,
      requestUserAnswer: (runId, questions) => this.questions.request(runId, questions),
      isActive: (runId) => this.activeRuns.has(runId),
      setGenerating: (runId) => this.messages.emitStatus(runId, "generating")
    };
  }

  // --- Permission / question pass-throughs (owned by the coordinators) -----

  resolvePermission(runId: string, decision: PermissionDecision): boolean {
    return this.permissions.resolve(runId, decision);
  }

  getPendingPermission(runId: string) {
    return this.permissions.getPending(runId);
  }

  resolveQuestion(runId: string, answer: { selections: string[][]; notes: string[] }): boolean {
    return this.questions.resolve(runId, answer);
  }

  getPendingQuestion(runId: string) {
    return this.questions.getPending(runId);
  }

  // --- Run lifecycle -------------------------------------------------------

  async cancel(runId: string): Promise<boolean> {
    await this.messages.flushAllPendingDbUpdates();
    // Unblock any pending permission/question promise so the run loop can unwind.
    this.permissions.cancelPending(runId);
    this.questions.cancelPending(runId);

    if (this.activeRuns.has(runId)) {
      this.activeRuns.delete(runId);
      await this.messages.emitStatus(runId, "cancelled");
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Chat generation cancelled by user." });
      console.log(`[Orchestrator] Run ${runId} has been cancelled by user.`);
      return true;
    }

    // Fallback for runs marked active in DB but not in memory (e.g. after restart).
    const run = this.runRepo.getById(runId);
    if (run && (run.status === "created" || run.status === "generating" || run.status === "awaiting_permission")) {
      await this.messages.emitStatus(runId, "cancelled");
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
      await this.messages.emitStatus(runId, "generating");

      // The mode strategy carries this run's full behavior: prompt section, base
      // tool set, and gating policy. All per-mode branching reads from it.
      const strategy = getModeStrategy(run.mode);

      // Dual-model: when a coder model is wired up, the main model is the
      // architect — it gets the delegate_tasks tool and architect instructions.
      // Delegation means implementation, so it is only offered in build-type
      // modes — never in plan mode (planning only) or chat mode (lightweight).
      const canDelegate = strategy.allowsDelegation;
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

      // The strategy selects the base tools for this mode. Plan mode gets
      // read-only tools plus update_plan; chat gets non-mutating tools; build
      // modes get the full toolset, except when a coder is configured — then the
      // architect is held to read-only tools so the only way it can implement is
      // to delegate (weak models otherwise ignore the soft "prefer delegating"
      // instruction and do all the work directly).
      const baseTools = strategy.selectBaseTools(!!delegation);
      const withDelegate = delegation ? [...baseTools, DELEGATE_TASKS_TOOL] : baseTools;
      // The utility-delegation tool is offered only when a utility model is
      // configured (and the run can delegate at all).
      const withUtility = delegation?.utilityModel ? [...withDelegate, DELEGATE_UTILITY_TOOL] : withDelegate;
      // The orchestrator-native tools the strategy allows: update_plan (plan
      // mode only) plus set_chat_title / ask_user_question / remember (every
      // mode). Sub-agents never get these. See orchestrator/tools.
      const tools = [...withUtility, ...availableSchemas(strategy)];

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

      await this.messages.emitStatus(runId, "done");
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
        this.messages.emitMessage(runId, errorMsg);

        await this.messages.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      await this.messages.flushAllPendingDbUpdates();
      this.activeRuns.delete(runId);
      this.permissions.clear(runId);
      this.questions.cancelPending(runId);
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
        this.messages.emitMessage(runId, finalMsg);
      } else {
        this.messages.updateMessage(runId, finalMsg);
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
          this.messages.emitMessage(runId, toolMsg);

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
    if (!getModeStrategy(run.mode).allowsDelegation) {
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
    if (!getModeStrategy(run.mode).allowsDelegation) {
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

    // HARD RULE: non-build modes are read-only. No file mutation, no run_command,
    // no fetch_url — even if the user approves. The model must switch to Build
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
    // run_command / fetch_url require approval in most modes — but NOT in Full
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
