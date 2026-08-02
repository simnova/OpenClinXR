import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditHandoffsPathScope,
  auditHandoffsSoleAuthorLocks,
  buildSliceTeamSpawnPrompt,
  buildTeamSpawnReport,
  constrainPathsToWriteRoots,
  materializeBriefFromTemplate,
  sliceHandoffPath,
  verifySliceBrief,
  type SliceBrief,
  type SliceHandoff,
  type SliceTeamTemplate,
} from "./slice-team.js";

const fixtureRoot = path.join(process.cwd(), ".test-fixtures-slice-team");

const template: SliceTeamTemplate = {
  schemaVersion: "openclinxr.slice-team-template.v1",
  id: "real-garment-v1",
  description: "test template",
  goal: "Visible real garment sleeves",
  q_gate: "Q1+Q5",
  autonomy: "execute without human approval",
  roles: {
    "asset-pipeline-lead": {
      paths: ["tools/openclinxr/factory/**/automate_blender.py"],
      mode: "write",
      phase: "execute",
    },
    "xr-systems-architect": {
      paths: ["packages/openclinxr/arena/**"],
      mode: "write",
      phase: "execute",
    },
    "productivity-skeptic": {
      paths: ["**"],
      mode: "read-only",
      phase: "scout",
    },
  },
  done_when: [
    "exists:.test-fixtures-slice-team/evidence/front.png",
    "handoff:asset-pipeline-lead:done",
    "handoff:xr-systems-architect:done",
  ],
  phases: [
    { id: "scout", parallel: true, roleIds: ["productivity-skeptic"] },
    {
      id: "execute",
      parallel: true,
      roleIds: ["asset-pipeline-lead", "xr-systems-architect"],
    },
    { id: "integrate", parallel: false, roleIds: [] },
  ],
};

describe("slice-team", () => {
  beforeEach(async () => {
    await mkdir(path.join(fixtureRoot, "evidence"), { recursive: true });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("materializes brief from template", () => {
    const brief = materializeBriefFromTemplate(template, "test-slice");
    expect(brief.id).toBe("test-slice");
    expect(brief.templateId).toBe("real-garment-v1");
    expect(brief.roles["asset-pipeline-lead"]?.mode).toBe("write");
  });

  it("builds slim spawn prompt with handoff path", () => {
    const brief = materializeBriefFromTemplate(template, "test-slice");
    const prompt = buildSliceTeamSpawnPrompt({
      repoRoot: "/repo",
      roleId: "asset-pipeline-lead",
      roleDir: "agents/core/asset-pipeline-lead",
      brief,
      assignment: brief.roles["asset-pipeline-lead"]!,
      phase: "execute",
    });
    expect(prompt).toContain("test-slice");
    expect(prompt).toContain(sliceHandoffPath("test-slice", "asset-pipeline-lead"));
    expect(prompt).not.toContain("PROJECT_COORDINATION_INDEX");
    expect(prompt).toContain("Do not edit PROJECT_STATUS.md");
  });

  it("buildSliceTeamSpawnPrompt includes PATH SCOPE for known role", () => {
    const brief = materializeBriefFromTemplate(template, "test-slice");
    const prompt = buildSliceTeamSpawnPrompt({
      repoRoot: "/repo",
      roleId: "xr-systems-architect",
      roleDir: "agents/core/xr-systems-architect",
      brief,
      assignment: brief.roles["xr-systems-architect"]!,
      phase: "execute",
    });
    expect(prompt).toContain("PATH SCOPE");
    expect(prompt).toContain("Write roots");
    expect(prompt).toContain("ISOLATION: parent MUST spawn with isolation=worktree");
    expect(prompt).toContain("Preferred CLI:");
  });

  it("constrainPathsToWriteRoots strips out-of-scope paths for xr-systems-architect", () => {
    const result = constrainPathsToWriteRoots("xr-systems-architect", [
      "packages/openclinxr/arena/**",
      "apps/api/**",
      "apps/ui-xr/**",
    ]);
    expect(result.paths).toContain("packages/openclinxr/arena/**");
    expect(result.paths).toContain("apps/ui-xr/**");
    expect(result.paths).not.toContain("apps/api/**");
    expect(result.warnings.some((w) => w.includes("apps/api/**"))).toBe(true);
  });

  it("constrainPathsToWriteRoots defaults to writeRoots when all paths stripped", () => {
    const result = constrainPathsToWriteRoots("xr-systems-architect", ["apps/api/**", "packages/data-mongodb/**"]);
    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths.every((p) => !p.includes("apps/api"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("defaulted to writeRoots"))).toBe(true);
  });

  it("constrainPathsToWriteRoots keeps .openclinxr/slices/** paths", () => {
    const result = constrainPathsToWriteRoots("xr-systems-architect", [
      ".openclinxr/slices/foo/handoffs/xr-systems-architect.json",
      "apps/api/**",
    ]);
    expect(result.paths).toContain(".openclinxr/slices/foo/handoffs/xr-systems-architect.json");
    expect(result.paths).not.toContain("apps/api/**");
  });

  it("builds parallel execute phase spawn report", () => {
    const brief = materializeBriefFromTemplate(template, "test-slice");
    const report = buildTeamSpawnReport({
      repoRoot: "/Volumes/files/src/openclinxr",
      brief,
      template,
      phase: "execute",
      roleDirs: {
        "asset-pipeline-lead": "agents/core/asset-pipeline-lead",
        "xr-systems-architect": "agents/core/xr-systems-architect",
      },
    });
    expect(report.parallel).toBe(true);
    expect(report.roles).toHaveLength(2);
  });

  it("buildTeamSpawnReport sets isolation worktree for write roles with workspace-write policy", () => {
    const brief = materializeBriefFromTemplate(template, "test-slice");
    const report = buildTeamSpawnReport({
      repoRoot: "/Volumes/files/src/openclinxr",
      brief,
      template,
      phase: "execute",
      roleDirs: {
        "asset-pipeline-lead": "agents/core/asset-pipeline-lead",
        "xr-systems-architect": "agents/core/xr-systems-architect",
      },
    });
    const xr = report.roles.find((r) => r.roleId === "xr-systems-architect");
    const asset = report.roles.find((r) => r.roleId === "asset-pipeline-lead");
    expect(xr?.isolation).toBe("worktree");
    expect(asset?.isolation).toBe("worktree");
    expect(xr?.pathScopeWriteRoots?.length).toBeGreaterThan(0);
    expect(xr?.spawnPrompt).toContain("PATH SCOPE");
    // asset-pipeline assignment path tools/openclinxr/factory/** is outside writeRoots → warning + default
    expect(asset?.pathWarnings?.length).toBeGreaterThan(0);
    // Wave A: parentChecklist on team-spawn roles
    expect(xr?.parentChecklist?.mustPassIsolationToHarness).toBe(true);
    expect(asset?.parentChecklist?.mustPassIsolationToHarness).toBe(true);
    expect(xr?.parentChecklist?.isolation).toBe("worktree");
  });

  it("buildTeamSpawnReport sets isolation none for read-only scout roles", () => {
    const brief = materializeBriefFromTemplate(template, "test-slice");
    const report = buildTeamSpawnReport({
      repoRoot: "/Volumes/files/src/openclinxr",
      brief,
      template,
      phase: "scout",
      roleDirs: {
        "productivity-skeptic": "agents/adversarial/productivity-skeptic",
      },
    });
    expect(report.roles).toHaveLength(1);
    expect(report.roles[0]?.isolation).toBe("none");
    expect(report.roles[0]?.parentChecklist?.mustPassIsolationToHarness).toBe(false);
  });

  it("verifies done_when rules", async () => {
    const brief: SliceBrief = materializeBriefFromTemplate(template, "test-slice");
    await writeFile(path.join(fixtureRoot, "evidence", "front.png"), "png-bytes");

    const handoffs: Record<string, SliceHandoff | null> = {
      "asset-pipeline-lead": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "asset-pipeline-lead",
        sliceId: "test-slice",
        status: "done",
        touched: ["tools/openclinxr/asset-pipeline/automate_blender.py:1050"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
      "xr-systems-architect": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "xr-systems-architect",
        sliceId: "test-slice",
        status: "done",
        touched: ["packages/openclinxr/arena/runtime.ts"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };

    const report = await verifySliceBrief({
      repoRoot: process.cwd(),
      brief,
      handoffs,
    });
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it("audits path-scope: handoff touched inside writeRoots passes", () => {
    const handoffs: Record<string, SliceHandoff | null> = {
      "asset-pipeline-lead": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "asset-pipeline-lead",
        sliceId: "test-slice",
        status: "done",
        touched: ["tools/openclinxr/asset-pipeline/generate.py"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
      "xr-systems-architect": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "xr-systems-architect",
        sliceId: "test-slice",
        status: "done",
        touched: ["packages/openclinxr/arena/runtime.ts"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };
    const checks = auditHandoffsPathScope(handoffs);
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(checks.every((c) => c.passed)).toBe(true);
    for (const c of checks) {
      expect(c.rule).toMatch(/^path-scope:/);
    }
  });

  it("audits path-scope: handoff touched outside writeRoots fails", () => {
    const handoffs: Record<string, SliceHandoff | null> = {
      "xr-systems-architect": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "xr-systems-architect",
        sliceId: "test-slice",
        status: "done",
        touched: ["apps/api/src/index.ts"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };
    const checks = auditHandoffsPathScope(handoffs);
    expect(checks.length).toBeGreaterThanOrEqual(1);
    const pathScopeCheck = checks.find((c) => c.rule === "path-scope:xr-systems-architect");
    expect(pathScopeCheck).toBeDefined();
    expect(pathScopeCheck!.passed).toBe(false);
    expect(pathScopeCheck!.detail).toContain("violations");
  });

  it("audits path-scope: empty touched skips", () => {
    const handoffs: Record<string, SliceHandoff | null> = {
      "productivity-skeptic": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "productivity-skeptic",
        sliceId: "test-slice",
        status: "done",
        touched: [],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };
    const checks = auditHandoffsPathScope(handoffs);
    expect(checks).toEqual([]);
  });

  it("audits path-scope: unknown role without policy skips", () => {
    const handoffs: Record<string, SliceHandoff | null> = {
      "unknown-role": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "unknown-role",
        sliceId: "test-slice",
        status: "done",
        touched: ["some/file.ts"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };
    const checks = auditHandoffsPathScope(handoffs);
    expect(checks).toEqual([]);
  });

  it("verifySliceBrief includes path-scope checks and fails on violations", async () => {
    const brief: SliceBrief = materializeBriefFromTemplate(template, "test-slice");
    const handoffs: Record<string, SliceHandoff | null> = {
      "xr-systems-architect": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "xr-systems-architect",
        sliceId: "test-slice",
        status: "done",
        touched: ["apps/api/src/routes.ts"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };
    const report = await verifySliceBrief({
      repoRoot: process.cwd(),
      brief,
      handoffs,
    });
    const pathScopeChecks = report.checks.filter((c) => c.rule.startsWith("path-scope:"));
    expect(pathScopeChecks.length).toBeGreaterThan(0);
    // xr-systems-architect touched apps/api/** which is forbidden → path-scope fails
    expect(report.ok).toBe(false);
  });

  it("strips line suffix from touched paths for glob matching", () => {
    const handoffs: Record<string, SliceHandoff | null> = {
      "asset-pipeline-lead": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "asset-pipeline-lead",
        sliceId: "test-slice",
        status: "done",
        touched: ["tools/openclinxr/asset-pipeline/generate.py:42"],
        evidence: [],
        blockers: [],
        recommended_next: null,
        updatedAt: new Date().toISOString(),
      },
    };
    const checks = auditHandoffsPathScope(handoffs);
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  describe("sole-author locks", () => {
    it("auditHandoffsSoleAuthorLocks passes when no violations", () => {
      const handoffs: Record<string, SliceHandoff | null> = {
        "asset-pipeline-lead": {
          schemaVersion: "openclinxr.slice-handoff.v1",
          role: "asset-pipeline-lead",
          sliceId: "test-slice",
          status: "done",
          touched: ["tools/openclinxr/asset-pipeline/generate.py"],
          evidence: [],
          blockers: [],
          recommended_next: null,
          updatedAt: new Date().toISOString(),
        },
      };
      const checks = auditHandoffsSoleAuthorLocks(handoffs);
      expect(checks.length).toBeGreaterThanOrEqual(1);
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("auditHandoffsSoleAuthorLocks fails when role touches locked path", () => {
      const handoffs: Record<string, SliceHandoff | null> = {
        "asset-pipeline-lead": {
          schemaVersion: "openclinxr.slice-handoff.v1",
          role: "asset-pipeline-lead",
          sliceId: "test-slice",
          status: "done",
          touched: ["docs/agent-ops/roster-review.md"],
          evidence: [],
          blockers: [],
          recommended_next: null,
          updatedAt: new Date().toISOString(),
        },
      };
      const checks = auditHandoffsSoleAuthorLocks(handoffs);
      const violations = checks.filter((c) => c.rule.startsWith("sole-author:agent-roster"));
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations.every((c) => !c.passed)).toBe(true);
      expect(violations[0]!.detail).toContain("locked by hrbp");
    });

    it("auditHandoffsSoleAuthorLocks passes when hrbp touches its own locked path", () => {
      const handoffs: Record<string, SliceHandoff | null> = {
        hrbp: {
          schemaVersion: "openclinxr.slice-handoff.v1",
          role: "hrbp",
          sliceId: "test-slice",
          status: "done",
          touched: ["docs/agent-ops/roster-review.md"],
          evidence: [],
          blockers: [],
          recommended_next: null,
          updatedAt: new Date().toISOString(),
        },
      };
      const checks = auditHandoffsSoleAuthorLocks(handoffs);
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("verifySliceBrief includes sole-author checks and fails on violation", async () => {
      const brief: SliceBrief = materializeBriefFromTemplate(template, "test-slice");
      const handoffs: Record<string, SliceHandoff | null> = {
        "xr-systems-architect": {
          schemaVersion: "openclinxr.slice-handoff.v1",
          role: "xr-systems-architect",
          sliceId: "test-slice",
          status: "done",
          touched: ["docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md"],
          evidence: [],
          blockers: [],
          recommended_next: null,
          updatedAt: new Date().toISOString(),
        },
      };
      const report = await verifySliceBrief({
        repoRoot: process.cwd(),
        brief,
        handoffs,
      });
      const soleAuthorChecks = report.checks.filter((c) =>
        c.rule.startsWith("sole-author:"),
      );
      expect(soleAuthorChecks.length).toBeGreaterThan(0);
      // At least one sole-author violation should fail
      const failing = soleAuthorChecks.filter((c) => !c.passed);
      expect(failing.length).toBeGreaterThan(0);
      expect(report.ok).toBe(false);
    });
  });
});