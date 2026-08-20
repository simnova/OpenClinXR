import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#368, remaining half), REWIRED FOR #466. The face-detail capture could not
 * tell anyone whether its in-page reframe actually found the patient mesh, so no face-framed
 * capture could evidence a face.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════
 * #466 — THE TEST RAN THE CAPTURE INSTEAD OF READING ITS ARTIFACT
 *
 * The original shape imported the capture module and invoked it inside `beforeAll`, booting a
 * portless dev server, driving a ~37 s live encounter, and — worse — rewriting the two TRACKED
 * summaries that #464/#465 landed (`parent-drives-a-real-viseme.json`,
 * `reframe-subject-in-frame.json`). A test whose green depends on a file it wrote itself is not
 * evidence (§7s), and it flipped `2 failed | 2 passed` to `4 passed` on the same commit.
 *
 * The capture module writing those tracked summaries is CORRECT and DELIBERATE — `.openclinxr/**`
 * is gitignored and has no land path (#396), so the tracked summaries ARE the land path.
 * `pnpm asset:ui-xr:viseme-drive-capture` is the step that *produces* evidence and may take as
 * long as it needs; a *test* is the step that *reads* it (§7b: measure once into an artifact,
 * assert against the artifact).
 *
 * THE REWIRE: the four clauses below read the two TRACKED summaries the capture derives (same
 * pattern as the #464/#465 contracts), instead of running the capture and reading the gitignored
 * `inspection.json`. The input moved; what each clause checks is preserved:
 *   (1) the reframe outcome is recorded — target mesh, world position, success status — not a
 *       hardcoded framing string;
 *   (2) COUNTERWEIGHT — the mesh the reframe framed equals the mesh the viseme sampler read, two
 *       independently derived names in two files, so a hardcoded literal cannot satisfy both;
 *   (3) VACUITY — the summary carries real viseme samples, so a crashed/empty capture fails
 *       loudly instead of passing on an empty object;
 *   (4) the actor label is derived from the live scene, not the stale Anny literal.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PARENT_SUMMARY = join(HERE, "parent-drives-a-real-viseme.json");
const REFRAME_SUMMARY = join(HERE, "reframe-subject-in-frame.json");

type ParentSummary = {
  /** Live source the rows came from — a path or command, not a claim. */
  capturedFrom: string;
  /** The mesh actually sampled, read from the live scene. */
  meshName: string;
  actor: string;
  samples: { drivenTargetName: string; influence: number }[];
};

type ReframeSummary = {
  capturedFrom: string;
  reframe: {
    status: string;
    targetMeshName: string | null;
    headNdc?: { x: number; y: number };
    subjectInFrame?: boolean;
    headWorldY?: number;
    aimWorldY?: number;
  };
  visemeInstants: { targetName: string; framePath: string | null }[];
};

const parentSummary: ParentSummary | null = existsSync(PARENT_SUMMARY)
  ? (JSON.parse(readFileSync(PARENT_SUMMARY, "utf8")) as ParentSummary)
  : null;

const reframeSummary: ReframeSummary | null = existsSync(REFRAME_SUMMARY)
  ? (JSON.parse(readFileSync(REFRAME_SUMMARY, "utf8")) as ReframeSummary)
  : null;

function requireParent(): ParentSummary {
  expect(
    parentSummary,
    `tools/openclinxr/evidence/parent-drives-a-real-viseme.json must exist — a TRACKED summary `
      + `derived from pnpm asset:ui-xr:viseme-drive-capture. The capture's own inspection.json is `
      + `gitignored and has no land path (#396).`,
  ).not.toBeNull();
  return parentSummary as ParentSummary;
}

function requireReframe(): ReframeSummary {
  expect(
    reframeSummary,
    `tools/openclinxr/evidence/reframe-subject-in-frame.json must exist — a TRACKED summary from a `
      + `live capture. The capture's own inspection.json is gitignored (#396).`,
  ).not.toBeNull();
  return reframeSummary as ReframeSummary;
}

describe("the capture records what it framed (#368 remaining half, read-only)", () => {
  it("(1) the artifact records the reframe outcome — the framed mesh and its world position", () => {
    const reframe = requireReframe().reframe;
    expect(
      reframe,
      "reframe outcome is not recorded — framing was the hardcoded string written whether or not the reframe found anything",
    ).toBeTruthy();
    expect(
      reframe.status,
      "the reframe must have succeeded for this capture to evidence a face",
    ).toBe("ok");
    expect(reframe.targetMeshName ?? "").not.toBe("");
    // The world position is recorded as the geometry-derived head Y and the aim Y (#465), not
    // the mesh-origin literal that framed a wall.
    expect(typeof reframe.headWorldY, "head world Y is a number").toBe("number");
    expect(typeof reframe.aimWorldY, "aim world Y is a number").toBe("number");
    expect(typeof reframe.headNdc?.x, "projected head x is a number").toBe("number");
    expect(typeof reframe.headNdc?.y, "projected head y is a number").toBe("number");
  });

  it("(2) COUNTERWEIGHT: the recorded target mesh equals the mesh the viseme sampler read", () => {
    const reframe = requireReframe().reframe;
    const parent = requireParent();
    expect(
      parent.meshName,
      "the sampler summary has no mesh name — a capture that read nothing cannot be evidence",
    ).not.toBe("");
    expect(
      reframe.targetMeshName,
      "reframe target and sampler meshName are derived independently (one from the reframe traversal, one from the viseme sampler) — a hardcoded literal cannot satisfy both",
    ).toBe(parent.meshName);
  });

  it("(3) VACUITY GUARD: the summary carries real viseme samples with non-empty names", () => {
    const parent = requireParent();
    expect(
      parent.samples.length,
      `a crashed or empty run must fail loudly; got ${parent.samples.length} samples`,
    ).toBeGreaterThanOrEqual(1);
    expect(parent.samples[0].drivenTargetName).not.toBe("");
    expect(
      parent.samples.every((s) => /^viseme_/iu.test(s.drivenTargetName) && s.influence > 0),
      "every sampled entry must be a weighted viseme_* drive, not an empty or FACS alias",
    ).toBe(true);
  });

  it("(4) the actor label is derived from the live scene, not the stale Anny literal", () => {
    const parent = requireParent();
    expect(parent.actor, "the summary names the actor it framed").not.toBe("");
    expect(
      parent.actor,
      "the stale hardcoded Anny label must not survive — the actor comes from userData.openClinXrActorId, not a typed string",
    ).not.toContain("Anny base in the peds station");
    expect(
      parent.capturedFrom,
      "the actor label must name the live capture source it was derived from",
    ).toContain("inspection.json");
  });
});
