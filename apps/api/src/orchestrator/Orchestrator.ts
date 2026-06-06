import type { Run, RunStatus, RunMessage, ChatMessage, PlanTask } from "@agent-bridge/shared";
import type { ModelProvider } from "../providers/ModelProvider.js";
import { RunRepository, MessageRepository, PlanRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";
import { db } from "../database/db.js";
import { buildSystemPrompt, buildCoderSystemPrompt, buildUtilitySystemPrompt } from "./systemPrompt.js";
import { WORKSPACE_TOOLS, UPDATE_PLAN_TOOL, DELEGATE_TASKS_TOOL, DELEGATE_UTILITY_TOOL, UTILITY_TOOLS, SET_TITLE_TOOL, executeWorkspaceToolAsync, buildPermissionPreview, DANGEROUS_TOOLS, READONLY_TOOLS, permissionKey } from "./workspaceTools.js";

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
  // Serializes concurrent permission prompts for the same run. Parallel coder
  // sub-agents share one runId and the pending-permission slot is single, so
  // their approval prompts must be shown one at a time, not overwrite each other.
  private permissionChain = new Map<string, Promise<void>>();

  constructor(
    private runRepo: RunRepository,
    private messageRepo: MessageRepository,
    private registry: ProviderRegistry,
    private planRepo: PlanRepository
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

  /**
   * Whether a standing grant covers this exact tool call. Grants are scoped per
   * tool, and for run_command per exact command string, so an approval never
   * leaks to a different command or tool.
   */
  private checkPermission(run: Run, toolCall: any): boolean {
    try {
      const { tool, command } = permissionKey(toolCall);
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
        this.emitStatus(runId, "awaiting_permission");
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

  /** Resolves how many coder sub-agents this run may launch (preset-bound, 1..3). */
  private maxSubAgentsFor(run: Run): number {
    const preset = run.agentPreset ? this.registry.getAgentPreset(run.agentPreset) : undefined;
    return Math.min(3, Math.max(1, preset?.maxSubAgents ?? 3));
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
      this.emitStatus(runId, "generating");

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
        : delegation
          ? [...readonlyTools]
          : [...WORKSPACE_TOOLS];
      const withDelegate = delegation ? [...baseTools, DELEGATE_TASKS_TOOL] : baseTools;
      // The utility-delegation tool is offered only when a utility model is
      // configured (and the run can delegate at all).
      const withUtility = delegation?.utilityModel ? [...withDelegate, DELEGATE_UTILITY_TOOL] : withDelegate;
      // set_chat_title is available to the main agent in every mode (it only
      // renames the run); sub-agents never get it.
      const tools = [...withUtility, SET_TITLE_TOOL];

      const systemPrompt = buildSystemPrompt(
        run.projectName,
        run.projectPath,
        run.mode,
        run.mode !== "chat" && shouldReadProjectGuidance,
        delegation
      );

      const finalText = await this.runAgentLoop(runId, run, [...initialMessages], {
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model,
        systemPrompt,
        tools,
        agentRole: delegation ? "planner" : undefined
      });

      this.emitStatus(runId, "done");
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

        this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      this.activeRuns.delete(runId);
      this.permissionChain.delete(runId);
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
          const result = await this.runToolCall(runId, run, tc);

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
   * Executes a delegate_tasks call from the architect: spins up 1..maxSubAgents
   * coder sub-agents (each its own runAgentLoop on the coder model, in the same
   * workspace) and returns their result summaries to the architect. Runs them in
   * parallel only when the architect explicitly requested it; otherwise sequential.
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

    const runOne = async (task: { title: string; instructions: string }) => {
      const systemPrompt = buildCoderSystemPrompt(run.projectName, run.projectPath, task.title);
      const summary = await this.runAgentLoop(runId, run, [{ role: "user", content: task.instructions }], {
        providerId: run.coderProviderId!,
        providerDisplayName: coderDisplayName,
        model: run.coderModel!,
        systemPrompt,
        tools: [...WORKSPACE_TOOLS],
        agentRole: "coder",
        // Tag every message with the sub-task title so the UI can render each
        // coder sub-agent in its own window instead of merging them.
        agentName: task.title
      });
      return { title: task.title, summary: summary || "(no summary returned)" };
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
    const parallel = !!args.parallel && tasks.length > 1;

    const runOne = async (task: { title: string; instructions: string }) => {
      const systemPrompt = buildUtilitySystemPrompt(run.projectName, run.projectPath, task.title);
      const summary = await this.runAgentLoop(runId, run, [{ role: "user", content: task.instructions }], {
        providerId: run.utilityProviderId!,
        providerDisplayName: utilityDisplayName,
        model: run.utilityModel!,
        systemPrompt,
        tools: [...UTILITY_TOOLS],
        agentRole: "utility",
        agentName: task.title
      });
      return { title: task.title, summary: summary || "(no summary returned)" };
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
  private async runToolCall(runId: string, run: Run, toolCall: any): Promise<string> {
    // update_plan is an internal bookkeeping tool (no filesystem/network side
    // effects), so it runs silently without any permission prompt.
    if (toolCall.function?.name === "update_plan") {
      return this.executePlanUpdate(runId, toolCall);
    }

    // set_chat_title only renames the run (no filesystem/network I/O), so it is
    // allowed in every mode and runs silently without a permission prompt.
    if (toolCall.function?.name === "set_chat_title") {
      return this.executeSetTitle(runId, toolCall);
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

    // HARD RULE: plan mode is read-only. No file mutation, no run_command, no
    // fetch_url — even if the user approves. The model must switch to Build mode
    // before anything changes. We block here regardless of any permission grant.
    const toolName = toolCall.function?.name;
    if (run.mode === "plan" && !READONLY_TOOLS.has(toolName)) {
      return JSON.stringify({
        success: false,
        error: `Blocked: "${toolName}" is not allowed in Plan mode. Plan mode makes NO changes and runs NO commands. Ask the user to switch to Build mode to implement.`
      });
    }

    const isDangerous = DANGEROUS_TOOLS.has(toolCall.function?.name);
    // run_command is always gated; other tools only in ask_permissions mode.
    // Either way a matching per-tool/per-command grant lets it run silently.
    const mustGate = isDangerous || run.mode === "ask_permissions";
    const needsPermission = mustGate && !this.checkPermission(run, toolCall);

    if (needsPermission) {
      const decision = await this.requestPermission(runId, run, toolCall);
      if (decision === "deny") {
        return JSON.stringify({ success: false, error: "Permission denied by user." });
      }
      this.emitStatus(runId, "generating");
    }
    return executeWorkspaceToolAsync(run, toolCall);
  }

  /**
   * Renames the run from the model's set_chat_title call and broadcasts the new
   * title to the UI. Never throws — failures come back as a JSON error.
   */
  private executeSetTitle(runId: string, toolCall: any): string {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      let title = typeof args.title === "string" ? args.title.trim() : "";
      // Strip wrapping quotes the model sometimes adds, and cap the length.
      title = title.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, 80);
      if (!title) {
        return JSON.stringify({ success: false, error: "Title was empty." });
      }

      this.runRepo.update(runId, { title });
      eventBus.emit(`run:${runId}`, { type: "run_title_changed", runId, title });

      return JSON.stringify({ success: true, title });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err?.message ?? "Failed to set title." });
    }
  }

  /**
   * Persists the assistant's plan for a run and broadcasts it to the UI. Called
   * when the model invokes update_plan; never throws — failures are returned to
   * the model as a JSON error so it can react.
   */
  private executePlanUpdate(runId: string, toolCall: any): string {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
      const tasks: PlanTask[] = rawTasks.map((t: any) => ({
        text: typeof t?.text === "string" ? t.text : "",
        status: t?.status === "in_progress" || t?.status === "completed" ? t.status : "pending"
      }));

      const plan = this.planRepo.upsert(runId, {
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
