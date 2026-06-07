/**
 * Grok-harness-only per-slice token introspection.
 * Combines Grok ~/.grok/sessions peaks with ccusage daily cross-checks to detect tier-routing drift.
 */

import type { GrokTierId } from "./grok-tier-routing.js";
import { getGrokTierSpec } from "./grok-tier-routing.js";

export type GrokModelTierClass = "flash" | "pro" | "composer" | "frontier" | "unknown";

export type CcusageDailyRow = {
  period: string;
  totalTokens: number;
  totalCostUsd?: number;
  totalCost?: number;
  modelsUsed: string[];
  metadata?: { agents?: string[] };
  modelBreakdowns: Array<{
    modelName: string;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cost?: number;
  }>;
};

export type CcusageSnapshot = {
  available: boolean;
  period: string;
  totalTokens: number;
  totalCostUsd: number;
  modelsUsed: string[];
  agents: string[];
  note: string;
};

export type GrokSessionTokenSnapshot = {
  sessionId: string;
  peakTotalTokens: number;
  finalTotalTokens: number;
  modelIdsSeen: string[];
  toolCallCount: number;
  turnCount: number;
};

export type GrokWorkspaceTokenSnapshot = {
  sessions: GrokSessionTokenSnapshot[];
  maxPeakTotalTokens: number;
  scoutPeakBaseline: number;
  proPeakBaseline: number;
  composerPeakBaseline: number;
  flashSessionCount: number;
  proSessionCount: number;
  composerSessionCount: number;
};

export type GrokSliceTokenBaseline = {
  schemaVersion: "openclinxr.grok-tier-slice-baseline.v1";
  sliceId: string;
  declaredTier: GrokTierId;
  capturedAt: string;
  ccusageDaily: CcusageSnapshot;
  grokWorkspace: GrokWorkspaceTokenSnapshot;
};

export type GrokTierTokenViolation = {
  violationId: string;
  severity: "info" | "warning" | "violation";
  message: string;
  remediation: string;
};

export type GrokSliceTokenIntrospectionReport = {
  schemaVersion: "openclinxr.grok-tier-slice-token-introspection.v1";
  generatedAt: string;
  harness: "grok_only";
  sliceId: string;
  declaredTier: GrokTierId;
  posture: "aligned" | "drift" | "violation";
  baselinePresent: boolean;
  ccusage: {
    baseline: CcusageSnapshot;
    current: CcusageSnapshot;
    tokenDelta: number;
    costDeltaUsd: number;
  };
  grok: {
    baseline: GrokWorkspaceTokenSnapshot;
    current: GrokWorkspaceTokenSnapshot;
    peakDelta: number;
    composerPeakDelta: number;
    newFlashSessions: number;
    scoutVsComposerPeakRatio: number | null;
  };
  violations: GrokTierTokenViolation[];
  recommendations: string[];
  stateRecordLine: string;
};

export const GROK_TOKEN_THRESHOLDS = {
  scoutPeakMax: 35_000,
  composerRoutinePeakMax: 120_000,
  scoutComposerRatioViolation: 4,
  ccusageTokenSpikeInfo: 500_000,
  ccusageTokenSpikeWarning: 2_000_000,
} as const;

export function classifyGrokModelTier(modelId: string): GrokModelTierClass {
  const normalized = modelId.toLowerCase();
  if (normalized.includes("deepseek") && normalized.includes("flash")) return "flash";
  if (normalized.includes("deepseek") && normalized.includes("pro")) return "pro";
  if (normalized.includes("grok-build")) return "frontier";
  if (normalized.includes("composer") || normalized.includes("grok-composer")) return "composer";
  return "unknown";
}

export function parseCcusageDailyPayload(payload: unknown, period?: string): CcusageSnapshot {
  const empty: CcusageSnapshot = {
    available: false,
    period: period ?? "unknown",
    totalTokens: 0,
    totalCostUsd: 0,
    modelsUsed: [],
    agents: [],
    note: "ccusage daily payload unavailable",
  };
  if (!payload || typeof payload !== "object") return empty;
  const daily = (payload as { daily?: CcusageDailyRow[] }).daily ?? [];
  const targetPeriod = period ?? daily.at(-1)?.period;
  const row = daily.find((entry) => entry.period === targetPeriod) ?? daily.at(-1);
  if (!row) return empty;
  return {
    available: true,
    period: row.period,
    totalTokens: row.totalTokens ?? 0,
    totalCostUsd: row.totalCostUsd ?? (row as { totalCost?: number }).totalCost ?? 0,
    modelsUsed: row.modelsUsed ?? [],
    agents: row.metadata?.agents ?? [],
    note: `ccusage daily ${row.period}`,
  };
}

export function summarizeGrokWorkspaceSessions(sessions: GrokSessionTokenSnapshot[]): GrokWorkspaceTokenSnapshot {
  let maxPeakTotalTokens = 0;
  let scoutPeakBaseline = 0;
  let proPeakBaseline = 0;
  let composerPeakBaseline = 0;
  let flashSessionCount = 0;
  let proSessionCount = 0;
  let composerSessionCount = 0;

  for (const session of sessions) {
    maxPeakTotalTokens = Math.max(maxPeakTotalTokens, session.peakTotalTokens);
    const tiers = session.modelIdsSeen.map(classifyGrokModelTier);
    if (tiers.some((tier) => tier === "flash")) {
      flashSessionCount += 1;
      scoutPeakBaseline = Math.max(scoutPeakBaseline, session.peakTotalTokens);
    }
    if (tiers.some((tier) => tier === "pro")) {
      proSessionCount += 1;
      proPeakBaseline = Math.max(proPeakBaseline, session.peakTotalTokens);
    }
    if (tiers.some((tier) => tier === "composer" || tier === "frontier")) {
      composerSessionCount += 1;
      composerPeakBaseline = Math.max(composerPeakBaseline, session.peakTotalTokens);
    }
  }

  return {
    sessions,
    maxPeakTotalTokens,
    scoutPeakBaseline,
    proPeakBaseline,
    composerPeakBaseline,
    flashSessionCount,
    proSessionCount,
    composerSessionCount,
  };
}

export function buildGrokSliceTokenBaseline(input: {
  sliceId: string;
  declaredTier: GrokTierId;
  capturedAt?: string;
  ccusageDaily: CcusageSnapshot;
  grokSessions: GrokSessionTokenSnapshot[];
}): GrokSliceTokenBaseline {
  return {
    schemaVersion: "openclinxr.grok-tier-slice-baseline.v1",
    sliceId: input.sliceId,
    declaredTier: input.declaredTier,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    ccusageDaily: input.ccusageDaily,
    grokWorkspace: summarizeGrokWorkspaceSessions(input.grokSessions),
  };
}

export function evaluateGrokSliceTokenViolations(input: {
  declaredTier: GrokTierId;
  baseline: GrokSliceTokenBaseline | null;
  currentGrok: GrokWorkspaceTokenSnapshot;
  ccusageTokenDelta: number;
  peakDelta: number;
  composerPeakDelta: number;
  newFlashSessions: number;
  scoutVsComposerPeakRatio: number | null;
}): GrokTierTokenViolation[] {
  const violations: GrokTierTokenViolation[] = [];
  const spec = getGrokTierSpec(input.declaredTier);
  const isScoutTier = spec.role === "scout";
  const isFrontierTier = spec.role === "frontier";

  if (!input.baseline) {
    violations.push({
      violationId: "missing_slice_baseline",
      severity: "warning",
      message: "No slice token baseline captured; run pnpm grok:tier:slice-start before the slice.",
      remediation: "Capture baseline at slice start so post-slice introspection can measure drift.",
    });
  }

  if (isScoutTier && input.composerPeakDelta > GROK_TOKEN_THRESHOLDS.scoutPeakMax) {
    violations.push({
      violationId: "scout_tier_composer_spike",
      severity: "violation",
      message: `Scout-tier slice grew Composer peak by ${input.composerPeakDelta} tokens (limit ${GROK_TOKEN_THRESHOLDS.scoutPeakMax}).`,
      remediation: "Delegate read-only consults to spawn_subagent explore (deepseek-v4-flash), not Composer or Cursor Task.",
    });
  }

  if (
    isScoutTier &&
    input.scoutVsComposerPeakRatio !== null &&
    input.scoutVsComposerPeakRatio >= GROK_TOKEN_THRESHOLDS.scoutComposerRatioViolation
  ) {
    violations.push({
      violationId: "composer_scout_ratio_exceeded",
      severity: "violation",
      message: `Composer/scout peak ratio ${input.scoutVsComposerPeakRatio}x exceeds ${GROK_TOKEN_THRESHOLDS.scoutComposerRatioViolation}x guidance.`,
      remediation: "Re-run coordinator consult via explore+flash; keep Composer for integration only.",
    });
  }

  if (isScoutTier && input.newFlashSessions === 0 && input.composerPeakDelta > 10_000) {
    violations.push({
      violationId: "scout_tier_no_deepseek_session",
      severity: "warning",
      message: "Scout-tier slice increased Composer tokens without a new DeepSeek flash subagent session.",
      remediation: "Use native spawn_subagent explore before expanding Composer context.",
    });
  }

  if (!isFrontierTier && input.composerPeakDelta > 40_000) {
    violations.push({
      violationId: "routine_slice_composer_growth",
      severity: "warning",
      message: `Non-frontier slice grew Composer peak by ${input.composerPeakDelta} tokens during slice window.`,
      remediation: "Split slice, delegate scouts to flash, or escalate tier explicitly with justification.",
    });
  }

  if (!isFrontierTier && input.peakDelta > GROK_TOKEN_THRESHOLDS.composerRoutinePeakMax) {
    violations.push({
      violationId: "routine_slice_peak_growth",
      severity: "warning",
      message: `Non-frontier slice grew workspace peak by ${input.peakDelta} tokens (threshold ${GROK_TOKEN_THRESHOLDS.composerRoutinePeakMax}).`,
      remediation: "Keep Composer context lean; move read-only exploration to explore+deepseek-v4-flash.",
    });
  }

  if (input.ccusageTokenDelta >= GROK_TOKEN_THRESHOLDS.ccusageTokenSpikeWarning) {
    violations.push({
      violationId: "ccusage_daily_spike_warning",
      severity: "warning",
      message: `ccusage daily tokens grew by ${input.ccusageTokenDelta} during slice window.`,
      remediation: "Review cross-harness usage; Grok slices should prefer flash scouts over Codex/Cursor frontier models.",
    });
  } else if (input.ccusageTokenDelta >= GROK_TOKEN_THRESHOLDS.ccusageTokenSpikeInfo) {
    violations.push({
      violationId: "ccusage_daily_spike_info",
      severity: "info",
      message: `ccusage daily tokens grew by ${input.ccusageTokenDelta} (cross-harness note).`,
      remediation: "Confirm Codex/Cursor usage was intentional; Grok harness should delegate scouts to DeepSeek flash.",
    });
  }

  return violations;
}

export function buildGrokSliceTokenIntrospectionReport(input: {
  sliceId: string;
  declaredTier: GrokTierId;
  baseline: GrokSliceTokenBaseline | null;
  currentCcusage: CcusageSnapshot;
  currentGrokSessions: GrokSessionTokenSnapshot[];
  generatedAt?: string;
}): GrokSliceTokenIntrospectionReport {
  const currentGrok = summarizeGrokWorkspaceSessions(input.currentGrokSessions);
  const baselineCcusage = input.baseline?.ccusageDaily ?? {
    available: false,
    period: input.currentCcusage.period,
    totalTokens: 0,
    totalCostUsd: 0,
    modelsUsed: [],
    agents: [],
    note: "no baseline",
  };
  const baselineGrok = input.baseline?.grokWorkspace ?? {
    sessions: [],
    maxPeakTotalTokens: 0,
    scoutPeakBaseline: 0,
    proPeakBaseline: 0,
    composerPeakBaseline: 0,
    flashSessionCount: 0,
    proSessionCount: 0,
    composerSessionCount: 0,
  };

  const ccusageTokenDelta = Math.max(0, input.currentCcusage.totalTokens - baselineCcusage.totalTokens);
  const ccusageCostDelta = Math.max(0, input.currentCcusage.totalCostUsd - baselineCcusage.totalCostUsd);
  const peakDelta = Math.max(0, currentGrok.maxPeakTotalTokens - baselineGrok.maxPeakTotalTokens);
  const composerPeakDelta = Math.max(0, currentGrok.composerPeakBaseline - baselineGrok.composerPeakBaseline);
  const newFlashSessions = Math.max(0, currentGrok.flashSessionCount - baselineGrok.flashSessionCount);
  const flashPeak = currentGrok.scoutPeakBaseline || baselineGrok.scoutPeakBaseline;
  const composerPeak = currentGrok.composerPeakBaseline;
  const scoutVsComposerPeakRatio =
    flashPeak > 0 && composerPeak > 0 ? Number((composerPeak / flashPeak).toFixed(2)) : null;

  const violations = evaluateGrokSliceTokenViolations({
    declaredTier: input.declaredTier,
    baseline: input.baseline,
    currentGrok,
    ccusageTokenDelta,
    peakDelta,
    composerPeakDelta,
    newFlashSessions,
    scoutVsComposerPeakRatio,
  });

  const hasViolation = violations.some((v) => v.severity === "violation");
  const hasDrift = violations.some((v) => v.severity === "warning");
  const posture: GrokSliceTokenIntrospectionReport["posture"] = hasViolation
    ? "violation"
    : hasDrift
      ? "drift"
      : "aligned";

  const tierShort = getGrokTierSpec(input.declaredTier).role === "scout"
    ? "flash"
    : getGrokTierSpec(input.declaredTier).role === "integrate"
      ? "compose"
      : getGrokTierSpec(input.declaredTier).role === "frontier"
        ? "frontier"
        : "pro";
  const newProSessions = Math.max(0, currentGrok.proSessionCount - baselineGrok.proSessionCount);
  const grokModelsSeen = [
    ...new Set(currentGrok.sessions.flatMap((session) => session.modelIdsSeen)),
  ].sort();
  const ccusageModels = input.currentCcusage.modelsUsed.length > 0
    ? input.currentCcusage.modelsUsed.join("|")
    : "none";

  return {
    schemaVersion: "openclinxr.grok-tier-slice-token-introspection.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    harness: "grok_only",
    sliceId: input.sliceId,
    declaredTier: input.declaredTier,
    posture,
    baselinePresent: input.baseline !== null,
    ccusage: {
      baseline: baselineCcusage,
      current: input.currentCcusage,
      tokenDelta: ccusageTokenDelta,
      costDeltaUsd: ccusageCostDelta,
    },
    grok: {
      baseline: baselineGrok,
      current: currentGrok,
      peakDelta,
      composerPeakDelta,
      newFlashSessions,
      scoutVsComposerPeakRatio,
    },
    violations,
    recommendations: [
      "Record token posture in slice ledger: Token introspection + tier line.",
      hasViolation
        ? "Next slice: force explore+deepseek-v4-flash for read-only work before Composer integration."
        : "Token posture aligned with tier routing guidance.",
      "Run pnpm grok:tier:slice-start at slice begin and pnpm grok:tier:slice-introspect at slice end.",
    ],
    stateRecordLine: [
      `Token introspection: ${posture}`,
      `tier: ${tierShort}`,
      `ccusageΔ=${ccusageTokenDelta}`,
      `ccusageModels=${ccusageModels}`,
      `grok flash=${currentGrok.flashSessionCount} pro=${currentGrok.proSessionCount} composer=${currentGrok.composerSessionCount}`,
      `flashΔ=${newFlashSessions} proΔ=${newProSessions} composerΔ=${composerPeakDelta}`,
      `grokModels=${grokModelsSeen.join("|") || "none"}`,
      `ratio=${scoutVsComposerPeakRatio ?? "n/a"}`,
    ].join("; "),
  };
}

export function formatGrokSliceTokenBrief(report: GrokSliceTokenIntrospectionReport): string {
  const lines = [
    `Slice ${report.sliceId} token posture: ${report.posture}`,
    report.stateRecordLine,
    `ccusage ${report.ccusage.current.period}: ${report.ccusage.current.totalTokens} tokens ($${report.ccusage.current.totalCostUsd.toFixed(2)}) Δ${report.ccusage.tokenDelta}`,
    `Grok peak ${report.grok.current.maxPeakTotalTokens} (composer ${report.grok.current.composerPeakBaseline}, flash ${report.grok.current.scoutPeakBaseline}, Δpeak ${report.grok.peakDelta})`,
  ];
  for (const violation of report.violations) {
    lines.push(`[${violation.severity}] ${violation.violationId}: ${violation.message}`);
  }
  return lines.join("\n");
}