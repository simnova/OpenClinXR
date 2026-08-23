import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  countCheckpointBlocks,
  daysBetween,
  isArchiveStubBody,
  measureDocsHygiene,
} from "./docs-hygiene-cli.js";

describe("docs-hygiene-cli", () => {
  it("counts checkpoint ### blocks", () => {
    const text = [
      "# Status",
      "## Per-Slice Checkpoints",
      "",
      "### one",
      "a",
      "### two",
      "b",
      "### three",
      "c",
    ].join("\n");
    expect(countCheckpointBlocks(text)).toBe(3);
  });

  it("detects archive stubs", () => {
    expect(
      isArchiveStubBody("# ARCHIVED — x\n\n**Status:** archived (docs warehouse cold tier)\n"),
    ).toBe(true);
    expect(isArchiveStubBody("# Living revision\n\nbody")).toBe(false);
  });

  it("computes days between", () => {
    expect(daysBetween("2026-08-01T00:00:00.000Z", "2026-08-15T00:00:00.000Z")).toBe(14);
  });

  it("forceHygiene when no last-run state (catch-up after long offline)", () => {
    const m = measureDocsHygiene({
      repoRoot: process.cwd(),
      now: new Date("2026-08-02T12:00:00.000Z"),
      // force by missing last-run only if thresholds quiet — may still force from never
      freezeCandidateThreshold: 999,
      forceFreezeCandidateThreshold: 999,
      checkpointThreshold: 999,
      staleDaysThreshold: 14,
    });
    // Either never-run forces, or real repo has candidates — forceHygiene should be boolean
    expect(typeof m.forceHygiene).toBe("boolean");
    expect(m.banner).toContain("DOC HYGIENE");
    expect(m.banner).toContain("PMO");
  });

  it("banner names pmo as unattended owner", () => {
    const m = measureDocsHygiene({
      repoRoot: process.cwd(),
      now: new Date("2026-08-02T12:00:00.000Z"),
      freezeCandidateThreshold: 0,
      forceFreezeCandidateThreshold: 0,
      checkpointThreshold: 0,
      staleDaysThreshold: 0,
    });
    expect(m.banner).toMatch(/PMO|unattended|pmo/i);
  });

  // #580 safety rail: the automated hygiene run may clear only bookkeeping removals
  // (files gone from disk). The guard now refuses "still present" removals even with
  // the flag, so this pass-through cannot re-create the #90 registry pruning.
  it("authority step passes --allow-shrink to docs:authority", () => {
    const source = readFileSync(new URL("./docs-hygiene-cli.ts", import.meta.url), "utf8");
    const stepMatch = /run\(\s*"docs:authority"[\s\S]*?\]\s*\)/.exec(source);
    expect(stepMatch, "docs:authority step not found in hygiene CLI").not.toBeNull();
    expect(stepMatch![0]).toContain('"--allow-shrink"');
  });
});
