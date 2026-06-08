import { projectContextSuffix } from "./shared.js";

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
- Only use read_file, list_directory, search_files, and move_file.
- You cannot run commands, delete files, edit files, write files, create files, or delegate. Do not claim otherwise.
- Do the minimum search/read needed, then stop.
- Think and answer in ENGLISH. Return only the requested path/line/list/summary.
- Do not paste large content. You cannot delegate further.${projectContextSuffix(projectName, projectPath)}`;
}
