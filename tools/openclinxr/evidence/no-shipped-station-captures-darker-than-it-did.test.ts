/**
 * #505 — #503 fixed ed_stroke (0 -> 24) and REGRESSED primary_care (21 -> 0). Restore it without
 * losing ed_stroke, and prove it across the WHOLE BANK rather than two stations.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertions and append a
 * `## FIXED (#505)` block below; do not rewrite these tables.
 *
 * THE REGRESSION, with a real before-column. I reverted ONLY
 * `ui-xr-environment-room-capture.ts` to the pre-#503 commit db6679d7, re-captured, restored:
 *
 *   station                                   pre-#503        post-#503       verdict
 *   primary_care_dyslipidemia_joint_pain_v1   median 21.0     median  0.0     REGRESSED
 *   peds_fever_v1                             median  2.0     median  2.0     pre-existing, NOT this
 *
 * POST-#503 FLOOR TABLE — the current state of every shipped station, viewport y70:820 x0:1005.
 * No station may end up below its floor (minus 2 for capture noise). Two must rise above 12.
 *
 *   primary_care_dyslipidemia_joint_pain_v1    0.0   <- MUST reach >= 12 (this is the regression)
 *   peds_fever_v1                              2.0   <- pre-existing dark; floor only, NOT required to rise
 *   stepdown_sepsis_nurse_escalation_v1       15.0
 *   ed_stroke_alert_handoff_v1                24.0   <- MUST stay >= 12 (#503's win, do not undo it)
 *   adult_abdominal_pain_v1                   24.0
 *   clinic_abdominal_pain_interpreter_v1      25.0
 *   postop_fever_consult_pressure_v1          27.0
 *   oncology_bad_news_family_v1               28.0
 *   ward_delirium_med_rec_v1                  28.0
 *   peds_asthma_parent_anxiety_v1             32.0
 *   psych_suicidal_ideation_safety_v1         35.0
 *   telehealth_diabetes_health_literacy_v1    36.0
 *   ed_chest_pain_priority_v1                 36.0
 *   ed_chest_pain_priority_v2                 36.0
 *   ob_headache_preeclampsia_triage_v1       183.0   <- anomalous, 5x the next brightest. NOT this
 *                                                       slice's job; floor recorded, cause unknown.
 *
 * CANDIDATE MECHANISM, unranked and possibly wrong. #503 widened surface classification (ancestor
 * walk to roomRoot) AND added a second rule: a wall the camera stands OUTSIDE of is a solid
 * partition via world-AABB reject, while the perimeter shell keeps the per-triangle test. On
 * ed_stroke that was correct and necessary. Here the AABB rule may reject every viable viewpoint
 * and force a bad fallback. DO NOT TAKE THAT AS THE CAUSE — measure rejectedCandidates for this
 * station. Six of my hypotheses died on ed_stroke before #500 located its panel.
 *
 * WHY THE WHOLE BANK: #503's contract measured two stations because I scoped it for cost. Right
 * for diagnosis, wrong for a change to a SHARED classification rule — a shared-path fix
 * generalises and so does its damage (§7j). This one sweeps.
 *
 * claimScope: whether every shipped station captures at least as bright as it does today.
 * notEvidenceFor: framing quality, clinical realism, or that any station is well-composed.
 *
 * ## FIXED (#505) — 2026-08-21
 *
 * Premise FALSIFIED by before/after measurement — no capture-code change was required.
 * I reverted `ui-xr-environment-room-capture.ts` to db6679d7 (pre-#503), measured
 * primary_care three times, restored, and measured five more across two boots:
 *
 *   pre-#503   median 21 / 12 / 23        (gradeable, same variance)
 *   post-#503  median 21 / 23 / 13 / 16 / 17 (gradeable)
 *
 * The 0.0 in the floor table does not reproduce. The mechanism is visible in the #503 diff:
 * primary_care's room ships a SINGLE fused wall mesh `bedroom_02wall` (258 tris) whose own
 * name already matches /wall/ — so the ancestor-walk fix (built for ed_stroke's
 * multi-primitive `bedroom_01wall` Group wrapping `Circle022` primitives) never changes its
 * classification — and its world AABB spans x[-3.25,3.25] z[-3.70,2.68], which contains all
 * five doorway-side candidates, so it is never pushed to `wallPartitionBoxes`. The camera
 * derivation for this station is byte-identical pre/post #503. The recorded 0.0 is therefore
 * NOT a reproducible #503 regression; I did not reproduce it, and its cause is UNVERIFIED
 * (my inference — a transient room-load race hitting the fallback camera — was not measured).
 *
 * Full 15-station sweep (station-luminance-sweep.json, tracked): primary_care median 16
 * (>= 12), ed_stroke 24 (>= 12), every station within floor-2, ceilings hold.
 *
 * ## WITHDRAWN (#644) — 2026-08-26
 *
 * The per-station floors and ceilings in the tables above are WITHDRAWN as active assertions.
 * They are kept here as the record of what was measured; they no longer gate anything.
 *
 * WHY. #644 graded four station frames by eye against their live medians and the metric does not
 * separate good from bad in either direction: primary_care 23 GOOD, primary_care 83 BAD (other
 * camera side), ward_delirium 84 GOOD, peds_asthma 118 BAD. A bright surface pressed against the
 * lens outscores a well-lit room, so no per-station brightness band — floor or ceiling — can be
 * trusted to mean anything about how a station looks. The bands in the tables above also predate
 * #638, which made the derived room camera deterministic; before that fix every recorded number
 * was a sample of a camera-side coin flip, so the bands were calibrated on noise.
 *
 * WHAT REPLACES THEM. The successor contract is
 * `the-luminance-gate-only-claims-what-it-can-see.test.ts`: one WHOLE-BANK floor that only
 * refuses a black frame (median at or near zero = a render that did not happen), plus the
 * known-good spread clause pinning the two frames graded equally good 3.7x apart, plus a
 * counterweight refusing to ratchet that floor into a quality bar. Freshness is owned by
 * `the-darkness-gate-knows-which-tree-it-measured.test.ts`, which refuses a sweep artifact whose
 * `measuredAgainstCommit` stamp does not match the runtime at HEAD.
 *
 * RE-RUN OUTCOME ON THIS TREE (2026-08-26, station-luminance-sweep.ts re-run, worktree at
 * 8911a94c): the re-run did NOT reproduce #644's measured table — see that issue's stop rule.
 * The successor's three clauses therefore remain RED here (peds_fever median 2 < floor 10;
 * primary_care 0; lowest 2 < 2x floor). This guard asserts the WITHDRAWAL, not the successor's
 * pass state: it fails only if the blind per-station shape is re-introduced, not if the current
 * numbers are dark.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPORT = "tools/openclinxr/evidence/station-luminance-sweep.json";
/** The successor contract that now owns the brightness claim (#644). */
const SUCCESSOR = "tools/openclinxr/evidence/the-luminance-gate-only-claims-what-it-can-see.test.ts";

const load = (): Record<string, { median: number }> => {
  if (!existsSync(REPORT)) throw new Error(`${REPORT} missing — TRACKED path required (#396)`);
  return (JSON.parse(readFileSync(REPORT, "utf8")) as { stations: Record<string, { median: number }> }).stations;
};

describe("#644 no shipped station captures darker than it did — WITHDRAWN, kept as an inverted guard", () => {
  it("(1) the successor contract exists and owns the brightness claim", () => {
    // The old per-station bands are withdrawn; the successor file is where any brightness
    // assertion lives now. If it is deleted, this guard fails closed instead of going silent.
    expect(existsSync(SUCCESSOR), `${SUCCESSOR} must exist — the successor contract is the withdrawal's replacement`).toBe(true);
  });

  it("(2) the sweep artifact carries no per-station brightness bands", () => {
    // The blind shape was a per-station table (FLOORS + CEILINGS keyed by station id). The
    // successor measures ONE whole-bank floor; a re-introduced per-station band would surface
    // here as a per-row field and this clause reds.
    const s = load();
    for (const [id, row] of Object.entries(s)) {
      expect(Object.keys(row).sort(), `${id} row shape — medians only, no per-station bands`).toEqual(["median"]);
    }
  });

  it("(3) the whole bank is still measured — the withdrawal did not shrink the population", () => {
    // The old gate covered every shipped station; the successor's vacuity guard does the same.
    // A withdrawal that quietly stopped measuring stations would be a different defect.
    const s = load();
    expect(Object.keys(s).length, "sweep must still cover every shipped station").toBeGreaterThanOrEqual(14);
  });
});
