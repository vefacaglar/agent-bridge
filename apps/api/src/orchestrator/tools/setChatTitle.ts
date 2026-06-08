import { SET_TITLE_TOOL } from "../workspaceTools.js";
import type { OrchestratorTool } from "./types.js";

/**
 * set_chat_title: renames the run and broadcasts the new title to the UI. No
 * filesystem/network I/O, so it is allowed in every mode and runs silently
 * (no permission prompt). Never throws — failures come back as a JSON error.
 */
export const setChatTitleTool: OrchestratorTool = {
  schema: SET_TITLE_TOOL,
  isAvailable: () => true,
  async execute(ctx, runId, _run, toolCall) {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      let title = typeof args.title === "string" ? args.title.trim() : "";
      // Strip wrapping quotes the model sometimes adds, and cap the length.
      title = title.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, 80);
      if (!title) {
        return JSON.stringify({ success: false, error: "Title was empty." });
      }

      await ctx.runRepo.update(runId, { title });
      ctx.eventBus.emit(`run:${runId}`, { type: "run_title_changed", runId, title });

      return JSON.stringify({ success: true, title });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err?.message ?? "Failed to set title." });
    }
  }
};
