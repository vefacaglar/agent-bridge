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
- Do NOT call update_plan here — the stable plan panel belongs to Plan mode only.
- For any multi-step or multi-file work, keep a live <task_list> and re-output it each reply, marking steps done. If an APPROVED PLAN is provided above, seed the task_list from its steps. Skip the list only for a trivial one-step fix.`;
  }
};
