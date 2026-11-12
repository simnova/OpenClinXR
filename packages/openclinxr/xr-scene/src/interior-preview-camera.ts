/**
 * Doorway-side interior preview camera. Shared by the product runtime
 * (`deriveInteriorPreviewCamera`) and the capture look-ray path.
 *
 * Extracted from infinigen-station-environment.ts to stay under the apps/ 600-line budget.
 */
import { Box3, Mesh, type Object3D, Vector3 } from "three";

export type Vec3Tuple = readonly [number, number, number];
export type WorldBoxTuple = { readonly min: Vec3Tuple; readonly max: Vec3Tuple };

export type InteriorPreviewCamera = {
  eye: Vector3;
  lookAt: Vector3;
  interiorMin: Vector3;
  interiorMax: Vector3;
  wallThicknessMeters: number;
  nearestActorMeters: number;
  /**
   * w0-cam-p-latch-on-full-cast: ids from `actorCasts` that failed to load and were
   * excluded from the cast box. Empty when the full cast loaded (and on the legacy
   * input, which carries no per-actor readiness), so readers can tell "full cast"
   * from "no information" without inferring it from a number.
   */
  partialCast: string[];
  /** Mixer time observed for every staged actor when the full-cast latch completed. */
  mixerTimeAtLatch: Record<string, number | null>;
};

/** Fixture node names that are a door leaf / fixture-slot door — not hull geometry. */
export const DOOR_LEAF_OCCLUDER_NAME = /door_leaf|fixture-slot\.door/i;

export function isDoorLeafOccluderName(name: string): boolean {
  return DOOR_LEAF_OCCLUDER_NAME.test(name);
}

/** Finish dressing meshes (room_clinic_finish `openclinxr_*`) carry this userData flag. */
export const FINISH_DECORATION_USER_DATA_FLAG = "openClinXrFinishDecoration";

export function isFinishDecorationMesh(obj: Object3D): boolean {
  const flag = (obj as Object3D & { userData?: Record<string, unknown> }).userData?.[
    FINISH_DECORATION_USER_DATA_FLAG
  ];
  return flag === true;
}

/** World AABB union of a subtree's meshes, split by whether the name reads "exterior". */
export function roomInteriorAndHull(roomRoot: Object3D): { interior: Box3 | null; hull: Box3 | null } {
  let interior: Box3 | null = null;
  let hull: Box3 | null = null;
  roomRoot.updateMatrixWorld(true);
  roomRoot.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh) || !obj.isMesh) return;
    if (isFinishDecorationMesh(obj)) return;
    const box = new Box3().setFromObject(obj);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) return;
    if (/exterior/i.test(obj.name)) hull = hull === null ? box : (hull as Box3).union(box);
    else interior = interior === null ? box : (interior as Box3).union(box);
  });
  return { interior, hull };
}

/**
 * Slab test: true when the segment origin→target intersects the AABB strictly before the
 * target. t=0 (origin inside) counts as a hit; a box behind the look point does not.
 */
export function lookRayHitsAabb(
  origin: Vec3Tuple,
  target: Vec3Tuple,
  box: WorldBoxTuple,
): boolean {
  const dir: [number, number, number] = [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2],
  ];
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len < 1e-6) return false;
  let tmin = 0;
  let tmax = 1;
  for (let c = 0; c < 3; c += 1) {
    const o = origin[c]!;
    const d = dir[c]!;
    const mn = box.min[c]!;
    const mx = box.max[c]!;
    if (Math.abs(d) < 1e-12) {
      if (o < mn || o > mx) return false;
      continue;
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmax < tmin) return false;
  }
  return tmax > 1e-6 && tmin < 1;
}

/** Door-leaf / fixture-slot.door world AABBs. Search root is the station, not only the room. */
export function collectDoorLeafWorldBoxes(root: Object3D): WorldBoxTuple[] {
  const boxes: WorldBoxTuple[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj: Object3D) => {
    const mesh = obj as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; visible?: boolean };
    if (mesh.isMesh !== true && mesh.isSkinnedMesh !== true) return;
    if (mesh.visible === false) return;
    if (!isDoorLeafOccluderName(obj.name ?? "")) return;
    const box = new Box3().setFromObject(obj);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) return;
    boxes.push({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    });
  });
  return boxes;
}

function lookRayHitsDoorLeaf(
  origin: Vec3Tuple,
  target: Vec3Tuple,
  doorBoxes: readonly WorldBoxTuple[],
): boolean {
  for (const box of doorBoxes) {
    if (lookRayHitsAabb(origin, target, box)) return true;
  }
  return false;
}

/**
 * #342b — where the PRODUCT's flat-preview camera must stand to see inside a CLOSED
 * generated room. Stand on the doorway side (+Z), inset by twice the measured wall
 * thickness; among candidates, take the one maximising distance to the nearest actor,
 * after rejecting any whose eye→look ray hits a door-leaf AABB before the look point.
 * If every doorway-row eye is rejected, search a finite set of deeper interior depth
 * rows derived from the measured room bounds (same x samples, same door AABBs, same
 * 2× wall clearance). Never restore a rejected candidate; return null if none clear.
 */
export function deriveInteriorPreviewCamera(input: {
  roomRoot: Object3D;
  /**
   * Legacy cast boxes. Still needed by the existing tests, which pass boxes
   * directly (finish-decoration, occlusion, infinigen-station-environment);
   * ignored whenever `stagedActorIds` is present.
   */
  actorWorldBoxes?: readonly WorldBoxTuple[];
  /**
   * w0-cam-p-b1: the scene holding the staged actor slots, and the blueprint
   * actor ids. The derivation finds each actor's root itself via the runtime's
   * userData.openClinXrActorId stamp and waits until every id is loaded
   * (>= 1 SkinnedMesh descendant under its own root) or failed; the cast box is
   * built from the loaded actors' roots only. Absent means the legacy path:
   * latch on whatever `actorWorldBoxes` holds, with an empty `partialCast`.
   */
  scene?: Object3D | null;
  stagedActorIds?: readonly string[];
  /** Ids from `stagedActorIds` whose load failed; the latch proceeds without them. */
  failedActorIds?: readonly string[];
  /** Runtime-only failure and mixer evidence folded into this existing public function. */
  latchEvidence?: {
    sceneEvidence: { assets: readonly { assetId: string; status: string }[] } | null | undefined;
    modelAssetIdForActor: (actorId: string) => string | undefined;
    mixerTimeForActor: (actorId: string) => number | null;
  };
}): InteriorPreviewCamera | null {
  const { interior, hull } = roomInteriorAndHull(input.roomRoot);
  if (interior === null) return null;
  const room: Box3 = interior;

  let actors = (input.actorWorldBoxes ?? []).filter(
    (b) => Number.isFinite(b.min[0]) && Number.isFinite(b.max[0]),
  );
  let partialCast: string[] = [];
  const mixerTimeAtLatch: Record<string, number | null> = {};
  if (input.stagedActorIds !== undefined) {
    const failedAssetIds = new Set(
      (input.latchEvidence?.sceneEvidence?.assets ?? [])
        .filter((asset) => asset.status === "failed")
        .map((asset) => asset.assetId),
    );
    const failed = new Set(
      input.failedActorIds ?? input.stagedActorIds.filter((actorId) =>
        failedAssetIds.has(input.latchEvidence?.modelAssetIdForActor(actorId) ?? ""),
      ),
    );
    partialCast = input.stagedActorIds.filter((actorId) => failed.has(actorId));
    for (const actorId of input.stagedActorIds) {
      mixerTimeAtLatch[actorId] = input.latchEvidence?.mixerTimeForActor(actorId) ?? null;
    }
    const loadedBoxes: WorldBoxTuple[] = [];
    for (const actorId of input.stagedActorIds) {
      if (failed.has(actorId)) continue;
      const root = findStampedActorRoot(input.scene ?? null, actorId);
      const boxes = root === null ? [] : collectSkinnedMeshBoxesUnderRoot(root, { refreshSkinnedBoxes: true });
      if (boxes.length === 0) return null;
      loadedBoxes.push(...boxes);
    }
    if (loadedBoxes.length === 0) return null;
    actors = loadedBoxes;
  }
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

  const eyeY = Math.min(castBox.max.y, room.max.y - wallThicknessMeters);
  const centre = new Vector3();
  castBox.getCenter(centre);
  const look: Vec3Tuple = [centre.x, centre.y, centre.z];

  const occluderRoot = input.roomRoot.parent ?? input.roomRoot;
  const doorBoxes = collectDoorLeafWorldBoxes(occluderRoot);

  const xMinClear = room.min.x + 2 * wallThicknessMeters;
  const xMaxClear = room.max.x - 2 * wallThicknessMeters;
  const zMinClear = room.min.z + 2 * wallThicknessMeters;
  const zMaxClear = room.max.z - 2 * wallThicknessMeters;
  const withinWallClearance = (x: number, z: number): boolean =>
    x >= xMinClear && x <= xMaxClear && z >= zMinClear && z <= zMaxClear;

  type EyeCandidate = { readonly x: number; readonly z: number };
  const doorwayAccepted: EyeCandidate[] = [];
  for (const candidateX of candidateXs) {
    if (!withinWallClearance(candidateX, eyeZ)) continue;
    const origin: Vec3Tuple = [candidateX, eyeY, eyeZ];
    if (lookRayHitsDoorLeaf(origin, look, doorBoxes)) continue;
    doorwayAccepted.push({ x: candidateX, z: eyeZ });
  }

  const pickFarthestFromActors = (
    pool: readonly EyeCandidate[],
  ): { readonly x: number; readonly z: number; readonly score: number } | null => {
    if (pool.length === 0) return null;
    let best = pool[0]!;
    let bestScore = -1;
    for (const candidate of pool) {
      const score = nearestActorMeters(candidate.x, candidate.z);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return { x: best.x, z: best.z, score: bestScore };
  };

  let chosen = pickFarthestFromActors(doorwayAccepted);
  if (chosen === null) {
    const zBack = zMinClear;
    const zMid = (eyeZ + zBack) / 2;
    const deeperZs: readonly number[] = [
      (eyeZ + zMid) / 2,
      zMid,
      (zMid + zBack) / 2,
      zBack,
    ];
    const deeperAccepted: EyeCandidate[] = [];
    for (const candidateZ of deeperZs) {
      if (!(candidateZ < eyeZ) || !Number.isFinite(candidateZ)) continue;
      for (const candidateX of candidateXs) {
        if (!withinWallClearance(candidateX, candidateZ)) continue;
        const origin: Vec3Tuple = [candidateX, eyeY, candidateZ];
        if (lookRayHitsDoorLeaf(origin, look, doorBoxes)) continue;
        deeperAccepted.push({ x: candidateX, z: candidateZ });
      }
    }
    chosen = pickFarthestFromActors(deeperAccepted);
  }

  if (chosen === null) return null;

  return {
    eye: new Vector3(chosen.x, eyeY, chosen.z),
    lookAt: centre,
    interiorMin: room.min.clone(),
    interiorMax: room.max.clone(),
    wallThicknessMeters,
    nearestActorMeters: chosen.score,
    partialCast,
    mixerTimeAtLatch,
  };
}

/** World AABBs of the SkinnedMesh descendants of one actor root (not the scene). */
function collectSkinnedMeshBoxesUnderRoot(
  root: Object3D,
  options?: { refreshSkinnedBoxes?: boolean },
): WorldBoxTuple[] {
  const boxes: WorldBoxTuple[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj: Object3D) => {
    const maybeSkinned = obj as Object3D & { isSkinnedMesh?: boolean; boundingBox?: Box3 | null };
    if (maybeSkinned.isSkinnedMesh !== true) return;
    // F1' D2: clear any box cached by an earlier reader so setFromObject below
    // recomputes from the current pose instead of reusing a stale bound.
    if (options?.refreshSkinnedBoxes === true) maybeSkinned.boundingBox = null;
    const box = new Box3().setFromObject(obj);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) return;
    boxes.push({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    });
  });
  return boxes;
}

export function collectActorWorldBoxes(scene: Object3D): WorldBoxTuple[] {
  return collectSkinnedMeshBoxesUnderRoot(scene);
}

/**
 * w0-cam-p-b1: outermost scene object stamped with an actor id. The runtime
 * stamps every staged slot root with userData.openClinXrActorId
 * (xr-station-room actor-staging.ts), and a loaded humanoid stamps itself the
 * same id (xr-asset-loading generated-loaders.ts) as a DESCENDANT of its slot —
 * so the first pre-order match is the slot root, the root that exists before
 * any GLB lands. Null scene (or no match) means not staged, never loaded.
 */
function findStampedActorRoot(scene: Object3D | null, actorId: string): Object3D | null {
  if (scene === null) return null;
  let found: Object3D | null = null;
  scene.updateMatrixWorld(true);
  scene.traverse((obj: Object3D) => {
    if (found !== null) return;
    const stamped = (obj as Object3D & { userData?: Record<string, unknown> }).userData?.[
      "openClinXrActorId"
    ];
    if (stamped === actorId) found = obj;
  });
  return found;
}
