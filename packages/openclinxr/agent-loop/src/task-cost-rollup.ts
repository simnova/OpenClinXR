/**
 * Per-task cost rollup: subagent + model breakdown and total estimate.
 *
 * Primary signal: Grok native subagent child sessions (tokens + model).
 * Optional: parent session peak delta attributed as "parent/main".
 * ccusage remains cross-harness secondary (not per-subagent).
 */

import {
  estimateUsdFromTotalTokens,
  formatUsd,
  MODEL_PRICING_SCHEMA,
  resolveModelPrice,
} from "./model-pricing.js";
import type { GrokSubagentTokenSnapshot } from "./grok-token-introspection.js";

export const TASK_COST_ROLLUP_SCHEMA = "openclinxr.task-cost-rollup.v1" as const;

export type TaskCostLine = {
  key: string;
  kind: "subagent" | "parent" | "model_roll";
  subagentId?: string;
  subagentType?: string;
  modelId: string;
  tokens: number;
  estimatedUsd: number;
  priceRowId: string;
  status?: string;
  durationMs?: number | null;
  source?: string;
};

export type TaskCostRollup = {
  schemaVersion: typeof TASK_COST_ROLLUP_SCHEMA;
  pricingSchema: typeof MODEL_PRICING_SCHEMA;
  taskId: string;
  generatedAt: string;
  window: {
    sinceIso: string | null;
    untilIso: string;
    note: string;
  };
  estimateMethod: string;
  disclaimer: string;
  bySubagent: TaskCostLine[];
  byModel: Array<{ modelId: string; tokens: number; estimatedUsd: number; count: number }>;
  totals: {
    subagentCount: number;
    subagentWithTokens: number;
    tokens: number;
    estimatedUsd: number;
    parentTokens: number;
    parentEstimatedUsd: number;
    grandTokens: number;
    grandEstimatedUsd: number;
  };
  costRecordLine: string;
  markdownTable: string;
};

export function filterSubagentsSince(
  items: GrokSubagentTokenSnapshot[],
  sinceIso: string | null,
  untilIso: string = new Date().toISOString(),
): GrokSubagentTokenSnapshot[] {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
  const untilMs = Date.parse(untilIso) || Date.now();
  return items.filter((item) => {
    const completed = item.completedAt;
    const started = item.startedAt;
    const t = completed
      ? Date.parse(completed)
      : started
        ? Date.parse(started)
        : untilMs; // if no timestamp, include when no since window
    if (!Number.isFinite(t)) return sinceIso == null;
    if (sinceIso && t < sinceMs) return false;
    if (t > untilMs) return false;
    return true;
  });
}

export function buildTaskCostRollup(input: {
  taskId: string;
  subagents: GrokSubagentTokenSnapshot[];
  sinceIso?: string | null;
  untilIso?: string;
  parentTokens?: number;
  parentModelId?: string | null;
  generatedAt?: string;
}): TaskCostRollup {
  const untilIso = input.untilIso ?? new Date().toISOString();
  const sinceIso = input.sinceIso ?? null;
  // Prefer items already scoped by caller; still apply filter if timestamps exist
  const scoped = filterSubagentsSince(input.subagents, sinceIso, untilIso);

  const bySubagent: TaskCostLine[] = [];
  for (const s of scoped) {
    const tokens = s.finalTotalTokens > 0 ? s.finalTotalTokens : s.peakTotalTokens;
    if (tokens <= 0) continue;
    const modelId = s.effectiveModelId ?? "unknown";
    const { usd, priceRowId } = estimateUsdFromTotalTokens(tokens, modelId);
    bySubagent.push({
      key: s.subagentId,
      kind: "subagent",
      subagentId: s.subagentId,
      subagentType: s.subagentType,
      modelId,
      tokens,
      estimatedUsd: usd,
      priceRowId,
      status: s.status,
      durationMs: s.durationMs,
      source: s.source,
    });
  }

  // Sort largest cost first
  bySubagent.sort((a, b) => b.estimatedUsd - a.estimatedUsd);

  const modelMap = new Map<string, { tokens: number; estimatedUsd: number; count: number }>();
  for (const line of bySubagent) {
    const cur = modelMap.get(line.modelId) ?? { tokens: 0, estimatedUsd: 0, count: 0 };
    cur.tokens += line.tokens;
    cur.estimatedUsd += line.estimatedUsd;
    cur.count += 1;
    modelMap.set(line.modelId, cur);
  }
  const byModel = [...modelMap.entries()]
    .map(([modelId, v]) => ({ modelId, ...v }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd);

  const subTokens = bySubagent.reduce((a, l) => a + l.tokens, 0);
  const subUsd = bySubagent.reduce((a, l) => a + l.estimatedUsd, 0);
  const parentTokens = Math.max(0, input.parentTokens ?? 0);
  const parentEst = estimateUsdFromTotalTokens(parentTokens, input.parentModelId ?? "grok-4.5");
  const grandTokens = subTokens + parentTokens;
  const grandUsd = subUsd + parentEst.usd;

  const costRecordLine = [
    `Task cost: ${formatUsd(grandUsd)} est`,
    `subagents=${bySubagent.length}`,
    `subTokens=${subTokens}`,
    `subUsd=${formatUsd(subUsd)}`,
    `parentTokens=${parentTokens}`,
    `parentUsd=${formatUsd(parentEst.usd)}`,
    `models=${byModel.map((m) => `${m.modelId}:${formatUsd(m.estimatedUsd)}`).join("|") || "none"}`,
  ].join("; ");

  const mdLines = [
    `| Subagent | Type | Model | Tokens | Est. USD |`,
    `|----------|------|-------|--------|----------|`,
    ...bySubagent.slice(0, 40).map(
      (l) =>
        `| \`${(l.subagentId ?? "").slice(0, 13)}\` | ${l.subagentType ?? "?"} | ${l.modelId} | ${l.tokens} | ${formatUsd(l.estimatedUsd)} |`,
    ),
    `| **Subagent total** | | | **${subTokens}** | **${formatUsd(subUsd)}** |`,
    `| Parent/main (Δ peak) | | ${input.parentModelId ?? "grok-4.5"} | ${parentTokens} | ${formatUsd(parentEst.usd)} |`,
    `| **Grand total (est.)** | | | **${grandTokens}** | **${formatUsd(grandUsd)}** |`,
    ``,
    `### By model`,
    ``,
    `| Model | Count | Tokens | Est. USD | Rate (blended $/1M) |`,
    `|-------|-------|--------|----------|---------------------|`,
    ...byModel.map((m) => {
      const row = resolveModelPrice(m.modelId);
      return `| ${m.modelId} | ${m.count} | ${m.tokens} | ${formatUsd(m.estimatedUsd)} | ${row.blendedPer1M} |`;
    }),
  ];

  return {
    schemaVersion: TASK_COST_ROLLUP_SCHEMA,
    pricingSchema: MODEL_PRICING_SCHEMA,
    taskId: input.taskId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    window: {
      sinceIso,
      untilIso,
      note: sinceIso
        ? "Subagents with completion/start in [since, until]; untimestamped included only if no since"
        : "No since window — all discovered subagent completions (may span prior tasks)",
    },
    estimateMethod:
      "blended_usd_per_1m_tokens * (finalTotalTokens || peakTotalTokens) / 1e6; context peaks overstate billed tokens",
    disclaimer:
      "Estimate only — not provider invoice. Peak/context totals ≠ exact input+output bill. Rates in model-pricing.ts.",
    bySubagent,
    byModel,
    totals: {
      subagentCount: scoped.length,
      subagentWithTokens: bySubagent.length,
      tokens: subTokens,
      estimatedUsd: subUsd,
      parentTokens,
      parentEstimatedUsd: parentEst.usd,
      grandTokens,
      grandEstimatedUsd: grandUsd,
    },
    costRecordLine,
    markdownTable: mdLines.join("\n"),
  };
}
