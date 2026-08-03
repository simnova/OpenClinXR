/**
 * Model pricing for task cost rollups (USD per 1M tokens).
 *
 * NOT a bill of record. Prefer EXACT input/output tokens (from grok headless
 * `--output-format json` `usage`, or ccusage) via `estimateUsdFromSplit`; the
 * `blendedPer1M` figure is an input-weighted (0.7·in + 0.3·out) fallback for
 * single total-token estimates only.
 *
 * COST-OPTIMIZATION PRINCIPLE: agentic (LLM) calls always cost tokens + wall-clock;
 * deterministic computation is ~free and instant. Compute cost, token counts, and
 * gate outcomes in CODE (this module, ccusage, tests) — never delegate a computable
 * task to a model. Reserve model calls for reasoning/judgment/generation.
 *
 * Rates fetched 2026-08-03 from public pricing pages (per-row `source`). Providers
 * move fast: re-verify weekly (a `delegate:refresh-prices` fetcher should re-pull
 * and diff). `asOf` on each row records last verification.
 *
 * Confirmed changes vs v1: DeepSeek legacy `deepseek-chat`/`deepseek-reasoner`
 * aliases deprecated 2026-07-24 (v4-flash/v4-pro are the live models); DeepSeek
 * V4-Pro price dropped (~1.10/3.30 -> 0.435/0.87); Grok 4.5 is 2/6 (not 3/15);
 * older Grok (grok-3, grok-4, grok-code-fast-1) are legacy. Claude rows added.
 */

export const MODEL_PRICING_SCHEMA = "openclinxr.model-pricing.v2" as const;

export type ModelPriceRow = {
  /** Display / match key (lowercase substrings also matched) */
  id: string;
  match: string[];
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** Input-weighted (0.7·in + 0.3·out) fallback for single total-token estimates. */
  blendedPer1M: number;
  /** USD per 1M cached-input tokens, when the provider prices cache hits. */
  cacheHitInputPer1M?: number;
  /** ISO date this row's rate was last verified against `source`. */
  asOf?: string;
  /** Public pricing URL the rate was taken from. */
  source?: string;
  note?: string;
};

/** Rate card — fetched 2026-08-03 from public pricing pages; re-verify weekly. */
export const MODEL_PRICE_ROWS: readonly ModelPriceRow[] = [
  // --- DeepSeek 4 (cheapest; chat/reasoner aliases deprecated 2026-07-24) ---
  {
    id: "deepseek-v4-flash",
    match: ["deepseek-v4-flash", "deepseek-flash"],
    inputPer1M: 0.14,
    outputPer1M: 0.28,
    blendedPer1M: 0.18,
    cacheHitInputPer1M: 0.0028,
    asOf: "2026-08-03",
    source: "https://deepseek.ai/pricing",
    note: "Grunt/scout tier. Cache hit 50x cheaper than miss. Almost free.",
  },
  {
    id: "deepseek-v4-pro",
    match: ["deepseek-v4-pro", "deepseek-pro", "deepseek-v4-pro-anthropic"],
    inputPer1M: 0.435,
    outputPer1M: 0.87,
    blendedPer1M: 0.57,
    cacheHitInputPer1M: 0.003625,
    asOf: "2026-08-03",
    source: "https://deepseek.ai/pricing",
    note: "Price DROPPED vs v1 (was 1.10/3.30). Bounded-impl tier.",
  },
  // --- xAI Grok (grok-4.5 is vision-capable; older grok-3/4/code-fast legacy) ---
  {
    id: "grok-4.1-fast",
    match: ["grok-4.1-fast", "grok-4-1-fast", "grok-fast"],
    inputPer1M: 0.2,
    outputPer1M: 0.5,
    blendedPer1M: 0.29,
    asOf: "2026-08-03",
    source: "https://benchlm.ai/xai/api-pricing",
    note: "Cheap high-context Grok tier (2M ctx); multimodal.",
  },
  {
    id: "grok-4.3",
    match: ["grok-4.3", "grok-4-3"],
    inputPer1M: 1.25,
    outputPer1M: 2.5,
    blendedPer1M: 1.63,
    asOf: "2026-08-03",
    source: "https://benchlm.ai/xai/api-pricing",
    note: "Mid Grok tier (1M ctx).",
  },
  {
    id: "grok-4.5",
    match: ["grok-4.5", "grok-4-5", "grok-4.5-build", "grok-build", "grok-composer", "grok-4-multi"],
    inputPer1M: 2.0,
    outputPer1M: 6.0,
    blendedPer1M: 3.2,
    cacheHitInputPer1M: 0.5,
    asOf: "2026-08-03",
    source: "https://benchlm.ai/xai/api-pricing",
    note: "Flagship, vision-capable (proven P1-grok45-vision). CLI grok-build/composer resolve here. >200K ctx surcharge.",
  },
  // --- Anthropic Claude (manager + high-cognition; Sonnet promo thru 2026-08-31) ---
  {
    id: "claude-haiku",
    match: ["claude-haiku", "haiku-4-5", "haiku"],
    inputPer1M: 1.0,
    outputPer1M: 5.0,
    blendedPer1M: 2.2,
    asOf: "2026-08-03",
    source: "https://www.anthropic.com/pricing",
    note: "Cheapest Claude; cache hit = 10% input; Batch API 50% off.",
  },
  {
    id: "claude-sonnet",
    match: ["claude-sonnet", "sonnet-5", "sonnet"],
    inputPer1M: 2.0,
    outputPer1M: 10.0,
    blendedPer1M: 4.4,
    asOf: "2026-08-03",
    source: "https://www.anthropic.com/pricing",
    note: "Promo 2/10 through 2026-08-31, then 3/15. Re-verify after that date.",
  },
  {
    id: "claude-opus",
    match: ["claude-opus", "opus-4-8", "opus-5", "opus"],
    inputPer1M: 5.0,
    outputPer1M: 25.0,
    blendedPer1M: 11.0,
    asOf: "2026-08-03",
    source: "https://www.anthropic.com/pricing",
    note: "Manager/high-cognition + verification. This session's model.",
  },
  {
    id: "claude-fable",
    match: ["claude-fable", "fable-5", "fable"],
    inputPer1M: 10.0,
    outputPer1M: 50.0,
    blendedPer1M: 22.0,
    asOf: "2026-08-03",
    source: "https://www.anthropic.com/pricing",
    note: "Frontier / rare.",
  },
  {
    id: "unknown",
    match: [],
    inputPer1M: 2.0,
    outputPer1M: 8.0,
    blendedPer1M: 4.0,
    note: "Fallback when model id unknown",
  },
] as const;

export function resolveModelPrice(modelId: string | null | undefined): ModelPriceRow {
  const normalized = (modelId ?? "").toLowerCase();
  if (!normalized) return MODEL_PRICE_ROWS[MODEL_PRICE_ROWS.length - 1]!;
  for (const row of MODEL_PRICE_ROWS) {
    if (row.id === "unknown") continue;
    if (row.match.some((m) => normalized.includes(m.toLowerCase()))) return row;
  }
  return MODEL_PRICE_ROWS[MODEL_PRICE_ROWS.length - 1]!;
}

/**
 * Estimate USD from a single total-token figure (context peak / final).
 * Overstates vs true billed tokens; documented as estimate.
 */
export function estimateUsdFromTotalTokens(
  totalTokens: number,
  modelId: string | null | undefined,
): { usd: number; priceRowId: string; blendedPer1M: number } {
  const row = resolveModelPrice(modelId);
  const tokens = Math.max(0, totalTokens);
  const usd = (tokens / 1_000_000) * row.blendedPer1M;
  return { usd, priceRowId: row.id, blendedPer1M: row.blendedPer1M };
}

/**
 * Exact USD from a real input/output split (grok headless `usage`, ccusage).
 * Preferred over the blended estimate. `cachedInputTokens` are billed at the
 * provider's cache-hit rate when known (else the normal input rate).
 * Deterministic — the delegation scorer computes cost here, never via a model.
 */
export function estimateUsdFromSplit(
  inputTokens: number,
  outputTokens: number,
  modelId: string | null | undefined,
  cachedInputTokens = 0,
): { usd: number; priceRowId: string; inputUsd: number; outputUsd: number; cachedUsd: number } {
  const row = resolveModelPrice(modelId);
  const freshInput = Math.max(0, inputTokens - Math.max(0, cachedInputTokens));
  const cachedRate = row.cacheHitInputPer1M ?? row.inputPer1M;
  const inputUsd = (freshInput / 1_000_000) * row.inputPer1M;
  const cachedUsd = (Math.max(0, cachedInputTokens) / 1_000_000) * cachedRate;
  const outputUsd = (Math.max(0, outputTokens) / 1_000_000) * row.outputPer1M;
  return { usd: inputUsd + cachedUsd + outputUsd, priceRowId: row.id, inputUsd, outputUsd, cachedUsd };
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
