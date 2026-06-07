import { describe, expect, it } from "vitest";
import {
  buildGrokRepoAgentSpawnRegistry,
  buildGrokRepoAgentSpawnSpec,
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
      "asset-pipeline-lead",
      "rigging-animation-specialist",
      "xr-systems-architect",
      "pediatrics-physician",
      "clinical-safety-critic",
      "license-provenance-specialist",
      "vp-engineering-delivery",
    ].map((roleId) => ({
      roleId,
      roleDir: `agents/group/${roleId}`,
      group: "group",
    }));
    const registry = buildGrokRepoAgentSpawnRegistry({ roles });
    expect(registry.posture).toBe("aligned");
    expect(registry.agents).toHaveLength(13);
  });

  it("recommends consult defaults", () => {
    expect(recommendRepoAgentsForConsult("drift")).toContain("openclaw-drift-police");
  });
});