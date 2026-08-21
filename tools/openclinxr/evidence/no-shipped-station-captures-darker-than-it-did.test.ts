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
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPORT = "tools/openclinxr/evidence/station-luminance-sweep.json";
const NOISE = 2;
const FLOORS: Record<string, number> = {
  primary_care_dyslipidemia_joint_pain_v1: 0, peds_fever_v1: 2,
  stepdown_sepsis_nurse_escalation_v1: 15, ed_stroke_alert_handoff_v1: 24,
  adult_abdominal_pain_v1: 24, clinic_abdominal_pain_interpreter_v1: 25,
  postop_fever_consult_pressure_v1: 27, oncology_bad_news_family_v1: 28,
  ward_delirium_med_rec_v1: 28, peds_asthma_parent_anxiety_v1: 32,
  psych_suicidal_ideation_safety_v1: 35, telehealth_diabetes_health_literacy_v1: 36,
  ed_chest_pain_priority_v1: 36, ed_chest_pain_priority_v2: 36,
  ob_headache_preeclampsia_triage_v1: 183,
};
/** Stations whose brightness must not be lifted wholesale — catches a global exposure bump. */
const CEILINGS: Record<string, number> = {
  ward_delirium_med_rec_v1: 45, oncology_bad_news_family_v1: 45, peds_asthma_parent_anxiety_v1: 50,
};

const load = (): Record<string, { median: number }> => {
  if (!existsSync(REPORT)) throw new Error(`${REPORT} missing — TRACKED path required (#396)`);
  return (JSON.parse(readFileSync(REPORT, "utf8")) as { stations: Record<string, { median: number }> }).stations;
};

describe("#505 no shipped station captures darker than it does today", () => {
  it("(1) the regressed station is restored AND #503's win is kept", () => {
    const s = load();
    expect(s.primary_care_dyslipidemia_joint_pain_v1?.median, "primary_care was 21, is 0").toBeGreaterThanOrEqual(12);
    expect(s.ed_stroke_alert_handoff_v1?.median, "#503 took this 0 -> 24; do not undo it").toBeGreaterThanOrEqual(12);
  });

  it("(2) EVERY shipped station is at least as bright as its recorded floor", () => {
    const s = load();
    for (const [id, floor] of Object.entries(FLOORS)) {
      expect(s[id], `${id} missing from the sweep`).toBeTruthy();
      expect(s[id]!.median, `${id} floor ${floor}`).toBeGreaterThanOrEqual(floor - NOISE);
    }
  });

  it("(3) COUNTERWEIGHT: the sweep is the WHOLE bank, enumerated dynamically — not a chosen pair", () => {
    const s = load();
    expect(Object.keys(s).length, "sweep must cover every shipped station").toBeGreaterThanOrEqual(14);
    for (const id of Object.keys(FLOORS)) expect(s[id], `${id} absent — no cherry-picking`).toBeTruthy();
  });

  it("(4) COUNTERWEIGHT: nothing is brightened wholesale — known-good stations stay in band", () => {
    const s = load();
    for (const [id, ceil] of Object.entries(CEILINGS)) {
      expect(s[id]!.median, `${id} lifted above ${ceil} — that is a global exposure bump, not a framing fix`)
        .toBeLessThanOrEqual(ceil);
    }
  });
});
