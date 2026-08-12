import { describe, expect, it } from "vitest";
import { Box3, Group, Mesh, BoxGeometry, MeshStandardMaterial, Vector3 } from "three";

/**
 * PLANTED CONTRACTS (#336). Infinigen-generated station environment, selected by environmentId.
 *
 * Six Infinigen probe slices produced evidence and no consumer: `grep -rn "infinigen"
 * apps/ui-xr/src/*.ts` was ZERO matches. This module is the consumer seam — the procedural box
 * stays as fallback and the generated room loads by environmentId.
 *
 * Header IMMUTABLE — append ## FIXED (#336) below.
 */

type LoaderModule = Record<string, unknown>;
const load = async () =>
  import("./infinigen-station-environment.js") as Promise<LoaderModule>;

describe("Infinigen station environment by environmentId (#336)", () => {
  it("maps a shipped environmentId to its baked Infinigen room GLB, and nothing else", async () => {
    const mod = await load();
    const resolve = mod["resolveInfinigenEnvironmentAsset"] as
      | ((environmentId: string) => string | null)
      | undefined;
    expect(resolve).toBeTypeOf("function");
    const ed = resolve!("ed_exam_bay_v1");
    expect(ed).toBe("/xr-assets/environment/infinigen-ed-exam-bay.glb");
    // Unknown ids must NOT silently resolve — the procedural box stays the fallback.
    expect(resolve!("no_such_environment_v1")).toBeNull();
    expect(resolve!("telehealth_home_visit_v1")).toBeNull();
  });

  it("hides the procedural box shell meshes but keeps fixture slots", async () => {
    const mod = await load();
    const hide = mod["hideProceduralShellMeshes"] as
      | ((shell: Group) => number)
      | undefined;
    expect(hide).toBeTypeOf("function");

    const shell = new Group();
    shell.name = "openclinxr.station-environment-shell";
    const floor = new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial());
    floor.name = "openclinxr.station-environment.floor";
    const wall = new Mesh(new BoxGeometry(0.08, 2.65, 3.45), new MeshStandardMaterial());
    wall.name = "openclinxr.station-environment.back-wall";
    const stretcher = new Mesh(new BoxGeometry(0.9, 0.9, 1.9), new MeshStandardMaterial());
    stretcher.name = "openclinxr.station-environment.fixture-slot.stretcher";
    shell.add(floor, wall, stretcher);

    const hidden = hide!(shell);
    expect(hidden).toBe(2);
    expect(floor.visible).toBe(false);
    expect(wall.visible).toBe(false);
    expect(stretcher.visible).toBe(true);
    expect(String(floor.userData["openClinXrInfinigenPolicy"] ?? "")).toContain("fallback");
  });

  it("does not hide anything when the shell has only fixtures (no shell meshes)", async () => {
    const mod = await load();
    const hide = mod["hideProceduralShellMeshes"] as ((shell: Group) => number) | undefined;
    const shell = new Group();
    const chair = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial());
    chair.name = "openclinxr.station-environment.fixture-slot.patient_chair";
    shell.add(chair);
    expect(hide!(shell)).toBe(0);
    expect(chair.visible).toBe(true);
  });

  it("positions a loaded room so its floor top sits at y=0 and its center matches the shell", async () => {
    const mod = await load();
    const position = mod["positionInfinigenRoom"] as
      | ((roomRoot: Group, stationEnvironment: Group) => unknown)
      | undefined;
    expect(position).toBeTypeOf("function");

    // Simulate the baked Infinigen room: centered, floor slab top at y≈0, walls below the slab.
    const roomRoot = new Group();
    const floorSlab = new Mesh(new BoxGeometry(6.5, 0.02, 6.5), new MeshStandardMaterial());
    floorSlab.name = "infinigen_room_0/0.floor";
    floorSlab.position.y = -0.01; // slab top at y=0 (0.02 thick, centered at -0.01)
    const wall = new Mesh(new BoxGeometry(6.9, 2.65, 6.9), new MeshStandardMaterial());
    wall.name = "infinigen_room_0/0.exterior";
    wall.position.y = -0.124 + 2.65 / 2; // walls extend below floor
    roomRoot.add(floorSlab, wall);

    const shell = new Group();
    const shellFloor = new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial());
    shellFloor.name = "openclinxr.station-environment.floor";
    shellFloor.position.set(0, -0.04, -0.775); // ED bay floorZ
    shell.userData.floorMesh = shellFloor;

    roomRoot.updateMatrixWorld(true);
    const result = position!(roomRoot, shell) as { floorTopY: number };
    expect(result.floorTopY).toBeCloseTo(0.0, 3);
    expect(roomRoot.position.y).toBeCloseTo(0.0, 3); // floor top already at 0 -> no shift
    expect(roomRoot.position.z).toBeCloseTo(-0.775, 3); // centered on shell floor center
  });

  it("returns unmapped status for an environmentId with no baked Infinigen room", async () => {
    const mod = await load();
    const loadFn = mod["loadInfinigenEnvironmentIntoStation"] as
      | ((input: unknown) => { state: string; assetPath: string | null })
      | undefined;
    expect(loadFn).toBeTypeOf("function");
    const scene = new Group() as never;
    const status = loadFn!({
      scene,
      environmentId: "oncology_consult_room_v1",
      stationEnvironment: new Group(),
      onStatus: () => {},
    });
    expect(status.state).toBe("unmapped");
    expect(status.assetPath).toBeNull();
  });

  it("starts pending for a mapped environmentId (async GLB load)", async () => {
    const mod = await load();
    const loadFn = mod["loadInfinigenEnvironmentIntoStation"] as
      | ((input: unknown) => { state: string; assetPath: string | null })
      | undefined;
    const scene = new Group() as never;
    const status = loadFn!({
      scene,
      environmentId: "ed_exam_bay_v1",
      stationEnvironment: new Group(),
      onStatus: () => {},
    });
    expect(status.state).toBe("pending");
    expect(status.assetPath).toBe("/xr-assets/environment/infinigen-ed-exam-bay.glb");
  });
});

/**
 * PLANTED CONTRACTS (#342). The composite station rendered a blank grey viewport while the
 * #336 contracts above were green, because both of their fixtures avoid the failure class.
 *
 * Measured from the LIVE scene graph before the fix (ED chest pain, scene-overview):
 *   dining-room_00floor  world y = -0.076   (humanoids ground at y=0; nurse lowest vertex -0.02)
 *   openclinxr.ed-chest-pain.floor          VISIBLE, y -0.08..0, z -2.5..0.95  (procedural floor
 *                                           still drawing on top of the generated one)
 *
 * Cause of both: a NAME MISMATCH the #336 fixtures could not exhibit.
 *   - `positionInfinigenRoom` matched `.floor` (dotted). The fixture above is named
 *     `infinigen_room_0/0.floor` — dotted — so it matched. The shipped bake is
 *     `dining-room_00floor` — NOT dotted — so it never matched, and the no-floor fallback
 *     (`box.min.y + 0.2`) placed the room 0.0755 m low.
 *   - `hideProceduralShellMeshes` matched the name `openclinxr.station-environment.floor`.
 *     main.ts renames that mesh to `openclinxr.<scenario>.floor` AFTER buildStationEnvironment
 *     returns, so the live floor was never hidden. The #336 fixture sets the pre-rename name.
 *
 * Header IMMUTABLE — append ## FIXED (#342) below.
 */
describe("Infinigen room placement against the SHIPPED bake's names (#342)", () => {
  it("finds the floor when the bake names it without a dot, as the shipped GLB does", async () => {
    const mod = await load();
    const position = mod["positionInfinigenRoom"] as
      | ((roomRoot: Group, stationEnvironment: Group) => { floorTopY: number })
      | undefined;
    expect(position).toBeTypeOf("function");

    // Real names from the shipped bake, read off the live scene graph.
    const roomRoot = new Group();
    const floorPlane = new Mesh(new BoxGeometry(6.38, 0.0, 6.25), new MeshStandardMaterial());
    floorPlane.name = "dining-room_00floor";
    floorPlane.position.y = 0;
    const wall = new Mesh(new BoxGeometry(6.38, 2.41, 6.38), new MeshStandardMaterial());
    wall.name = "dining-room_00wall";
    wall.position.y = -0.0755 + 2.41 / 2;
    const hull = new Mesh(new BoxGeometry(6.5, 2.65, 6.5), new MeshStandardMaterial());
    hull.name = "dining-room_00exterior";
    hull.position.y = -0.1245 + 2.65 / 2;
    roomRoot.add(floorPlane, wall, hull);

    const shell = new Group();
    const shellFloor = new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial());
    shellFloor.name = "openclinxr.station-environment.floor";
    shellFloor.position.set(0, -0.04, -0.775);
    shell.userData.floorMesh = shellFloor;

    roomRoot.updateMatrixWorld(true);
    const result = position!(roomRoot, shell);

    // The floor plane IS the standing surface: it must be found, not the 0.2 m fallback band.
    expect(result.floorTopY).toBeCloseTo(0.0, 3);
    // Regression guard on the exact defect: the fallback produced +0.0755 here.
    expect(Math.abs(result.floorTopY - 0.0755)).toBeGreaterThan(0.01);
    // Floor top lands at world y=0, where every humanoid grounds.
    roomRoot.updateMatrixWorld(true);
    const floorTopWorldY = new Box3().setFromObject(floorPlane).max.y;
    expect(floorTopWorldY).toBeCloseTo(0.0, 3);
  });

  it("hides the procedural floor after main.ts has renamed it to a scenario-prefixed id", async () => {
    const mod = await load();
    const hide = mod["hideProceduralShellMeshes"] as ((shell: Group) => number) | undefined;
    expect(hide).toBeTypeOf("function");

    const shell = new Group();
    shell.name = "openclinxr.station-environment-shell";
    const floor = new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial());
    // main.ts:3335 — `floor.name = iwsdkStationSceneObjects.floor` renames it post-build.
    floor.name = "openclinxr.ed-chest-pain.floor";
    const wall = new Mesh(new BoxGeometry(0.08, 2.65, 3.45), new MeshStandardMaterial());
    wall.name = "openclinxr.station-environment.back-wall";
    const stretcher = new Mesh(new BoxGeometry(0.9, 0.9, 1.9), new MeshStandardMaterial());
    stretcher.name = "openclinxr.station-environment.fixture-slot.stretcher";
    shell.add(floor, wall, stretcher);
    shell.userData.floorMesh = floor;

    const hidden = hide!(shell);

    // The generated room's own floor plane is the replacement for this surface.
    expect(floor.visible).toBe(false);
    expect(wall.visible).toBe(false);
    expect(stretcher.visible).toBe(true);
    expect(hidden).toBe(2);
  });

  it("counts a mesh hidden once when it matches by BOTH name and floorMesh identity", async () => {
    const mod = await load();
    const hide = mod["hideProceduralShellMeshes"] as ((shell: Group) => number) | undefined;
    const shell = new Group();
    const floor = new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial());
    floor.name = "openclinxr.station-environment.floor";
    shell.add(floor);
    shell.userData.floorMesh = floor;
    expect(hide!(shell)).toBe(1);
    expect(floor.visible).toBe(false);
  });
});

/**
 * ## FIXED (#336)
 *
 * Implemented `apps/ui-xr/src/infinigen-station-environment.ts`:
 * - `INFINIGEN_ENVIRONMENT_ASSETS` maps `ed_exam_bay_v1` → baked Infinigen room GLB.
 * - `loadInfinigenEnvironmentIntoStation` loads the GLB, positions it (floor top y=0,
 *   centered on the shell floor), and hides the procedural box shell meshes on success.
 * - The procedural `buildStationEnvironment` box remains the fallback: unmapped ids and load
 *   failures leave it visible.
 * - `main.ts` calls the loader for the active environmentId (procedural box untouched).
 *
 * The room GLB is baked from Infinigen `clinical_bay.gin` seed 0 (dining-room, 6.5×6.5×2.65 m,
 * floor top y=0, centered) — reproducible by seed+config, NOT exact-dimension parameterisable
 * (MADR 0043 / #271: footprint and door placement are not inputs).
 *
 * CLAIM: a deterministic generated Infinigen room is now selected by `environmentId` in the
 * ui-xr station environment path, with the procedural box kept as fallback.
 *
 * NOT TESTED: browser/WebXR load of the GLB in a live session; interaction between the loaded
 * room and per-scenario clinical set dressing; a second environmentId row in the asset map.
 */
