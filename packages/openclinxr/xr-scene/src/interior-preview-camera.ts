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
};

/** Fixture node names that are a door leaf / fixture-slot door — not hull geometry. */
export const DOOR_LEAF_OCCLUDER_NAME = /door_leaf|fixture-slot\.door/i;

export function isDoorLeafOccluderName(name: string): boolean {
  return DOOR_LEAF_OCCLUDER_NAME.test(name);
}

/** World AABB union of a subtree's meshes, split by whether the name reads "exterior". */
export function roomInteriorAndHull(roomRoot: Object3D): { interior: Box3 | null; hull: Box3 | null } {
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

  const accepted: number[] = [];
  for (const candidateX of candidateXs) {
    const origin: Vec3Tuple = [candidateX, eyeY, eyeZ];
    if (lookRayHitsDoorLeaf(origin, look, doorBoxes)) continue;
    accepted.push(candidateX);
  }
  const pool = accepted.length > 0 ? accepted : [...candidateXs];

  let bestX = pool[0]!;
  let bestScore = -1;
  for (const candidateX of pool) {
    const score = nearestActorMeters(candidateX, eyeZ);
    if (score > bestScore) {
      bestScore = score;
      bestX = candidateX;
    }
  }

  return {
    eye: new Vector3(bestX, eyeY, eyeZ),
    lookAt: centre,
    interiorMin: room.min.clone(),
    interiorMax: room.max.clone(),
    wallThicknessMeters,
    nearestActorMeters: bestScore,
  };
}

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
