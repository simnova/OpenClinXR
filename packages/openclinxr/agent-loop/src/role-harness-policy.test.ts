import { describe, expect, it } from "vitest";
import {
  getRepoRoleHarnessPolicy,
  repoRoleHarnessPolicies,
  resolveHarnessModelSpec,
  shouldRecommendMoonbridgeAssist,
} from "./role-harness-policy.js";

describe("role-harness-policy", () => {
  it("maps active repo roles to differentiated tiers and sandboxes", () => {
    expect(getRepoRoleHarnessPolicy("chief-coordinator")).toMatchObject({
      policyTier: "fast_bounded",
      sandboxMode: "read-only",
      moonbridgeAssistOnCodex: true,
    });
    expect(getRepoRoleHarnessPolicy("asset-pipeline-lead")).toMatchObject({
      policyTier: "standard_execution",
      sandboxMode: "workspace-write",
      recommendedSkills: expect.arrayContaining(["anny-asset-pipeline", "provider-boundary"]),
    });
    expect(getRepoRoleHarnessPolicy("vp-engineering-delivery")).toMatchObject({
      policyTier: "frontier_thinking",
      sandboxMode: "read-only",
      moonbridgeAssistOnCodex: false,
    });
  });

  it("resolves harness-specific model specs", () => {
    expect(resolveHarnessModelSpec("fast_bounded", "grok")).toEqual({
      model: "deepseek-v4-flash",
      reasoningEffort: "low",
    });
    expect(resolveHarnessModelSpec("standard_execution", "codex")).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "medium",
    });
    expect(resolveHarnessModelSpec("frontier_thinking", "grok")).toEqual({
      model: "grok-build",
      reasoningEffort: "xhigh",
    });
  });

  it("recommends Moonbridge only for Codex on eligible tiers", () => {
    const coordinator = getRepoRoleHarnessPolicy("chief-coordinator");
    const assetLead = getRepoRoleHarnessPolicy("asset-pipeline-lead");
    expect(coordinator).toBeDefined();
    expect(assetLead).toBeDefined();
    expect(shouldRecommendMoonbridgeAssist("codex", coordinator!)).toBe(true);
    expect(shouldRecommendMoonbridgeAssist("grok", coordinator!)).toBe(false);
    expect(shouldRecommendMoonbridgeAssist("codex", assetLead!)).toBe(false);
  });

  it("covers all documented active repo roles", () => {
    const expectedRoles = [
      "asset-pipeline-lead",
      "chief-coordinator",
      "clinical-safety-critic",
      "implementation-plan-gap-attacker",
      "implementation-planning-lead",
      "license-provenance-specialist",
      "openclaw-drift-police",
      "pediatrics-physician",
      "productivity-skeptic",
      "rigging-animation-specialist",
      "visual-realism-adversary",
      "vp-engineering-delivery",
      "xr-systems-architect",
    ];
    expect(repoRoleHarnessPolicies.map((policy) => policy.roleId).sort()).toEqual(expectedRoles.sort());
  });
});