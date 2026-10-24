import { describe, expect, it } from "vitest";
import {
  GROK_WORKER_FALLBACK_MODEL,
  GROK_WORKER_MODEL,
  allowedToolsForRole,
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
  it("holds DeepSeek and defaults Grok workers to muse-spark-1 with nemotron fallback", () => {
    expect(GROK_WORKER_MODEL).toBe("muse-spark-1");
    expect(GROK_WORKER_FALLBACK_MODEL).toBe("nemotron-ultra");
  });

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
      model: "muse-spark-1",
      reasoningEffort: "low",
    });
    expect(resolveHarnessModelSpec("standard_execution", "grok")).toEqual({
      model: "muse-spark-1",
      reasoningEffort: "medium",
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
      "imagine-trellis",
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
      expect(hrbp?.writeScopeNote).toContain("agent-ops");
    });

    it("role list length is 18 (includes architect + archivist + hrbp + pmo + imagine-trellis)", () => {
      expect(repoRoleHarnessPolicies.length).toBe(18);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "architect")).toBe(true);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "archivist")).toBe(true);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "hrbp")).toBe(true);
      expect(repoRoleHarnessPolicies.some((p) => p.roleId === "pmo")).toBe(true);
    });

    it("pmo owns temporal cadence writeRoots and hygiene CLIs", () => {
      const policy = getRepoRoleHarnessPolicy("pmo");
      expect(policy).toBeDefined();
      expect(policy?.policyTier).toBe("standard_execution");
      expect(policy?.sandboxMode).toBe("workspace-write");
      expect(policy?.pathScope.writeRoots).toEqual(
        expect.arrayContaining([
          "docs/agent-ops/DOC-HYGIENE-CADENCE.md",
          ".openclinxr/docs-hygiene/**",
          "agents/coordinator/pmo/**",
        ]),
      );
      expect(policy?.pathScope.preferredCli).toEqual(
        expect.arrayContaining(["pnpm docs:hygiene:run", "pnpm docs:hygiene:session-start"]),
      );
      expect(policy?.pathScope.forbidden).toEqual(
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
      expect(policy?.policyTier).toBe("fast_bounded");
      expect(policy?.sandboxMode).toBe("read-only");
      expect(policy?.pathScope.writeRoots).toEqual(
        expect.arrayContaining([".openclinxr/docs-archive/**", "agents/coordinator/archivist/**"]),
      );
      expect(policy?.pathScope.readRoots).toEqual(
        expect.arrayContaining(["docs/_archive/**", "docs/agent-ops/DOC-WAREHOUSE.md"]),
      );
      expect(policy?.pathScope.forbidden).toEqual(
        expect.arrayContaining(["apps/**", "packages/**", "docs/agent-ops/PATH-SCOPE.md"]),
      );
      expect(policy?.pathScope.preferredCli).toEqual(
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
      expect(policy?.policyTier).toBe("standard_execution");
      expect(policy?.sandboxMode).toBe("workspace-write");
      expect(policy?.pathScope.writeRoots).toEqual(
        expect.arrayContaining([
          "packages/cellix/**",
          "packages/openclinxr-verification/architecture-rules/**",
          "docs/agent-ops/COMPOSITION-ROOTS.md",
        ]),
      );
      expect(policy?.pathScope.preferredCli).toEqual(
        expect.arrayContaining(["pnpm -F @openclinxr/architecture-rules", "pnpm boundaries"]),
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
    it("chief-coordinator pathScope covers root README/docs for promote", () => {
      const scope = getRolePathScope("chief-coordinator");
      expect(scope.writeRoots).toEqual(
        expect.arrayContaining([
          "PROJECT_STATUS.md",
          "README.md",
          "docs/index.html",
          "docs/agent-ops/**",
          ".openclinxr/epics/**",
          "tools/openclinxr/openclaw/**",
        ]),
      );
      expect(scope.preferredCli).toEqual(expect.arrayContaining(["pnpm openclaw:epic"]));
    });

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

  describe("allowedToolsForRole (Wave B1.1 positive allowlist)", () => {
    it("emits read/search/lsp allowlist for read-only scouts without shell or write", () => {
      const policy = getRepoRoleHarnessPolicy("openclaw-drift-police")!;
      const tools = allowedToolsForRole("openclaw-drift-police", policy);
      expect(tools).toBeDefined();
      expect(tools).toEqual(
        expect.arrayContaining(["read_file", "grep", "list_dir", "lsp", "web_search", "web_fetch"]),
      );
      expect(tools).not.toContain("run_terminal_command");
      expect(tools).not.toContain("write");
      expect(tools).not.toContain("search_replace");
      expect(tools).not.toContain("workflow");
      expect(tools).not.toContain("spawn_subagent");
      expect(tools).not.toContain("image_gen");
    });

    it("chief-coordinator allowlist keeps spawn helpers but not shell/write", () => {
      const policy = getRepoRoleHarnessPolicy("chief-coordinator")!;
      const tools = allowedToolsForRole("chief-coordinator", policy);
      expect(tools).toEqual(
        expect.arrayContaining([
          "spawn_subagent",
          "get_command_or_subagent_output",
          "kill_command_or_subagent",
          "read_file",
          "grep",
        ]),
      );
      expect(tools).not.toContain("run_terminal_command");
      expect(tools).not.toContain("write");
      expect(tools).not.toContain("search_replace");
    });

    it("visual read-only roles keep image tools on the positive allowlist", () => {
      for (const roleId of ["productivity-skeptic", "visual-realism-adversary"] as const) {
        const policy = getRepoRoleHarnessPolicy(roleId)!;
        expect(policy.sandboxMode).toBe("read-only");
        const tools = allowedToolsForRole(roleId, policy);
        expect(tools, roleId).toEqual(
          expect.arrayContaining(["image_gen", "image_edit", "read_file", "grep"]),
        );
        expect(tools, roleId).not.toContain("run_terminal_command");
        expect(tools, roleId).not.toContain("write");
      }
    });

    it("workspace-write execute roles get no positive allowlist (keep shell+write)", () => {
      for (const roleId of [
        "asset-pipeline-lead",
        "xr-systems-architect",
        "rigging-animation-specialist",
        "architect",
        "hrbp",
        "pmo",
      ] as const) {
        const policy = getRepoRoleHarnessPolicy(roleId)!;
        expect(policy.sandboxMode, roleId).toBe("workspace-write");
        expect(allowedToolsForRole(roleId, policy), roleId).toBeUndefined();
      }
    });

    it("every read-only policy role gets an allowlist without shell/write", () => {
      for (const policy of repoRoleHarnessPolicies) {
        if (policy.sandboxMode !== "read-only") continue;
        const tools = allowedToolsForRole(policy.roleId, policy);
        expect(tools, policy.roleId).toBeDefined();
        expect(tools, policy.roleId).not.toContain("run_terminal_command");
        expect(tools, policy.roleId).not.toContain("write");
        expect(tools, policy.roleId).not.toContain("search_replace");
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
        "packages/openclinxr-verification/architecture-rules/src/workspace-architecture.test.ts",
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
      expect(agentRosterViolation?.ownerRoleId).toBe("hrbp");
    });

    it("other role triggers violation for protected blueprint docs", () => {
      const violations = findSoleAuthorLockViolations("xr-systems-architect", [
        "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
      ]);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const blueprintViolation = violations.find((v) => v.lockId === "protected-blueprint");
      expect(blueprintViolation).toBeDefined();
      expect(blueprintViolation?.ownerRoleId).toBe("openclaw-drift-police");
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

  describe("coverage-gap admissions (ci-closure-20261020, minimal exact roots)", () => {
    it("architect admits verified-unowned compute infrastructure + lockfile, nothing broad", () => {
      const scope = getRolePathScope("architect");
      expect(scope.writeRoots).toEqual(
        expect.arrayContaining([
          "packages/openclinxr/compute-slots/**",
          "packages/openclinxr/service-local-compute/**",
          "pnpm-lock.yaml",
        ]),
      );
      const admitted = assertTouchedWithinWriteRoots(
        [
          "packages/openclinxr/compute-slots/src/slots.ts",
          "packages/openclinxr/compute-slots/src/slots.test.ts",
          "packages/openclinxr/service-local-compute/src/local.ts",
          "packages/openclinxr/service-local-compute/src/local-compute.test.ts",
          "pnpm-lock.yaml",
        ],
        scope,
      );
      expect(admitted.ok).toBe(true);
      // No broad widening: feature/factory/capacity/apps roots still refused.
      const refused = assertTouchedWithinWriteRoots(
        [
          "packages/openclinxr/factory-stations/src/index.ts",
          "packages/openclinxr/xr-capacity/src/index.ts",
          "tools/openclinxr/dark-factory/multi-case-runner.ts",
          "tools/openclinxr/evidence/quest-capacity/browser-check.ts",
          "apps/ui-xr/src/static-assets.test.ts",
        ],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.sort()).toEqual(
        [
          "packages/openclinxr/factory-stations/src/index.ts",
          "packages/openclinxr/xr-capacity/src/index.ts",
          "tools/openclinxr/dark-factory/multi-case-runner.ts",
          "tools/openclinxr/evidence/quest-capacity/browser-check.ts",
          "apps/ui-xr/src/static-assets.test.ts",
        ].sort(),
      );
      expect(scope.writeRoots).not.toContain("packages/**");
      expect(scope.writeRoots).not.toContain("apps/**");
    });

    it("architect admits verified-unowned root package.json, nothing broad", () => {
      const scope = getRolePathScope("architect");
      expect(scope.writeRoots).toContain("package.json");
      const admitted = assertTouchedWithinWriteRoots(["package.json"], scope);
      expect(admitted.ok).toBe(true);
      // Negative (updated 2026-10-21 prospective: pnpm-workspace.yaml is now its own
      // exact-literal admission below, so this control covers the remaining refusals).
      const refused = assertTouchedWithinWriteRoots(
        ["vitest.config.ts", "apps/api/src/index.ts"],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.sort()).toEqual(
        ["vitest.config.ts", "apps/api/src/index.ts"].sort(),
      );
      expect(scope.writeRoots).not.toContain("packages/**");
      expect(scope.writeRoots).not.toContain("apps/**");
    });

    it("architect admits prospective exact root pnpm-workspace.yaml, nothing broad", () => {
      const scope = getRolePathScope("architect");
      expect(scope.writeRoots).toContain("pnpm-workspace.yaml");
      // Positive: the exact workspace root only.
      expect(
        assertTouchedWithinWriteRoots(["pnpm-workspace.yaml"], scope).ok,
      ).toBe(true);
      // Negative: vitest config, other root yaml/json, apps, domain stay refused.
      const refused = assertTouchedWithinWriteRoots(
        [
          "vitest.config.ts",
          "pnpm-workspace.yaml.orig",
          "tsconfig.json",
          ".npmrc",
          "apps/api/src/index.ts",
          "apps/ui-xr/src/static-assets.test.ts",
          "packages/openclinxr/domain/patient.ts",
        ],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.sort()).toEqual(
        [
          "vitest.config.ts",
          "pnpm-workspace.yaml.orig",
          "tsconfig.json",
          ".npmrc",
          "apps/api/src/index.ts",
          "apps/ui-xr/src/static-assets.test.ts",
          "packages/openclinxr/domain/patient.ts",
        ].sort(),
      );
      // No wildcard broadening: exact literal only.
      expect(scope.writeRoots).not.toContain("*.yaml");
      expect(scope.writeRoots).not.toContain("*.yml");
      expect(scope.writeRoots).not.toContain("pnpm-workspace.*");
      expect(scope.writeRoots).not.toContain("**/*.yaml");
      expect(scope.writeRoots).not.toContain("vitest.config.ts");
      expect(scope.writeRoots).not.toContain("packages/**");
      expect(scope.writeRoots).not.toContain("apps/**");
    });

    it("xr-systems-architect admits mouth-verifier but still refuses the openclaw hook", () => {
      const scope = getRolePathScope("xr-systems-architect");
      expect(scope.writeRoots).toContain("packages/openclinxr/stations/mouth-verifier/**");
      const admitted = assertTouchedWithinWriteRoots(
        [
          "packages/openclinxr/stations/mouth-verifier/src/evaluator.ts",
          "packages/openclinxr/stations/mouth-verifier/src/headless-scene.ts",
          "packages/openclinxr/stations/mouth-verifier/tsconfig.json",
        ],
        scope,
      );
      expect(admitted.ok).toBe(true);
      const refused = assertTouchedWithinWriteRoots(
        ["tools/openclinxr/openclaw/known-red-tests.json", "apps/api/server.ts"],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations).toEqual([
        "tools/openclinxr/openclaw/known-red-tests.json",
        "apps/api/server.ts",
      ]);
    });

    it("hrbp admits its own roster index but still refuses product packages", () => {
      const scope = getRolePathScope("hrbp");
      expect(scope.writeRoots).toContain("agents/coordinator/hrbp/index.json");
      expect(
        assertTouchedWithinWriteRoots(
          ["agents/coordinator/hrbp/index.json", "agents/coordinator/hrbp/charter.md"],
          scope,
        ).ok,
      ).toBe(true);
      const refused = assertTouchedWithinWriteRoots(
        ["packages/openclinxr/compute-slots/src/slots.ts", "apps/ui-xr/src/static-assets.test.ts"],
        scope,
      );
      expect(refused.ok).toBe(false);
    });

    it("reassigned factory/evidence/capacity paths resolve to existing rightful owners", () => {
      expect(
        assertTouchedWithinWriteRoots(
          [
            "packages/openclinxr/factory-stations/src/lip_sync/run.ts",
            "packages/openclinxr/factory-stations/consumes.json",
            "tools/openclinxr/dark-factory/multi-case-runner.ts",
            "packages/openclinxr/factory-stations/arch-index.json",
          ],
          getRolePathScope("implementation-planning-lead"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          [
            "packages/openclinxr/xr-capacity/src/index.ts",
            "packages/openclinxr/xr-capacity/arch-index.json",
            "tools/openclinxr/evidence/quest-capacity/browser-check.ts",
            "tools/openclinxr/evidence/consumes.json",
            "apps/ui-xr/src/static-assets.test.ts",
          ],
          getRolePathScope("xr-systems-architect"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          ["tools/openclinxr/evidence/room-ward-finish-chain/sync-static-ward-pin.ts"],
          getRolePathScope("asset-pipeline-lead"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          ["tools/openclinxr/openclaw/known-red-tests.json"],
          getRolePathScope("chief-coordinator"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          ["tools/openclinxr/evidence/check-license-policy.ts"],
          getRolePathScope("license-provenance-specialist"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          ["agents/coordinator/pmo/score-history.json"],
          getRolePathScope("pmo"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          ["agents/coordinator/archivist/index.json"],
          getRolePathScope("archivist"),
        ).ok,
      ).toBe(true);
      expect(
        assertTouchedWithinWriteRoots(
          ["agents/adversarial/openclaw-drift-police/index.json"],
          getRolePathScope("openclaw-drift-police"),
        ).ok,
      ).toBe(true);
    });

    it("path-scope-policy sole-author lock is intact: PL needs HRBP review, no bypass added", () => {
      // Lock logic untouched: non-owner touching role-harness-policy.ts still violates.
      const plViolations = findSoleAuthorLockViolations("implementation-planning-lead", [
        "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
      ]);
      expect(
        plViolations.some((v) => v.lockId === "path-scope-policy" && v.ownerRoleId === "hrbp"),
      ).toBe(true);
      // Lock owner itself stays clean.
      expect(
        findSoleAuthorLockViolations("hrbp", [
          "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
        ]),
      ).toEqual([]);
      // role-path-scopes.ts (this table) is not lock-covered: PL may author it.
      expect(
        findSoleAuthorLockViolations("implementation-planning-lead", [
          "packages/openclinxr/agent-loop/src/role-path-scopes.ts",
        ]),
      ).toEqual([]);
    });

    it("chief still refused protected registries, license tools and foreign agent indexes", () => {
      const scope = getRolePathScope("chief-coordinator");
      const refused = assertTouchedWithinWriteRoots(
        [
          "docs/openclinxr/doc-authority-registry-2026-05-27.json",
          "tools/openclinxr/evidence/check-license-policy.ts",
          "agents/coordinator/hrbp/index.json",
          "agents/coordinator/pmo/score-history.json",
        ],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.length).toBe(4);
    });

    it("openclaw-drift-police admits exactly 3 doc-authority-registry literals, nothing broad", () => {
      const scope = getRolePathScope("openclaw-drift-police");
      // Positive: all 3 HRBP-approved exact literals admitted.
      expect(scope.writeRoots).toEqual(
        expect.arrayContaining([
          "tools/agent-factory/build-doc-authority-registry.ts",
          "tools/agent-factory/doc-authority-registry/append.ts",
          "tools/agent-factory/doc-authority-registry/append.test.ts",
        ]),
      );
      const admitted = assertTouchedWithinWriteRoots(
        [
          "tools/agent-factory/build-doc-authority-registry.ts",
          "tools/agent-factory/doc-authority-registry/append.ts",
          "tools/agent-factory/doc-authority-registry/append.test.ts",
        ],
        scope,
      );
      expect(admitted.ok).toBe(true);
      // Forbidden unchanged: apps/packages still refused.
      expect(scope.forbidden).toEqual(expect.arrayContaining(["apps/**", "packages/**"]));
      // Negative: agent siblings, unrelated tools, forbidden apps/packages all refused.
      const refused = assertTouchedWithinWriteRoots(
        [
          "agents/adversarial/clinical-safety-critic/index.json",
          "agents/coordinator/hrbp/index.json",
          "tools/openclinxr/evidence/check-license-policy.ts",
          "tools/agent-factory/other-tool.ts",
          "tools/openclinxr/openclaw/known-red-tests.json",
          "apps/ui-xr/src/static-assets.test.ts",
          "packages/openclinxr/factory-stations/src/index.ts",
        ],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.sort()).toEqual(
        [
          "agents/adversarial/clinical-safety-critic/index.json",
          "agents/coordinator/hrbp/index.json",
          "tools/openclinxr/evidence/check-license-policy.ts",
          "tools/agent-factory/other-tool.ts",
          "tools/openclinxr/openclaw/known-red-tests.json",
          "apps/ui-xr/src/static-assets.test.ts",
          "packages/openclinxr/factory-stations/src/index.ts",
        ].sort(),
      );
      // No broad widening: tools/** wildcard and parent dir glob must not exist.
      expect(scope.writeRoots).not.toContain("tools/**");
      expect(scope.writeRoots).not.toContain("tools/agent-factory/**");
      expect(scope.writeRoots).not.toContain("apps/**");
      expect(scope.writeRoots).not.toContain("packages/**");
    });
  });

  describe("role-config-ownership (consolidated; standalone file removed to keep testInternalImports at ceiling)", () => {
    const TARGETS = [".github/workflows/ci.yml", "turbo.json", "knip.json"];

    it("architect allows the exact 3 CI config literals", () => {
      const scope = getRolePathScope("architect");
      for (const t of TARGETS) expect(scope.writeRoots).toContain(t);
      expect(assertTouchedWithinWriteRoots(TARGETS, scope).ok).toBe(true);
    });

    it("architect still refuses neighboring roots and broad globs", () => {
      const scope = getRolePathScope("architect");
      const refused = assertTouchedWithinWriteRoots(
        [
          ".github/workflows/other.yml",
          ".github/CODEOWNERS",
          "turbo.json.orig",
          "knip.json.bak",
          "vitest.config.ts",
          "tsconfig.json",
          "apps/api/src/index.ts",
          "packages/openclinxr/domain/patient.ts",
        ],
        scope,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.length).toBe(8);
    });

    it("admits exact literals only, no wildcard widening", () => {
      const scope = getRolePathScope("architect");
      for (const broad of [
        ".github/**",
        "*.json",
        "*.yml",
        "**/*.json",
        "turbo.*",
        "knip.*",
        "packages/**",
        "apps/**",
      ])
        expect(scope.writeRoots).not.toContain(broad);
    });

    it("exact 3 are architect-only: every other role still refuses", () => {
      // Consolidated without the standalone file's role-path-scopes.js import:
      // repoRoleHarnessPolicies is already imported above and is built from the
      // same 18-role table; the "covers all documented active repo roles" test
      // pins that 18-list, so enumerating it here keeps the 17-other check exact.
      const others = repoRoleHarnessPolicies
        .map((p) => p.roleId)
        .filter((r) => r !== "architect");
      expect(repoRoleHarnessPolicies.length).toBe(18);
      expect(others.length).toBe(17);
      for (const role of others) {
        const res = assertTouchedWithinWriteRoots(TARGETS, getRolePathScope(role));
        expect(res.ok).toBe(false);
        expect(res.violations.sort()).toEqual([...TARGETS].sort());
      }
      // Pre-existing broad tools/** owner (license-provenance-specialist) still
      // does not cover these repo-root paths.
      expect(
        assertTouchedWithinWriteRoots(TARGETS, getRolePathScope("license-provenance-specialist"))
          .ok,
      ).toBe(false);
    });

    it("no sole-author lock covers the 3; path-scope-policy lock stays intact", () => {
      for (const lock of soleAuthorLocks)
        for (const p of lock.paths)
          expect(TARGETS).not.toContain(p);
      expect(
        findSoleAuthorLockViolations("architect", TARGETS),
      ).toEqual([]);
      // Unchanged behavior: non-owner touching the policy file still violates.
      expect(
        findSoleAuthorLockViolations("implementation-planning-lead", [
          "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
        ]).some((v) => v.lockId === "path-scope-policy"),
      ).toBe(true);
      // Architect forbidden range unchanged: product/xr roots still refused.
      const scope = getRolePathScope("architect");
      expect(scope.forbidden).toEqual(
        expect.arrayContaining([
          "apps/**",
          "packages/openclinxr/domain/**",
          "packages/openclinxr/scenario-runtime/**",
        ]),
      );
    });
  });

  describe("harness-owner admission (ph207 HRBP ACCEPT_BOUNDED, prospective exact literal)", () => {
    const TARGET = "tests/openclinxr/helpers/assembled-exam-harness.ts";

    it("implementation-planning-lead admits the exact harness literal", () => {
      const scope = getRolePathScope("implementation-planning-lead");
      expect(scope.writeRoots).toContain(TARGET);
      expect(assertTouchedWithinWriteRoots([TARGET], scope).ok).toBe(true);
    });

    it("every other role still refuses the harness literal; no tests/** grant", () => {
      const others = repoRoleHarnessPolicies
        .map((p) => p.roleId)
        .filter((r) => r !== "implementation-planning-lead");
      expect(repoRoleHarnessPolicies.length).toBe(18);
      expect(others.length).toBe(17);
      for (const role of others) {
        const res = assertTouchedWithinWriteRoots([TARGET], getRolePathScope(role));
        expect(res.ok).toBe(false);
        expect(res.violations).toEqual([TARGET]);
      }
      const pl = getRolePathScope("implementation-planning-lead");
      expect(pl.writeRoots).not.toContain("tests/**");
      // Adjacent helper stays unadmitted.
      expect(pl.writeRoots).not.toContain("tests/openclinxr/helpers/assembled-exam-admin.vite.config.ts");
      expect(
        assertTouchedWithinWriteRoots(
          ["tests/openclinxr/helpers/assembled-exam-admin.vite.config.ts"],
          pl,
        ).ok,
      ).toBe(false);
    });

    it("no sole-author lock covers the harness; path-scope-policy lock stays intact", () => {
      for (const lock of soleAuthorLocks)
        for (const p of lock.paths)
          expect(p).not.toBe(TARGET);
      expect(
        findSoleAuthorLockViolations("implementation-planning-lead", [TARGET]),
      ).toEqual([]);
      // Unchanged behavior: non-owner touching the policy file still violates.
      expect(
        findSoleAuthorLockViolations("implementation-planning-lead", [
          "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
        ]).some((v) => v.lockId === "path-scope-policy"),
      ).toBe(true);
    });
  });

  describe("capability-owner admission (ph228 HRBP ACCEPT_BOUNDED, prospective whole-package root)", () => {
    const TARGETS = [
      "packages/openclinxr/capability-gateway/src/index.ts",
      "packages/openclinxr/capability-gateway/src/deterministic-asset-adapter.ts",
    ];

    it("implementation-planning-lead admits the capability-gateway package root", () => {
      const scope = getRolePathScope("implementation-planning-lead");
      expect(scope.writeRoots).toContain("packages/openclinxr/capability-gateway/**");
      expect(assertTouchedWithinWriteRoots(TARGETS, scope).ok).toBe(true);
    });

    it("every other role still refuses gateway files; no packages/** grant; neighbors refused", () => {
      const others = repoRoleHarnessPolicies
        .map((p) => p.roleId)
        .filter((r) => r !== "implementation-planning-lead");
      expect(repoRoleHarnessPolicies.length).toBe(18);
      expect(others.length).toBe(17);
      for (const role of others) {
        const res = assertTouchedWithinWriteRoots(TARGETS, getRolePathScope(role));
        expect(res.ok).toBe(false);
        expect(res.violations.sort()).toEqual([...TARGETS].sort());
      }
      const pl = getRolePathScope("implementation-planning-lead");
      expect(pl.writeRoots).not.toContain("packages/**");
      // Adjacent unowned packages stay refused by the positive write-root check;
      // the asset-pipeline tool is covered by the forbidden layer (PL owns
      // tools/openclinxr/** but forbids tools/openclinxr/asset-pipeline/**).
      const refused = assertTouchedWithinWriteRoots(
        [
          "packages/openclinxr/data-mongodb/src/index.ts",
          "packages/openclinxr/service-local-compute/src/local.ts",
        ],
        pl,
      );
      expect(refused.ok).toBe(false);
      expect(refused.violations.sort()).toEqual(
        [
          "packages/openclinxr/data-mongodb/src/index.ts",
          "packages/openclinxr/service-local-compute/src/local.ts",
        ].sort(),
      );
      expect(
        pathMatchesAnyGlob("tools/openclinxr/asset-pipeline/generate.ts", pl.forbidden),
      ).toBe(true);
      // Existing exact harness literal still admitted alongside the new root.
      expect(pl.writeRoots).toContain("tests/openclinxr/helpers/assembled-exam-harness.ts");
      expect(
        assertTouchedWithinWriteRoots(
          ["tests/openclinxr/helpers/assembled-exam-harness.ts"],
          pl,
        ).ok,
      ).toBe(true);
      // HRBP sole-author lock unchanged: PL touching role-harness-policy.ts violates.
      expect(
        findSoleAuthorLockViolations("implementation-planning-lead", [
          "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
        ]).some((v) => v.lockId === "path-scope-policy" && v.ownerRoleId === "hrbp"),
      ).toBe(true);
    });
  });
});