import { describe, expect, it } from "vitest";
import { estimateUsdFromSplit, estimateUsdFromTotalTokens, resolveModelPrice, formatUsd } from "./model-pricing.js";
import { buildTaskCostRollup, filterSubagentsSince } from "./task-cost-rollup.js";
import type { GrokSubagentTokenSnapshot } from "./grok-token-introspection.js";

const sample = (over: Partial<GrokSubagentTokenSnapshot>): GrokSubagentTokenSnapshot => ({
  subagentId: "019fc0aa-300f",
  parentSessionId: "parent",
  childSessionId: "child",
  subagentType: "explore",
  status: "completed",
  durationMs: 1000,
  toolCalls: 10,
  effectiveModelId: "deepseek-v4-flash",
  peakTotalTokens: 100_000,
  finalTotalTokens: 100_000,
  signalsContextTokens: 100_000,
  source: "child_session_signals",
  startedAt: "2026-08-02T10:00:00.000Z",
  completedAt: "2026-08-02T10:05:00.000Z",
  ...over,
});

describe("model-pricing + task-cost-rollup", () => {
  it("resolves model price rows", () => {
    expect(resolveModelPrice("deepseek-v4-flash").id).toBe("deepseek-v4-flash");
    expect(resolveModelPrice("grok-4.5").id).toBe("grok-4.5");
    expect(estimateUsdFromTotalTokens(1_000_000, "deepseek-v4-flash").usd).toBeCloseTo(0.18, 5);
    expect(formatUsd(0.004)).toMatch(/\$0\.00/);
  });

  it("resolves fetched Claude + Grok rows and computes exact split cost (real 2026-08-03 rates)", () => {
    expect(resolveModelPrice("claude-opus").inputPer1M).toBe(5.0);
    expect(resolveModelPrice("claude-haiku").outputPer1M).toBe(5.0);
    expect(resolveModelPrice("grok-4.5-build").id).toBe("grok-4.5"); // CLI alias resolves
    // Grok-4.5 vision judgment (P1): 41k in / 800 out at real 2/6 -> ~$0.087, not $0.25.
    const p1 = estimateUsdFromSplit(41_000, 800, "grok-4.5");
    expect(p1.usd).toBeCloseTo(0.0868, 3);
    // DeepSeek-flash cached input billed 50x cheaper than fresh.
    const cached = estimateUsdFromSplit(100_000, 0, "deepseek-v4-flash", 100_000);
    expect(cached.usd).toBeCloseTo((100_000 / 1_000_000) * 0.0028, 6);
  });

  it("filters subagents by completion window", () => {
    const items = [
      sample({ subagentId: "a", completedAt: "2026-08-02T09:00:00.000Z" }),
      sample({ subagentId: "b", completedAt: "2026-08-02T11:00:00.000Z" }),
    ];
    const filtered = filterSubagentsSince(items, "2026-08-02T10:30:00.000Z", "2026-08-02T12:00:00.000Z");
    expect(filtered.map((i) => i.subagentId)).toEqual(["b"]);
  });

  it("rolls up by subagent and model with grand total", () => {
    const rollup = buildTaskCostRollup({
      taskId: "demo-slice",
      sinceIso: "2026-08-02T09:00:00.000Z",
      untilIso: "2026-08-02T12:00:00.000Z",
      parentTokens: 50_000,
      parentModelId: "grok-4.5",
      subagents: [
        sample({
          subagentId: "flash-1",
          effectiveModelId: "deepseek-v4-flash",
          finalTotalTokens: 1_000_000,
          peakTotalTokens: 1_000_000,
          completedAt: "2026-08-02T10:00:00.000Z",
        }),
        sample({
          subagentId: "pro-1",
          subagentType: "general-purpose",
          effectiveModelId: "deepseek-v4-pro",
          finalTotalTokens: 500_000,
          peakTotalTokens: 500_000,
          completedAt: "2026-08-02T11:00:00.000Z",
        }),
      ],
    });
    expect(rollup.bySubagent).toHaveLength(2);
    expect(rollup.byModel.some((m) => m.modelId === "deepseek-v4-flash")).toBe(true);
    expect(rollup.totals.grandEstimatedUsd).toBeGreaterThan(0);
    expect(rollup.costRecordLine).toContain("Task cost:");
    expect(rollup.markdownTable).toContain("Grand total");
  });
});
