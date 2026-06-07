import { describe, expect, it } from "vitest";
import {
  buildGrokTierIntrospectionReport,
  buildGrokTierWorkOrder,
  evaluateGrokDelegationAdvice,
  evaluateGrokTierUpgrade,
  formatGrokTierRecordLine,
  recommendGrokStartTier,
  validateGrokHarnessTierConfig,
} from "./grok-tier-routing.js";

const SAMPLE_CONFIG = `
[subagents.models]
explore = "deepseek-v4-flash"
plan = "deepseek-v4-pro"
# grok-tier-routing: see agents/rules/grok-tier-routing.md
`;

describe("grok tier routing", () => {
  it("recommends flash scout by default", () => {
    expect(recommendGrokStartTier({ taskKind: "scout" })).toBe("tier1_deepseek_flash_scout");
    expect(recommendGrokStartTier({ taskKind: "scout", preferZeroCost: true })).toBe("tier0_local_consult");
  });

  it("builds work order with spawn hints and upgrade triggers", () => {
    const order = buildGrokTierWorkOrder({
      sliceId: "anny-garment-geometry",
      sliceSummary: "Improve mesh clothing seams",
      scoutQuestion: "Which Blender stage owns garment trim?",
    });
    expect(order.schemaVersion).toBe("openclinxr.grok-tier-work-order.v1");
    expect(order.spawnSubagentHints.explore.model).toBe("deepseek-v4-flash");
    expect(order.upgradeTriggers.length).toBeGreaterThan(5);
    expect(order.cursorTaskWarning).toContain("Cursor Task");
    expect(order.repoAgentSpawns.scout?.roleId).toBe("chief-coordinator");
    expect(order.repoAgentSpawns.scout?.model).toBe("deepseek-v4-flash");
  });

  it("validates grok harness config", () => {
    const good = validateGrokHarnessTierConfig(SAMPLE_CONFIG);
    expect(good.ok).toBe(true);
    const bad = validateGrokHarnessTierConfig(`[subagents.models]\nexplore = "grok-build"\n`);
    expect(bad.ok).toBe(false);
  });

  it("builds introspection report posture", () => {
    const report = buildGrokTierIntrospectionReport({
      configToml: SAMPLE_CONFIG,
      ruleFilePresent: true,
      packageScriptsPresent: true,
    });
    expect(report.posture).toBe("aligned");
    expect(report.nativeSpawnSubagentPreferred).toBe(true);
    expect(report.introspectionPrompts.length).toBeGreaterThan(3);
  });

  it("blocks cursor task for scouts via delegation advice", () => {
    const advice = evaluateGrokDelegationAdvice({ intent: "scout" });
    expect(advice.useNativeSpawnSubagent).toBe(true);
    expect(advice.useCursorTask).toBe(false);
  });

  it("evaluates upgrade when verification fails twice", () => {
    const evaluation = evaluateGrokTierUpgrade({
      currentTier: "tier3_deepseek_pro_execution",
      verificationFailures: 2,
    });
    expect(evaluation.shouldUpgrade).toBe(true);
    expect(evaluation.toTier).toBe("tier4_grok_compose_integrate");
  });

  it("formats tier record for state files", () => {
    expect(formatGrokTierRecordLine("tier4_grok_compose_integrate")).toContain("compose");
  });
});