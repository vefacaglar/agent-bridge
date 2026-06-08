import type { PlanTask } from "@agent-bridge/shared";
import { UPDATE_PLAN_TOOL } from "../workspaceTools.js";
import { getModeStrategy } from "../prompts/index.js";
import type { OrchestratorTool } from "./types.js";

/**
 * update_plan: records or revises the stable plan-panel document. No
 * filesystem/network I/O, so it runs silently (no permission prompt). The plan
 * PANEL belongs to Plan mode only — in any other mode it is not advertised, and
 * a stray call (some models invoke it out of habit) is rejected with guidance to
 * write the plan as plain inline text instead. Never throws.
 */
export const updatePlanTool: OrchestratorTool = {
  schema: UPDATE_PLAN_TOOL,
  isAvailable: (strategy) => strategy.allowsPlanTool,
  async execute(ctx, runId, run, toolCall) {
    if (!getModeStrategy(run.mode).allowsPlanTool) {
      return JSON.stringify({
        success: false,
        error: `update_plan is only available in Plan mode. In ${run.mode} mode, do not create a plan panel — write any plan as plain text directly in your reply, then proceed.`
      });
    }

    try {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
      const tasks: PlanTask[] = rawTasks.map((t: any) => ({
        text: typeof t?.text === "string" ? t.text : "",
        status: t?.status === "in_progress" || t?.status === "completed" ? t.status : "pending"
      }));

      const plan = await ctx.planRepo.upsert(runId, {
        title: typeof args.title === "string" ? args.title : undefined,
        body: typeof args.body === "string" ? args.body : undefined,
        tasks,
        startNew: !!args.start_new
      });

      ctx.eventBus.emit(`run:${runId}`, { type: "plan_updated", plan });

      return JSON.stringify({
        success: true,
        planId: plan.id,
        version: plan.version,
        taskCount: plan.tasks.length,
        completed: plan.tasks.filter(t => t.status === "completed").length
      });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }
  }
};
