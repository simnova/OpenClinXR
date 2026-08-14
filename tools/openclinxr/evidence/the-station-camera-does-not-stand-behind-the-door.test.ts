import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Every station overview capture is taken from one hardcoded point, and in 6 of 14 rooms that
 * point is directly behind the room's own door leaf.**
 *
 * `ui-xr-environment-room-capture.ts:868` sets the camera inside a `page.evaluate` closure:
 *
 *   camera.position.set(1.35, 2.05, 3.15);
 *   camera.lookAt(0, 1.0, -1.35);            // framing "…doorway_elevated_overview_#69"
 *
 * `x = 1.35` is a literal. The door leaf's position is not — it is derived per room:
 * `DOOR_LEAF` is `wall_anchor` on `+x` at `DOOR_WALL_INSET_METERS = 0.5`
 * (`environment-zone-templates.ts:415-433`), `anchorFixtureNearFaceToPlane` puts the assembly's
 * near face at `width/2 − 0.5`, and the assembly's half-span is 0.52 (jamb centre 0.48 + half
 * thickness 0.04), so the 0.88 m leaf (`station-architecture-fixtures.ts:135`) spans
 *
 *   x ∈ [width/2 − 1.02 − 0.44,  width/2 − 1.02 + 0.44]
 *
 * A constant camera x against a width-derived door band collides in exactly the narrow rooms.
 *
 * ## MEASURED 2026-08-14 10:3x — all 14 shipped environments, from the shipped constants
 *
 *   environmentId                          width   leaf x-span      camera x = 1.35
 *   -------------------------------------  -----   --------------   ---------------
 *   ed_stroke_bay_v1                        7.20   [+2.14, +3.02]   clear
 *   ed_exam_bay_v1                          7.00   [+2.04, +2.92]   clear
 *   adult_ed_abdominal_bay_v1               6.80   [+1.94, +2.82]   clear
 *   stepdown_room_v1                        6.20   [+1.64, +2.52]   clear
 *   inpatient_ward_room_v1                  6.00   [+1.54, +2.42]   clear
 *   surgical_ward_room_v1                   6.00   [+1.54, +2.42]   clear
 *   ob_triage_room_v1                       5.90   [+1.49, +2.37]   clear
 *   oncology_consult_room_v1                5.80   [+1.44, +2.32]   clear
 *   behavioral_health_private_room_v1       5.60   [+1.34, +2.22]   **BEHIND DOOR**
 *   urgent_care_clinic_room_v1              5.50   [+1.29, +2.17]   **BEHIND DOOR**
 *   pediatric_fever_urgent_care_bay_v1      5.40   [+1.24, +2.12]   **BEHIND DOOR**
 *   pediatric_urgent_care_bay_v1            5.40   [+1.24, +2.12]   **BEHIND DOOR**
 *   telehealth_home_visit_v1                5.20   [+1.14, +2.02]   **BEHIND DOOR**
 *   primary_care_clinic_room_v1             5.00   [+1.04, +1.92]   **BEHIND DOOR**
 *
 * **Why nobody saw it:** the eight clear rooms are the wide ones, and the wide ED bays are what the
 * default capture pair has always photographed (§7j — a fix or a check that names its subjects
 * explicitly is the thing that will be wrong later).
 *
 * ## IT IS THE CAMERA, NOT THE ROOM — AND I HAD IT BACKWARDS FIRST
 *
 * The 09:2x peds capture (`.openclinxr/evidence/issue-0052-station-0924/`) shows a saturated blue
 * plane filling the right third with the parent actor behind it. I graded that as a room defect and
 * was wrong twice on the way to this contract:
 *
 *   1. *"The blue slab is a broken prop."* It is the DOOR LEAF, coloured `mat(input.trimColor, …)`
 *      = the room's own `wallTrimColor` `0x0ea5e9` (`station-architecture-fixtures.ts:120`). Working
 *      as written.
 *   2. *"The door is rotated 90° from the wall it is anchored to."* Deliberate, and documented:
 *      `fixture-wall-mounting.ts:29` — *"A fixture that is anchored NEAR a wall but is free-standing
 *      (the door leaf) keeps facing the learner."* `facesWall` is set on `WALL_BOARD` and
 *      intentionally not on `DOOR_LEAF`.
 *
 * The measurement that settled it — ray from each viewpoint to each peds-bay actor plant, against
 * the leaf's shipped extent:
 *
 *   viewpoint                          child (−0.90)   nurse (+0.64)   parent (+1.42)
 *   ---------------------------------  -------------   -------------   --------------
 *   LEARNER_START (0, 1.6, 1.4)            clear           clear           **clear**
 *   capture camera (1.35, 2.05, 3.15)      clear           clear         **OCCLUDED**
 *
 * **A learner standing at the entry point can see all three actors. Only the camera cannot.** This
 * is a defect in the evidence pipeline (D12: capture and publish graded wins), not in the station.
 * A slice that moves the door to fix a photograph would be changing the product to suit the
 * instrument.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) clear | (2) known-good | (3) door kept | (4) unseen width | result
 *   ---------------------------------------------------|-----------|----------------|---------------|------------------|--------
 *   a) today — x = 1.35 literal                      | **FAIL**  |      pass      |     pass      |     **FAIL**     | REFUSED
 *   b) move the camera inside the room               |   pass    |    **FAIL**    |     pass      |       pass       | REFUSED
 *   c) move / narrow / delete the DOOR_LEAF          |   pass    |      pass      |   **FAIL**    |       pass       | REFUSED
 *   d) a new literal tuned to clear today's 14 rooms |   pass    |      pass      |     pass      |     **FAIL**     | REFUSED
 *   e) derive the camera from the shell's own width  |   pass    |      pass      |     pass      |       pass       | ALL PASS
 *
 * **(b) is the one to watch.** Dropping the camera to the room centre clears every door instantly and
 * destroys the framing the manifest declares — `captureMode: "scene-overview"`, a doorway-side
 * elevated view. Clause (2) pins the camera outside the front plane and above 1.8 m.
 *
 * **(d) is why clause (4) exists.** A second literal that happens to miss all fourteen of today's
 * bands is the same defect with a different number, and it fails the moment a room is added. Clause
 * (4) evaluates two widths that are NOT in the shipped set.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (4) are REDs** — both fail today, (1) on six
 * shipped rooms and (4) on a 4.60 m synthetic. **(2) also fails today, unavoidably** — it reads the
 * same absent module, and it is the net that stops (1) being satisfied by (b). **(3) is a true net
 * and PASSES today**: it reads the door's own constants out of the two source files that define
 * them, so it is independent of the new module and reds the moment the door is moved to clear the
 * camera. Verified 2026-08-14: with the module absent, (1) and (4) are `expected fail`, (2) fails,
 * (3) passes.
 *
 * NOT TESTED:
 *   - **Occlusion of actual actor plants bank-wide.** Only the peds bay's three plants were
 *     ray-tested, by hand. The predicate here is the camera-in-band proxy, which is conservative in
 *     one direction (a camera in the band occludes everything behind it in that band) and blind in
 *     another (a camera just outside the band can still occlude an actor at a shallow angle).
 *     **`buildEncounterRuntimeAssetBundle({ scenario })` alone does NOT resolve plants** — it threw
 *     `TypeError: Cannot read properties of undefined (reading 'storeKind')` on all 14 scenarios when
 *     I tried it, so it needs more input than the scenario. Do not rebuild that path blind (§9g).
 *   - **The jambs and header.** The band here is the 0.88 m leaf. The full assembly is 1.04 m wide,
 *     so the frame adds ~0.08 m of occluder each side that this predicate ignores.
 *   - **Any other occluder.** Only `DOOR_LEAF` is evaluated. Work surfaces, boards and equipment can
 *     stand between the camera and an actor and nothing here sees them.
 *   - **Whether the resulting captures are good.** This asserts the camera is not behind a door. It
 *     says nothing about whether the new viewpoint frames the cast well — that is a pixel grade.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** The module this slice must create — the camera must become inspectable, not stay in a closure. */
const MODULE_PATH = join(HERE, "doorway-overview-camera.ts");
/** Computed so TypeScript cannot resolve a not-yet-existing module at compile time (#383/#352). */
const MODULE_SPECIFIER = ["./doorway", "overview", "camera.js"].join("-");

/** Measured 2026-08-14 from the shipped constants; the six that fail clause (1) today. */
const BEHIND_DOOR_TODAY = [
  "behavioral_health_private_room_v1",
  "urgent_care_clinic_room_v1",
  "pediatric_fever_urgent_care_bay_v1",
  "pediatric_urgent_care_bay_v1",
  "telehealth_home_visit_v1",
  "primary_care_clinic_room_v1",
] as const;

/** The eight that are clear today and must stay clear — the known-good column (§9h). */
const CLEAR_TODAY = [
  "ed_stroke_bay_v1",
  "ed_exam_bay_v1",
  "adult_ed_abdominal_bay_v1",
  "stepdown_room_v1",
  "inpatient_ward_room_v1",
  "surgical_ward_room_v1",
  "ob_triage_room_v1",
  "oncology_consult_room_v1",
] as const;

/** Widths deliberately absent from the shipped bank, so a re-tuned literal cannot pass clause (4). */
const UNSEEN_WIDTHS_M = [4.6, 8.0] as const;

/** The declared framing: a doorway-side elevated overview. Both bounds come from the manifest. */
const MIN_CAMERA_HEIGHT_M = 1.8;

type CameraVerdict = {
  environmentId: string;
  roomWidthMeters: number;
  roomDepthMeters: number;
  camera: { x: number; y: number; z: number };
  doorLeafXSpan: [number, number] | null;
  cameraBehindDoorLeaf: boolean;
};

type Api = {
  deriveDoorwayOverviewCameraForAllEnvironments?: () => CameraVerdict[];
  deriveDoorwayOverviewCameraForWidth?: (roomWidthMeters: number, roomDepthMeters: number) => CameraVerdict;
};

async function loadApi(): Promise<Api | null> {
  if (!existsSync(MODULE_PATH)) return null;
  try {
    const mod = (await import(MODULE_SPECIFIER)) as Api;
    if (typeof mod.deriveDoorwayOverviewCameraForAllEnvironments !== "function") return null;
    if (typeof mod.deriveDoorwayOverviewCameraForWidth !== "function") return null;
    return mod;
  } catch {
    return null;
  }
}

const api = await loadApi();
const verdicts = api?.deriveDoorwayOverviewCameraForAllEnvironments?.() ?? null;

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireVerdicts(): CameraVerdict[] {
  expect(
    api,
    `${MODULE_PATH} must export deriveDoorwayOverviewCameraForAllEnvironments() and deriveDoorwayOverviewCameraForWidth(width, depth) — today the camera is a literal inside a page.evaluate closure at ui-xr-environment-room-capture.ts:868 and nothing can read it`,
  ).not.toBeNull();
  expect(verdicts, "a verdict per shipped environment").not.toBeNull();
  expect(
    verdicts?.length ?? 0,
    "shipped environments evaluated (14 measured 2026-08-14)",
  ).toBeGreaterThanOrEqual(BEHIND_DOOR_TODAY.length + CLEAR_TODAY.length);
  return verdicts as CameraVerdict[];
}

describe("the station camera does not stand behind the door", () => {
  it.fails("(1) RED: no environment puts the overview camera inside its door leaf's x-span", () => {
    const rows = requireVerdicts();
    const behind = rows
      .filter((r) => r.cameraBehindDoorLeaf)
      .map(
        (r) =>
          `${r.environmentId}: camera x=${r.camera.x.toFixed(2)} inside leaf span [${r.doorLeafXSpan?.[0]?.toFixed(2)}, ${r.doorLeafXSpan?.[1]?.toFixed(2)}] (width ${r.roomWidthMeters})`,
      );
    expect(behind, `measured 2026-08-14: 6 of 14 — ${BEHIND_DOOR_TODAY.join(", ")}`).toEqual([]);
  });

  it("(2) COUNTERWEIGHT known-good: the eight clear rooms stay clear, and the framing is preserved", () => {
    // Refuses (b). Dropping the camera into the room clears every door and destroys the doorway-side
    // elevated overview the manifest declares. Both bounds are read off the shell, not invented: the
    // camera must sit beyond the open front plane (depth/2) and above 1.8 m.
    const rows = requireVerdicts();
    const regressed = rows
      .filter((r) => (CLEAR_TODAY as readonly string[]).includes(r.environmentId) && r.cameraBehindDoorLeaf)
      .map((r) => `${r.environmentId} was clear on 2026-08-14 and is now behind the leaf`);
    expect(regressed, "rooms that regressed from the known-good column").toEqual([]);

    const unframed = rows
      .filter((r) => !(r.camera.z > r.roomDepthMeters / 2) || !(r.camera.y >= MIN_CAMERA_HEIGHT_M))
      .map(
        (r) =>
          `${r.environmentId}: camera (y=${r.camera.y.toFixed(2)}, z=${r.camera.z.toFixed(2)}) must stay outside the front plane z>${(r.roomDepthMeters / 2).toFixed(2)} and at or above ${MIN_CAMERA_HEIGHT_M} m`,
      );
    expect(unframed, "rooms whose camera left the declared doorway-elevated framing").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the door leaf itself is not moved, narrowed or deleted", () => {
    // Refuses (c). The door is correct — `mat(trimColor)` by design, free-standing by design
    // (fixture-wall-mounting.ts:29). Moving the product to flatter a photograph is the wrong layer.
    // Read from the two files that DEFINE the door, not from the new camera module, so this clause is
    // a real net: it passes today and reds the moment the door is edited to clear the camera.
    const fixtures = readFileSync(join(HERE, "../../../apps/ui-xr/src/station-architecture-fixtures.ts"), "utf8");
    const zones = readFileSync(
      join(HERE, "../../../packages/openclinxr/asset-registry/src/environment-zone-templates.ts"),
      "utf8",
    );
    const doorFn = fixtures.slice(fixtures.indexOf("export function buildDoorLeafFixture"));
    const leaf = /leaf = new Mesh\(new BoxGeometry\(([0-9.]+), ([0-9.]+), ([0-9.]+)\)/u.exec(doorFn);
    expect(leaf, "the door leaf's BoxGeometry in buildDoorLeafFixture").not.toBeNull();
    expect([Number(leaf![1]), Number(leaf![2])], "door leaf width x height (0.88 x 1.95 m)").toEqual([0.88, 1.95]);

    const jambR = /jambR\.position\.set\(([0-9.]+),/u.exec(doorFn);
    expect(Number(jambR?.[1]), "door jamb half-span (0.48 m)").toBe(0.48);

    const inset = /DOOR_WALL_INSET_METERS = ([0-9.]+)/u.exec(zones);
    expect(Number(inset?.[1]), "DOOR_WALL_INSET_METERS (0.50 m, bank-wide, #204)").toBe(0.5);

    const doorSlot = zones.slice(zones.indexOf("export const DOOR_LEAF"), zones.indexOf("export const WALL_BOARD"));
    expect(/wall:\s*"\+x"/u.test(doorSlot), "DOOR_LEAF stays anchored to the +x wall").toBe(true);
    expect(/facesWall/u.test(doorSlot), "DOOR_LEAF stays free-standing (facesWall NOT set)").toBe(false);
  });

  it.fails("(4) RED: the rule holds at widths that are not in the shipped bank", () => {
    // Refuses (d). A second literal fitted to today's fourteen bands is the same defect with a new
    // number. 4.60 m and 8.00 m are deliberately absent from the bank; a derived camera answers both.
    const mod = requireVerdicts() && (api as Api);
    const failures = UNSEEN_WIDTHS_M.map((w) => mod.deriveDoorwayOverviewCameraForWidth!(w, 2.95))
      .filter((r) => r.cameraBehindDoorLeaf)
      .map(
        (r) =>
          `width ${r.roomWidthMeters}: camera x=${r.camera.x.toFixed(2)} inside leaf span [${r.doorLeafXSpan?.[0]?.toFixed(2)}, ${r.doorLeafXSpan?.[1]?.toFixed(2)}]`,
      );
    expect(failures, "unseen widths where the camera still lands behind the door").toEqual([]);
  });
});
