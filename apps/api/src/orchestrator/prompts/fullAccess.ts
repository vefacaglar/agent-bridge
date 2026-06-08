import type { ModeStrategy } from "./types.js";
import { buildModeBaseTools } from "./shared.js";

/**
 * Full access mode: fully autonomous. The model creates/edits/deletes files and
 * runs commands and network tools with NO approval prompts — dangerous tools bypass gating
 * entirely. A valid backend mode (not offered in the UI mode picker).
 */
export const fullAccessStrategy: ModeStrategy = {
  mode: "full_access",
  lightweight: false,
  allowsMutation: true,
  allowsDelegation: true,
  allowsPlanTool: false,
  bypassDangerousGating: true,
  gatesEveryTool: false,
  selectBaseTools: (delegating) => buildModeBaseTools(delegating),
  promptSection(): string {
    return `\n\nCURRENT OPERATIONAL MODE: FULL ACCESS MODE
- You are implementing autonomously. Directly create/edit/delete files with workspace tools; NO approval is needed for any tool, including run_command, search_web, and fetch_url.
- run_command, search_web, and fetch_url do NOT require user approval in this mode. Use them freely when needed.
- Do NOT call update_plan here — write any plan as plain text in your reply (or a <task_list> for complex work), then implement.
- All file access is confined to the project workspace; you cannot operate outside the project folder.
- Stay within the user's intent: do not take destructive or irreversible actions beyond the requested task.`;
  }
};
