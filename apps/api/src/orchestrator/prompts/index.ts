import type { DelegationContext, ModeStrategy } from "./types.js";
import {
  GLOBAL_RULES,
  initialGuidance,
  delegationBlock,
  projectContextSuffix,
  formatMemoryContext
} from "./shared.js";
import { chatStrategy } from "./chat.js";
import { planStrategy } from "./plan.js";
import { buildStrategy } from "./build.js";
import { autoStrategy } from "./auto.js";
import { askPermissionsStrategy } from "./askPermissions.js";
import { fullAccessStrategy } from "./fullAccess.js";

export type { ModeStrategy, DelegationContext, PromptContext, ToolDef } from "./types.js";
export { formatMemoryContext, formatActivePlan } from "./shared.js";
export { buildCoderSystemPrompt, buildUtilitySystemPrompt } from "./subAgents.js";

const STRATEGIES: Record<string, ModeStrategy> = {
  [chatStrategy.mode]: chatStrategy,
  [planStrategy.mode]: planStrategy,
  [buildStrategy.mode]: buildStrategy,
  [autoStrategy.mode]: autoStrategy,
  [askPermissionsStrategy.mode]: askPermissionsStrategy,
  [fullAccessStrategy.mode]: fullAccessStrategy
};

/**
 * Resolves the strategy for a run's mode. Unknown / legacy modes fall back to
 * the build (accept_edits) strategy — the same default the previous if/else
 * chain used (its final `else` branch was accept_edits).
 */
export function getModeStrategy(mode?: string): ModeStrategy {
  return STRATEGIES[mode ?? ""] ?? buildStrategy;
}

/**
 * Builds the system prompt for a single-model workspace chat session. Picks the
 * mode strategy, then composes the shared sections around its prompt block:
 * global rules -> initial guidance -> mode section -> delegation -> plan ->
 * memory -> project context. A lightweight strategy (chat) returns its entire
 * prompt standalone, so no wrapping is applied.
 */
export function buildSystemPrompt(
  projectName?: string,
  projectPath?: string,
  mode?: string,
  shouldReadProjectGuidance = false,
  delegation?: DelegationContext,
  memoryContext = "",
  planContext = ""
): string {
  const strategy = getModeStrategy(mode);
  const ctx = { projectName, projectPath, shouldReadProjectGuidance, delegation, memoryContext };

  if (strategy.lightweight) {
    return strategy.promptSection(ctx);
  }

  let prompt = GLOBAL_RULES;
  if (shouldReadProjectGuidance) prompt += initialGuidance();
  prompt += strategy.promptSection(ctx);
  // Architect (dual-model) instructions: when a coder model is wired up, the
  // main model acts as an architect and delegates the heavy code-writing.
  if (delegation) prompt += delegationBlock(delegation);
  prompt += planContext;
  prompt += memoryContext;
  prompt += projectContextSuffix(projectName, projectPath);

  return prompt;
}
