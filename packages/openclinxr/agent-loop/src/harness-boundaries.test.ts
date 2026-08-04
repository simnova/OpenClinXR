import { describe, expect, it } from "vitest";
import {
  buildHarnessNeutralManifest,
  effortForTier,
  seedBoundaryViolation,
  validateHarnessBoundaries,
  type BoundaryValidationInput,
} from "./harness-neutral-manifest.js";
import { repoRoleHarnessPolicies } from "./role-harness-policy.js";

function cleanInput(overrides: Partial<BoundaryValidationInput> = {}): BoundaryValidationInput {
  const manifest = buildHarnessNeutralManifest();
  const policyRoleIds = repoRoleHarnessPolicies.map((p) => p.roleId);
  const grokAgentStems = [...policyRoleIds, "orchestrator", "README"];
  const codexAgentStems = [...policyRoleIds, "README"];
  return {
    manifest,
    policyRoleIds,
    grokAgentStems,
    codexAgentStems,
    agentsMdText:
      "# OpenClinXR\nMain session = orchestrator. Config lives under `.grok/config.toml`.\nNo spawn runtime in root contract.\n",
    ...overrides,
  };
}

describe("harness-neutral manifest + boundary validator", () => {
  it("builds vendor-free manifest from policy (no model IDs)", () => {
    const manifest = buildHarnessNeutralManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.maxNestingDepth).toBe(1);
    expect(manifest.roles.length).toBe(repoRoleHarnessPolicies.length);
    expect(manifest.roles.map((r) => r.name).sort()).toEqual(
      repoRoleHarnessPolicies.map((p) => p.roleId).sort(),
    );
    const blob = JSON.stringify(manifest);
    expect(blob).not.toMatch(/deepseek|grok-build|composer-2|gpt-5\./i);
    const architect = manifest.roles.find((r) => r.name === "architect");
    expect(architect).toMatchObject({
      tier: "standard_execution",
      effort: effortForTier("standard_execution"),
      sandboxMode: "workspace-write",
    });
    expect(architect?.ownerGlobs.length).toBeGreaterThan(0);
    const scout = manifest.roles.find((r) => r.name === "chief-coordinator");
    expect(scout).toMatchObject({
      tier: "fast_bounded",
      effort: "low",
      sandboxMode: "read-only",
    });
  });

  it("passes clean input matching current repo reality (orchestrator Grok-only, .grok/ warn)", () => {
    const report = validateHarnessBoundaries(cleanInput());
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => w.includes(".grok/"))).toBe(true);
  });

  it("flags seeded Grok parity violation", () => {
    const seeded = seedBoundaryViolation(cleanInput(), "parity");
    const report = validateHarnessBoundaries(seeded);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("Grok role parity") || e.includes("architect"))).toBe(
      true,
    );
  });

  it("flags seeded non-writer sandbox violation", () => {
    const seeded = seedBoundaryViolation(cleanInput(), "sandbox");
    const report = validateHarnessBoundaries(seeded);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.toLowerCase().includes("sandbox") || e.includes("non-writer"))).toBe(
      true,
    );
  });

  it("flags seeded maxNestingDepth violation", () => {
    const seeded = seedBoundaryViolation(cleanInput(), "nesting");
    const report = validateHarnessBoundaries(seeded);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("maxNestingDepth"))).toBe(true);
  });

  it("flags seeded AGENTS.md spawn_subagent runtime token", () => {
    const seeded = seedBoundaryViolation(cleanInput(), "agents_md_token");
    const report = validateHarnessBoundaries(seeded);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("spawn_subagent"))).toBe(true);
  });

  it("flags vendor model id leak into neutral SSOT", () => {
    const seeded = seedBoundaryViolation(cleanInput(), "vendor_model");
    const report = validateHarnessBoundaries(seeded);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("vendor model") || e.includes("parity"))).toBe(true);
  });

  it("skips Codex parity when codexAgentStems is null", () => {
    const report = validateHarnessBoundaries(cleanInput({ codexAgentStems: null }));
    expect(report.ok).toBe(true);
  });
});
