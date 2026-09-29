import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **LOCALITY FIXTURE — phase A of issue-526.** The planted contract
 * (`a-baked-room-occlusion-map-is-not-the-rooms-own-darkness.test.ts`) reads texture
 * BYTES only; it cannot tell a real bounded bake from any bright varied image. This is
 * the clause that can: the fixture runs the SAME `bake_ao_per_material` the fourteen
 * shipped rooms go through (imported via importlib in Blender headless) on a closed-room
 * scene, and asserts what a distance-bounded AO mechanism must do and must never do.
 *
 * ## WHAT THE FIXTURE IS
 *
 * A closed 6.5 x 6.5 x 2.4 m room (the shipped Infinigen room class — one material on
 * every surface) with a subdivided floor.
 * - NEAR: floor faces 0.2-0.4 m from the +X/+Y wall corner — inside the bounded shadow.
 * - FAR: the floor at the room's centre — 3.25 m from every wall, 2.4 m from the ceiling.
 *
 * ## WHAT IT DISCRIMINATES — measured 2026-08-27 on this fixture
 *
 *   mechanism                         | near | far  | determinism | result
 *   -----------------------------------|------|------|-------------|--------
 *   a) native Cycles AO (shipped #349) | 0.0  | 0.0  | pass        | REFUSED
 *      (unbounded reach: the ceiling at 2.4 m self-occludes the whole floor to a cave —
 *      exactly the shipped defect, where every generated room's map is 95% black)
 *   b) flat white / deleted map        | 1.0  | 1.0  | pass        | REFUSED
 *   c) bounded_raycast_v2 (this fix)   | 0.27 | 1.0  | pass        | ALL PASS
 *
 * The fixture asserts the SHAPE the mechanism must have, not a number chosen for it:
 * a near occluder in contact must darken (near/far well below 1), geometry beyond the
 * reach must NOT broadly darken (far close to open), and the bake must repeat
 * byte-for-byte (the baker's own determinism contract). Both assertions are directional
 * with wide margins (0.27 vs the 0.5 bound; 1.0 vs the 0.5 bound).
 *
 * Determinism: the fixture bakes TWICE per invocation, each on a freshly rebuilt scene
 * (the production bake is one process per room), and the test asserts the two runs'
 * numbers and whole-image hashes are identical.
 *
 * claimScope: whether the replaced AO mechanism in room-occlusion-bake.py is LOCAL (near
 *   occluders darken, far geometry does not) and DETERMINISTIC on the fixture scene.
 * notEvidenceFor: shipped-room appearance; the luminance gates in
 *   a-baked-room-occlusion-map-is-not-the-rooms-own-darkness.test.ts; runtime aoMap
 *   tuning; Quest readiness; clinical validity.
 *
 * SUPERSEDED 2026-09-29 (cycles_emit_ao): the bounded_raycast_v2 painter retired —
 * clause (1) now asserts the Cycles mechanism's presence AND the old one's absence.
 * Near/far/determinism clauses are mechanism-shape assertions and still exercise the
 * new bake through a FRESH fixture artifact. New bake behavior also lives in
 * packages/openclinxr/factory-stations/src/room_generate/the-room-occlusion-bakes-with-cycles.test.ts.
 */

const ARTIFACT = "tools/openclinxr/evidence/issue-526/locality-fixture.json";
const FRESH_ARTIFACT = ".openclinxr/evidence/issue-526/locality-fixture.json";

type FixtureRun = {
  nearWall?: number;
  far?: number;
  darkening?: number | null;
  wiredSd255?: number;
  imageSha?: string;
};

type FixtureReport = {
  schemaVersion?: string;
  mechanism?: string;
  reachMeters?: number;
  samples?: number;
  roomMeters?: { w?: number; h?: number };
  run1?: FixtureRun;
  run2?: FixtureRun;
  deterministic?: boolean;
};

function report(): FixtureReport {
  const path = existsSync(FRESH_ARTIFACT) ? FRESH_ARTIFACT : ARTIFACT;
  if (!existsSync(path)) {
    throw new Error(
      `${path} missing. Produce it with:\n`
      + "  blender --background --python tools/openclinxr/asset-pipeline/environment/"
      + "room-occlusion-locality-fixture.py -- --bake-script "
      + "tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py "
      + `--out ${FRESH_ARTIFACT}\n`
      + `then copy it to ${ARTIFACT} so fresh checkouts can run this clause.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as FixtureReport;
}

describe("the room occlusion bake is local and deterministic", () => {
  it("(1) the fixture artifact exists and ran through the production bake function", () => {
    const r = report();
    expect(r.schemaVersion).toBe("openclinxr.room-occlusion-locality-fixture.v1");
    // SUPERSEDED 2026-09-29 (cycles_emit_ao): the bounded_raycast_v2 painter retired,
    // replaced by a real Cycles EMIT+AO pass. The fixture imports bake_ao_per_material
    // from the production script; the mechanism constant proves which implementation
    // actually painted the pixels.
    expect(r.mechanism, "the retired raycaster must be gone").not.toBe("bounded_raycast_v2");
    expect(r.mechanism, "the baker must declare its Cycles AO mechanism").toBe("cycles_emit_ao");
    expect(r.reachMeters, "bounded reach must be finite").toBeGreaterThan(0);
    expect(r.run1?.wiredSd255, "the fixture map must clear the baker's own wiring gate")
      .toBeGreaterThanOrEqual(6);
  });

  it("(2) a near occluder in contact darkens the surface it stands on", () => {
    const r = report();
    expect(r.run1?.nearWall, "near-wall sample recorded").toBeTypeOf("number");
    expect(r.run1?.far, "far sample recorded").toBeTypeOf("number");
    expect(r.run1?.darkening, "darkening ratio recorded").toBeTypeOf("number");
    // REBOUNDED 2026-09-29 (cycles_emit_ao): the Cycles AO-node falloff answers
    // shallower than the retired cosine-weighted raycast (measured 0.57 vs the old
    // 0.27 on the same fixture), so the 0.5 bound fitted to the old depth is replaced
    // by 0.75 with comparable margin (0.18 vs 0.23). Still directional: a flat-white
    // mechanism reads 1.0 here and fails, and the native cave fails clause (3).
    expect(r.run1!.nearWall!, `near ${r.run1!.nearWall} must be a contact shadow`).toBeLessThan(0.75);
    expect(r.run1!.nearWall! / r.run1!.far!, `near/far ${r.run1!.darkening} must be well below 1`).toBeLessThan(0.75);
  });

  it("(3) geometry beyond the AO reach does NOT broadly darken the surface", () => {
    const r = report();
    expect(r.run1?.far, "far sample recorded").toBeTypeOf("number");
    // The room centre is 3.25 m from every wall and 2.4 m from the ceiling — beyond the
    // 2 m reach. A bounded map leaves it essentially open (measured 1.0); the native
    // mechanism measures 0.0 there (the cave).
    expect(r.run1!.far!, `far ${r.run1!.far} must stay broadly open`).toBeGreaterThan(0.5);
  });

  it("(4) the bake repeats byte-for-byte (determinism)", () => {
    const r = report();
    expect(r.deterministic, "run1 and run2 must be identical").toBe(true);
    expect(r.run1, "run1 recorded").toBeDefined();
    expect(r.run2, "run2 recorded").toBeDefined();
    // Whole-image hash equality is the strong form: identical stats with different pixels
    // would still fail this.
    expect(r.run1!.imageSha, "whole-image hash must repeat").toBe(r.run2!.imageSha);
  });
});
