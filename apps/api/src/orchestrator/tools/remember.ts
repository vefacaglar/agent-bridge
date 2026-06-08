import { REMEMBER_TOOL } from "../workspaceTools.js";
import type { OrchestratorTool } from "./types.js";

/**
 * remember: saves (or revises) a durable memory. Silent — no permission prompt,
 * no SSE; the user manages memories in Settings. A "project" memory is scoped to
 * this run's project path. Allowed in every mode. Never throws.
 */
export const rememberTool: OrchestratorTool = {
  schema: REMEMBER_TOOL,
  isAvailable: () => true,
  async execute(ctx, _runId, run, toolCall) {
    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!content) {
        return JSON.stringify({ success: false, error: "Nothing to remember: content was empty." });
      }

      // Revise an existing memory in place when the model passes update_id.
      const updateId = typeof args.update_id === "number" ? args.update_id : Number(args.update_id);
      if (Number.isInteger(updateId) && updateId > 0) {
        const updated = await ctx.memoryRepo.update(updateId, content);
        if (updated) {
          return JSON.stringify({ success: true, action: "updated", memory: updated });
        }
        // Fall through to create if the id no longer exists.
      }

      const scope = args.scope === "global" ? "global" : "project";
      const memory = await ctx.memoryRepo.create({
        scope,
        projectPath: scope === "project" ? (run.projectPath || "") : "",
        category: args.category,
        content
      });
      return JSON.stringify({ success: true, action: "created", memory });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err?.message ?? "Failed to save memory." });
    }
  }
};
