interface PriceRate {
  inputRate: number;      // USD per 1M tokens
  outputRate: number;     // USD per 1M tokens
  cacheReadRate?: number; // USD per 1M tokens
  cacheWriteRate?: number; // USD per 1M tokens
}

// Pricing rates in USD per 1,000,000 tokens
const PRICING_SHEET: Record<string, PriceRate> = {
  // Anthropic Models
  "claude-3-5-sonnet": {
    inputRate: 3.0,
    outputRate: 15.0,
    cacheReadRate: 0.3,
    cacheWriteRate: 3.75
  },
  "claude-3-opus": {
    inputRate: 15.0,
    outputRate: 75.0,
    cacheReadRate: 1.5,
    cacheWriteRate: 18.75
  },
  "claude-3-5-haiku": {
    inputRate: 0.8,
    outputRate: 4.0,
    cacheReadRate: 0.08,
    cacheWriteRate: 1.0
  },

  // OpenAI Models
  "gpt-4o": {
    inputRate: 2.5,
    outputRate: 10.0,
    cacheReadRate: 1.25
  },
  "gpt-4o-mini": {
    inputRate: 0.15,
    outputRate: 0.6,
    cacheReadRate: 0.075
  },
  "o1": {
    inputRate: 15.0,
    outputRate: 60.0
  },
  "o3-mini": {
    inputRate: 1.1,
    outputRate: 4.4
  },

  // DeepSeek Models
  "deepseek-chat": {
    inputRate: 0.14,
    outputRate: 0.28,
    cacheReadRate: 0.014
  },
  "deepseek-coder": {
    inputRate: 0.14,
    outputRate: 0.28,
    cacheReadRate: 0.014
  },
  "deepseek-v3": {
    inputRate: 0.14,
    outputRate: 0.28,
    cacheReadRate: 0.014
  },

  // Gemini Models
  "gemini-1.5-flash": {
    inputRate: 0.075,
    outputRate: 0.3
  },
  "gemini-1.5-pro": {
    inputRate: 1.25,
    outputRate: 5.0
  },
  "gemini-2.0-flash": {
    inputRate: 0.075,
    outputRate: 0.3
  },
  "gemini-3.5-flash": {
    inputRate: 0.075,
    outputRate: 0.3
  }
};

/**
 * Finds the closest matching pricing rate for a given model string.
 */
function findRate(model: string): PriceRate | null {
  const normalizedModel = model.toLowerCase();
  
  // Try exact match first
  if (PRICING_SHEET[normalizedModel]) {
    return PRICING_SHEET[normalizedModel];
  }

  // Try substring match
  for (const [key, rate] of Object.entries(PRICING_SHEET)) {
    if (normalizedModel.includes(key)) {
      return rate;
    }
  }

  // Fallbacks based on naming heuristics
  if (normalizedModel.includes("sonnet")) {
    return PRICING_SHEET["claude-3-5-sonnet"];
  }
  if (normalizedModel.includes("opus")) {
    return PRICING_SHEET["claude-3-opus"];
  }
  if (normalizedModel.includes("haiku")) {
    return PRICING_SHEET["claude-3-5-haiku"];
  }
  if (normalizedModel.includes("mini") && normalizedModel.includes("gpt")) {
    return PRICING_SHEET["gpt-4o-mini"];
  }
  if (normalizedModel.includes("gpt-4")) {
    return PRICING_SHEET["gpt-4o"];
  }
  if (normalizedModel.includes("deepseek") || normalizedModel.includes("qwen")) {
    // Qwen/Deepseek compatible deepseek pricing
    return PRICING_SHEET["deepseek-chat"];
  }
  if (normalizedModel.includes("flash")) {
    return PRICING_SHEET["gemini-1.5-flash"];
  }
  if (normalizedModel.includes("pro")) {
    return PRICING_SHEET["gemini-1.5-pro"];
  }

  return null;
}

/**
 * Computes the estimated cost of an LLM completion request in USD.
 */
export function calculateCost(
  _providerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0
): number {
  const rate = findRate(model);
  if (!rate) {
    return 0.0;
  }

  const inputCost = (inputTokens / 1_000_000) * rate.inputRate;
  const outputCost = (outputTokens / 1_000_000) * rate.outputRate;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * (rate.cacheReadRate ?? 0);
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (rate.cacheWriteRate ?? 0);

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
