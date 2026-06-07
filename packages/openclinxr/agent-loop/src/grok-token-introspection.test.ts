import { describe, expect, it } from "vitest";
import {
  buildGrokSliceTokenBaseline,
  buildGrokSliceTokenIntrospectionReport,
  classifyGrokModelTier,
  parseCcusageDailyPayload,
  summarizeGrokWorkspaceSessions,
} from "./grok-token-introspection.js";

const SAMPLE_CCUSAGE = {
  daily: [
    {
      period: "2026-06-07",
      totalTokens: 1_000_000,
      totalCost: 5.5,
      modelsUsed: ["gpt-5.5"],
      metadata: { agents: ["codex"] },
      modelBreakdowns: [],
    },
  ],
};

describe("grok token introspection", () => {
  it("classifies grok model tiers", () => {
    expect(classifyGrokModelTier("deepseek-v4-flash")).toBe("flash");
    expect(classifyGrokModelTier("grok-composer-2.5-fast")).toBe("composer");
  });

  it("parses ccusage daily payload", () => {
    const snapshot = parseCcusageDailyPayload(SAMPLE_CCUSAGE, "2026-06-07");
    expect(snapshot.available).toBe(true);
    expect(snapshot.totalTokens).toBe(1_000_000);
    expect(snapshot.agents).toContain("codex");
  });

  it("summarizes grok workspace sessions", () => {
    const summary = summarizeGrokWorkspaceSessions([
      {
        sessionId: "flash-1",
        peakTotalTokens: 21_837,
        finalTotalTokens: 21_837,
        modelIdsSeen: ["deepseek-v4-flash"],
        toolCallCount: 2,
        turnCount: 4,
      },
      {
        sessionId: "composer-1",
        peakTotalTokens: 172_550,
        finalTotalTokens: 172_550,
        modelIdsSeen: ["grok-composer-2.5-fast"],
        toolCallCount: 30,
        turnCount: 80,
      },
    ]);
    expect(summary.scoutPeakBaseline).toBe(21_837);
    expect(summary.composerPeakBaseline).toBe(172_550);
    expect(summary.flashSessionCount).toBe(1);
    expect(summary.proSessionCount).toBe(0);
  });

  it("flags scout-tier composer spike violation", () => {
    const baseline = buildGrokSliceTokenBaseline({
      sliceId: "anny-garment",
      declaredTier: "tier1_deepseek_flash_scout",
      ccusageDaily: parseCcusageDailyPayload(SAMPLE_CCUSAGE, "2026-06-07"),
      grokSessions: [
        {
          sessionId: "composer-1",
          peakTotalTokens: 100_000,
          finalTotalTokens: 100_000,
          modelIdsSeen: ["grok-composer-2.5-fast"],
          toolCallCount: 10,
          turnCount: 20,
        },
      ],
    });
    const report = buildGrokSliceTokenIntrospectionReport({
      sliceId: "anny-garment",
      declaredTier: "tier1_deepseek_flash_scout",
      baseline,
      currentCcusage: parseCcusageDailyPayload({
        daily: [{ ...SAMPLE_CCUSAGE.daily[0], totalTokens: 3_500_000, totalCost: 20 }],
      }, "2026-06-07"),
      currentGrokSessions: [
        {
          sessionId: "composer-1",
          peakTotalTokens: 172_550,
          finalTotalTokens: 172_550,
          modelIdsSeen: ["grok-composer-2.5-fast"],
          toolCallCount: 40,
          turnCount: 100,
        },
      ],
    });
    expect(report.posture).toBe("violation");
    expect(report.violations.some((v) => v.violationId === "scout_tier_composer_spike")).toBe(true);
    expect(report.stateRecordLine).toContain("Token introspection");
  });
});