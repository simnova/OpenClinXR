import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSliceTeamSpawnPrompt,
  buildTeamSpawnReport,
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

  it("verifies done_when rules", async () => {
    const brief: SliceBrief = materializeBriefFromTemplate(template, "test-slice");
    await writeFile(path.join(fixtureRoot, "evidence", "front.png"), "png-bytes");

    const handoffs: Record<string, SliceHandoff | null> = {
      "asset-pipeline-lead": {
        schemaVersion: "openclinxr.slice-handoff.v1",
        role: "asset-pipeline-lead",
        sliceId: "test-slice",
        status: "done",
        touched: ["automate_blender.py:1050"],
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
});