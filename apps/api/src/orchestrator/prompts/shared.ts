import type { Memory } from "@agent-bridge/shared";
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
- Before implementation, use the 'update_plan' tool to outline steps. For complex or long-running tasks, maintain a live <task_list> checklist in your visible replies. Do not use task lists for simple, quick changes.
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
- You do NOT have write/edit/delete/create/move/run tools. To change files, call delegate_tasks.
- Inspect, decide architecture, then delegate implementation. You may launch 1-${delegation.maxSubAgents} coder tasks.
- Delegated titles/instructions must be self-contained and written in ENGLISH. The sub-agent does not see this conversation.
- Set parallel=true only for disjoint files. After results, verify changed files and delegate fixes if needed.`;

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
 * The base tools for a build-type mode: when a coder is configured the architect
 * is held to read-only tools (it can only delegate); otherwise the full toolset.
 */
export function buildModeBaseTools(delegating: boolean): ToolDef[] {
  return delegating ? [...READONLY_WORKSPACE_TOOLS] : [...WORKSPACE_TOOLS];
}
