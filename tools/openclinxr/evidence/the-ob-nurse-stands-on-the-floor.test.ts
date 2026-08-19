import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main efcdf5ec — do not re-derive these rows
 *
 * `actor-floor-contact-all-stations` is RED on main. One actor in 39:
 *
 *   ob_headache_preeclampsia_triage_v1 / ob_nurse_williams_v1
 *   declaredPosture standing, posed-skin lowestVertexY = 0.4100, band 0.15
 *
 * She hovers **41 cm** off the floor. The next-highest standing actor in the whole bank is
 * `patient_samuel_brooks_v1` at **0.0153** — a **27x outlier**, not a marginal miss. Her two
 * co-actors in the same station, same floor, same 21 frames, are fine.
 *
 * ## THE DISCRIMINATOR, AND IT IS A DISCRIMINATOR NOT A CAUSE
 *
 * From `sceneManifest.actorPlacements` in the OB station's learner-runtime-bundle:
 *
 *   actor                   slotKind             pos.y  vertOffset  scale   y0
 *   patient_aisha_khan_v1   primary_patient      1.06   -0.98       1.1    -0.0176
 *   ob_nurse_williams_v1    clinical_team        0.95   -0.95       1.0    +0.4100
 *   partner_omar_khan_v1    family_or_observer   0.95   -0.95       1.0    -0.0074
 *
 * **The nurse and the partner have IDENTICAL placement parameters and differ by 0.417 m.**
 * `slotKind` is the only differing input. That is where to start looking. It is NOT a
 * statement about what goes wrong.
 *
 * ## FOUR CANDIDATES I ELIMINATED BY MEASUREMENT — do not re-run these
 *
 *   1. **The placement data.** Identical for the two actors that differ (table above).
 *   2. **The asset origin.** Every MPFB adult sits on its own origin, read from the GLBs:
 *        mpfb-clinical-nurse-adult  meshMinY=-0.0000 h=1.7607 lowestFootJointY=0.0093
 *        mpfb-family-partner-adult  meshMinY=-0.0000 h=1.6686 lowestFootJointY=0.0089
 *        mpfb-ob-patient-aisha      meshMinY= 0.0010 h=1.6871 lowestFootJointY=0.0089
 *   3. **The framing pass.** `applyCleanEncounterVisualReviewActorFraming` runs on ALL FOUR
 *      slots (`main.ts:3664,3708,3757,3798`) and `encounter-actor-framing.ts` writes only
 *      `rotation.y` — never `position.y`.
 *   4. **Posture resolution.** `resolveActorPosture` takes `slotKind` as an input and the
 *      seated branch would lift a figure to `PATIENT_CHAIR_SEAT_HEIGHT_METERS = 0.45`, which
 *      is temptingly close to 0.41. Measured for the OB environment: all three slots resolve
 *      `standing`. **The seat-height coincidence is a red herring — check it off, do not chase it.**
 *
 * **THE CAUSE IS NOT KNOWN TO ME BEYOND THE ROWS ABOVE.** My last three inferences in this
 * area were withdrawn — a skinned mesh's `worldMin` is not the posed skin (SS6v), a stale
 * cache was not hiding this (a served cache still fails; measured), and the asset origin was
 * not the cause. Trace it yourself. Do not adopt a hypothesis of mine; there isn't one.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                         |FAIL |pass |pass |pass | REFUSED
 *   b) declare her seated or supine                  |**FAIL**|**FAIL**|pass|pass| REFUSED
 *   c) hide her (visible=false / drop the slot)      |pass |pass |**FAIL**|pass| REFUSED
 *   d) drop every actor 0.41 m                       |pass |pass |pass |**FAIL**| REFUSED
 *   e) trace and fix the clinical_team path          |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the cheapest green in the repo.** `supine` and `seated` are exempt from the float
 * check by design (#150 — an actor on a support surface is not floating), so one word in the
 * bundle makes the existing contract pass while leaving a nurse hanging in mid-air. Clause (2)
 * pins her resolved posture to `standing`.
 *
 * **(c) is the second cheapest.** A hidden actor has no lowest vertex to measure.
 *
 * **(d) is the one that looks like a fix.** A global -0.41 would green her and sink the other
 * 38 through the floor. Clause (4) pins every other actor's y0 to the band it holds today.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — both substitutions MATCHED, and (b) is stronger than I claimed
 *
 * Mutated the report on disk, ran, restored from a backup copy each time.
 *
 *   cheat (b) reclassify her `seated`  -> 2 failed: clauses (1) AND (2)
 *   cheat (c) drop her from the report -> 4 failed: clauses (1), (2), (3) AND (5)
 *
 * **My table said (b) would pass clause (1). It does not.** Clause (1) here is unconditional
 * — unlike the generic #105 contract it carries no seated/supine exemption — so reclassifying
 * her fails the height assertion as well as the posture one. Corrected in the row above rather
 * than appended (SS7q). The prediction was wrong in the safe direction; the counterweight is
 * stronger than advertised.
 *
 * Cheat (c) also trips the vacuity guard, which is what (5) is for: a report trimmed to make
 * (4) cheap goes red on (5) first.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1) is the SOLE RED — she measures 0.4100 today.
 *   (2)(3)(4) ALL PASS TODAY — she is already declared standing, already visible, and the
 *             other 38 are already in band. They are pure nets against (b), (c) and (d).
 *   (5) PASSES TODAY — vacuity guard on the report itself.
 *
 * NOT TESTED:
 *   - **The cause.** This asserts the outcome. Nothing here says where the 0.41 comes from.
 *   - **Whether other stations' clinical_team slots float.** Every other one measures in band
 *     today, so if the mechanism is slot-kind-wide it is also station-conditional. Not chased.
 *   - **How long main has been red.** Unknown; the artifact carries a treeStamp but I have not
 *     diffed it against history, and the cache is NOT the reason it went unnoticed.
 *   - Appearance. No pixel claim. A nurse at the correct height may still look wrong.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(
  REPO_ROOT,
  ".openclinxr/evidence/actor-floor-contact/actor-floor-contact-all-stations.json",
);

const OB_SCENARIO = "ob_headache_preeclampsia_triage_v1";
const NURSE = "ob_nurse_williams_v1";
/** The band the existing #105 contract already enforces. This slice does NOT move it. */
const FLOAT_BAND_METERS = 0.15;
/** #150: an actor on a support surface is not floating. Reclassifying her here is cheat (b). */
const SUPPORT_POSTURES = new Set(["seated", "supine"]);

type ActorRow = {
  scenarioId: string;
  actorId: string;
  lowestVertexY: number;
  declaredPosture: string;
  framesAdvanced: number;
};

const report: { actors?: ActorRow[] } | null = existsSync(ARTIFACT)
  ? ((JSON.parse(readFileSync(ARTIFACT, "utf8")) as { report?: { actors?: ActorRow[] } }).report ?? null)
  : null;
const actors: ActorRow[] = report?.actors ?? [];

/**
 * SS7t: an empty or missing report must FAIL, never pass vacuously. The artifact is produced
 * by `actor-floor-contact-all-stations`; run that first if this refuses.
 */
function requireActors(): ActorRow[] {
  expect(
    actors.length,
    `no floor-contact report on disk — run actor-floor-contact-all-stations first (it re-measures when the tree stamp moves)`,
  ).toBeGreaterThan(30);
  return actors;
}

function nurseRow(): ActorRow {
  const row = requireActors().find((a) => a.scenarioId === OB_SCENARIO && a.actorId === NURSE);
  expect(row, `${OB_SCENARIO}/${NURSE} is absent from the report — she must be measured, not dropped`).toBeDefined();
  return row as ActorRow;
}

describe("the OB nurse stands on the floor", () => {
  it("(1) RED: her lowest posed vertex is inside the existing band", () => {
    const row = nurseRow();
    expect(
      row.lowestVertexY,
      `measured 0.4100 on efcdf5ec against a ${String(FLOAT_BAND_METERS)} band — a 27x outlier; the next-highest standing actor in the bank is 0.0153`,
    ).toBeLessThanOrEqual(FLOAT_BAND_METERS);
  });

  it("(2) COUNTERWEIGHT: she is still resolved standing, not reclassified onto a support surface", () => {
    // Refuses (b), the cheapest green in the repo: seated/supine are exempt from the float
    // check (#150), so one word in the bundle passes the existing contract with a nurse
    // hanging in mid-air.
    const row = nurseRow();
    expect(
      SUPPORT_POSTURES.has(row.declaredPosture),
      `posture became "${row.declaredPosture}" — exempting her from the float check is not fixing the float`,
    ).toBe(false);
    expect(row.declaredPosture, "she is a standing clinical actor").toBe("standing");
  });

  it("(3) COUNTERWEIGHT: she is still measured, with frames advanced", () => {
    // Refuses (c). A hidden or dropped actor has no lowest vertex, so absence reads as success.
    const row = nurseRow();
    expect(Number.isFinite(row.lowestVertexY), "no measurement — was she hidden or dropped?").toBe(true);
    expect(row.framesAdvanced, "frames must advance or the pose is never applied").toBeGreaterThan(0);
  });

  it("(4) COUNTERWEIGHT: the other 38 slots keep the floor contact they have today", () => {
    // Refuses (d). A global -0.41 would green her and sink everyone else through the floor.
    const others = requireActors().filter((a) => !(a.scenarioId === OB_SCENARIO && a.actorId === NURSE));
    const sunk = others.filter((a) => a.lowestVertexY < -0.05).map((a) => `${a.scenarioId}/${a.actorId} y0=${a.lowestVertexY}`);
    expect(sunk, `actors pushed below the floor — a global offset is not a fix`).toEqual([]);
    const floating = others
      .filter((a) => !SUPPORT_POSTURES.has(a.declaredPosture) && a.lowestVertexY > FLOAT_BAND_METERS)
      .map((a) => `${a.scenarioId}/${a.actorId} y0=${a.lowestVertexY}`);
    expect(floating, `a NEW floater appeared while fixing this one`).toEqual([]);
  });

  it("(5) VACUITY GUARD: the report covers the bank and both OB co-actors are in it", () => {
    // Reads the population, not the nurse's value, so it passes today and keeps passing: if
    // someone trims the report to make (4) cheap, this goes red first.
    const all = requireActors();
    expect(all.length, "the bank's actor slots").toBeGreaterThanOrEqual(39);
    const ob = all.filter((a) => a.scenarioId === OB_SCENARIO).map((a) => a.actorId);
    expect(ob, "the OB co-actors are the in-station known-good column").toContain("partner_omar_khan_v1");
    expect(ob, "the OB co-actors are the in-station known-good column").toContain("patient_aisha_khan_v1");
  });
});
