/**
 * #336 — Infinigen-generated station environment, selected by `environmentId`.
 *
 * Six Infinigen probe slices (#130/#135/#229/#234/#236/#271) produced evidence but no
 * consumer: `grep -rn "infinigen" apps/ui-xr/src/*.ts` was ZERO matches. This module is
 * the consumer seam — a deterministic generated room under a learner.
 *
 * Parameterisation posture (measured, #271 + #336): `wall_height` is an exact deterministic
 * gin input; absolute footprint and door placement are NOT inputs (soft objectives, sampled).
 * So the factory contract is "one reproducible room per environmentId", not "emit this exact
 * bay from the case". The shipped GLB is baked from `clinical_bay.gin` seed 0 (reproducibility
 * verified: two independent seed-0 runs produced identical floorplan footprints) with a single
 * room extracted post-process (the proven #236 technique) and centered with floor top at y=0.
 *
 * The procedural `buildStationEnvironment` box remains the FALLBACK: this loader only hides
 * the box's shell meshes (floor/walls/ceiling/trim) when its GLB actually loads; the box
 * stays visible if the environmentId is unmapped or the load fails.
 *
 * claimScope: environmentId-keyed loading of a deterministic generated Infinigen room shell
 * in the ui-xr station environment path, with the procedural box as fallback.
 * notEvidenceFor: clinical room semantics (the room is a residential-scale empty shell; clinical
 * identity comes from the parametric fixtures), Quest worn readiness, clinical validity, exact
 * dimension parameterisation of the generator, scoring validity.
 */

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, type Group, Mesh, type Object3D, type Scene, Vector3 } from "three";

/** environmentId → shipped Infinigen room GLB. Deterministic bake; add rows as rooms are produced. */
export const INFINIGEN_ENVIRONMENT_ASSETS: Readonly<Record<string, string>> = {
  ed_exam_bay_v1: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
} as const;

export type InfinigenEnvironmentStatus = {
  environmentId: string;
  state: "unmapped" | "pending" | "loaded" | "failed";
  assetPath: string | null;
  error?: string;
};

/** Shell-mesh name prefixes owned by the procedural box (not fixture slots). */
const SHELL_MESH_NAME_PREFIX = "openclinxr.station-environment.";
const FIXTURE_SLOT_PREFIX = "openclinxr.station-environment.fixture-slot.";
const SHELL_MESH_SUFFIXES = [
  "floor",
  "back-wall",
  "left-wall",
  "right-wall",
  "ceiling",
  "wall-trim",
] as const;

/**
 * #342 — a mesh is the room's standing surface when its name ends in "floor".
 *
 * Was `.floor` (a DOTTED suffix). Infinigen's single-room extraction bakes
 * `dining-room_00floor` — no dot — so the match never fired on the only shipped room and
 * `positionInfinigenRoom` silently took its no-floor fallback (`box.min.y + 0.2`), landing
 * the floor 0.0755 m BELOW y=0 while every humanoid grounds at y=0. Measured live before the
 * fix: floor plane world y = -0.076, nurse/spouse lowest vertex y = -0.02.
 */
function isFloorMeshName(name: string): boolean {
  return /floor$/.test(name.toLowerCase());
}

export function resolveInfinigenEnvironmentAsset(environmentId: string): string | null {
  return INFINIGEN_ENVIRONMENT_ASSETS[environmentId] ?? null;
}

/**
 * Hide the procedural box's shell meshes (floor/walls/ceiling/trim) while keeping fixtures,
 * so the generated room becomes the visible environment and the box stays as fallback.
 * Returns the number of shell meshes hidden.
 */
export function hideProceduralShellMeshes(stationEnvironment: Group): number {
  let hidden = 0;
  const hide = (obj: Object3D): void => {
    if (obj.visible === false) return;
    obj.visible = false;
    obj.userData.openClinXrInfinigenPolicy =
      "hidden_generated_infinigen_room_owns_shell_procedural_box_is_fallback";
    hidden += 1;
  };

  stationEnvironment.traverse((obj: Object3D) => {
    if (obj === stationEnvironment) return;
    if (!obj.name.startsWith(SHELL_MESH_NAME_PREFIX)) return;
    if (obj.name.startsWith(FIXTURE_SLOT_PREFIX)) return;
    const suffix = obj.name.slice(SHELL_MESH_NAME_PREFIX.length);
    if ((SHELL_MESH_SUFFIXES as readonly string[]).includes(suffix)) {
      hide(obj);
    }
  });

  // #342 — the floor must be hidden by IDENTITY, not by name. main.ts renames the shell's
  // floor mesh to a scenario-prefixed id (`openclinxr.ed-chest-pain.floor`) after
  // buildStationEnvironment returns, so the name match above never reached it: measured live,
  // the procedural floor stayed VISIBLE at y=0 spanning z -2.5..0.95 on top of the generated
  // room's own floor plane. The generated room's floor is the replacement for this surface —
  // it is only hidden on the same success path that adds that replacement.
  const floorMesh = stationEnvironment.userData.floorMesh;
  if (floorMesh instanceof Mesh) {
    hide(floorMesh);
  }

  return hidden;
}

/**
 * Position a loaded Infinigen room so its floor TOP sits at y=0 (matching the procedural
 * shell's floor top) and its X/Z center coincides with the shell's floor center.
 *
 * The baked GLB is already centered with the floor slab at y≈0; this re-derives the floor
 * top from the room's OWN floor mesh (see `isFloorMeshName` — name ends in "floor", dotted or
 * not; never an invented constant) so any bake offset is absorbed. Walls extend below the
 * floor slab (baked as a single shell), which is fine: the slab is the standing surface the
 * actor-floor contracts measure.
 */
export function positionInfinigenRoom(
  roomRoot: Group,
  stationEnvironment: Group,
): { center: Vector3; floorTopY: number; floorCenterZ: number; roomSizeMeters: Vector3 } {
  const box = new Box3().setFromObject(roomRoot);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Floor top = world max-y across the room's own floor mesh(es) (name ends "floor").
  let floorTopY = 0;
  const floorProbe = new Box3();
  let foundFloor = false;
  roomRoot.traverse((obj: Object3D) => {
    if (obj instanceof Mesh && obj.isMesh && isFloorMeshName(obj.name)) {
      const meshBox = new Box3().setFromObject(obj);
      if (!Number.isFinite(meshBox.max.y)) return;
      if (foundFloor) floorProbe.union(meshBox);
      else floorProbe.copy(meshBox);
      foundFloor = true;
    }
  });
  if (foundFloor) {
    floorTopY = floorProbe.max.y;
  } else {
    // No floor-named mesh (unexpected bake): fall back to the lowest y band of the whole room.
    // This fallback is a LAST RESORT, not a working path: on the shipped bake it landed the
    // room 0.0755 m low for as long as the name match was wrong (#342).
    floorTopY = box.min.y + Math.min(0.2, size.y * 0.1);
  }

  const floorCenterZ =
    stationEnvironment.userData.floorMesh instanceof Object
      ? ((stationEnvironment.userData.floorMesh as Mesh).position.z ?? 0)
      : 0;
  roomRoot.position.x -= center.x;
  roomRoot.position.y -= floorTopY;
  roomRoot.position.z = floorCenterZ - center.z;
  roomRoot.userData.openClinXrInfinigenRoom = {
    boundsMin: [box.min.x, box.min.y, box.min.z],
    boundsMax: [box.max.x, box.max.y, box.max.z],
    sizeMeters: [size.x, size.y, size.z],
    floorTopY,
    floorCenterZ,
  };
  return { center, floorTopY, floorCenterZ, roomSizeMeters: size };
}

/** A world point as a fixed-length tuple, so indexing is typed and needs no assertions. */
export type Vec3Tuple = readonly [number, number, number];

/** A world-space axis-aligned box in the plain-tuple form the camera derivation consumes. */
export type WorldBoxTuple = { readonly min: Vec3Tuple; readonly max: Vec3Tuple };

export type InteriorPreviewCamera = {
  /** World-space eye and target. Callers convert into their own rig space. */
  eye: Vector3;
  lookAt: Vector3;
  interiorMin: Vector3;
  interiorMax: Vector3;
  /** Measured hull-minus-interior gap, used as the stand-off. Not a tuned constant. */
  wallThicknessMeters: number;
  nearestActorMeters: number;
};

/**
 * #342b — MEASURED AND REJECTED: hiding the outer hull.
 *
 * `dining-room_00exterior` is 176 triangles with NO material (three default grey) and it is
 * what filled the viewport when the camera stood outside the closed shell, so hiding it looked
 * like an obvious win — both cosmetically, and as a way to make "camera outside the room" fail
 * LOUDLY instead of as a confident grey render. Both halves were measured false:
 *
 *   viewport sample        hull visible        hull hidden
 *   interior viewpoint     byte-identical at every sampled point
 *   camera outside room    (145,145,145)       (229,228,222)
 *
 * From inside, the hull is back-face culled and contributes nothing. From outside, hiding it
 * just exposes the next opaque layer — the wall's own outer face — so the failure is still a
 * flat confident field, only a different shade. The change had no observable effect in either
 * state, so it is not made. Recorded here so the next reader does not re-derive it.
 *
 * (The grey wedges at the frame edges of a correct interior view are NOT the hull: they are the
 * room's own plaster walls at grazing incidence, measured at (154,152,142) against the same
 * wall's face-on (229,228,222) — a uniform 0.67x of the same hue, i.e. less light on the same
 * material, not a hole. See MADR 0053.)
 */

/** World AABB union of a subtree's meshes, split by whether the name reads "exterior". */
function roomInteriorAndHull(roomRoot: Object3D): { interior: Box3 | null; hull: Box3 | null } {
  let interior: Box3 | null = null;
  let hull: Box3 | null = null;
  roomRoot.updateMatrixWorld(true);
  roomRoot.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh) || !obj.isMesh) return;
    const box = new Box3().setFromObject(obj);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) return;
    if (/exterior/i.test(obj.name)) hull = hull === null ? box : (hull as Box3).union(box);
    else interior = interior === null ? box : (interior as Box3).union(box);
  });
  return { interior, hull };
}

/**
 * #342b — where the PRODUCT's flat-preview camera must stand to see inside a CLOSED
 * generated room.
 *
 * The authored framing (main.ts, `wide_clean_..._three_actor_context`) is a 4.9 m pull-back
 * tuned for the PARAMETRIC box, which is open at +Z — its walls and ceiling stop at z=0.95 and
 * it has no front wall, so a camera behind it looks straight in. The Infinigen room is a closed
 * shell, and the same camera lands 2.38 m beyond its +Z face, where every ray hits the
 * untextured 176-triangle exterior hull. Measured: a flat grey viewport.
 *
 * Pulling straight back is not available indoors and neither is keeping the authored framing:
 * reproducing a 4.9 m composition from 2.2 m inside the room needs a ~99 degree fov. So the
 * viewpoint is SELECTED from measured geometry instead:
 *
 *   - stand on the doorway side (+Z, where a learner enters), inset by TWICE the measured wall
 *     thickness. The interior AABB face is the wall's OUTER surface, so one thickness only
 *     reaches the inner surface and leaves the eye coplanar with it; two clears both faces.
 *     The multiplier is the wall's own two surfaces, not a tuned stand-off.
 *   - among candidates spread across that wall, take the one MAXIMISING distance to the
 *     NEAREST actor. That is exactly "no single actor fills the frame", expressed over measured
 *     geometry rather than as a chosen coordinate.
 *   - eye height = the tallest actor's head, so the view is at the encounter's own eye line.
 *
 * This is the derivation #342 proved in the capture harness
 * (`reframeCameraForRoom`, a browser string IIFE with no unit test). It lives here now so the
 * PRODUCT owns it and the capture can photograph the product's camera instead of substituting
 * its own — the split that let "the capture works" and "the learner sees grey" both be true.
 *
 * Returns null when there is no generated room or no cast to frame: the parametric box keeps
 * its authored framing untouched.
 */
export function deriveInteriorPreviewCamera(input: {
  roomRoot: Object3D;
  actorWorldBoxes: readonly WorldBoxTuple[];
}): InteriorPreviewCamera | null {
  const { interior, hull } = roomInteriorAndHull(input.roomRoot);
  if (interior === null) return null;
  const room: Box3 = interior;

  const actors = input.actorWorldBoxes.filter(
    (b) => Number.isFinite(b.min[0]) && Number.isFinite(b.max[0]),
  );
  if (actors.length === 0) return null;

  const castBox = new Box3();
  for (const b of actors) {
    castBox.union(
      new Box3(
        new Vector3(b.min[0], b.min[1], b.min[2]),
        new Vector3(b.max[0], b.max[1], b.max[2]),
      ),
    );
  }

  // Wall thickness = how far the outer hull stands proud of the interior union on +Z.
  const wallThicknessMeters = hull === null ? 0 : Math.max(0, (hull as Box3).max.z - room.max.z);

  const nearestActorMeters = (x: number, z: number): number => {
    let best = Infinity;
    for (const b of actors) {
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
      const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
      best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
    }
    return best;
  };

  const eyeZ = room.max.z - 2 * wallThicknessMeters;
  const xLeft = room.min.x + 2 * wallThicknessMeters;
  const xRight = room.max.x - 2 * wallThicknessMeters;
  const xMid = (xLeft + xRight) / 2;
  const candidateXs: readonly number[] = [
    xLeft,
    xRight,
    xMid,
    (xLeft + xMid) / 2,
    (xMid + xRight) / 2,
  ];

  let bestX = xLeft;
  let bestScore = -1;
  for (const candidateX of candidateXs) {
    const score = nearestActorMeters(candidateX, eyeZ);
    if (score > bestScore) {
      bestScore = score;
      bestX = candidateX;
    }
  }

  // Eye at the tallest head, but never above the ceiling's stand-off band.
  const eyeY = Math.min(castBox.max.y, room.max.y - wallThicknessMeters);
  const centre = new Vector3();
  castBox.getCenter(centre);

  return {
    eye: new Vector3(bestX, eyeY, eyeZ),
    lookAt: centre,
    interiorMin: room.min.clone(),
    interiorMax: room.max.clone(),
    wallThicknessMeters,
    nearestActorMeters: bestScore,
  };
}

/**
 * Collect world AABBs of the staged actor meshes, for `deriveInteriorPreviewCamera`.
 * Skinned meshes only: the cast is what the preview must frame, and unfilled placeholder
 * primitives are not skinned.
 */
export function collectActorWorldBoxes(scene: Object3D): WorldBoxTuple[] {
  const boxes: WorldBoxTuple[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((obj: Object3D) => {
    const maybeSkinned = obj as Object3D & { isSkinnedMesh?: boolean };
    if (maybeSkinned.isSkinnedMesh !== true) return;
    const box = new Box3().setFromObject(obj);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) return;
    boxes.push({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    });
  });
  return boxes;
}

/**
 * Load the Infinigen room GLB for an environmentId and add it to the station environment.
 * Procedural box is the fallback: on success its shell meshes are hidden; on failure or
 * unmapped id nothing changes and the box stays visible.
 */
export function loadInfinigenEnvironmentIntoStation(input: {
  scene: Scene;
  environmentId: string;
  stationEnvironment: Group;
  onStatus?: (status: InfinigenEnvironmentStatus) => void;
}): InfinigenEnvironmentStatus {
  const assetPath = resolveInfinigenEnvironmentAsset(input.environmentId);
  if (!assetPath) {
    const status: InfinigenEnvironmentStatus = {
      environmentId: input.environmentId,
      state: "unmapped",
      assetPath: null,
      error: `no Infinigen room baked for environmentId ${input.environmentId}`,
    };
    input.onStatus?.(status);
    return status;
  }

  const status: InfinigenEnvironmentStatus = {
    environmentId: input.environmentId,
    state: "pending",
    assetPath,
  };
  input.onStatus?.(status);

  const loader = new GLTFLoader();
  try {
    loader.load(
      assetPath,
      (gltf) => {
        const roomRoot = gltf.scene;
        roomRoot.name = "openclinxr.station-environment.infinigen-room";
        roomRoot.userData.openClinXrEnvironmentSource = "infinigen-generated-room";
        roomRoot.userData.openClinXrEnvironmentId = input.environmentId;
        roomRoot.userData.openClinXrInfinigenPolicy =
          "generated_room_loaded_by_environmentId_procedural_box_is_fallback";
        const placement = positionInfinigenRoom(roomRoot, input.stationEnvironment);
        const hiddenShellMeshes = hideProceduralShellMeshes(input.stationEnvironment);
        roomRoot.userData.openClinXrInfinigenPlacement = placement;
        roomRoot.userData.openClinXrHiddenShellMeshes = hiddenShellMeshes;
        input.stationEnvironment.add(roomRoot);
        const loaded: InfinigenEnvironmentStatus = {
          environmentId: input.environmentId,
          state: "loaded",
          assetPath,
        };
        input.onStatus?.(loaded);
      },
      undefined,
      (error) => {
        const failed: InfinigenEnvironmentStatus = {
          environmentId: input.environmentId,
          state: "failed",
          assetPath,
          error: error instanceof Error ? error.message : String(error),
        };
        input.onStatus?.(failed);
      },
    );
  } catch (error) {
    // Synchronous throw (e.g. unresolvable asset URL in a non-browser environment) is also a
    // failure — the procedural box stays visible as the fallback.
    const failed: InfinigenEnvironmentStatus = {
      environmentId: input.environmentId,
      state: "failed",
      assetPath,
      error: error instanceof Error ? error.message : String(error),
    };
    input.onStatus?.(failed);
  }

  return status;
}
