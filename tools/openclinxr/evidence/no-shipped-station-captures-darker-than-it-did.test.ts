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
  it.fails("(1) the regressed station is restored AND #503's win is kept", () => {
    const s = load();
    expect(s.primary_care_dyslipidemia_joint_pain_v1?.median, "primary_care was 21, is 0").toBeGreaterThanOrEqual(12);
    expect(s.ed_stroke_alert_handoff_v1?.median, "#503 took this 0 -> 24; do not undo it").toBeGreaterThanOrEqual(12);
  });

  it.fails("(2) EVERY shipped station is at least as bright as its recorded floor", () => {
    const s = load();
    for (const [id, floor] of Object.entries(FLOORS)) {
      expect(s[id], `${id} missing from the sweep`).toBeTruthy();
      expect(s[id]!.median, `${id} floor ${floor}`).toBeGreaterThanOrEqual(floor - NOISE);
    }
  });

  it.fails("(3) COUNTERWEIGHT: the sweep is the WHOLE bank, enumerated dynamically — not a chosen pair", () => {
    const s = load();
    expect(Object.keys(s).length, "sweep must cover every shipped station").toBeGreaterThanOrEqual(14);
    for (const id of Object.keys(FLOORS)) expect(s[id], `${id} absent — no cherry-picking`).toBeTruthy();
  });

  it.fails("(4) COUNTERWEIGHT: nothing is brightened wholesale — known-good stations stay in band", () => {
    const s = load();
    for (const [id, ceil] of Object.entries(CEILINGS)) {
      expect(s[id]!.median, `${id} lifted above ${ceil} — that is a global exposure bump, not a framing fix`)
        .toBeLessThanOrEqual(ceil);
    }
  });
});
