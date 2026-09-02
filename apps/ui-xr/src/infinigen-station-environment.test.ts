import { describe, expect, it } from "vitest";
import { Box3, Group, Mesh, BoxGeometry, MeshStandardMaterial, type Vector3 } from "three";

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
    expect(resolve!("telehealth_home_visit_v1")).toBe(
      "/xr-assets/environment/infinigen-telehealth-home-visit.glb",
    );
    expect(resolve!("oncology_consult_room_v1")).toBe(
      "/xr-assets/environment/infinigen-oncology-consult.glb",
    );
    expect(resolve!("urgent_care_clinic_room_v1")).toBe(
      "/xr-assets/environment/infinigen-urgent-care-clinic.glb",
    );
    expect(resolve!("ob_triage_room_v1")).toBe(
      "/xr-assets/environment/infinigen-ob-triage.glb",
    );
    expect(resolve!("inpatient_ward_room_v1")).toBe(
      "/xr-assets/environment/infinigen-inpatient-ward.glb",
    );
    expect(resolve!("pediatric_fever_urgent_care_bay_v1")).toBe(
      "/xr-assets/environment/infinigen-pediatric-fever-urgent-care.glb",
    );
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
      environmentId: "unmapped_test_only_v1",
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
 * PLANTED CONTRACTS (#342b). The PRODUCT's default camera, not the capture path's.
 *
 * #342 derived an interior camera inside `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`
 * (`reframeCameraForRoom`, a browser string IIFE with no unit test). The capture therefore
 * photographed a camera the product never uses. Measured from the live scene graph with the
 * capture mode OFF — the product's own `wide_clean_dynamic_encounter_room_review_three_actor_context`
 * branch (main.ts:3314-3318):
 *
 *   camera world position          [0, 1.48, 4.730]      fov 55
 *   room interior world z          -4.025 .. 2.3505      (union of wall/floor/ceiling)
 *   exterior hull world z          -4.025 .. 2.4750      (the untextured 176-tri outer skin)
 *   meshes containing the camera   []                    (it is beyond the hull entirely)
 *
 * and the graded viewport
 * (.openclinxr/evidence/issue-342b/pre-fix/ed_chest_pain_priority_v1-none-viewport.png)
 * is a FLAT GREY FIELD: no floor, no walls, no actors. A learner on the default camera sees
 * nothing.
 *
 * Two rejected alternatives, both disqualified by measurement rather than taste:
 *   MOVE THE ROOM  - the camera is 2.38 m beyond the interior's +Z face, so the room must shift
 *                    >= +2.4 m. Its far wall then lands at z >= -1.63, inside the measured
 *                    ed_environment extent (z -2.09) and just behind the patient (z -0.62):
 *                    furniture and cast would intersect the wall.
 *   OPEN THE SHELL - there is no +Z wall to hide. `gltf-transform` reports the bake as four
 *                    single-primitive meshes (wall / floor / ceiling / exterior); all four walls
 *                    are ONE 190-triangle mesh. Opening it means deleting faces from a baked
 *                    mesh by hand, per bake (D1).
 * So: MOVE THE CAMERA. The product already calls this offset `desktopPreviewCameraOffsetZ`
 * (main.ts:3157) — it is a flat-preview pull-back, not the learner's position. The locomotion
 * rig, which IS the learner, sits at the origin inside the room, and in an XR session three.js
 * drives the camera from the headset pose so the offset never applies. The defect is scoped to
 * the flat desktop preview.
 *
 * Header IMMUTABLE — append ## FIXED (#342b) below.
 */
describe("product default preview camera inside a closed generated room (#342b)", () => {
  /** The shipped bake's measured world geometry, plus the live ED cast bounds. */
  const shippedRoom = (): Group => {
    const room = new Group();
    room.name = "openclinxr.station-environment.infinigen-room";
    // interior x -3.250..3.1255, y 0..2.4011, z -4.025..2.3505
    const wall = new Mesh(new BoxGeometry(6.3755, 2.4011, 6.3755), new MeshStandardMaterial());
    wall.name = "dining-room_00wall";
    wall.position.set((-3.25 + 3.1255) / 2, 2.4011 / 2, (-4.025 + 2.3505) / 2);
    const floorPlane = new Mesh(new BoxGeometry(6.3755, 0.0, 6.251), new MeshStandardMaterial());
    floorPlane.name = "dining-room_00floor";
    floorPlane.position.set((-3.25 + 3.1255) / 2, 0, (-3.9005 + 2.3505) / 2);
    // exterior hull: z reaches 2.475, so hull-minus-interior = the measured wall thickness.
    const hull = new Mesh(new BoxGeometry(6.5, 2.65, 6.5), new MeshStandardMaterial());
    hull.name = "dining-room_00exterior";
    hull.position.set(0, (-0.1245 + 2.5255) / 2, (-4.025 + 2.475) / 2);
    room.add(wall, floorPlane, hull);
    room.updateMatrixWorld(true);
    return room;
  };

  type Vec3T = readonly [number, number, number];
  type BoxT = { readonly min: Vec3T; readonly max: Vec3T };

  /** Live ED cast world bounds, measured from the same dump. */
  const edCast = (): BoxT[] => [
    { min: [-1.94, 0.28, -0.62], max: [-0.34, 1.48, 0.43] },
    { min: [0.13, -0.04, 0.07], max: [1.15, 1.69, 0.7] },
    { min: [0.94, -0.03, -0.19], max: [1.86, 1.51, 0.46] },
  ];

  type Derived = {
    eye: Vector3;
    lookAt: Vector3;
    interiorMin: Vector3;
    interiorMax: Vector3;
    wallThicknessMeters: number;
    nearestActorMeters: number;
  };
  type DeriveFn = (input: { roomRoot: Group; actorWorldBoxes: readonly BoxT[] }) => Derived | null;

  const derive = async (): Promise<DeriveFn> => {
    const mod = await load();
    const fn = mod["deriveInteriorPreviewCamera"] as DeriveFn | undefined;
    expect(fn).toBeTypeOf("function");
    if (fn === undefined) throw new Error("deriveInteriorPreviewCamera is not exported");
    return fn;
  };

  it("puts the eye inside the closed room, clear of both wall faces", async () => {
    const fn = await derive();
    const out = fn({ roomRoot: shippedRoom(), actorWorldBoxes: edCast() });
    expect(out).not.toBeNull();
    if (out === null) return;
    const { eye, interiorMin, interiorMax, wallThicknessMeters } = out;

    // The measured hull-minus-interior gap IS the wall thickness; never an invented stand-off.
    expect(wallThicknessMeters).toBeGreaterThan(0.1);

    // Strictly inside, and clear of the wall's inner face by a full thickness on every axis.
    // The pre-fix camera (world z 4.730) is 2.38 m beyond interiorMax.z and fails this.
    const axes: ReadonlyArray<readonly [number, number, number]> = [
      [interiorMin.x, eye.x, interiorMax.x],
      [interiorMin.y, eye.y, interiorMax.y],
      [interiorMin.z, eye.z, interiorMax.z],
    ];
    for (const [lo, value, hi] of axes) {
      expect(value).toBeGreaterThanOrEqual(lo + wallThicknessMeters);
      expect(value).toBeLessThanOrEqual(hi - wallThicknessMeters);
    }
    expect(eye.z).toBeLessThan(4.73);
  });

  it("COUNTERWEIGHT: beats the trivial 'any point inside' answer on actor clearance", async () => {
    const fn = await derive();
    const out = fn({ roomRoot: shippedRoom(), actorWorldBoxes: edCast() });
    expect(out).not.toBeNull();
    if (out === null) return;
    const { eye, interiorMin, interiorMax, nearestActorMeters } = out;

    const nearest = (x: number, z: number): number => {
      let best = Infinity;
      for (const b of edCast()) {
        const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
        const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
        best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
      }
      return best;
    };
    // Room centre is inside the interior, so "inside" alone is satisfiable by standing on the
    // patient. Measured: centre is 0.35 m from the nearest actor box.
    const centreClearance = nearest(
      (interiorMin.x + interiorMax.x) / 2,
      (interiorMin.z + interiorMax.z) / 2,
    );
    expect(centreClearance).toBeLessThan(0.6);
    expect(nearestActorMeters).toBeGreaterThan(centreClearance);
    // Far enough that no single actor fills the frame; and the report matches the returned eye.
    expect(nearestActorMeters).toBeGreaterThan(1.5);
    expect(nearest(eye.x, eye.z)).toBeCloseTo(nearestActorMeters, 3);
    // Eye height tracks the cast, not a constant: it is at or above the tallest actor's head.
    expect(eye.y).toBeGreaterThanOrEqual(1.69);
  });

  it("tracks the room it is given rather than returning a fixed point", async () => {
    const fn = await derive();
    const big = fn({ roomRoot: shippedRoom(), actorWorldBoxes: edCast() });

    // Same cast, a room whose +Z face is 2 m nearer. A hardcoded eye cannot follow it.
    const small = shippedRoom();
    small.traverse((o) => {
      if (o instanceof Mesh) o.position.z -= 2;
    });
    small.updateMatrixWorld(true);
    const out = fn({ roomRoot: small, actorWorldBoxes: edCast() });
    expect(big).not.toBeNull();
    expect(out).not.toBeNull();
    if (big === null || out === null) return;
    expect(out.interiorMax.z).toBeCloseTo(big.interiorMax.z - 2, 3);
    expect(out.eye.z).toBeCloseTo(big.eye.z - 2, 3);
  });

  it("returns null when no generated room is present, so the parametric box keeps its framing", async () => {
    const fn = await derive();
    const empty = new Group();
    empty.name = "openclinxr.station-environment";
    expect(fn({ roomRoot: empty, actorWorldBoxes: edCast() })).toBeNull();
    // A room with no cast cannot be framed on the encounter either.
    expect(fn({ roomRoot: shippedRoom(), actorWorldBoxes: [] })).toBeNull();
  });
});

/**
 * Door-leaf look-ray reject. The magenta fixture
 * `openclinxr.station-environment.fixture-slot.door_leaf.leaf` is a sibling of the
 * Infinigen room, so `/wall|floor|ceiling|exterior/i` never saw it. OB calibration
 * (not production numbers): +X eye look-ray crossed the leaf; left-corner
 * (-2.80, 1.54, 1.62) cleared it.
 */
describe("doorway look-ray rejects a door leaf AABB", () => {
  const shippedRoom = (): Group => {
    const room = new Group();
    room.name = "openclinxr.station-environment.infinigen-room";
    const wall = new Mesh(new BoxGeometry(6.3755, 2.4011, 6.3755), new MeshStandardMaterial());
    wall.name = "dining-room_00wall";
    wall.position.set((-3.25 + 3.1255) / 2, 2.4011 / 2, (-4.025 + 2.3505) / 2);
    const floorPlane = new Mesh(new BoxGeometry(6.3755, 0.0, 6.251), new MeshStandardMaterial());
    floorPlane.name = "dining-room_00floor";
    floorPlane.position.set((-3.25 + 3.1255) / 2, 0, (-3.9005 + 2.3505) / 2);
    const hull = new Mesh(new BoxGeometry(6.5, 2.65, 6.5), new MeshStandardMaterial());
    hull.name = "dining-room_00exterior";
    hull.position.set(0, (-0.1245 + 2.5255) / 2, (-4.025 + 2.475) / 2);
    room.add(wall, floorPlane, hull);
    room.updateMatrixWorld(true);
    return room;
  };

  type BoxT = { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  /** Actors clustered on −X so the +X doorway candidate wins on distance alone. */
  const leftClusteredCast = (): BoxT[] => [
    { min: [-2.2, 0.2, -0.4], max: [-1.1, 1.55, 0.3] },
    { min: [-1.8, 0.0, -0.1], max: [-0.7, 1.6, 0.5] },
  ];

  const stationWithDoor = (door: Mesh): { station: Group; room: Group } => {
    const station = new Group();
    station.name = "openclinxr.station-environment";
    const room = shippedRoom();
    station.add(room, door);
    station.updateMatrixWorld(true);
    return { station, room };
  };

  const derive = async () => {
    const mod = await load();
    const fn = mod["deriveInteriorPreviewCamera"] as
      | ((input: { roomRoot: Group; actorWorldBoxes: readonly BoxT[] }) => {
          eye: Vector3;
          lookAt: Vector3;
        } | null)
      | undefined;
    if (fn === undefined) throw new Error("deriveInteriorPreviewCamera is not exported");
    return fn;
  };

  it("matches fixture node names, not coordinates", async () => {
    const mod = await load();
    const match = mod["isDoorLeafOccluderName"] as ((name: string) => boolean) | undefined;
    expect(match).toBeTypeOf("function");
    expect(match!("openclinxr.station-environment.fixture-slot.door_leaf.leaf")).toBe(true);
    expect(match!("openclinxr.station-environment.fixture-slot.door")).toBe(true);
    expect(match!("dining-room_00wall")).toBe(false);
    expect(match!("kitchen_00wall")).toBe(false);
  });

  it("rejects the +X candidate whose look ray hits a door leaf, and keeps a clearing eye", async () => {
    const fn = await derive();
    const leaf = new Mesh(new BoxGeometry(0.12, 1.9, 1.4), new MeshStandardMaterial());
    leaf.name = "openclinxr.station-environment.fixture-slot.door_leaf.leaf";
    // On the +X side of the look point, between the +X eye and the left-clustered cast.
    leaf.position.set(1.6, 1.0, 1.05);
    const { room } = stationWithDoor(leaf);

    const blocked = fn({ roomRoot: shippedRoom(), actorWorldBoxes: leftClusteredCast() });
    expect(blocked).not.toBeNull();
    if (blocked === null) return;
    // Distance-only (no sibling door) prefers +X — that is the pre-fix scorer.
    expect(blocked.eye.x).toBeGreaterThan(1.5);

    const cleared = fn({ roomRoot: room, actorWorldBoxes: leftClusteredCast() });
    expect(cleared).not.toBeNull();
    if (cleared === null) return;
    // +X is refused; the surviving pool still picks by nearest-actor distance.
    expect(cleared.eye.x).toBeLessThan(blocked.eye.x - 0.5);
    expect(cleared.eye.x).not.toBeCloseTo(blocked.eye.x, 1);
  });

  it("keeps the distance winner when the leaf is off the look ray", async () => {
    const fn = await derive();
    const leaf = new Mesh(new BoxGeometry(0.12, 1.9, 0.4), new MeshStandardMaterial());
    leaf.name = "openclinxr.station-environment.fixture-slot.door_leaf.leaf";
    // Parked on +X past the look point's lateral band so the −X winner's ray never hits it.
    leaf.position.set(2.7, 1.0, -1.8);
    const { room } = stationWithDoor(leaf);

    const baseline = fn({ roomRoot: shippedRoom(), actorWorldBoxes: leftClusteredCast() });
    const withDoor = fn({ roomRoot: room, actorWorldBoxes: leftClusteredCast() });
    expect(baseline).not.toBeNull();
    expect(withDoor).not.toBeNull();
    if (baseline === null || withDoor === null) return;
    expect(withDoor.eye.x).toBeCloseTo(baseline.eye.x, 3);
    expect(withDoor.eye.z).toBeCloseTo(baseline.eye.z, 3);
  });
});

/**
 * ## FIXED (#342b)
 *
 * `deriveInteriorPreviewCamera` + `collectActorWorldBoxes` in
 * `apps/ui-xr/src/infinigen-station-environment.ts`, applied by `applyInteriorPreviewCameraOnce`
 * from the ui-xr frame loop (`main.ts`), one-shot, flat preview only, and only on the product's
 * own wide default framing.
 *
 * The viewpoint is SELECTED from measured geometry, never chosen: stand on the doorway (+Z) side
 * inset by TWICE the measured hull-minus-interior wall thickness (one thickness only reaches the
 * inner face and leaves the eye coplanar with it), take the candidate MAXIMISING distance to the
 * NEAREST actor box, and sit at the tallest actor's head height. Post-fix the eye lands at world
 * `[-3.001, 1.466, 2.102]` — inside the interior, 2.0 m from the nearest actor — and the graded
 * viewport shows floor, walls, doorway, wall board, stretcher and all three actors, against a
 * pre-fix viewport that was a uniform grey field at (145,145,145).
 *
 * Destructive probe: early-returning from `applyInteriorPreviewCameraOnce` returns the camera to
 * world `[0,1.48,4.73]` and the viewport to a flat blank field. Reverting the derivation fails
 * exactly these four contracts and no others.
 *
 * MEASURED AND REVERTED in the same slice: hiding the untextured exterior hull. From inside the
 * viewport was byte-identical; from outside it only exposed the wall's outer face. Zero
 * observable effect, so it was not shipped — see the note above `roomInteriorAndHull`.
 *
 * CLAIM: the product's default flat-preview camera stands inside the closed generated room and
 * draws the encounter for `ed_chest_pain_priority_v1`.
 *
 * NOT TESTED: the capture-mode framings, still authored for the open parametric box and
 * deliberately unchanged; any other environmentId; XR-worn behaviour (three.js drives the camera
 * from the headset pose there, so this path does not run); the warm-grey grazing-incidence wedges
 * at the frame edges (framing quality, measured as the room's own walls at 0.67x face-on
 * luminance, not a hole); fixture placement, still positioned for the 7 m parametric box.
 */

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

/**
 * #342c — fixtures must be re-anchored onto the GENERATED room's measured walls.
 *
 * Header IMMUTABLE — append ## FIXED (#342c) below.
 *
 * MEASURED on the shipped bake before this existed (live scene-graph dump, product camera,
 * .openclinxr/evidence/issue-342c/pre-fix-inventory.json): 8 visible fixture meshes lay
 * outside the generated room's floor footprint (x -3.250..3.126) — the whole wall board
 * (frame min x -3.995, i.e. 0.745 m out) and four of the five door parts (jamb/header max
 * x 3.520, i.e. 0.394 m out). Every overhang was on X; nothing was outside on Z.
 *
 * `buildStationEnvironment` runs synchronously and anchors those fixtures to the PARAMETRIC
 * box's walls; the GLB arrives later and hides that box. Nothing moved what was mounted on
 * it.
 */
describe("#342c wall fixtures re-anchor onto the generated room", () => {
  /**
   * A room shaped like the SHIPPED bake: an interior surface set plus a separate outer
   * hull standing proud by one wall thickness. Deliberately NOT a clean convex box —
   * `stub` reproduces the wall fragments the single-room extraction leaves inside the
   * footprint, which is what defeated the centre-out raycast on the real room.
   */
  function makeShellRoom(halfX: number, halfZ: number, thickness = 0.124, height = 2.4): Group {
    const room = new Group();
    room.name = "openclinxr.station-environment.infinigen-room";
    const floor = new Mesh(new BoxGeometry(halfX * 2, 0.02, halfZ * 2), new MeshStandardMaterial());
    floor.name = "generated_00floor";
    room.add(floor);
    // Interior wall surfaces at +-half; the hull is one thickness further out.
    const wall = new Mesh(new BoxGeometry(halfX * 2, height, halfZ * 2), new MeshStandardMaterial());
    wall.name = "generated_00wall";
    wall.position.set(0, height / 2, 0);
    room.add(wall);
    const stub = new Mesh(new BoxGeometry(0.1, height, 0.6), new MeshStandardMaterial());
    stub.name = "generated_00wall.stub";
    stub.position.set(-halfX * 0.3, height / 2, 0);
    room.add(stub);
    const hull = new Mesh(
      new BoxGeometry((halfX + thickness) * 2, height + thickness, (halfZ + thickness) * 2),
      new MeshStandardMaterial(),
    );
    hull.name = "generated_00exterior";
    hull.position.set(0, height / 2, 0);
    room.add(hull);
    room.updateMatrixWorld(true);
    return room;
  }

  it("measures each inner wall face by insetting the hull, not from the AABB", async () => {
    const mod = await load();
    const measure = mod.measureRoomInteriorPlanes as (r: Group) => Array<{
      wall: string;
      planeCoordinate: number;
      method: string;
    }>;
    const planes = measure(makeShellRoom(2.75, 1.75));
    const byWall = new Map(planes.map((p) => [p.wall, p]));
    // Inner faces are the wall surfaces at +-half, NOT the hull AABB at +-(half+thickness),
    // and NOT the interior stub at x -0.825 that a centre-out ray would have struck first.
    expect(byWall.get("+x")?.planeCoordinate).toBeCloseTo(2.75, 3);
    expect(byWall.get("-x")?.planeCoordinate).toBeCloseTo(-2.75, 3);
    expect(byWall.get("+z")?.planeCoordinate).toBeCloseTo(1.75, 3);
    expect(byWall.get("-z")?.planeCoordinate).toBeCloseTo(-1.75, 3);
    expect(planes.every((p) => p.method === "hull_inset")).toBe(true);
  });

  it("says aabb_fallback rather than inventing a plane when there is no hull to inset", async () => {
    const mod = await load();
    const measure = mod.measureRoomInteriorPlanes as (r: Group) => Array<{
      wall: string;
      method: string;
    }>;
    // Floor only: no exterior hull, so wall thickness cannot be measured.
    const room = new Group();
    const floor = new Mesh(new BoxGeometry(4, 0.02, 4), new MeshStandardMaterial());
    floor.name = "generated_00floor";
    room.add(floor);
    room.updateMatrixWorld(true);
    const planes = measure(room);
    expect(planes.length).toBe(4);
    expect(planes.every((p) => p.method === "aabb_fallback")).toBe(true);
  });

  it("pulls a board anchored to the 7 m box inside a 5.5 m generated room", async () => {
    const mod = await load();
    const reanchor = mod.reanchorWallFixturesToRoom as (i: {
      stationEnvironment: Group;
      roomRoot: Group;
    }) => Array<{ slotId: string; movedMeters: number }>;
    const { buildStationEnvironment } = await import("./station-environment.js");

    const shell = buildStationEnvironment({ environmentId: "ed_exam_bay_v1" });
    let board: Mesh | Group | null = null;
    shell.traverse((o) => {
      if (o.userData?.fixtureSlotId === "wall_board" && o.userData?.isMarkerCube === false) {
        board = o as Group;
      }
    });
    expect(board).not.toBeNull();
    if (!board) return;

    // The 19.25 m2 reachable-minimum footprint measured in #342b (5.5 x 3.5).
    const room = makeShellRoom(2.75, 1.75);
    const before = new Box3().setFromObject(board).min.x;
    expect(before).toBeLessThan(-2.75); // outside the small room before re-anchoring
    const moved = reanchor({ stationEnvironment: shell, roomRoot: room });
    const after = new Box3().setFromObject(board);
    expect(moved.some((m) => m.slotId === "wall_board" && Math.abs(m.movedMeters) > 0)).toBe(true);
    // Near face lands at the measured plane + the authored 0.08 m mount setback.
    expect(after.min.x).toBeCloseTo(-2.75 + 0.08, 3);
    // Counterweight: the board is not shrunk or emptied to make it fit.
    expect(Math.max(after.max.x - after.min.x, after.max.z - after.min.z)).toBeGreaterThan(1.1);
  });

  it("leaves fraction-placed furniture and the learner marker where they are", async () => {
    const mod = await load();
    const reanchor = mod.reanchorWallFixturesToRoom as (i: {
      stationEnvironment: Group;
      roomRoot: Group;
    }) => unknown;
    const { buildStationEnvironment } = await import("./station-environment.js");
    const shell = buildStationEnvironment({ environmentId: "ed_exam_bay_v1" });
    const sample = (id: string): Vector3 | null => {
      let hit: Vector3 | null = null;
      shell.traverse((o) => {
        if (o.userData?.fixtureSlotId === id) hit = o.position.clone();
      });
      return hit;
    };
    const stretcherBefore = sample("stretcher");
    const learnerBefore = sample("learner_start");
    reanchor({ stationEnvironment: shell, roomRoot: makeShellRoom(2.75, 1.75) });
    expect(sample("stretcher")).toEqual(stretcherBefore);
    expect(sample("learner_start")).toEqual(learnerBefore);
  });
});

/**
 * ## FIXED (#424) — sixth environmentId maps to its own generated room
 *
 * Flips the planted `telehealth_home_visit_v1 -> null` assertion to the shipped GLB path.
 * Seed 14 `clinical_bay.gin`, `bedroom_0` segment 2 (segment-pruned copy), `--yaw-deg 180`,
 * `--drop-interior-hull-faces` DEFAULT ON, predicate DEFAULT ON. Predicate PASSES: floorAspect
 * 1.518, floorArea 59.44 m2, ceilingHeight 2.407 m, hullFrontFacingToDoorwayEyeCount 0,
 * doorwayCandidateSurviveCount 5; +Z hull 0.1214 m (world). Shipped bytes
 * `infinigen-telehealth-home-visit.glb` SHA-256 `476a8e402b2dc8c4f2023536f225325a16006828cd4e865880311923a811aa01`,
 * signature 4 meshes / 3 materials / 6 textures / extent 9.50 x 2.65 x 6.50 m — distinct from
 * the five shipped rooms by hash AND geometric signature.
 */

/**
 * ## FIXED (#425) — eighth environmentId maps to its own generated room
 *
 * Flips the planted `oncology_consult_room_v1 -> null` assertion to the shipped GLB path and
 * moves the unmapped example to `urgent_care_clinic_room_v1` (still unmapped). Seed 17
 * `clinical_bay.gin`, `dining-room_0` segment 0, `--yaw-deg 0`, `--drop-interior-hull-faces`
 * DEFAULT ON, predicate DEFAULT ON. Predicate PASSES: floorAspect 1.046, floorArea 28.92 m2,
 * ceilingHeight 2.409 m, hullFrontFacingToDoorwayEyeCount 0, doorwayCandidateSurviveCount 5;
 * +Z hull 0.1206 m (world). Shipped bytes `infinigen-oncology-consult.glb` SHA-256
 * `65969fe479bcb6e07e7a1ffdbd314cfb3be0449a8199edc9e79549e33ec9415b`, signature 4 meshes /
 * 3 materials / 6 textures / extent 6.25 x 2.65 x 6.18 m — distinct from the seven shipped
 * rooms by hash AND geometric signature.
 */

/**
 * ## FIXED — ninth environmentId maps to its own generated room
 *
 * Flips the planted `urgent_care_clinic_room_v1 -> null` assertion to the shipped GLB path
 * and moves the unmapped example to `surgical_ward_room_v1` (still unmapped). Seed 22
 * `clinical_bay.gin`, `bedroom_0` segment 0 (segment-pruned copy keeping `bedroom_0/0.*`
 * wall/floor/ceiling/exterior), `--yaw-deg 270`, `--drop-interior-hull-faces` DEFAULT ON,
 * predicate DEFAULT ON. Predicate PASSES: floorAspect 1.052, floorArea 57.32 m2,
 * ceilingHeight 2.427 m, hullFrontFacingToDoorwayEyeCount 0, doorwayCandidateSurviveCount 4;
 * +Z hull 0.1179 m (world). Shipped bytes `infinigen-urgent-care-clinic.glb` — distinct
 * from the eight shipped rooms by hash AND geometric signature.
 */

/**
 * ## FIXED — tenth environmentId maps to its own generated room
 *
 * Flips the planted `surgical_ward_room_v1 -> null` assertion to the shipped GLB path
 * and moves the unmapped example to `stepdown_room_v1` (still unmapped). Seed 25
 * `clinical_bay.gin`, `bedroom_0` segment 0 (segment-pruned copy keeping `bedroom_0/0.*`
 * wall/floor/ceiling/exterior), `--yaw-deg 90`, `--drop-interior-hull-faces` DEFAULT ON,
 * predicate DEFAULT ON. Predicate PASSES: floorAspect 1.0, floorArea 54.74 m2,
 * ceilingHeight 2.447 m, hullFrontFacingToDoorwayEyeCount 5, doorwayCandidateSurviveCount 5;
 * +Z hull 0.1013 m (world). Shipped bytes `infinigen-surgical-ward.glb` SHA-256
 * `491c43d6fba5974ff330edc64ae85f1b43e1b201678622a4ae74b2383be37656`, signature 4 meshes /
 * 4 materials / 6 textures / extent 7.74 x 2.65 x 8.56 m — distinct from the nine shipped
 * rooms by hash AND geometric signature.
 */

/**
 * ## FIXED — eleventh environmentId maps to its own generated room
 *
 * Flips the planted `stepdown_room_v1 -> null` assertion to the shipped GLB path
 * and moves the unmapped example to `ob_triage_room_v1` (still unmapped). Seed 26
 * `clinical_bay.gin`, `bedroom_0` segment 2 (segment-pruned copy keeping `bedroom_0/2.*`
 * wall/floor/ceiling/exterior), `--yaw-deg 90`, `--drop-interior-hull-faces` DEFAULT ON,
 * predicate DEFAULT ON. Predicate PASSES: floorAspect 1.096, floorArea 65.89 m2,
 * ceilingHeight 2.402 m, hullFrontFacingToDoorwayEyeCount 0, doorwayCandidateSurviveCount 4;
 * +Z hull 0.124 m (world). Shipped bytes `infinigen-stepdown.glb` SHA-256
 * `6b098ab7e174b3cca768565bf980bb34d197f83fea4b04981d8cc06736510c5b`, signature 4 meshes /
 * 3 materials / 5 textures / extent 8.31 x 2.65 x 8.50 m — distinct from the ten shipped
 * rooms by hash AND geometric signature.
 */

/**
 * ## FIXED — twelfth environmentId maps to its own generated room
 *
 * Flips the planted `ob_triage_room_v1 -> null` assertion to the shipped GLB path
 * and moves the unmapped example to `inpatient_ward_room_v1` (still unmapped). Seed 27
 * `clinical_bay.gin`, `dining-room_0` segment 0 (segment-pruned copy keeping
 * `dining-room_0/0.*` wall/floor/ceiling/exterior), `--yaw-deg 180`,
 * `--drop-interior-hull-faces` DEFAULT ON, predicate DEFAULT ON. Predicate PASSES:
 * floorAspect 1.251, floorArea 28.79 m2, ceilingHeight 2.448 m,
 * hullFrontFacingToDoorwayEyeCount 0, doorwayCandidateSurviveCount 5; +Z hull 0.1012 m
 * (world). Shipped bytes `infinigen-ob-triage.glb` SHA-256
 * `f2e11babc41b70d5ae991452ca074a51ffea3c868d543b2f24ddaf377017f625`, signature 4 meshes /
 * 3 materials / 6 textures / extent 7.5 x 2.65 x 5.58 m — distinct from the eleven shipped
 * rooms by hash AND geometric signature.
 */

/**
 * ## FIXED — thirteenth environmentId maps to its own generated room
 *
 * Flips the planted `inpatient_ward_room_v1 -> null` assertion to the shipped GLB path
 * and moves the unmapped example to `pediatric_fever_urgent_care_bay_v1` (still unmapped).
 * Seed 29 `clinical_bay.gin`, `bedroom_0` segment 0, `--yaw-deg 180`. Predicate PASSES.
 * SHA-256 `9424e4f6d42f8726ef5a042cc821cc89e9701b429e6acd7dfd02e83671dacbae`.
 */

/**
 * ## FIXED — fourteenth environmentId maps to its own generated room
 *
 * Flips the planted `pediatric_fever_urgent_care_bay_v1 -> null` assertion to the shipped
 * GLB path. There is no 15th real environmentId; the unmapped example is now the synthetic
 * id `unmapped_test_only_v1` (not in the descriptor bank). Seed 34 `clinical_bay.gin`,
 * `bedroom_0` segment 1 (segment-pruned copy keeping `bedroom_0/1.*`), `--yaw-deg 0`,
 * `--drop-interior-hull-faces` DEFAULT ON, predicate DEFAULT ON. Predicate PASSES:
 * floorAspect 1.035, floorArea 40.83 m2, ceilingHeight 2.431 m,
 * hullFrontFacingToDoorwayEyeCount 0, doorwayCandidateSurviveCount 5; +Z hull 0.1095 m
 * (world). Shipped bytes `infinigen-pediatric-fever-urgent-care.glb` SHA-256
 * `8cc0a75d424baa3c7a20c70ae5bded59a939ba2de69bed1157746b8591a862b9`. Seeds 30/31 crashed
 * (Concrete.generate(vertical) / room_floors not callable); 32/33 complete with no
 * hulled+predicate-pass bay. Distinct from the thirteen shipped rooms by hash AND
 * geometric signature. Last real descriptor.
 */
