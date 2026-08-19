import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main 5f3a9a77 — do not re-derive these rows
 *
 * The telehealth patient is the ONLY seated actor in the bank, and his feet do not reach
 * the floor. Posed-skin measurement, taken AFTER #446's settle fix (tree stamp 5f3a9a77
 * matches HEAD, so these are current, not mid-load):
 *
 *   telehealth_diabetes_health_literacy_v1 / patient_luis_martinez_v1
 *   declaredPosture seated, lowestVertexY = 0.2998, framesAdvanced 22
 *
 * He is sitting 30 cm in the air. I graded the HUD-free still from #445 and wrote
 * "a compressed pale mass at the chair rather than a recognisable seated figure" —
 * this is the measurement behind that.
 *
 * ## WHY 0 IS THE RIGHT TARGET, DERIVED FROM TWO INPUTS THAT THE POSE CANNOT MOVE (SS9s)
 *
 * **The chair is static geometry**, so its bounds are trustworthy in a way a skinned mesh's
 * are not. From #445's live inspect of this station:
 *
 *   patient_chair seat slab   y[0.400, 0.450]   <- seat top 0.450
 *   patient_chair back        y[0.410, 0.930]
 *   patient_chair legs x4     y[0.000, 0.400]
 *
 * That 0.450 matches `PATIENT_CHAIR_SEAT_HEIGHT_METERS` in `station-chair.ts:20` exactly.
 *
 * **The figure's own lower leg**, read from its armature in bind pose, is 0.5005 m from
 * `lowerleg01` to the foot (0.2829H of a 1.7695 m stature). A figure whose hips rest on a
 * 0.450 m seat therefore has knees near 0.450 and feet at 0.450 - 0.5005 = **below the
 * floor** — which is exactly why chair seats are built at about lower-leg height.
 *
 * Both references are INPUTS to the seating problem: the fitter does not move the chair, and
 * the pose does not change the bind-pose bone lengths. Neither is a fraction of the thing
 * being measured. A self-referential band — "within some fraction of the observed sit" —
 * would pass on any value including this one.
 *
 * The band below is 0.15 m, the SAME band `actor-floor-contact-all-stations` already enforces
 * for standing actors. This slice introduces no new number.
 *
 * ## THERE IS NO KNOWN-GOOD SEATED COLUMN IN THIS TREE, AND THAT IS ITSELF THE FINDING (SS9h)
 *
 * He is the **only** actor in all 39 slots with `declaredPosture: seated`. Every other
 * comparison available is a standing actor. So clause (4) uses the standing population as the
 * floor-contact known-good and clause (5) pins the chair, but there is no second seated figure
 * to cross-check the sit against. Stated rather than papered over.
 *
 * ## THE CAUSE IS NOT KNOWN TO ME
 *
 * Three candidates I have NOT distinguished and am deliberately NOT ranking: the hips sit
 * above the seat; the seated clip folds the legs so the feet never descend; the seated
 * vertical offset is derived from seat height without accounting for the figure's leg length.
 * **They may all be wrong.** My last four inferences in this area were withdrawn — a
 * skinned-mesh `worldMin` is not the posed skin (SS6v, twice), a stale cache was not hiding
 * the OB float, and the OB "defect" was a sampling instant rather than a placement fault.
 *
 * **The first measurement, before any product edit:** record the patient's HIP world Y and
 * KNEE world Y alongside `lowestVertexY`, against the chair's measured seat top of 0.450.
 * Hips at ~0.45 with feet at 0.30 means the legs are folded; hips at ~0.75 means the whole
 * figure is lifted. That one table separates the candidates; nothing else here does.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) | (2) | (3) | (4) | (5) | result
 *   -------------------------------------------------|-----|-----|-----|-----|-----|--------
 *   a) today                                         |FAIL |pass |pass |pass |pass | REFUSED
 *   b) declare him standing                          |pass |**FAIL**|pass|pass|pass| REFUSED
 *   c) raise the chair to meet his feet               |pass |pass |pass |pass |**FAIL**| REFUSED
 *   d) drop or hide him                               |pass |**FAIL**|**FAIL**|pass|pass| REFUSED
 *   e) drop every actor 0.30 m                        |pass |pass |pass |**FAIL**|pass| REFUSED
 *   f) seat him properly                              |pass |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the cheapest.** `seated` is exempt from the standing float check (#150), so the
 * generic contract never sees this; flipping him to `standing` would make him stand beside a
 * chair and satisfy that gate. Clause (2) pins the posture.
 *
 * **(c) is the tempting one.** Raising the seat to 0.75 m puts the chair under him and greens
 * a height assertion, while producing a bar stool in a living room. Clause (5) pins the
 * chair's measured geometry.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — both substitutions MATCHED the table
 *
 * Mutated the artifacts on disk, ran, restored from backups each time.
 *
 *   cheat (b) declare him standing + land his feet -> clause (1) GREEN, clause (2) fires
 *   cheat (c) raise the chair 0.30 + land his feet -> clause (1) GREEN, clause (5) fires
 *
 * Both make the height assertion pass, which is the point: (1) alone is satisfiable by
 * standing him beside the chair or by turning the chair into a bar stool. The counterweights
 * are the contract. Predictions and outcomes agree on every cell of rows (b) and (c).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1) is the SOLE RED — he measures 0.2998 today.
 *   (2)(3) PASS TODAY — he is already declared seated and already measured. Nets against
 *          (b) and (d).
 *   (4) PASSES TODAY — the other 38 are in band after #446. Net against (e).
 *   (5) PASSES TODAY — it reads the chair's static geometry. Net against (c).
 *
 * NOT TESTED:
 *   - **The cause.** This asserts the outcome only.
 *   - **Whether the sit LOOKS right** once the feet land. Hip angle, spine, arm rest and the
 *     "compressed mass" appearance are all ungated here; a figure with feet on the floor can
 *     still be folded wrongly. The orchestrator grades the still afterwards.
 *   - **Other seated actors.** There are none. If a second is added later this contract does
 *     not cover it.
 *   - Garment fit, clinical plausibility, Quest budget. None of them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const FLOOR_ARTIFACT = join(
  REPO_ROOT,
  ".openclinxr/evidence/actor-floor-contact/actor-floor-contact-all-stations.json",
);
const ROOM_INSPECT = join(HERE, "telehealth-room-inspect.json");

const SCENARIO = "telehealth_diabetes_health_literacy_v1";
const PATIENT = "patient_luis_martinez_v1";
/** The band actor-floor-contact already enforces for standing actors. Unchanged here. */
const FLOOR_BAND_METERS = 0.15;
/** Measured from the station's static chair geometry, and matches station-chair.ts:20. */
const CHAIR_SEAT_TOP_METERS = 0.45;
const CHAIR_SEAT_TOLERANCE = 0.03;

type ActorRow = {
  scenarioId: string;
  actorId: string;
  lowestVertexY: number;
  declaredPosture: string;
  framesAdvanced: number;
};
type MeshRow = { name: string; worldMin: number[]; worldMax: number[] };

const actors: ActorRow[] = existsSync(FLOOR_ARTIFACT)
  ? ((JSON.parse(readFileSync(FLOOR_ARTIFACT, "utf8")) as { report?: { actors?: ActorRow[] } }).report?.actors ?? [])
  : [];
const meshes: MeshRow[] = existsSync(ROOM_INSPECT)
  ? ((JSON.parse(readFileSync(ROOM_INSPECT, "utf8")) as { meshes?: MeshRow[] }).meshes ?? [])
  : [];

/** SS7t: an empty enumeration must FAIL, never pass vacuously. */
function requireActors(): ActorRow[] {
  expect(
    actors.length,
    `no floor-contact report — run actor-floor-contact-all-stations first (it re-measures when the tree stamp moves)`,
  ).toBeGreaterThan(30);
  return actors;
}

function patientRow(): ActorRow {
  const row = requireActors().find((a) => a.scenarioId === SCENARIO && a.actorId === PATIENT);
  expect(row, `${SCENARIO}/${PATIENT} is absent from the report — he must be measured, not dropped`).toBeDefined();
  return row as ActorRow;
}

describe("the seated patient reaches the floor", () => {
  it("(1) RED: his lowest posed vertex is inside the floor band", () => {
    const row = patientRow();
    expect(
      row.lowestVertexY,
      `measured 0.2998 on 5f3a9a77 — seated 30 cm in the air on a chair whose seat top is ${String(CHAIR_SEAT_TOP_METERS)} m, `
        + `while his own bind-pose lower leg is 0.5005 m long`,
    ).toBeLessThanOrEqual(FLOOR_BAND_METERS);
  });

  it("(2) COUNTERWEIGHT: he is still a seated actor", () => {
    // Refuses (b) and half of (d). `seated` is exempt from the standing float check (#150),
    // so flipping him to standing satisfies the generic gate by standing him beside the chair.
    const row = patientRow();
    expect(row.declaredPosture, `posture became "${row.declaredPosture}" — standing him up is not seating him`).toBe("seated");
  });

  it("(3) COUNTERWEIGHT: he is still measured, with frames advanced", () => {
    // Refuses the rest of (d). A hidden actor has no lowest vertex, so absence reads as success.
    const row = patientRow();
    expect(Number.isFinite(row.lowestVertexY), "no measurement — was he hidden or dropped?").toBe(true);
    expect(row.framesAdvanced, "frames must advance or the seated pose is never applied").toBeGreaterThan(0);
  });

  it("(4) COUNTERWEIGHT: the other 38 keep the floor contact #446 restored", () => {
    // Refuses (e). A global -0.30 would seat him and sink everyone else through the floor.
    const others = requireActors().filter((a) => !(a.scenarioId === SCENARIO && a.actorId === PATIENT));
    const sunk = others.filter((a) => a.lowestVertexY < -0.05).map((a) => `${a.actorId} y0=${a.lowestVertexY}`);
    expect(sunk, "actors pushed below the floor — a global offset is not a fix").toEqual([]);
    const floating = others
      .filter((a) => a.declaredPosture !== "supine" && a.declaredPosture !== "seated" && a.lowestVertexY > FLOOR_BAND_METERS)
      .map((a) => `${a.actorId} y0=${a.lowestVertexY}`);
    expect(floating, "a NEW floater appeared").toEqual([]);
  });

  it("(5) COUNTERWEIGHT: the chair is still a chair", () => {
    // Refuses (c). Raising the seat to meet his feet greens a height assertion and produces a
    // bar stool in a living room. The chair is STATIC geometry, so these bounds are reliable
    // in a way a skinned mesh's AABB is not (SS6v — that instrument burned me twice).
    const seat = meshes.filter((m) => /patient_chair|patient-chair/iu.test(m.name));
    expect(seat.length, `no chair meshes in the room inspect — run telehealth-room-inspect first`).toBeGreaterThan(0);
    const seatTop = Math.max(...seat.map((m) => m.worldMax[1] as number).filter((y) => y < 0.6));
    expect(
      Math.abs(seatTop - CHAIR_SEAT_TOP_METERS),
      `seat top moved to ${seatTop.toFixed(3)} — raising the chair to meet his feet is not seating him`,
    ).toBeLessThanOrEqual(CHAIR_SEAT_TOLERANCE);
  });
});
