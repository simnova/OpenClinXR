import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#365) — visemes resolve 9/9 on paper and nobody has ever watched a mouth move.
 *
 * THE CHAIN IS COMPLETE AND UNVERIFIED IN MOTION. Measured 2026-08-13 11:15 on main: all three
 * shipped actors (ob-patient-aisha, peds-nurse-kevin, peds-patient-child) resolve 9/9 visemes
 * through the real runtime resolver with 8 distinct shapes, and the drive chain is wired
 * (main.ts:8889 — phonemes → driveVisemeTimeline → applyVisemeWeights). Gaze looked exactly like
 * this at 08:20 and turned out to hide a live defect (#362): 1 of 3 case literals resolved to a
 * silent null. This is the same gap check for the mouth.
 *
 * THE CAPTURE TOOL EXISTED AND COULD NOT RUN. At 11:40 the tool crashed before a single frame:
 * `page.evaluate: ReferenceError: __name is not defined`. tsx/esbuild's keepNames transform wraps
 * named const arrows inside evaluate callbacks (`isRecord`, `hasPositionApi`) in a `__name` helper
 * that does not exist in the browser page. PROTO_VERIFY_DELEGATION §6k recorded the fix from the
 * #72 retro: pass the evaluate body as a STRING IIFE. Applied; the tool now runs.
 *
 * MEASURED AFTER THE CRASH FIX (live scene probe, peds_asthma_parent_anxiety_v1):
 *   - The peds patient renders as the Anny `peds_patient_child` base — 9 viseme_* morphs, driven
 *     to weight 1.0 by the named drive (viseme_E, viseme_AA, viseme_OH, viseme_L, viseme_FV,
 *     viseme_silence all observed at 1.0).
 *   - The parent/nurse are MPFB FACS bodies (hm08) driven through the #353 alias map —
 *     `mouth-protusion` and `mouth-compression` observed at 1.0 — so an MPFB mouth DOES move in
 *     this station; it is just not the framed subject.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════
 * #467 — THE TEST RAN THE CAPTURE INSTEAD OF READING ITS ARTIFACT
 *
 * The original shape imported the capture module and invoked it inside `beforeAll`, booting a
 * portless dev server (~37 s), driving a live encounter, and — worse — rewriting the two TRACKED
 * summaries that #464/#465 landed (`parent-drives-a-real-viseme.json`,
 * `reframe-subject-in-frame.json`). A test whose green depends on a file it wrote itself is not
 * evidence (§7s). This is the second instance of #466, which fixed
 * `the-capture-records-what-it-framed.test.ts` the same way.
 *
 * The capture module writing those tracked summaries is CORRECT and DELIBERATE — `.openclinxr/**`
 * is gitignored and has no land path (#396), so the tracked summaries ARE the land path.
 * `pnpm asset:ui-xr:viseme-drive-capture` is the step that *produces* evidence and may take as
 * long as it needs; a *test* is the step that *reads* it (§7b: measure once into an artifact,
 * assert against the artifact).
 *
 * THE REWIRE: the four clauses below read the two TRACKED summaries the capture derives (same
 * pattern as #464/#465/#466), instead of running the capture and reading the gitignored
 * `inspection.json`. The input moved; what each clause checks is preserved:
 *   (1) the dominant viseme still must take ≥5 distinct mouth shapes — the bar is UNCHANGED and
 *       is legitimately RED, because the tracked summaries carry four (viseme_sil, viseme_aa,
 *       viseme_TH, viseme_E). Why only four is the "twelve of fifteen unobserved at runtime"
 *       coverage question, which is out of scope for this slice and not solved by lowering the
 *       bar or by manufacturing a fifth shape in the mock dialogue;
 *   (2) VACUITY — both summaries carry real, non-empty viseme evidence, so a crashed/empty run
 *       fails loudly instead of passing on an empty object;
 *   (3) COUNTERWEIGHT a — influence is non-trivial (above the 0.5 floor), so "distinct" is not
 *       float noise;
 *   (4) COUNTERWEIGHT b (#308) — every dominant target is a mouth/lip/jaw morph, never a
 *       brow/eye/cheek target.
 *
 * WHAT THIS CONTRACT PROVES, AND WHAT IT DOES NOT: the runtime drives the patient's mouth through
 * ≥5 distinct morph shapes at non-trivial weight, and every dominant shape is a mouth/lip/jaw
 * morph (never a brow/eye/cheek target — the #308 failure class). It does NOT say the mouth shapes
 * LOOK right — that is the orchestrator's pixel grade of the captured frames, and possibly a
 * clinician's. claimScope: mouth morph drive. notEvidenceFor: phoneme timing, facial animation
 * quality, clinical affect.
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

/** Mouth/lip/jaw shapes across the Anny (viseme_*) and MPFB FACS (mouth-*) rails. */
const isMouthShape = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("viseme_") ||
    lower.startsWith("mouth") ||
    lower.startsWith("openclinxr_mouth")
  );
};

/** Distinct dominant target names across both tracked summaries (the capture's strong instants). */
const distinctDominantNames = (): string[] => [
  ...new Set([
    ...requireParent().samples.map((s) => s.drivenTargetName),
    ...requireReframe().visemeInstants.map((v) => v.targetName),
  ].filter((name) => name !== "none")),
];

describe("viseme capture produces distinct mouth shapes (#365, read-only)", () => {
  it("the dominant viseme takes ≥5 distinct values (RED — coverage question, bar unchanged)", () => {
    const distinct = distinctDominantNames();
    expect(
      distinct.length,
      `dominant viseme took only ${distinct.length} distinct values: ${distinct.join(", ")} — need ≥5. `
        + `Lowering this bar would erase the coverage question instead of answering it.`,
    ).toBeGreaterThanOrEqual(5);
  });

  it("VACUITY GUARD: both summaries carry real weighted viseme samples", () => {
    const parent = requireParent();
    expect(
      parent.samples.length,
      `a crashed or empty run must fail loudly; got ${parent.samples.length} samples`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      parent.samples.every((s) => /^viseme_/iu.test(s.drivenTargetName) && s.influence > 0),
      "every sampled entry must be a weighted viseme_* drive, not an empty or FACS alias",
    ).toBe(true);
    const instants = requireReframe().visemeInstants;
    expect(
      instants.length,
      `a crashed or empty run must fail loudly; got ${instants.length} viseme instants`,
    ).toBeGreaterThanOrEqual(1);
    expect(instants[0].targetName, "the first viseme instant must name a real target").not.toBe("");
  });

  it("weights are non-trivial: max influence above the floor (COUNTERWEIGHT a)", () => {
    const data = requireParent();
    const maxWeight = Math.max(...data.samples.map((s) => s.influence), 0);
    expect(
      maxWeight,
      "a sequence of near-zero weights is 'distinct' by float noise and is not speech",
    ).toBeGreaterThan(0.5);
  });

  it("every dominant target is a mouth/lip/jaw morph (COUNTERWEIGHT b — #308)", () => {
    const offenders = distinctDominantNames().filter((name) => !isMouthShape(name));
    expect(
      offenders,
      "a resolver returning some name for every request while driving the wrong region",
    ).toHaveLength(0);
  });
});
