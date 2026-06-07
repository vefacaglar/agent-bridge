import type { Memory } from "@agent-bridge/shared";

/** Appends the active project workspace context, when available. */
function projectContextSuffix(projectName?: string, projectPath?: string): string {
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
 * Builds the system prompt for a single-model workspace chat session.
 * The prompt adapts to the active operational mode and injects the
 * active project workspace context when available.
 */
export interface DelegationContext {
  coderModel: string;
  maxSubAgents: number;
  // When set, an optional cheap "utility" tier is available via delegate_to_utility.
  utilityModel?: string;
}

export function buildSystemPrompt(
  projectName?: string,
  projectPath?: string,
  mode?: string,
  shouldReadProjectGuidance = false,
  delegation?: DelegationContext,
  memoryContext = ""
): string {
  // Chat mode is deliberately lightweight: a short prompt with no tool catalog
  // or planning scaffolding, so casual conversations stay cheap on context and
  // the model does not go scanning the project on its own.
  if (mode === "chat") {
    return `You are Locagens, a local-first AI assistant chatting with the user about their project. Be concise and conversational.

CURRENT OPERATIONAL MODE: CHAT MODE
- Do NOT proactively explore, scan, read, modify, run commands, or write <plan>/<task_list> blocks.
- Read/search/list/fetch tools are available only when the user explicitly asks for inspection or references.
- If the request needs hands-on workspace work or commands, tell the user to switch to Build mode.
- Think in ENGLISH; final visible replies match the user's language.
- Do not use emojis. Do not use bold text except for real section headings.
- Call set_chat_title once when intent is clear. Save durable preferences with remember in ENGLISH; do not save transient chatter.${memoryContext}${projectContextSuffix(projectName, projectPath)}`;
  }

  let prompt = `You are Locagens, a local-first AI assistant working in the user's active project workspace.

GLOBAL RULES:
- Think, plan tool use, and reason privately in ENGLISH. Final visible replies match the user's language.
- Treat the latest explicit user decision as authoritative. If instructions conflict and the latest decision is unclear, ask.
- Call set_chat_title once when the user's intent is clear.
- Do not use emojis in visible conversation. Do not use bold text except for real section headings.
- Save durable preferences/project facts with remember in ENGLISH. Do not save transient task details, secrets, or facts already in code/config.
- Ask only when blocked on a real user decision. Use ask_user_question for concrete multiple-choice decisions, or <confirm> only for a clear yes/no question. Do not infer approval from casual wording.
- Inspect with read_file/list_directory/search_files before risky edits. Use edit_file for targeted edits.
- run_command and fetch_url require user approval. Ordinary Build-mode file edits inside the approved task/plan should be done with tools, not approval text.
- Before implementation, use the 'update_plan' tool to outline steps. Maintain a live <task_list> checklist in your visible replies.
- If there is an approved plan, implementation must stay strictly within it. If it is incomplete, unsafe, or wrong, stop and ask for a plan revision.`;

  if (shouldReadProjectGuidance) {
    prompt += `\n\nINITIAL PROJECT GUIDANCE:
- This is the first model request for this run. Before doing substantive planning or implementation, inspect the active workspace guidance files by calling read_file for 'Agents.md' and 'Claude.md' when they exist.
- If either file is missing or unreadable, continue with the available context and do not get stuck.`;
  }

  if (mode === "plan") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: PLAN MODE
- Plan only: discuss architecture, decisions, and steps.
- Do NOT implement. Do NOT write production code, patches, diffs, full file contents, or copy-pastable fenced code blocks.
- DO NOT call any file-mutating tools ('write_file', 'edit_file', 'delete_file', 'create_directory', 'move_file') or 'run_command'. Read-only inspection is fine.
- If asked to implement, ask the user to switch to Build mode.
- If a plan was rejected, do not treat repeated or pasted plan text as approval.
- Use update_plan once for the stable plan panel; revise it only when the user asks. Do NOT output a <plan> block in plan mode. Keep the chat brief with a live <task_list>.`;
  } else if (mode === "auto") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: AUTO/BUILD MODE
- Directly perform needed workspace edits with tools. Dangerous tools still follow permission gating.`;
  } else if (mode === "ask_permissions") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: ASK PERMISSIONS MODE
- Call the matching tool for inspection or changes. Do not ask for permission in plain text; the app intercepts tool calls and shows approvals.`;
  } else if (mode === "accept_edits") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: BUILD MODE
- You are implementing, not just planning. Directly create/edit/delete files with workspace tools; do not ask before ordinary approved edits.
- Keep the in-message <task_list> live and incremental, re-outputting the full list as steps complete.`;
  }

  // Architect (dual-model) instructions: when a coder model is wired up, the
  // main model acts as an architect and delegates the heavy code-writing to
  // 1..maxSubAgents coder sub-agents via the delegate_tasks tool.
  if (delegation) {
    prompt += `\n\nDUAL-MODEL / ARCHITECT MODE:
- You are the ARCHITECT. A separate coder model (${delegation.coderModel}) is available as your sub-agent(s).
- You do NOT have write/edit/delete/create/move/run tools. To change files, call delegate_tasks.
- Inspect, decide architecture, then delegate implementation. You may launch 1-${delegation.maxSubAgents} coder tasks.
- Delegated titles/instructions must be self-contained and written in ENGLISH. The sub-agent does not see this conversation.
- Set parallel=true only for disjoint files. After results, verify changed files and delegate fixes if needed.`;

    if (delegation.utilityModel) {
      prompt += `
- UTILITY TIER: ${delegation.utilityModel} is available via delegate_to_utility.
- Use it first for tiny lookups, file/symbol mapping, summaries, path checks, or simple renames. Keep tasks small, self-contained, and in ENGLISH.
- Use delegate_tasks for substantial implementation.`;
    }
  }

  prompt += memoryContext;
  prompt += projectContextSuffix(projectName, projectPath);

  return prompt;
}

/**
 * System prompt for a coder sub-agent: a focused build-mode worker that
 * implements ONE self-contained delegated task in the shared workspace and
 * reports concisely what it did. It has no plan panel and cannot delegate.
 */
export function buildCoderSystemPrompt(
  projectName: string | undefined,
  projectPath: string | undefined,
  taskTitle: string
): string {
  return `You are a CODER sub-agent in the user's workspace.

YOUR TASK: ${taskTitle}

RULES:
- Build mode: inspect, then directly use workspace tools to complete this one task.
- Stay strictly within the delegated scope; no unrelated refactors.
- run_command/fetch_url require approval; use them only when needed.
- Think and report in ENGLISH. End with a short report: files changed, behavior, assumptions/problems.
- Do not paste full files. You cannot delegate further.${projectContextSuffix(projectName, projectPath)}`;
}

/**
 * System prompt for a utility sub-agent: a cheap, focused worker that answers ONE
 * tiny mechanical question (locate a file/symbol, summarize a file) or performs a
 * simple rename/move, then returns a SHORT answer. It can only read/list/search
 * and move files — never write/edit/delete — and cannot delegate.
 */
export function buildUtilitySystemPrompt(
  projectName: string | undefined,
  projectPath: string | undefined,
  taskTitle: string
): string {
  return `You are a UTILITY sub-agent for one tiny mechanical workspace task.

YOUR TASK: ${taskTitle}

RULES:
- Only use read_file, list_directory, search_files, and move_file. No write/edit/delete/create/run.
- Do the minimum search/read needed, then stop.
- Think and answer in ENGLISH. Return only the requested path/line/list/summary.
- Do not paste large content. You cannot delegate further.${projectContextSuffix(projectName, projectPath)}`;
}
