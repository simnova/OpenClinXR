import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a full viseme timeline is baked for every case and nothing loads it, so a learner sees
 * a still mouth while the cues sit on disk.
 *
 * MEASURED 2026-08-27 at head 15214830. IMMUTABLE — flip the assertion and append a
 * `## FIXED (#722)` block below; do not rewrite these numbers.
 *
 * THE BAKE HALF IS DONE. `.openclinxr/evidence/issue-288/cases/<scenario>/stage-lip-sync/` holds per
 * utterance a `.aiff`, a `.wav`, a `.mouth-cues.json` and a `lip-sync-manifest.json`. Fifteen
 * mouth-cue files across the case population and NONE is idle. `ed_stroke_alert_handoff_v1` is
 * representative — 25 cues over 3.71 s, distribution `B 9, C 6, A 2, D 2, F 2, X 2, G 1, E 1`,
 * opening `X → A → C → B → C → B`.
 *
 * THE RUNTIME HALF IS WIRED. `viseme-timeline-drive.ts:196` → `viseme-morph-apply.ts:35,59` →
 * `viseme-runtime-wire.ts:285-296`, imported at `main.ts:148`. All 47 morph targets ship on every
 * shipped actor.
 *
 * NOTHING JOINS THEM. Grepping `apps` and `packages` outside tests for `mouth-cues`, `mouthCues`,
 * `lip-sync-manifest` or `lipSyncManifest` returns ZERO hits.
 *
 * ## SEVENTH INSTANCE OF ONE DEFECT CLASS
 *
 * A mechanism lands and "what calls it?" goes unanswered — #699 → #700 → #705 → #707 → #711 traced
 * exactly this through the readiness chain, and #62's docstring records a sixth. Every one of those
 * had a working code path. **A code path is not the evidence this contract wants.** Clause (1) asks
 * for a live run in which distinct viseme values reach named morph targets with non-zero weight,
 * because that is the only thing the previous six could not have produced.
 *
 * ## NOTHING HERE NEEDS ACQUIRING
 *
 * Unlike the gown (no cached asset exists) and texture compression (a dependency decision), every
 * part of this is already on the machine: Rhubarb installed and on PATH, audio baked, cues baked,
 * morphs shipped, applier landed.
 *
 * claimScope: whether a baked viseme timeline reaches morph targets in a running scene.
 * notEvidenceFor: that the mouth LOOKS right — no clause here grades an appearance, and the
 *   orchestrator's pixel grade is the only thing that can; that cue timing matches speech, which
 *   Rhubarb owns and this does not re-measure.
 */

const REPO = join(import.meta.dirname, "../../..");
const CUES = join(REPO, ".openclinxr/evidence/issue-288/cases/ed_stroke_alert_handoff_v1/stage-lip-sync/utterance-6539634edf.mouth-cues.json");
const REPORT = join(REPO, "tools/openclinxr/evidence/viseme-runtime-application.json");
const WIRE = join(REPO, "apps/ui-xr/src/viseme-runtime-wire.ts");

/** The representative timeline, measured at planting. Counterweight (3) pins it. */
const CUE_COUNT = 25;
const DISTINCT_VALUES = 8;

type Applied = { viseme: string; morphTargetName: string; weight: number };
type Report = { scenarioId?: string; applied?: Applied[] };

function reportOrNull(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("the viseme timeline reaches a face (#722)", () => {
  it.fails("(1) a live run applies distinct visemes to named morph targets", () => {
    const report = reportOrNull();
    expect(
      report !== null,
      `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64). Record what a RUNNING scene applied, not what a code path could apply.",
    ).toBe(true);
    const applied = report!.applied ?? [];
    expect(applied.length, "no morph writes recorded from the live run").toBeGreaterThan(0);
    for (const row of applied) {
      expect(
        row.morphTargetName?.length ?? 0,
        "a morph must be named, not indexed — writing morphTargetInfluences[0] is the defect #62 "
          + "landed to remove and it would satisfy a count-only assertion",
      ).toBeGreaterThan(0);
      expect(row.weight, `${row.viseme}: weight must be non-zero`).toBeGreaterThan(0);
    }
    expect(
      new Set(applied.map((r) => r.viseme)).size,
      "one viseme reaching one morph is a wiring smoke test. The timeline carries eight distinct "
        + "values; at least two must reach the face or nothing distinguishes this from a stuck mouth.",
    ).toBeGreaterThanOrEqual(2);
    expect(
      new Set(applied.map((r) => r.morphTargetName)).size,
      "distinct visemes driving the SAME target is exactly the index-0 defect wearing a name",
    ).toBeGreaterThanOrEqual(2);
  });

  it("(2) COUNTERWEIGHT: the wire is used, not bypassed", () => {
    const src = readFileSync(WIRE, "utf8");
    expect(
      /\bapplyVisemeWeights\s*\(/u.test(src),
      "the join must drive the landed applier. A fresh morphTargetInfluences write in main.ts would "
        + "satisfy clause (1) and re-create the defect #62 removed.",
    ).toBe(true);
  });

  /**
   * CORRECTED 2026-08-27, and the correction is mine. The first form asserted the source cue file
   * EXISTS. `.openclinxr/evidence/` is gitignored, so a worker's fresh worktree never has it, and the
   * clause fired on absence rather than on the cheat — #722's first run was killed by this while its
   * own diff never touched that path. That is the #64 rule arriving from the input side: a contract
   * INPUT under a gitignored path is not present in a worktree.
   *
   * The guard itself is unchanged where it can see the file: on main, and against any promoted copy.
   * Regenerating the timeline to suit the consumer still fails. Absence now skips instead of failing.
   */
  it("(3) COUNTERWEIGHT: the baked cues are not regenerated to suit the consumer", () => {
    const promoted = join(REPO, "apps/ui-xr/public/lip-sync-cues/utterance-6539634edf.mouth-cues.json");
    // EVERY copy that exists is checked, not the first one found. Reading only the source would let a
    // regenerated PROMOTED timeline — the one a runtime actually loads — pass unseen on any machine
    // where the gitignored source is present. Probed: it did.
    const paths = [CUES, promoted].filter((p) => existsSync(p));
    if (paths.length === 0) return;
    for (const path of paths) {
      const doc = JSON.parse(readFileSync(path, "utf8")) as { mouthCues?: { value: string }[] };
      const cues = doc.mouthCues ?? [];
      expect(
        cues.length,
        `${path}: rewriting the timeline to fit the consumer measures the fix against its own output; `
          + "these cues came from Rhubarb on baked audio and are the input, not a variable",
      ).toBe(CUE_COUNT);
      expect(new Set(cues.map((c) => c.value)).size, `${path}: distinct viseme values`).toBe(DISTINCT_VALUES);
    }
  });
});

// NOT TESTED: whether the mouth LOOKS right — no clause grades an appearance and the orchestrator's
// pixel grade is the only thing that can. Nor whether cue timing matches the speech, which Rhubarb
// owns. Nor whether the cue files are reachable at runtime from a gitignored evidence path, which may
// need a promote step and is the slice's first real obstacle. Nor whether utterance identity can be
// matched to a dialogue turn, which nothing has established.
