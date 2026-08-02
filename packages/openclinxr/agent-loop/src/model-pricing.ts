/**
 * Estimated model pricing for task cost rollups (USD per 1M tokens).
 *
 * NOT a bill of record. Grok session data gives context/peak totals, not exact
 * billed input/output splits. We use a blended rate unless both sides known.
 *
 * Update rates when providers change; temporal-review weekly for Grok/DeepSeek.
 * schemaVersion bumped when rates change so old rollups stay interpretable.
 */

export const MODEL_PRICING_SCHEMA = "openclinxr.model-pricing.v1" as const;

export type ModelPriceRow = {
  /** Display / match key (lowercase substrings also matched) */
  id: string;
  match: string[];
  /** USD per 1M input tokens (estimate) */
  inputPer1M: number;
  /** USD per 1M output tokens (estimate) */
  outputPer1M: number;
  /**
   * Blended USD per 1M when only a single total-token figure is available
   * (typical for Grok contextTokensUsed / peak totals).
   */
  blendedPer1M: number;
  note?: string;
};

/** Living rate card — re-check via temporal catalog (weekly for Grok/DeepSeek). */
export const MODEL_PRICE_ROWS: readonly ModelPriceRow[] = [
  {
    id: "deepseek-v4-flash",
    match: ["deepseek-v4-flash", "deepseek-flash"],
    inputPer1M: 0.14,
    outputPer1M: 0.28,
    blendedPer1M: 0.2,
    note: "Cheap scout tier; verify against current DeepSeek list prices",
  },
  {
    id: "deepseek-v4-pro",
    match: ["deepseek-v4-pro", "deepseek-pro", "deepseek-v4-pro-anthropic"],
    inputPer1M: 1.1,
    outputPer1M: 3.3,
    blendedPer1M: 1.8,
    note: "Pro / anthropic-compatible path estimate",
  },
  {
    id: "grok-4.5",
    match: ["grok-4.5", "grok-4-multi", "x-grok-4"],
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    blendedPer1M: 6.0,
    note: "Parent/main + some GP writers; blended for context totals",
  },
  {
    id: "grok-composer",
    match: ["grok-composer", "composer-2", "composer-3"],
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    blendedPer1M: 6.0,
  },
  {
    id: "grok-build",
    match: ["grok-build"],
    inputPer1M: 5.0,
    outputPer1M: 25.0,
    blendedPer1M: 10.0,
    note: "Frontier / rare",
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

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
