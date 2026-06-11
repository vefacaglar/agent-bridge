import type { ModelPricing, PriceTier } from "@locagens/shared";

/**
 * Picks the pricing tier for a request by its total prompt (input) token count.
 * Tiers are matched against the first whose `upToInputTokens` ceiling covers the
 * prompt; the final open-ended tier (no ceiling) catches everything larger.
 */
function selectTier(tiers: PriceTier[], promptTokens: number): PriceTier | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => (a.upToInputTokens ?? Infinity) - (b.upToInputTokens ?? Infinity));
  for (const tier of sorted) {
    if (tier.upToInputTokens === undefined || promptTokens <= tier.upToInputTokens) return tier;
  }
  return sorted[sorted.length - 1];
}

/**
 * Computes the cost of a completion in USD from the model's user-entered
 * `pricing` only. There is NO built-in pricing table and no guessing from the
 * model name: if a model has no pricing configured, its cost is 0. Rates are USD
 * per 1M tokens; for tiered pricing the tier is chosen by the prompt size.
 */
export function calculateCost(
  pricing: ModelPricing | null | undefined,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0
): number {
  if (!pricing?.tiers?.length) return 0.0;

  // Tier is chosen by the size of the prompt (all input-side tokens).
  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const tier = selectTier(pricing.tiers, promptTokens);
  if (!tier) return 0.0;

  const inputCost = (inputTokens / 1_000_000) * tier.inputRate;
  const outputCost = (outputTokens / 1_000_000) * tier.outputRate;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * (tier.cacheReadRate ?? 0);
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (tier.cacheWriteRate ?? 0);

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
