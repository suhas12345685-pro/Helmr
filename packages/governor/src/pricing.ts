/**
 * Per-model price table and USD cost estimation from AI-SDK token usage.
 *
 * Prices are USD per 1,000,000 tokens, separated into input (prompt) and output
 * (completion). The table is intentionally small and easy to keep current; an
 * unknown model falls back to a conservative default so we over-estimate rather
 * than under-count spend (a budget should fail safe).
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** AI-SDK has historically also used these names. */
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Conservative default for an unrecognized model: priced at the high end so an
 * unknown model never silently under-reports spend.
 */
export const DEFAULT_MODEL_PRICE: ModelPrice = { inputPerMTok: 15, outputPerMTok: 75 };

/** Keyed by bare model name (provider prefix stripped before lookup). */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic Claude
  'claude-opus-4-7': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-opus-4-5': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-opus-4-1': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-sonnet-4-0': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4 },
  // OpenAI
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4.1': { inputPerMTok: 2, outputPerMTok: 8 },
  'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  'o3-mini': { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  // Google Gemini
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-2.0-flash': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  // Groq (Llama)
  'llama-3.3-70b-versatile': { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  // xAI Grok
  'grok-4': { inputPerMTok: 3, outputPerMTok: 15 },
  'grok-3': { inputPerMTok: 3, outputPerMTok: 15 },
};

/** Strip a provider prefix (e.g. `anthropic/claude-...`) and trailing dates. */
export function normalizeModelId(modelId: string): string {
  const bare = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  // Drop a trailing `-YYYYMMDD` snapshot suffix so dated aliases match the table.
  return bare.replace(/-\d{8}$/, '').trim().toLowerCase();
}

/** Resolve the price for a model id, falling back to the conservative default. */
export function priceForModel(modelId: string): ModelPrice {
  const key = normalizeModelId(modelId);
  if (MODEL_PRICES[key]) return MODEL_PRICES[key]!;
  // Prefix match so `claude-sonnet-4-5-some-variant` still resolves.
  for (const [name, price] of Object.entries(MODEL_PRICES)) {
    if (key.startsWith(name)) return price;
  }
  return DEFAULT_MODEL_PRICE;
}

function inputTokensOf(usage: TokenUsage): number {
  return usage.inputTokens ?? usage.promptTokens ?? 0;
}

function outputTokensOf(usage: TokenUsage): number {
  return usage.outputTokens ?? usage.completionTokens ?? 0;
}

/** Estimate the USD cost of a single completion from its token usage. */
export function estimateCostUsd(modelId: string, usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  const price = priceForModel(modelId);
  let input = inputTokensOf(usage);
  let output = outputTokensOf(usage);
  // If only a total is reported, attribute it all to output (the pricier side).
  if (input === 0 && output === 0 && usage.totalTokens) {
    output = usage.totalTokens;
  }
  const cost = (input / 1_000_000) * price.inputPerMTok + (output / 1_000_000) * price.outputPerMTok;
  return Number.isFinite(cost) ? cost : 0;
}
