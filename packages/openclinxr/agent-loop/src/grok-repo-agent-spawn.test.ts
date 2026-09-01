import { describe, expect, it } from "vitest";
import {
  buildGrokRepoAgentSpawnRegistry,
  buildGrokRepoAgentSpawnSpec,
  formatGrokRepoAgentSpawnBrief,
  formatWorkerHeadlessDispatchFlags,
  WORKER_TONE_DIRECTIVE,
  formatWorkerHeadlessEnvPrefix,
  GROK_SUBAGENTS_ENV,
  looksLikeLargeParallelTask,
  OPENCLINXR_WORKER_ENV,
  recommendRepoAgentsForConsult,
  requiresMultimodalReasoning,
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

  it("maps asset-pipeline-lead to general-purpose pro (standard_execution tier)", () => {
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
      "imagine-trellis",
    ].map((roleId) => ({
      roleId,
      roleDir: `agents/group/${roleId}`,
      group: "group",
    }));
    const registry = buildGrokRepoAgentSpawnRegistry({ roles });
    expect(registry.posture).toBe("aligned");
    expect(registry.agents).toHaveLength(18);
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
      expect(brief).toContain("headlessEnv=OPENCLINXR_WORKER=1");
      expect(brief).toContain(GROK_SUBAGENTS_ENV.headlessPrefix);
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

  describe("worker env + large-task bake", () => {
    it("writer spawn prompt documents OPENCLINXR_WORKER, GROK_SUBAGENTS, and job tmp", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "asset-pipeline-lead",
        roleDir: "agents/core/asset-pipeline-lead",
        group: "core",
        task: "Implement garment sleeve expand in package only",
      });
      expect(spec.spawnPrompt).toContain("OPENCLINXR_WORKER=1");
      expect(spec.spawnPrompt).toContain("GROK_SUBAGENTS=1");
      expect(spec.spawnPrompt).toContain("OPENCLINXR_JOB_TMP");
      expect(spec.spawnPrompt).toContain("openclinxr_skin_albedo_mixed.png");
      expect(spec.spawnPrompt).toContain("worker-scoped-session");
      expect(spec.spawnPrompt).toContain("spawn_subagent");
    });

    it("bakes the tone directive inline (proven mechanism) — not a native persona-file binding", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "asset-pipeline-lead",
        roleDir: "agents/core/asset-pipeline-lead",
        group: "core",
        task: "any task",
      });
      // The full directive is inlined (survives untrusted worktrees); native personas don't bind in -p.
      expect(spec.spawnPrompt).toContain(WORKER_TONE_DIRECTIVE);
      expect(spec.spawnPrompt).toContain("BOTTOM LINE first");
      expect(spec.spawnPrompt).toContain('Recommended next: <slice> (Q#)');
      // Must NOT tell the child to bind the persona FILE (proven inert in -p).
      expect(spec.spawnPrompt).not.toContain("Tone: .grok/personas/terse-bluf.toml");
    });

    it("large parallel task forces fan-out skill language", () => {
      expect(looksLikeLargeParallelTask("parallel blender batch all meshes")).toBe(true);
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "asset-pipeline-lead",
        roleDir: "agents/core/asset-pipeline-lead",
        group: "core",
        task: "Large task: parallel blender batch across all meshes with fan-out",
      });
      expect(spec.spawnPrompt).toContain("LARGE-TASK FAN-OUT");
      expect(spec.spawnPrompt).toContain("large-task-orchestration");
    });

    it("formatWorkerHeadlessEnvPrefix exports worker flag + GROK_SUBAGENTS + job tmp", () => {
      const prefix = formatWorkerHeadlessEnvPrefix("mesh-a");
      expect(prefix).toContain(OPENCLINXR_WORKER_ENV.headlessPrefix);
      expect(prefix).toContain(GROK_SUBAGENTS_ENV.headlessPrefix);
      expect(prefix).toMatch(/\bGROK_SUBAGENTS=1\b/);
      expect(prefix).toContain("OPENCLINXR_JOB_ID=mesh-a");
      expect(prefix).toContain("OPENCLINXR_JOB_TMP=");
      // Dispatch-ready order: worker + subagents flags before job tmp
      expect(prefix.indexOf("OPENCLINXR_WORKER=1")).toBeLessThan(prefix.indexOf("GROK_SUBAGENTS=1"));
      expect(prefix.indexOf("GROK_SUBAGENTS=1")).toBeLessThan(prefix.indexOf("OPENCLINXR_JOB_TMP="));
    });

    it("formatWorkerHeadlessDispatchFlags emits bounded-autonomy flags (not blanket --yolo)", () => {
      const flags = formatWorkerHeadlessDispatchFlags();
      // VERIFIED behaviorally (agentic-eval permission-bounds.test.ts): --sandbox fences
      // out-of-cwd writes, --deny blocks destructive shell; both non-interactive.
      expect(flags).toContain("--always-approve");
      expect(flags).toContain("--sandbox workspace");
      expect(flags).toContain("--deny 'Bash(rm -rf *)'");
      expect(flags).not.toContain("--yolo");
    });

    it("read-only scouts omit worker env headless mandate", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "chief-coordinator",
        roleDir: "agents/coordinator/chief-coordinator",
        group: "coordinator",
        task: "Scout next slice",
      });
      expect(spec.spawnPrompt).not.toContain("WORKER ENV:");
    });
  });
});

describe("multimodal spawn routing (operator 2026-08-29: deepseek vision, grok-4.6 escalate-only)", () => {
  it("routes multimodal tasks to deepseek-v4-flash-vision-exp and bakes model into spawnSubagentCall", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "chief-coordinator",
      roleDir: "agents/coordinator/chief-coordinator",
      group: "coordinator",
      task: "Grade cagematch front.png evidence",
    });
    expect(spec.multimodal).toBe(true);
    expect(spec.model).toBe("deepseek-v4-flash-vision-exp");
    expect(spec.spawnSubagentCall?.model).toBe("deepseek-v4-flash-vision-exp");
    expect(spec.spawnSubagentCall?.subagent_type).toBe("explore");
    expect(spec.spawnPrompt).toContain("model: deepseek-v4-flash-vision-exp (multimodal)");
  });

  it("routes productivity-skeptic with no task to deepseek-v4-flash-vision-exp (goal panel inherits PNGs)", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "productivity-skeptic",
      roleDir: "agents/adversarial/productivity-skeptic",
      group: "adversarial",
    });
    expect(spec.multimodal).toBe(true);
    expect(spec.model).toBe("deepseek-v4-flash-vision-exp");
    expect(spec.spawnSubagentCall?.model).toBe("deepseek-v4-flash-vision-exp");
  });

  it("routes implementation-plan-gap-attacker with no task to vision-exp (goal panel inherits PNGs)", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "implementation-plan-gap-attacker",
      roleDir: "agents/adversarial/implementation-plan-gap-attacker",
      group: "adversarial",
    });
    expect(spec.multimodal).toBe(true);
    expect(spec.model).toBe("deepseek-v4-flash-vision-exp");
    expect(spec.spawnSubagentCall?.model).toBe("deepseek-v4-flash-vision-exp");
  });

  it("routes a png in files[] to vision-exp even on a text scout role", () => {
    expect(requiresMultimodalReasoning("chief-coordinator", "Scout next slice")).toBe(false);
    expect(
      requiresMultimodalReasoning("chief-coordinator", undefined, [
        "tools/openclinxr/asset-pipeline/trellis/packs/ecg-cart-imagine-box/front.png",
      ]),
    ).toBe(true);
  });

  it("keeps non-multimodal fast_bounded on explore + deepseek-v4-flash", () => {
    const spec = buildGrokRepoAgentSpawnSpec({
      roleId: "chief-coordinator",
      roleDir: "agents/coordinator/chief-coordinator",
      group: "coordinator",
      task: "Scout next slice",
    });
    expect(spec.multimodal).toBe(false);
    expect(spec.model).toBe("deepseek-v4-flash");
    expect(spec.spawnSubagentCall?.model).toBe("deepseek-v4-flash");
  });

  it("registry aligns multimodal roles on deepseek-v4-flash-vision-exp (multimodal_uses_deepseek_vision)", () => {
    const roles = ["imagine-trellis", "chief-coordinator"].map((roleId) => ({
      roleId,
      roleDir: `agents/group/${roleId}`,
      group: "group",
    }));
    const registry = buildGrokRepoAgentSpawnRegistry({ roles });
    const multimodalAgents = registry.agents.filter((a) => a.multimodal);
    expect(multimodalAgents.length).toBeGreaterThan(0);
    for (const a of multimodalAgents) {
      expect(a.model).toBe("deepseek-v4-flash-vision-exp");
    }
    const check = registry.checks.find((c) => c.checkId === "multimodal_uses_deepseek_vision");
    expect(check?.passed).toBe(true);
  });
});
