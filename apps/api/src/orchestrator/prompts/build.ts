import type { ModeStrategy } from "./types.js";
import { buildModeBaseTools } from "./shared.js";

/**
 * Build mode (the `accept_edits` backend mode shown in the UI): the model
 * implements directly with workspace tools; ordinary approved edits do not ask,
 * but dangerous tools (run_command/fetch_url) still gate. This is also the
 * default for unknown/legacy modes.
 */
export const buildStrategy: ModeStrategy = {
  mode: "accept_edits",
  lightweight: false,
  allowsMutation: true,
  allowsDelegation: true,
  allowsPlanTool: false,
  bypassDangerousGating: false,
  gatesEveryTool: false,
  selectBaseTools: (delegating) => buildModeBaseTools(delegating),
  promptSection(): string {
    return `\n\nCURRENT OPERATIONAL MODE: BUILD MODE
- You are implementing, not just planning. Directly create/edit/delete files with workspace tools; do not ask before ordinary approved edits.
- Do NOT call update_plan here — the stable plan panel belongs to Plan mode only. If you want to outline steps, write them as plain text in your reply (or a <task_list> for complex work), then implement.
- If using a <task_list> for a complex task, keep it live and incremental, re-outputting the full list as steps complete.`;
  }
};
