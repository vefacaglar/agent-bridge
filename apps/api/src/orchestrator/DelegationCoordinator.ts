import type { Run, RunMessage, ReasoningEffort } from "@agent-bridge/shared";
import type { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { buildCoderSystemPrompt, buildUtilitySystemPrompt, getModeStrategy } from "./systemPrompt.js";
import { WORKSPACE_TOOLS, UTILITY_TOOLS } from "./workspaceTools.js";
import type { AgentLoop, Delegator } from "./AgentLoop.js";

/**
 * Common framework/library tokens that look like file paths (extension match)
 * but are prose mentions, not files. Excluded when scanning coder summaries for
 * files to verify. Compared lowercased against the matched token's basename.
 */
const NON_FILE_TOKENS = new Set([
  "node.js",
  "vue.js",
  "react.js",
  "next.js",
  "nuxt.js",
  "express.js",
  "three.js",
  "d3.js"
]);

/**
 * Hard cap on how much of a sub-agent's report is fed back into the (expensive)
 * architect context. The coder/utility prompt already asks for a compact report,
 * but a non-compliant model can still dump a wall of text; this guarantees the
 * architect's input stays lean regardless. File-path scanning runs on the FULL
 * summary before trimming, so verification targets are never lost to truncation.
 */
const MAX_SUMMARY_CHARS = 1200;

function trimSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  const dropped = summary.length - MAX_SUMMARY_CHARS;
  return `${summary.slice(0, MAX_SUMMARY_CHARS)}\n…[truncated ${dropped} chars — the sub-agent's report was long. Verify the changed files if you need detail instead of asking it to repeat.]`;
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

/**
 * Runs the architect's delegate_tasks / delegate_to_utility calls: spins up
 * coder / utility sub-agents (each its own AgentLoop pass in the same workspace),
 * optionally with a resilience fallback chain (utility -> coder -> architect),
 * and returns their result summaries to the architect. Owns no run state — it
 * borrows the shared AgentLoop to execute each sub-agent.
 */
export class DelegationCoordinator implements Delegator {
  constructor(
    private registry: ProviderRegistry,
    private agentLoop: AgentLoop
  ) {}

  /** Resolves how many coder sub-agents this run may launch (preset-bound, 1..3). */
  maxSubAgentsFor(run: Run): number {
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
        const summary = await this.agentLoop.run(runId, run, [{ role: "user", content: task.instructions }], {
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
   * coder sub-agents (each its own AgentLoop pass on the coder model, in the same
   * workspace) and returns their result summaries to the architect. Runs them in
   * parallel only when the architect explicitly requested it; otherwise sequential.
   * If the coder model is unavailable, each task falls back to the architect.
   */
  async executeDelegateTasks(runId: string, run: Run, toolCall: any): Promise<string> {
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
      return JSON.stringify({ success: false, error: `Could not parse delegate_tasks arguments (${e.message}). This usually means the arguments were too large and got cut off. Do NOT paste file contents or large code into 'instructions' — the coder reads files itself with read_file. Keep each task's instructions short: describe what to change and cite file paths, then retry.` });
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

    // Collect file paths from task args (each task may have a `files` array)
    const filesToVerify: string[] = [];
    if (Array.isArray(args.tasks)) {
      for (const t of args.tasks) {
        if (t && Array.isArray(t.files)) {
          for (const f of t.files) {
            if (typeof f === "string" && f.trim()) {
              filesToVerify.push(f.trim());
            }
          }
        }
      }
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

    // Scan each result's summary for additional file paths
    const fileExtPattern = /[\w\-./]+\.\w{1,5}/g;
    const sourceExts =
      /\.(ts|js|vue|go|json|tsx|jsx|css|scss|sass|less|md|py|rb|rs|java|kt|swift|yaml|yml|toml|xml|sh|bash|zsh|fish|env|gitignore|editorconfig|prettierrc|eslintrc|npmrc|nvmrc)$/i;
    for (const r of results) {
      if (r.summary) {
        const matches = r.summary.match(fileExtPattern);
        if (matches) {
          for (const m of matches) {
            const basename = (m.split("/").pop() ?? m).toLowerCase();
            if (sourceExts.test(m) && !NON_FILE_TOKENS.has(basename)) {
              filesToVerify.push(m);
            }
          }
        }
      }
    }

    // Deduplicate
    const uniqueFilesToVerify = [...new Set(filesToVerify)];

    // Sub-agent success check — scan summaries for error keywords
    const errorKeywords = /\b(error|failed|could not|unable|exception|bug|broken|crash|regression)\b/i;
    const warnings: string[] = [];
    for (const r of results) {
      if (r.summary && errorKeywords.test(r.summary)) {
        warnings.push(`Task "${r.title}" may have issues — review the summary carefully.`);
      }
    }

    // When a utility tier is available, verification is offloaded to it (cheap)
    // instead of the architect reading each file into its expensive context.
    const verifyViaUtility = !!(run.utilityModel && run.utilityProviderId);
    const reminder = verifyViaUtility
      ? "You MUST now verify these changes via delegate_to_utility: ask the utility model to read each file in _files_to_verify and confirm correctness, returning a SHORT verdict. Do NOT read the files yourself. If something is wrong, delegate a fix."
      : "You MUST now read_file each file listed in _files_to_verify to confirm the changes are correct before marking any task complete. If changes are wrong, delegate a fix.";

    return JSON.stringify({
      success: true,
      parallel,
      results: results.map(r => ({ title: r.title, summary: trimSummary(r.summary) })),
      _verification_required: true,
      _files_to_verify: uniqueFilesToVerify,
      _reminder: reminder,
      _parallel_advice: !parallel && tasks.length > 1
        ? `You ran ${tasks.length} tasks sequentially. If they touch disjoint files, use parallel: true next time for faster execution.`
        : undefined,
      _warnings: warnings.length > 0 ? warnings : undefined
    });
  }

  /**
   * Executes a delegate_to_utility call: spins up 1..3 cheap "utility" sub-agents
   * (each its own AgentLoop pass on the utility model) restricted to read/list/search
   * + move_file, and returns their short summaries to the architect. Mirrors
   * executeDelegateTasks but with the utility model and a lighter toolset.
   */
  async executeUtilityTasks(runId: string, run: Run, toolCall: any): Promise<string> {
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
      return JSON.stringify({ success: false, error: `Could not parse delegate_to_utility arguments (${e.message}). This usually means they were too large and got cut off. Do NOT paste file contents into 'instructions' — utility reads files itself. Keep each task short: say what to look up and cite file paths, then retry.` });
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

    return JSON.stringify({
      success: true,
      parallel,
      results: results.map(r => ({ title: r.title, summary: trimSummary(r.summary) })),
      _verification_required: false,
      _reminder:
        "Review the utility results above and proceed with implementation if the information is sufficient."
    });
  }
}
