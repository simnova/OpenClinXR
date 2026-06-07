import { describe, expect, it } from "vitest";
import {
  evaluateGrokDelegationAdvice,
  evaluateGrokTierUpgrade,
  formatGrokTierRecordLine,
  parseGrokTierId,
} from "../../../packages/openclinxr/agent-loop/src/grok-tier-routing.js";

describe("grok tier cli helpers", () => {
  it("advises native spawn for scouts", () => {
    const advice = evaluateGrokDelegationAdvice({ intent: "scout" });
    expect(advice.useNativeSpawnSubagent).toBe(true);
    expect(advice.useCursorTask).toBe(false);
    expect(advice.spawnHint?.model).toBe("deepseek-v4-flash");
  });

  it("upgrades when scout output lacks repo paths", () => {
    const evaluation = evaluateGrokTierUpgrade({
      currentTier: "tier1_deepseek_flash_scout",
      scoutOutput: "You should improve tests and add more documentation.",
    });
    expect(evaluation.shouldUpgrade).toBe(true);
    expect(evaluation.toTier).toBe("tier2_deepseek_pro_analysis");
  });

  it("formats tier record lines for state files", () => {
    expect(formatGrokTierRecordLine("tier1_deepseek_flash_scout")).toContain("tier: flash");
  });

  it("accepts execute tier alias used by agents", () => {
    expect(parseGrokTierId("tier3_deepseek_pro_execute")).toBe("tier3_deepseek_pro_execution");
  });
});