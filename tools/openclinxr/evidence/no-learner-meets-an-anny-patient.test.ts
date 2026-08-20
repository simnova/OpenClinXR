import { describe, expect, it } from "vitest";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import {
  MPFB_GOWN_ADULT_PATIENT_GLB,
} from "../../../packages/openclinxr/asset-registry/src/cast-asset-constants.js";

/**
 * Campaign #478 lane **L6** — the recast. This is the slice that moves the tally.
 *
 * ## THE DEFECT, ENUMERATED LIVE — IMMUTABLE
 *
 * Seven patients resolve to ONE Anny body. Every Anny-cast row in the whole bank is a patient:
 *
 *   ed_chest_pain_priority_v1              patient  ed_chest_pain_adult_cast.glb
 *   ward_delirium_med_rec_v1               patient  ed_chest_pain_adult_cast.glb
 *   psych_suicidal_ideation_safety_v1      patient  ed_chest_pain_adult_cast.glb
 *   ed_stroke_alert_handoff_v1             patient  ed_chest_pain_adult_cast.glb
 *   stepdown_sepsis_nurse_escalation_v1    patient  ed_chest_pain_adult_cast.glb
 *   postop_fever_consult_pressure_v1       patient  ed_chest_pain_adult_cast.glb
 *   adult_abdominal_pain_v1                patient  ed_chest_pain_adult_cast.glb
 *
 * `railTally` = **MPFB 32 / ANNY 7 / LIBRARY 0**, enumerated by `resolveScenarioActorCast()` over
 * `listShippedCastScenarioIds()` — never typed. Four hand-typed populations produced confident wrong
 * measurements earlier in this campaign, so this contract enumerates the same way.
 *
 * That Anny body carries **23 joints, no `jaw`, 0 FACS mouth or eye targets and NO EYE MESH**. Seven
 * learners meet a patient who cannot open her mouth to speak.
 *
 * ## WHY THIS WAS FROZEN, AND WHY IT IS NOT ANY MORE
 *
 * The freeze (P1, "a resolver swap is S2 again") was against recasting **without a hospital-class
 * garment** — S0/S1/S2 landed three green contracts on crudegown and the pixel grade showed a
 * floor-length evening dress. **That garment now exists and is graded**: `#490` landed
 * `MPFB_GOWN_ADULT_PATIENT_GLB` at shell 3,009 v, hemFrac 0.320, topFrac 0.863, 138 joints + jaw, no
 * lower garment — exact parity with the bake the orchestrator pixel-graded across `#480`/`#481`/
 * `#485`/`#487`/`#488`. The superagent lifted the freeze on that basis.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) no anny | (2) gowned | (3) others | result
 *   -------------------------------------------------|-------------|------------|------------|--------
 *   a) today — seven patients on the Anny body        |  **FAIL**   |  **FAIL**  |    pass    | REFUSED
 *   b) point them at any MPFB adult (street clothes)  |    pass     |  **FAIL**  |    pass    | REFUSED
 *   c) blanket-swap every Anny reference in the tree  |    pass     |    pass    |  **FAIL**  | REFUSED
 *   d) point the seven at the gowned MPFB patient     |    pass     |    pass    |    pass    | ALL PASS
 *
 * **(b) is the one to watch.** The pool already holds MPFB adults — `mpfb-street-adult-male`,
 * `mpfb-family-partner-adult`, `mpfb-clinical-nurse-adult`. Any of them clears "not Anny" and puts a
 * gowned-station patient in street clothes or scrubs. Clause (2) requires the GOWNED asset by name.
 *
 * **(c) is the S2 shape.** `ed_chest_pain_adult_cast.glb` is also the *nurse* and *spouse* file's
 * sibling in the ED station's naming, and a blanket rename would take correct casts with it. Clause
 * (3) pins every non-patient row to the body it resolves to today.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (2) are RED** — no patient is gowned-MPFB
 * today. **(3) passes today** and exists so (1) cannot be satisfied by a blanket swap. (4) is a
 * vacuity guard on the enumeration itself.
 *
 * NOT TESTED:
 *   - Whether one shared body is right for seven distinct patients. They share one today and this
 *     slice does not change that — it changes WHICH one. Distinct identities are a later card.
 *   - The constant-offset torso (`#488`: std 1.5 mm against a 22.4 mm `cloth_offset`).
 *   - Runtime skinning, posture, seated or supine placement, Quest, or any clinical claim.
 *   - That the Anny FILE stops shipping. L7 owns retiring it; this slice only stops CASTING it.
 */

type CastRow = { role?: string; actorId?: string; assetPath?: string };

/** Same call the campaign tracker uses (`campaign-track.ts:91`) — rows come back DIRECTLY. */
function allCastRows(): { scenarioId: string; row: CastRow }[] {
  const out: { scenarioId: string; row: CastRow }[] = [];
  for (const scenarioId of listShippedCastScenarioIds()) {
    for (const row of resolveScenarioActorCast(scenarioId) as unknown as CastRow[]) {
      out.push({ scenarioId, row });
    }
  }
  return out;
}

const basename = (p: string | undefined): string => String(p ?? "").split("/").pop() ?? "";
const ANNY_PATIENT_GLB = "ed_chest_pain_adult_cast.glb";

/** Non-patient rows and the body each resolves to today — clause (3)'s pinned baseline. */
const NON_PATIENT_BASELINE = allCastRows()
  .filter(({ row }) => row.role !== "patient")
  .map(({ scenarioId, row }) => `${scenarioId}|${row.role}|${basename(row.assetPath)}`)
  .sort();

describe("no learner meets a patient on the Anny rail", () => {
  it.fails("(1) RED: no shipped cast resolves a patient to the Anny body", () => {
    const offenders = allCastRows()
      .filter(({ row }) => basename(row.assetPath) === ANNY_PATIENT_GLB)
      .map(({ scenarioId, row }) => `${scenarioId} ${row.role} ${row.actorId}`);
    expect(
      offenders,
      `the Anny body carries 23 joints, no jaw, 0 FACS targets and no eye mesh — a patient on it\n`
        + `  cannot open her mouth to speak`,
    ).toEqual([]);
  });

  it.fails("(2) RED: every gowned-station patient resolves to the GOWNED MPFB asset", () => {
    // Refuses (b). The pool already holds MPFB adults in street clothes and scrubs; any of them
    // clears "not Anny" and puts a gowned-station patient in the wrong wardrobe.
    const wasAnny = allCastRows().filter(({ row }) => row.role === "patient");
    const gowned = wasAnny.filter(({ row }) => basename(row.assetPath) === MPFB_GOWN_ADULT_PATIENT_GLB);
    expect(
      gowned.length,
      `${gowned.length} of ${wasAnny.length} patients resolve to ${MPFB_GOWN_ADULT_PATIENT_GLB};\n`
        + `  the seven that were Anny-cast must land on the gowned asset by NAME, not merely off Anny`,
    ).toBeGreaterThanOrEqual(7);
  });

  it("(3) COUNTERWEIGHT: every non-patient cast is unchanged", () => {
    // Refuses (c), which is the S2 shape: a blanket swap of every Anny reference takes correct
    // nurse, spouse, family and child casts with it. Pinned to what resolves TODAY.
    const now = allCastRows()
      .filter(({ row }) => row.role !== "patient")
      .map(({ scenarioId, row }) => `${scenarioId}|${row.role}|${basename(row.assetPath)}`)
      .sort();
    expect(now, "nurses, spouses, family and children keep the bodies they resolve to today").toEqual(
      NON_PATIENT_BASELINE,
    );
  });

  it("(4) VACUITY GUARD: the enumeration sees the whole shipped bank", () => {
    // If the enumeration went empty, (1) and (2) would be green about nothing.
    expect(listShippedCastScenarioIds().length, "shipped scenarios").toBeGreaterThanOrEqual(14);
    expect(allCastRows().length, "cast rows across the bank").toBeGreaterThanOrEqual(30);
    expect(
      allCastRows().filter(({ row }) => row.role === "patient").length,
      "patient rows must exist for (1) and (2) to mean anything",
    ).toBeGreaterThanOrEqual(7);
  });
});
