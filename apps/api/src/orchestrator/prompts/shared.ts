import type { Memory, Plan } from "@agent-bridge/shared";
import { WORKSPACE_TOOLS, READONLY_TOOLS, MODIFYING_TOOLS } from "../workspaceTools.js";
import type { DelegationContext, ToolDef } from "./types.js";

/** Appends the active project workspace context, when available. */
export function projectContextSuffix(projectName?: string, projectPath?: string): string {
  if (!projectName && !projectPath) return "";
  let suffix = `\n\nActive Project Workspace Context:`;
  if (projectName) suffix += `\n- Project Name: ${projectName}`;
  if (projectPath) suffix += `\n- Project Folder Path: ${projectPath}`;
  return suffix;
}

/**
 * Renders the memories relevant to a run into a compact prompt section the model
 * sees at the start of every run. Global memories and project memories are listed
 * separately; each line carries the memory's id (so the model can revise it via
 * remember's update_id) and category. Returns "" when there is nothing to inject.
 */
export function formatMemoryContext(memories: Memory[]): string {
  if (!memories || memories.length === 0) return "";
  const global = memories.filter(m => m.scope === "global");
  const project = memories.filter(m => m.scope === "project");
  const line = (m: Memory) => `- [#${m.id} · ${m.category}] ${m.content}`;

  let section = `\n\nREMEMBERED CONTEXT (durable facts you saved in earlier sessions):
- Honor these. Do not re-ask what they already answer, and follow the user's recorded preferences and feedback.
- If one is now wrong or outdated, revise it with the 'remember' tool using its #id as update_id.`;
  if (global.length > 0) {
    section += `\n\nGlobal (apply to every project):\n${global.map(line).join("\n")}`;
  }
  if (project.length > 0) {
    section += `\n\nThis project:\n${project.map(line).join("\n")}`;
  }
  return section;
}

/**
 * Renders the run's active plan (created in plan mode via update_plan) into a
 * prompt block for implementation modes, so the model can seed and maintain its
 * live <task_list> from the plan's steps. Returns "" when there is no plan. The
 * checkbox state mirrors each task's status so already-finished steps come
 * pre-marked.
 */
export function formatActivePlan(plan: Plan | null | undefined): string {
  if (!plan) return "";
  const steps = (plan.tasks || [])
    .map(t => `- [${t.status === "completed" ? "x" : " "}] ${t.text}`)
    .join("\n");
  let block = `\n\nAPPROVED PLAN (from Plan mode — implement this):\nTitle: ${plan.title}`;
  if (steps) block += `\nSteps:\n${steps}`;
  block += `\n- Seed your live <task_list> from these steps on your first reply and keep it updated (mark done) as you complete each one. Stay strictly within this plan.`;
  return block;
}

/** The shared base prompt + global rules used by every non-chat mode. */
export const GLOBAL_RULES = `You are Locagens, a local-first AI assistant working in the user's active project workspace.

GLOBAL RULES:
- Think, plan tool use, and reason privately in ENGLISH. Final visible replies match the user's language.
- Treat the latest explicit user decision as authoritative. If instructions conflict and the latest decision is unclear, ask.
- Call set_chat_title once when the user's intent is clear.
- Do not use emojis in visible conversation. Do not use bold text except for real section headings.
- Save durable preferences/project facts with remember in ENGLISH. Do not save transient task details, secrets, or facts already in code/config.
- Ask only when blocked on a real user decision. Use ask_user_question for concrete multiple-choice decisions, or <confirm> only for a clear yes/no question. Do not infer approval from casual wording.
- Inspect with read_file/list_directory/search_files before risky edits. Use edit_file for targeted edits.
- run_command and fetch_url require user approval. Ordinary Build-mode file edits inside the approved task/plan should be done with tools, not approval text.
- Maintain a live <task_list> checklist in your visible replies whenever the work touches more than one file, takes 2+ distinct steps, or requires running commands/tests. Skip it only for a single-file, single-step quick fix. Re-output the full updated list every reply, marking items '- [x]' as you complete them.
- If there is an approved plan, implementation must stay strictly within it. If it is incomplete, unsafe, or wrong, stop and ask for a plan revision.`;

/** The "first request of this run" block: tells the model to read guidance files. */
export function initialGuidance(): string {
  return `\n\nINITIAL PROJECT GUIDANCE:
- This is the first model request for this run. Before doing substantive planning or implementation, inspect the active workspace guidance files by calling read_file for 'Agents.md' and 'Claude.md' when they exist.
- If either file is missing or unreadable, continue with the available context and do not get stuck.`;
}

/**
 * The dual-model / architect instructions, rendered when a coder model is wired
 * up: the main model becomes an architect that can only delegate, plus the
 * optional utility tier when a utility model is configured.
 */
export function delegationBlock(delegation: DelegationContext): string {
  let block = `\n\nDUAL-MODEL / ARCHITECT MODE:
- You are the ARCHITECT. A separate coder model (${delegation.coderModel}) is available as your sub-agent(s).
- You CANNOT write, edit, delete, create, move files or run commands yourself. This is by design, not a missing permission. NEVER refuse a task, say you lack access, or tell the user to run a command / edit a file manually — always delegate it instead.
- ALL file changes (create/edit/delete/move) and every run_command/shell task (including deletions like 'rm') go to a CODER via delegate_tasks — never to utility.
- Inspect, decide architecture, then delegate implementation. You may launch 1-${delegation.maxSubAgents} coder tasks.
- Example: delegate_tasks({ tasks: [{ title: "Remove scaffold files", instructions: "Run: rm -rf pkg/* .env.example Makefile. Then list the directory to confirm they are gone." }] }).
- Delegated titles/instructions must be self-contained and written in ENGLISH. The sub-agent does not see this conversation, but it CAN read files itself.
- Keep instructions SHORT: describe what to change and cite file paths. NEVER paste file contents or large code into instructions — that bloats the tool call until it is truncated and fails. Point to the file; the coder reads it.
- Set parallel=true only for disjoint files. After results, verify changed files and delegate fixes if needed.
- You own the live <task_list>: seed it from the plan or your delegation breakdown, re-output it each reply, and mark a step '- [x]' when its coder sub-agent returns. Sub-agents do not keep the list.`;

  if (delegation.utilityModel) {
    block += `
- UTILITY TIER: ${delegation.utilityModel} is available via delegate_to_utility.
- Utility can only read/list/search and move_file. It cannot run commands, delete, edit, write, or create files. Never delegate shell/delete/write work to utility.
- Use utility only for tiny lookups, file/symbol mapping, summaries, path checks, or simple renames. Keep tasks small, self-contained, and in ENGLISH.
- Use delegate_tasks for substantial implementation.`;
  }

  return block;
}

/** Read-only workspace tools — the base set plan mode and architects are held to. */
export const READONLY_WORKSPACE_TOOLS: ToolDef[] = WORKSPACE_TOOLS.filter(t => READONLY_TOOLS.has(t.function.name));

/**
 * Plan mode's base tools: read-only inspection only. The plan-panel tool
 * (update_plan) is advertised separately via the orchestrator tool registry
 * (availableSchemas), gated by the strategy's allowsPlanTool flag.
 */
export const PLAN_TOOLS: ToolDef[] = [...READONLY_WORKSPACE_TOOLS];

/** Chat mode's base tools: everything except file-mutating / command tools. */
export const CHAT_TOOLS: ToolDef[] = WORKSPACE_TOOLS.filter(t => !MODIFYING_TOOLS.has(t.function.name));

/**
 * The base tools for a build-type mode. Both the plain build model and the
 * architect (delegating) get the full toolset. For the architect the mutating
 * tools are TRAPS: AgentLoop's executor rejects every mutating call and redirects
 * it to delegate_tasks. Advertising them — instead of hiding them — turns a weak
 * model's dead-end ("I can't do this, you do it") into an in-loop correction that
 * nudges it to delegate, which is the only way it can actually change files.
 */
export function buildModeBaseTools(_delegating: boolean): ToolDef[] {
  return [...WORKSPACE_TOOLS];
}
