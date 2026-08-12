import { describe, expect, it } from "vitest";
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Vector3 } from "three";

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
