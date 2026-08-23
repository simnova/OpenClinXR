import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: a seated actor is over the seat of the chair the environment authored for her.**
 *
 * ## MEASURED BY THE ORCHESTRATOR ON HEAD f9d42d61, 2026-08-23 — do not re-derive
 *
 * Live scene, `actor-floor-contact-all-stations --scenario peds_asthma_parent_anxiety_v1`, cleared
 * cache, `frames=27`, after `waitForSceneAssetsSettled`:
 *
 *     parent_tara_johnson_v1   posture=seated    lowestVertexY = 0.129
 *     patient_maya_johnson_v1  posture=standing  lowestVertexY = 0.010
 *     nurse_kevin_lee_v1       posture=standing  lowestVertexY = 0.013
 *
 * The seated actor's lowest vertex is 12.9 cm off the floor; both standing actors are at ~1 cm. A
 * pixel grade of the same station shows her sitting on nothing visible.
 *
 * ## THE CHAIR IS BUILT — one candidate is already dead, do not re-investigate it
 *
 *     environment-descriptors.ts:398      peds bay fixtureSlots includes FAMILY_CHAIR
 *     environment-zone-templates.ts:464   FAMILY_CHAIR at { x: -0.55, y: 0, z: -0.75 }
 *     station-environment.ts:302-341      not an architecture fixture, so it falls through to
 *     station-chair.ts:87                 isPatientChairSlotId -> id.endsWith("_chair") -> TRUE
 *     station-environment.ts:335          buildPatientChair(...) -> shell.add(chair)
 *     station-chair.ts:20                 PATIENT_CHAIR_SEAT_HEIGHT_METERS = 0.45
 *     station-chair.ts:49                 seat is BoxGeometry(0.48, t, 0.48)
 *
 * No `continue` short-circuits the chair branch. A 0.45 m seat IS added at the family slot. So
 * "no chair exists" is refuted; what remains is whether the ACTOR is over it.
 *
 * ## WHY `lowestVertexY` CANNOT ANSWER THIS, AND WHAT CAN
 *
 * A figure seated correctly whose feet do not quite reach, and a figure floating 13 cm above the
 * seat with feet dangling, produce the SAME raised lowest vertex. The discriminators are the
 * actor's PELVIS height against the seat top, and the actor's world XZ against the chair's. The
 * wired probe reports neither — that measurement is what this contract asks for.
 *
 * ## NO INVENTED MAGNITUDE (§9k)
 *
 * This contract deliberately does NOT assert "feet reach the floor" or "the pelvis sits N cm above
 * the seat". I do not know the correct seat-to-pelvis offset for this rig and will not fit one. It
 * asserts only RELATIONSHIPS whose numbers come from the tree:
 *   - the pelvis is not BELOW the seat top (0.45, `station-chair.ts:20`) — she is not sitting
 *     through the chair
 *   - the actor is within the seat's own half-width in XZ (0.48/2 = 0.24, `station-chair.ts:49`)
 *     — she is over the seat, not merely near it
 * Foot clearance is a REPORTED consequence, not a gate.
 *
 * claimScope: whether a seated actor's pelvis is over the seat of her authored chair, live.
 * notEvidenceFor: whether the pose looks natural; garment contrast; the linear head artifact;
 *   whether 0.45 m is the right seat height; any station other than the one measured.
 */

/** `station-chair.ts:20`. Authored, not chosen here. */
const SEAT_TOP_METERS = 0.45;
/** `station-chair.ts:49` — seat is BoxGeometry(0.48, t, 0.48). Half-width, authored, not chosen here. */
const SEAT_HALF_WIDTH_METERS = 0.24;
const SCENARIO = "peds_asthma_parent_anxiety_v1";
const SEATED_ACTOR = "parent_tara_johnson_v1";

type SeatedPlacementRow = {
  scenarioId: string;
  actorId: string;
  declaredPosture: string;
  pelvisWorldY: number;
  actorWorldX: number;
  actorWorldZ: number;
  chairWorldX: number | null;
  chairWorldZ: number | null;
  chairSeatTopY: number | null;
  lowestVertexY: number;
};

async function loadInspect(): Promise<
  ((opts: { scenarioId: string }) => Promise<SeatedPlacementRow[]>) | undefined
> {
  const mod = (await import("./seated-actor-seat-placement.js").catch(() => undefined)) as
    | { inspectSeatedActorSeatPlacement?: (o: { scenarioId: string }) => Promise<SeatedPlacementRow[]> }
    | undefined;
  return mod?.inspectSeatedActorSeatPlacement;
}

describe("a seated actor sits on the chair she is planted on", () => {
  it.fails("(1) RED: the measurement exists and reports pelvis + chair world placement", async () => {
    // Today there is no module that reports pelvis Y or chair XZ, so the two candidate causes
    // cannot be separated at all. This clause fails on absence, which is the honest first defect.
    const inspect = await loadInspect();
    expect(typeof inspect, "seated-actor-seat-placement must export inspectSeatedActorSeatPlacement")
      .toBe("function");
    const rows = await inspect!({ scenarioId: SCENARIO });
    const row = rows.find((r) => r.actorId === SEATED_ACTOR);
    expect(row, `${SEATED_ACTOR} must appear in the placement report`).toBeTruthy();
    expect(row!.chairWorldX, "the chair the actor is planted on must be located, not null").not.toBeNull();
    expect(row!.chairSeatTopY, "the chair's seat top must be measured from the live mesh").not.toBeNull();
  });

  it.fails("(2) RED: her pelvis is not BELOW the authored seat top", async () => {
    // Refuses the cheap fix on (3): translating the actor down until her feet touch the floor
    // satisfies a naive foot-contact check while sinking her pelvis through the seat.
    const inspect = await loadInspect();
    expect(typeof inspect).toBe("function");
    const rows = await inspect!({ scenarioId: SCENARIO });
    const row = rows.find((r) => r.actorId === SEATED_ACTOR)!;
    expect(row.pelvisWorldY, `pelvis ${row?.pelvisWorldY} is below the ${SEAT_TOP_METERS} m seat top`)
      .toBeGreaterThanOrEqual(SEAT_TOP_METERS);
  });

  it.fails("(3) RED: she is over the seat, not merely near the chair", async () => {
    const inspect = await loadInspect();
    expect(typeof inspect).toBe("function");
    const rows = await inspect!({ scenarioId: SCENARIO });
    const row = rows.find((r) => r.actorId === SEATED_ACTOR)!;
    const dx = Math.abs(row.actorWorldX - (row.chairWorldX ?? Number.NaN));
    const dz = Math.abs(row.actorWorldZ - (row.chairWorldZ ?? Number.NaN));
    expect(dx, `actor is ${dx} m off the seat centre on X (seat half-width ${SEAT_HALF_WIDTH_METERS})`)
      .toBeLessThanOrEqual(SEAT_HALF_WIDTH_METERS);
    expect(dz, `actor is ${dz} m off the seat centre on Z (seat half-width ${SEAT_HALF_WIDTH_METERS})`)
      .toBeLessThanOrEqual(SEAT_HALF_WIDTH_METERS);
  });

  it.fails("(4) COUNTERWEIGHT: the standing actors in the same station stay on the floor", async () => {
    // Refuses a global Y translation that seats the parent by lifting or sinking everyone, and
    // pins the KNOWN-GOOD COLUMN: these two measured 0.010 and 0.013 before any change.
    const inspect = await loadInspect();
    expect(typeof inspect).toBe("function");
    const rows = await inspect!({ scenarioId: SCENARIO });
    const standing = rows.filter((r) => r.declaredPosture === "standing");
    expect(standing.length, "both standing actors must still be reported").toBeGreaterThanOrEqual(2);
    for (const r of standing) {
      expect(r.lowestVertexY, `${r.actorId} lifted off the floor to ${r.lowestVertexY}`)
        .toBeLessThanOrEqual(0.05);
    }
  });
});
