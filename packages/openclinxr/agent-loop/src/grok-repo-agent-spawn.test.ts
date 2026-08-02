import { describe, expect, it } from "vitest";
import {
  buildGrokRepoAgentSpawnRegistry,
  buildGrokRepoAgentSpawnSpec,
  formatGrokRepoAgentSpawnBrief,
  recommendRepoAgentsForConsult,
  resolveGrokSpawnSurfaceForPolicy,
} from "./grok-repo-agent-spawn.js";
import { getRepoRoleHarnessPolicy } from "./role-harness-policy.js";

describe("grok repo agent spawn", () => {
  it("maps chief-coordinator to explore flash", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "chief-coordinator",
      roleDir: "agents/coordinator/chief-coordinator",
      group: "coordinator",
    });
    expect(spec.grokSubagentType).toBe("explore");
    expect(spec.model).toBe("deepseek-v4-flash");
    expect(spec.spawnSubagentCall?.capability_mode).toBe("read-only");
  });

  it("maps asset-pipeline-lead to general-purpose pro", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "asset-pipeline-lead",
      roleDir: "agents/core/asset-pipeline-lead",
      group: "core",
    });
    expect(spec.grokSubagentType).toBe("general-purpose");
    expect(spec.model).toBe("deepseek-v4-pro");
    expect(spec.spawnSubagentCall?.capability_mode).toBe("read-write");
  });

  it("keeps vp-engineering on composer surface", () => {
    const policy = getRepoRoleHarnessPolicy("vp-engineering-delivery");
    expect(policy).toBeDefined();
    const surface = resolveGrokSpawnSurfaceForPolicy(policy!);
    expect(surface.spawnSurface).toBe("composer_main_thread");
    expect(surface.grokSubagentType).toBeNull();
  });

  it("builds aligned registry for all policy roles", () => {
    const roles = [
      "chief-coordinator",
      "openclaw-drift-police",
      "implementation-plan-gap-attacker",
      "productivity-skeptic",
      "visual-realism-adversary",
      "implementation-planning-lead",
      "architect",
      "archivist",
      "asset-pipeline-lead",
      "rigging-animation-specialist",
      "xr-systems-architect",
      "pediatrics-physician",
      "clinical-safety-critic",
      "license-provenance-specialist",
      "vp-engineering-delivery",
      "hrbp",
      "pmo",
    ].map((roleId) => ({
      roleId,
      roleDir: `agents/group/${roleId}`,
      group: "group",
    }));
    const registry = buildGrokRepoAgentSpawnRegistry({ roles });
    expect(registry.posture).toBe("aligned");
    expect(registry.agents).toHaveLength(17);
  });

  it("recommends consult defaults", () => {
    expect(recommendRepoAgentsForConsult("drift")).toContain("openclaw-drift-police");
    expect(recommendRepoAgentsForConsult("architecture")).toContain("architect");
    expect(recommendRepoAgentsForConsult("docs_warehouse")).toContain("archivist");
    expect(recommendRepoAgentsForConsult("archive")).toContain("archivist");
    expect(recommendRepoAgentsForConsult("temporal")).toContain("pmo");
    expect(recommendRepoAgentsForConsult("hygiene")).toContain("pmo");
    expect(recommendRepoAgentsForConsult("cadence")).toContain("pmo");
  });

  it("maps archivist to explore flash read-only", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "archivist",
      roleDir: "agents/coordinator/archivist",
      group: "coordinator",
    });
    expect(spec.grokSubagentType).toBe("explore");
    expect(spec.model).toBe("deepseek-v4-flash");
    expect(spec.spawnSubagentCall?.capability_mode).toBe("read-only");
    expect(spec.isolation).toBe("none");
    expect(spec.pathScope.writeRoots).toEqual(
      expect.arrayContaining([".openclinxr/docs-archive/**"]),
    );
  });

  it("maps architect to general-purpose pro with worktree", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "architect",
      roleDir: "agents/core/architect",
      group: "core",
    });
    expect(spec.grokSubagentType).toBe("general-purpose");
    expect(spec.model).toBe("deepseek-v4-pro");
    expect(spec.isolation).toBe("worktree");
    expect(spec.safeguards.some((s) => s.includes("general-purpose"))).toBe(true);
    expect(spec.spawnPrompt).toContain("COMPOSITION-ROOTS");
  });

  describe("worktree isolation", () => {
    it("asset-pipeline-lead gets isolation worktree (workspace-write + read-write + native spawn)", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "asset-pipeline-lead",
        roleDir: "agents/core/asset-pipeline-lead",
        group: "core",
      });
      expect(spec.isolation).toBe("worktree");
      expect(spec.spawnSubagentCall?.isolation).toBe("worktree");
    });

    it("asset-pipeline-lead has parentChecklist mustPassIsolationToHarness true", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "asset-pipeline-lead",
        roleDir: "agents/core/asset-pipeline-lead",
        group: "core",
      });
      expect(spec.isolation).toBe("worktree");
      expect(spec.parentChecklist.isolation).toBe("worktree");
      expect(spec.parentChecklist.mustPassIsolationToHarness).toBe(true);
      expect(spec.parentChecklist.pathScopePresent).toBe(true);
      expect(spec.parentChecklist.writeRootsCount).toBeGreaterThan(0);
    });

    it("xr-systems-architect gets isolation worktree", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "xr-systems-architect",
        roleDir: "agents/core/xr-systems-architect",
        group: "core",
      });
      expect(spec.isolation).toBe("worktree");
      expect(spec.spawnSubagentCall?.isolation).toBe("worktree");
      expect(spec.parentChecklist.mustPassIsolationToHarness).toBe(true);
    });

    it("chief-coordinator gets isolation none (read-only)", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "chief-coordinator",
        roleDir: "agents/coordinator/chief-coordinator",
        group: "coordinator",
      });
      expect(spec.isolation).toBe("none");
      expect(spec.spawnSubagentCall?.isolation).toBe("none");
      expect(spec.parentChecklist.mustPassIsolationToHarness).toBe(false);
    });

    it("vp-engineering-delivery gets isolation none (frontier/composer)", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "vp-engineering-delivery",
        roleDir: "agents/leadership/vp-engineering-delivery",
        group: "leadership",
      });
      expect(spec.isolation).toBe("none");
      expect(spec.spawnSubagentCall).toBeNull();
      expect(spec.parentChecklist.mustPassIsolationToHarness).toBe(false);
    });

    it("formatGrokRepoAgentSpawnBrief shows isolation + checklist for worktree roles", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "asset-pipeline-lead",
        roleDir: "agents/core/asset-pipeline-lead",
        group: "core",
      });
      const brief = formatGrokRepoAgentSpawnBrief(spec);
      expect(brief).toContain("isolation=worktree");
      expect(brief).toContain("parentChecklist.mustPassIsolationToHarness=true");
    });

    it("formatGrokRepoAgentSpawnBrief does not show isolation for non-worktree", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "chief-coordinator",
        roleDir: "agents/coordinator/chief-coordinator",
        group: "coordinator",
      });
      const brief = formatGrokRepoAgentSpawnBrief(spec);
      expect(brief).not.toContain("isolation=worktree");
      expect(brief).not.toContain("mustPassIsolationToHarness=true");
    });
  });
});