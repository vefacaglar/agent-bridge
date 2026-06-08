import type { UserQuestion } from "@agent-bridge/shared";
import { ASK_QUESTION_TOOL } from "../workspaceTools.js";
import type { OrchestratorTool } from "./types.js";

/**
 * ask_user_question: validates/normalizes the questions, pauses the run for the
 * user's selections, and returns those selections to the model as the tool
 * result. No filesystem/network I/O; allowed in every mode. Never throws.
 */
export const askUserQuestionTool: OrchestratorTool = {
  schema: ASK_QUESTION_TOOL,
  isAvailable: () => true,
  async execute(ctx, runId, _run, toolCall) {
    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (e: any) {
      return JSON.stringify({ success: false, error: `Invalid ask_user_question arguments: ${e.message}` });
    }

    // In plan mode, once a plan exists the plan panel already carries the
    // approve/revise/reject controls ("Start building"). Block ask_user_question
    // here so the model can't pop a redundant approval card alongside the panel;
    // it should simply end its turn and let the user approve via the panel.
    const run = ctx.runRepo.getById(runId);
    if (run?.mode === "plan" && ctx.planRepo.getActive(runId)) {
      return JSON.stringify({
        success: false,
        error:
          "Do not ask for approval here. A plan already exists; the plan panel provides the approve/revise/reject controls. End your turn and let the user decide via the panel."
      });
    }

    const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
    const questions: UserQuestion[] = rawQuestions
      .filter((q: any) => q && typeof q.question === "string" && q.question.trim() && Array.isArray(q.options))
      .slice(0, 4)
      .map((q: any) => ({
        question: String(q.question),
        header: typeof q.header === "string" ? q.header.trim().slice(0, 12) : "",
        multiSelect: !!q.multiSelect,
        options: q.options
          .map((o: any) =>
            typeof o === "string"
              ? { label: o }
              : o && typeof o.label === "string"
                ? { label: String(o.label), description: typeof o.description === "string" ? o.description : undefined }
                : null
          )
          .filter((o: any): o is { label: string; description?: string } => !!o && !!o.label.trim())
          .slice(0, 4)
      }))
      .filter((q: UserQuestion) => q.options.length > 0);

    if (questions.length === 0) {
      return JSON.stringify({ success: false, error: "No valid questions (each needs a question and at least one option)." });
    }

    const { selections, notes } = await ctx.requestUserAnswer(runId, questions);

    // If the run was cancelled while waiting, don't flip status back — let the
    // loop's next cancellation check unwind it.
    if (!ctx.isActive(runId)) {
      return JSON.stringify({ success: false, error: "Cancelled before the user answered." });
    }
    await ctx.setGenerating(runId);

    const answers = questions.map((q, i) => {
      const note = (notes[i] ?? "").trim();
      return {
        question: q.question,
        header: q.header,
        selected: selections[i] ?? [],
        ...(note ? { note } : {})
      };
    });
    return JSON.stringify({ success: true, answers });
  }
};
