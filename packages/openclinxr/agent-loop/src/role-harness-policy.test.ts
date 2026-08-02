import { describe, expect, it } from "vitest";
import {
  assertDeliveryRoleMapped,
  assertTouchedWithinWriteRoots,
  disallowedToolsForRole,
  findSoleAuthorLockViolations,
  formatPathScopeBlock,
  getRepoRoleHarnessPolicy,
  getRolePathScope,
  pathMatchesAnyGlob,
  PREFERRED_CLI_SOFT_WARN,
  repoRoleHarnessPolicies,
  resolveHarnessModelSpec,
  shouldRecommendMoonbridgeAssist,
  soleAuthorLocks,
  VISUAL_MULTIMODAL_ROLE_IDS,
  type RolePathScope,
} from "./role-harness-policy.js";
import {
  buildGrokRepoAgentSpawnSpec,
  buildRepoAgentSpawnPrompt,
} from "./grok-repo-agent-spawn.js";

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
      "architect",
      "archivist",
      "asset-pipeline-lead",
      "chief-coordinator",
      "clinical-safety-critic",
      "hrbp",
      "implementation-plan-gap-attacker",
      "implementation-planning-lead",
      "license-provenance-specialist",
      "openclaw-drift-police",
      "pediatrics-physician",
      "pmo",
      "productivity-skeptic",
      "rigging-animation-specialist",
      "visual-realism-adversary",
      "vp-engineering-delivery",
      "xr-systems-architect",
    ];
    expect(repoRoleHarnessPolicies.map((policy) => policy.roleId).sort()).toEqual(expectedRoles.sort());
  });

  describe("pathScope", () => {
    it("every policy has non-empty writeRoots, readRoots, forbidden, outputRoots", () => {
      for (const policy of repoRoleHarnessPolicies) {
        expect(policy.pathScope, `${policy.roleId}: pathScope must exist`).toBeDefined();
        expect(policy.pathScope.writeRoots.length, `${policy.roleId}: writeRoots must be non-empty`).toBeGreaterThan(0);
        expect(policy.pathScope.readRoots.length, `${policy.roleId}: readRoots must be non-empty`).toBeGreaterThan(0);
        expect(policy.pathScope.forbidden.length, `${policy.roleId}: forbidden must be non-empty`).toBeGreaterThan(0);
        expect(policy.pathScope.outputRoots.length, `${policy.roleId}: outputRoots must be non-empty`).toBeGreaterThan(0);
      }
    });

    it("hrbp writeScope still mentions agent-ops", () => {
      const hrbp = getRepoRoleHarnessPolicy("hrbp");
      expect(hrbp).toBeDefined();
      expect(hrbp!.writeScopeNote).toContain("agent-ops");
    });

    it("role list length is 17 (includes architect + archivist + hrbp + pmo)", () => {
      expect(repoRoleHarnessPolicies.length).toBe(17);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "architect")).toBe(true);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "archivist")).toBe(true);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "hrbp")).toBe(true);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "pmo")).toBe(true);
    });

    it("pmo owns temporal cadence writeRoots and hygiene CLIs", () => {
      const policy = getRepoRoleHarnessPolicy("pmo");
      expect(policy).toBeDefined();
      expect(policy!.policyTier).toBe("standard_execution");
      expect(policy!.sandboxMode).toBe("workspace-write");
      expect(policy!.pathScope.writeRoots).toEqual(
        expect.arrayContaining([
          "docs/agent-ops/DOC-HYGIENE-CADENCE.md",
          ".openclinxr/docs-hygiene/**",
          "agents/coordinator/pmo/**",
        ]),
      );
      expect(policy!.pathScope.preferredCli).toEqual(
        expect.arrayContaining(["pnpm docs:hygiene:run", "pnpm docs:hygiene:session-start"]),
      );
      expect(policy!.pathScope.forbidden).toEqual(
        expect.arrayContaining(["apps/**", "packages/**", "docs/agent-ops/PATH-SCOPE.md"]),
      );
      const tools = disallowedToolsForRole("pmo", policy!);
      // Writers keep run_terminal + edit; ban image gen sprawl
      expect(tools).toEqual(expect.arrayContaining(["image_gen"]));
      expect(tools).not.toContain("run_terminal_command");
    });

    it("archivist is fast_bounded read-only warehouse retrieval", () => {
      const policy = getRepoRoleHarnessPolicy("archivist");
      expect(policy).toBeDefined();
      expect(policy!.policyTier).toBe("fast_bounded");
      expect(policy!.sandboxMode).toBe("read-only");
      expect(policy!.pathScope.writeRoots).toEqual(
        expect.arrayContaining([".openclinxr/docs-archive/**", "agents/coordinator/archivist/**"]),
      );
      expect(policy!.pathScope.readRoots).toEqual(
        expect.arrayContaining(["docs/_archive/**", "docs/agent-ops/DOC-WAREHOUSE.md"]),
      );
      expect(policy!.pathScope.forbidden).toEqual(
        expect.arrayContaining(["apps/**", "packages/**", "docs/agent-ops/PATH-SCOPE.md"]),
      );
      expect(policy!.pathScope.preferredCli).toEqual(
        expect.arrayContaining(["pnpm docs:archive status", "rg"]),
      );
      const tools = disallowedToolsForRole("archivist", policy!);
      expect(tools).toEqual(
        expect.arrayContaining(["search_replace", "write", "workflow", "spawn_subagent", "image_gen"]),
      );
      expect(tools).not.toContain("run_terminal_command");
    });

    it("architect has composition writeRoots and bans image tools", () => {
      const policy = getRepoRoleHarnessPolicy("architect");
      expect(policy).toBeDefined();
      expect(policy!.policyTier).toBe("standard_execution");
      expect(policy!.sandboxMode).toBe("workspace-write");
      expect(policy!.pathScope.writeRoots).toEqual(
        expect.arrayContaining([
          "packages/cellix/**",
          "packages/openclinxr/architecture-rules/**",
          "docs/agent-ops/COMPOSITION-ROOTS.md",
        ]),
      );
      expect(policy!.pathScope.preferredCli).toEqual(
        expect.arrayContaining(["pnpm --filter @openclinxr/architecture-rules", "pnpm boundaries"]),
      );
      const tools = disallowedToolsForRole("architect", policy!);
      expect(tools).toEqual(
        expect.arrayContaining(["image_gen", "image_edit", "workflow", "spawn_subagent"]),
      );
      expect(tools).not.toContain("run_terminal_command");
      expect(tools).not.toContain("search_replace");
    });

    it("outputRoots always includes handoff JSON for roleId", () => {
      for (const policy of repoRoleHarnessPolicies) {
        const hasHandoff = policy.pathScope.outputRoots.some((p) =>
          p.includes(policy.roleId),
        );
        expect(hasHandoff, `${policy.roleId}: outputRoots must include roleId pattern`).toBe(true);
      }
    });

    it("readRoots includes writeRoots and coordination files", () => {
      for (const policy of repoRoleHarnessPolicies) {
        for (const w of policy.pathScope.writeRoots) {
          expect(policy.pathScope.readRoots, `${policy.roleId}: readRoots must include writeRoot ${w}`).toContain(w);
        }
        expect(policy.pathScope.readRoots).toContain("AGENTS.md");
        expect(policy.pathScope.readRoots).toContain("PROJECT_STATUS.md");
      }
    });
  });

  describe("pathMatchesAnyGlob", () => {
    it("exact match", () => {
      expect(pathMatchesAnyGlob("PROJECT_STATUS.md", ["PROJECT_STATUS.md"])).toBe(true);
    });

    it("wildcard match", () => {
      expect(pathMatchesAnyGlob("operator-steering.md", ["operator-*.md"])).toBe(true);
    });

    it("double star directory match", () => {
      expect(pathMatchesAnyGlob("apps/arena/foo.ts", ["apps/**"])).toBe(true);
    });

    it("double star nested match", () => {
      expect(pathMatchesAnyGlob("packages/openclinxr/arena/src/index.ts", ["packages/openclinxr/arena/**"])).toBe(true);
    });

    it("no match", () => {
      expect(pathMatchesAnyGlob("apps/api/server.ts", ["packages/**", "docs/**"])).toBe(false);
    });

    it("matches multiple globs", () => {
      expect(pathMatchesAnyGlob("docs/openclinxr/something.md", ["apps/**", "docs/openclinxr/**"])).toBe(true);
    });

    it("trailing /** matches contents", () => {
      expect(pathMatchesAnyGlob(".openclinxr/slices/foo/handoffs/bar.json", [".openclinxr/slices/**"])).toBe(true);
    });
  });

  describe("assertTouchedWithinWriteRoots", () => {
    const scope: RolePathScope = {
      writeRoots: ["PROJECT_STATUS.md", "docs/openclinxr/**", "operator-*.md"],
      readRoots: [],
      forbidden: ["apps/**"],
      outputRoots: [],
    };

    it("all within write roots", () => {
      const result = assertTouchedWithinWriteRoots(
        ["PROJECT_STATUS.md", "docs/openclinxr/foo.md", "operator-blocker.md"],
        scope,
      );
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("detects violation", () => {
      const result = assertTouchedWithinWriteRoots(
        ["PROJECT_STATUS.md", "apps/api/server.ts"],
        scope,
      );
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual(["apps/api/server.ts"]);
    });
  });

  describe("formatPathScopeBlock", () => {
    it("emits PATH SCOPE heading", () => {
      const scope = getRolePathScope("chief-coordinator");
      const block = formatPathScopeBlock(scope);
      expect(block).toContain("PATH SCOPE");
      expect(block).toContain("Write roots");
      expect(block).toContain("Forbidden");
      expect(block).toContain("Read preference");
      expect(block).toContain("Output roots");
      expect(block).toContain("PROJECT_STATUS.md");
    });

    it("includes preferred CLI when present", () => {
      const scope = getRolePathScope("xr-systems-architect");
      const block = formatPathScopeBlock(scope);
      expect(block).toContain("Preferred CLI");
      expect(block).toContain("pnpm --filter @openclinxr/ui-xr");
      // Wave B2 soft-warn
      expect(block).toContain(PREFERRED_CLI_SOFT_WARN);
      expect(block).toContain("prefer preferredCli filters");
    });
  });

  describe("disallowedToolsForRole (Wave B1)", () => {
    it("bans image tools for non-visual read-only scout (openclaw-drift-police)", () => {
      const policy = getRepoRoleHarnessPolicy("openclaw-drift-police")!;
      const tools = disallowedToolsForRole("openclaw-drift-police", policy);
      expect(tools).toEqual(
        expect.arrayContaining([
          "search_replace",
          "write",
          "workflow",
          "spawn_subagent",
          "image_gen",
          "image_edit",
          "image_to_video",
          "reference_to_video",
        ]),
      );
      expect(tools).not.toContain("run_terminal_command");
    });

    it("does not ban image tools for visual multimodal roles", () => {
      for (const roleId of VISUAL_MULTIMODAL_ROLE_IDS) {
        const policy = getRepoRoleHarnessPolicy(roleId)!;
        const tools = disallowedToolsForRole(roleId, policy);
        expect(tools, roleId).not.toContain("image_gen");
        expect(tools, roleId).not.toContain("image_edit");
        expect(tools, roleId).not.toContain("image_to_video");
        expect(tools, roleId).not.toContain("reference_to_video");
        expect(tools, roleId).not.toContain("run_terminal_command");
      }
    });

    it("bans workflow + spawn for workspace-write writers; keeps shell and write tools", () => {
      const policy = getRepoRoleHarnessPolicy("asset-pipeline-lead")!;
      const tools = disallowedToolsForRole("asset-pipeline-lead", policy);
      expect(tools).toContain("workflow");
      expect(tools).toContain("spawn_subagent");
      expect(tools).not.toContain("search_replace");
      expect(tools).not.toContain("write");
      expect(tools).not.toContain("run_terminal_command");
    });

    it("chief-coordinator keeps spawn_subagent but bans write + image tools", () => {
      const policy = getRepoRoleHarnessPolicy("chief-coordinator")!;
      const tools = disallowedToolsForRole("chief-coordinator", policy);
      expect(tools).not.toContain("spawn_subagent");
      expect(tools).toEqual(
        expect.arrayContaining([
          "search_replace",
          "write",
          "workflow",
          "image_gen",
          "image_edit",
        ]),
      );
    });

    it("non-visual expert_review and frontier ban image tools", () => {
      for (const roleId of [
        "pediatrics-physician",
        "clinical-safety-critic",
        "license-provenance-specialist",
        "vp-engineering-delivery",
        "implementation-planning-lead",
        "hrbp",
      ] as const) {
        const policy = getRepoRoleHarnessPolicy(roleId)!;
        const tools = disallowedToolsForRole(roleId, policy);
        expect(tools, roleId).toEqual(
          expect.arrayContaining(["image_gen", "image_edit", "image_to_video", "reference_to_video"]),
        );
      }
    });
  });

  describe("spawn prompt path scope integration", () => {
    it("spawn prompt includes PATH SCOPE block for chief-coordinator", () => {
      const policy = getRepoRoleHarnessPolicy("chief-coordinator")!;
      const prompt = buildRepoAgentSpawnPrompt({
        roleId: "chief-coordinator",
        roleDir: "agents/coordinator/chief-coordinator",
        policy,
      });
      expect(prompt).toContain("PATH SCOPE");
    });

    it("spawn prompt is shorter than 4500 chars for typical roles", () => {
      for (const role of [
        "chief-coordinator",
        "asset-pipeline-lead",
        "xr-systems-architect",
        "hrbp",
        "openclaw-drift-police",
        "architect",
      ] as const) {
        const policy = getRepoRoleHarnessPolicy(role)!;
        const prompt = buildRepoAgentSpawnPrompt({
          roleId: role,
          roleDir: `agents/${role}`,
          policy,
        });
        expect(prompt.length, `${role} prompt length ${prompt.length}`).toBeLessThan(4500);
        expect(prompt).toContain("Rehydrate: pathScope");
        expect(prompt).not.toContain("Confirm AGENTS.md, PROJECT_STATUS.md, docs/agent-factory");
        expect(prompt).toContain("PATH SCOPE");
        expect(prompt).toContain("MANDATE_VISIBILITY");
      }
    });

    it("workspace-write spawn prompts include COMPOSITION-ROOTS pointer", () => {
      for (const role of ["architect", "asset-pipeline-lead", "xr-systems-architect"] as const) {
        const policy = getRepoRoleHarnessPolicy(role)!;
        const prompt = buildRepoAgentSpawnPrompt({
          roleId: role,
          roleDir: `agents/core/${role}`,
          policy,
        });
        expect(prompt, role).toContain("COMPOSITION-ROOTS");
        expect(prompt, role).toContain("docs/agent-ops/COMPOSITION-ROOTS.md");
      }
      const scout = getRepoRoleHarnessPolicy("openclaw-drift-police")!;
      const scoutPrompt = buildRepoAgentSpawnPrompt({
        roleId: "openclaw-drift-police",
        roleDir: "agents/adversarial/openclaw-drift-police",
        policy: scout,
      });
      expect(scoutPrompt).not.toContain("COMPOSITION-ROOTS: feature→packages");
    });

    it("spawn spec includes pathScope", () => {
      const spec = buildGrokRepoAgentSpawnSpec({
        roleId: "chief-coordinator",
        roleDir: "agents/coordinator/chief-coordinator",
        group: "coordinator",
      });
      expect(spec.pathScope).toBeDefined();
      expect(spec.pathScope.writeRoots.length).toBeGreaterThan(0);
      expect(spec.pathScope.forbidden).toContain("apps/**");
    });

    it("spawn spec pathScope is valid for all roles", () => {
      for (const policy of repoRoleHarnessPolicies) {
        const spec = buildGrokRepoAgentSpawnSpec({
          roleId: policy.roleId,
          roleDir: `agents/coordinator/${policy.roleId}`,
          group: "test",
        });
        expect(spec.pathScope.writeRoots.length, `${policy.roleId}: writeRoots`).toBeGreaterThan(0);
        expect(spec.pathScope.forbidden.length, `${policy.roleId}: forbidden`).toBeGreaterThan(0);
      }
    });
  });

  describe("assertDeliveryRoleMapped (Wave C-arch)", () => {
    it("accepts registered roles", () => {
      expect(assertDeliveryRoleMapped("architect").ok).toBe(true);
      expect(assertDeliveryRoleMapped("asset-pipeline-lead").ok).toBe(true);
    });

    it("rejects bare general-purpose and empty roleId", () => {
      const bare = assertDeliveryRoleMapped("general-purpose");
      expect(bare.ok).toBe(false);
      if (!bare.ok) {
        expect(bare.reason).toMatch(/general-purpose|spawn-spec/i);
      }
      expect(assertDeliveryRoleMapped("").ok).toBe(false);
      expect(assertDeliveryRoleMapped("explore").ok).toBe(false);
    });

    it("rejects unknown product roles without policy", () => {
      const unknown = assertDeliveryRoleMapped("silent-fullstack-catch-all");
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) {
        expect(unknown.reason).toMatch(/No RepoRoleHarnessPolicy/);
      }
    });
  });

  describe("soleAuthorLocks", () => {
    it("soleAuthorLocks has expected entries", () => {
      const lockIds = soleAuthorLocks.map((l) => l.lockId);
      expect(lockIds).toContain("agent-roster");
      expect(lockIds).toContain("protected-blueprint");
      expect(lockIds).toContain("ceo-voice");
      expect(lockIds).toContain("path-scope-policy");
      expect(lockIds).toContain("composition-roots");
    });

    it("architect owns composition-roots and can touch COMPOSITION-ROOTS + cellix", () => {
      const violations = findSoleAuthorLockViolations("architect", [
        "docs/agent-ops/COMPOSITION-ROOTS.md",
        "packages/cellix/config-typescript/package.json",
        "packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts",
      ]);
      expect(violations).toEqual([]);
    });

    it("other role triggers violation for composition-roots paths", () => {
      const violations = findSoleAuthorLockViolations("asset-pipeline-lead", [
        "packages/cellix/config-vitest/package.json",
      ]);
      expect(violations.some((v) => v.lockId === "composition-roots")).toBe(true);
    });

    it("each lock has non-empty paths and unique lockId", () => {
      const seen = new Set<string>();
      for (const lock of soleAuthorLocks) {
        expect(lock.paths.length, `${lock.lockId}: paths must be non-empty`).toBeGreaterThan(0);
        expect(seen.has(lock.lockId), `duplicate lockId: ${lock.lockId}`).toBe(false);
        seen.add(lock.lockId);
      }
    });

    it("owner role does not trigger violation for own locked paths", () => {
      const violations = findSoleAuthorLockViolations("hrbp", [
        "docs/agent-ops/roster-review.md",
      ]);
      expect(violations).toEqual([]);
    });

    it("other role triggers violation for locked agent-ops path", () => {
      const violations = findSoleAuthorLockViolations("asset-pipeline-lead", [
        "docs/agent-ops/something.md",
      ]);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const agentRosterViolation = violations.find((v) => v.lockId === "agent-roster");
      expect(agentRosterViolation).toBeDefined();
      expect(agentRosterViolation!.ownerRoleId).toBe("hrbp");
    });

    it("other role triggers violation for protected blueprint docs", () => {
      const violations = findSoleAuthorLockViolations("xr-systems-architect", [
        "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
      ]);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const blueprintViolation = violations.find((v) => v.lockId === "protected-blueprint");
      expect(blueprintViolation).toBeDefined();
      expect(blueprintViolation!.ownerRoleId).toBe("openclaw-drift-police");
    });

    it("openclaw-drift-police owns protected-blueprint and can touch it", () => {
      const violations = findSoleAuthorLockViolations("openclaw-drift-police", [
        "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
        "docs/openclinxr/openclaw-runbook-2026-05-27.md",
      ]);
      expect(violations).toEqual([]);
    });

    it("other role triggers violation for ceo-voice path", () => {
      const violations = findSoleAuthorLockViolations("rigging-animation-specialist", [
        "docs/agent-ops/CEO-VOICE.md",
      ]);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const ceoViolation = violations.find((v) => v.lockId === "ceo-voice");
      expect(ceoViolation).toBeDefined();
    });

    it("other role triggers violation for path-scope-policy file", () => {
      const violations = findSoleAuthorLockViolations("clinical-safety-critic", [
        "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
      ]);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const scopeViolation = violations.find((v) => v.lockId === "path-scope-policy");
      expect(scopeViolation).toBeDefined();
    });

    it("empty touched returns no violations", () => {
      const violations = findSoleAuthorLockViolations("asset-pipeline-lead", []);
      expect(violations).toEqual([]);
    });

    it("touching an unlocked file returns no violations", () => {
      const violations = findSoleAuthorLockViolations("asset-pipeline-lead", [
        "tools/openclinxr/asset-pipeline/generate.ts",
      ]);
      expect(violations).toEqual([]);
    });
  });
});