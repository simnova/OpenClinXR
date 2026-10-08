export type Vec3 = [number, number, number];
export type AxisAlignedBox = { min: Vec3; max: Vec3 };

export type GateActor = {
  id: string;
  box: AxisAlignedBox;
  heading: number;
  recumbent?: boolean;
  primary?: boolean;
};

export type GateOccluder = { box: AxisAlignedBox; actorId: string | null; name: string };
export type GateCamera = { eye: Vec3; look: Vec3; fov: number; aspect?: number };

export type ActorVisibilityReading = {
  actorId: string;
  crownVisible: boolean;
  chestVisible: boolean;
  visibleSampleCount: number;
  sampleCount: 5;
  visible: boolean;
  blockedSamples: Array<{ sample: string; blockedBy: string }>;
};

export type GateReading = {
  containedActors: number;
  totalActors: number;
  visibleActors: number;
  crownChest: ActorVisibilityReading[];
  meanFacingDeg: number;
  nearOcclusionFraction: number;
  nearRayCount: number;
  minMargin: number;
  gatePass: boolean;
};

/** Five stable AABB samples used by both the browser capture and offline solver. */
export function actorSamplePoints(box: AxisAlignedBox, recumbent = false): Array<{ name: string; point: Vec3 }> {
  const width = box.max[0] - box.min[0];
  const height = box.max[1] - box.min[1];
  const depth = box.max[2] - box.min[2];
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  if (recumbent) {
    const top = box.max[1] - height * 0.08;
    const alongX = width >= depth;
    const point = (fraction: number, minorOffset = 0): Vec3 => alongX
      ? [box.min[0] + width * fraction, top, cz + depth * minorOffset]
      : [cx + width * minorOffset, top, box.min[2] + depth * fraction];
    return [
      { name: "crown", point: point(0.1) },
      { name: "chest", point: point(0.32) },
      { name: "pelvis", point: point(0.58) },
      { name: "left_foot", point: point(0.88, -0.18) },
      { name: "right_foot", point: point(0.88, 0.18) },
    ];
  }
  return [
    { name: "crown", point: [cx, box.min[1] + height * 0.9, cz] },
    { name: "chest", point: [cx, box.min[1] + height * 0.65, cz] },
    { name: "pelvis", point: [cx, box.min[1] + height * 0.42, cz] },
    { name: "left_foot", point: [box.min[0] + width * 0.25, box.min[1] + height * 0.12, cz] },
    { name: "right_foot", point: [box.min[0] + width * 0.75, box.min[1] + height * 0.12, cz] },
  ];
}

export function rayBoxDistance(box: AxisAlignedBox, origin: Vec3, direction: Vec3): number {
  let first = 0;
  let last = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = direction[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return Infinity;
      continue;
    }
    let near = (box.min[axis] - origin[axis]) / delta;
    let far = (box.max[axis] - origin[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    first = Math.max(first, near);
    last = Math.min(last, far);
    if (last < first) return Infinity;
  }
  if (last <= 1e-6) return Infinity;
  return first > 1e-6 ? first : last;
}

export function segmentBoxHit(box: AxisAlignedBox, origin: Vec3, target: Vec3): number {
  const direction: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const hit = rayBoxDistance(box, origin, direction);
  return hit < 0.98 ? hit : Infinity;
}

/** Self-contained by design: Function#toString is the exact browser implementation. */
export function measureActorVisibility(
  origin: Vec3,
  actor: { id: string; box: AxisAlignedBox; recumbent?: boolean },
  occluders: readonly GateOccluder[],
): ActorVisibilityReading {
  const box = actor.box;
  const width = box.max[0] - box.min[0], height = box.max[1] - box.min[1], depth = box.max[2] - box.min[2];
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  let samples: Array<{ name: string; point: Vec3 }> = [
    { name: "crown", point: [cx, box.min[1] + height * 0.9, cz] },
    { name: "chest", point: [cx, box.min[1] + height * 0.65, cz] },
    { name: "pelvis", point: [cx, box.min[1] + height * 0.42, cz] },
    { name: "left_foot", point: [box.min[0] + width * 0.25, box.min[1] + height * 0.12, cz] },
    { name: "right_foot", point: [box.min[0] + width * 0.75, box.min[1] + height * 0.12, cz] },
  ];
  if (actor.recumbent === true) {
    const top = box.max[1] - height * 0.08, alongX = width >= depth;
    const point = (fraction: number, minorOffset: number): Vec3 => alongX
      ? [box.min[0] + width * fraction, top, cz + depth * minorOffset]
      : [cx + width * minorOffset, top, box.min[2] + depth * fraction];
    samples = [
      { name: "crown", point: point(0.1, 0) }, { name: "chest", point: point(0.32, 0) },
      { name: "pelvis", point: point(0.58, 0) }, { name: "left_foot", point: point(0.88, -0.18) },
      { name: "right_foot", point: point(0.88, 0.18) },
    ];
  }
  const hit = (candidate: AxisAlignedBox, target: Vec3): number => {
    let first = 0, last = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = target[axis] - origin[axis];
      if (Math.abs(delta) < 1e-12) {
        if (origin[axis] < candidate.min[axis] || origin[axis] > candidate.max[axis]) return Infinity;
        continue;
      }
      let near = (candidate.min[axis] - origin[axis]) / delta;
      let far = (candidate.max[axis] - origin[axis]) / delta;
      if (near > far) [near, far] = [far, near];
      first = Math.max(first, near); last = Math.min(last, far);
      if (last < first) return Infinity;
    }
    return last > 1e-6 && first < 0.98 ? Math.max(first, 0) : Infinity;
  };
  const blockedSamples: Array<{ sample: string; blockedBy: string }> = [];
  let visibleSampleCount = 0;
  for (const sample of samples) {
    let nearest = Infinity, blockedBy = "";
    for (const occluder of occluders) {
      if (occluder.actorId === actor.id) continue;
      if (origin[0] >= occluder.box.min[0] && origin[0] <= occluder.box.max[0]
        && origin[1] >= occluder.box.min[1] && origin[1] <= occluder.box.max[1]
        && origin[2] >= occluder.box.min[2] && origin[2] <= occluder.box.max[2]) continue;
      const distance = hit(occluder.box, sample.point);
      if (distance < nearest) { nearest = distance; blockedBy = occluder.name; }
    }
    if (nearest === Infinity) visibleSampleCount += 1;
    else blockedSamples.push({ sample: sample.name, blockedBy });
  }
  const crownVisible = !blockedSamples.some((sample) => sample.sample === "crown");
  const chestVisible = !blockedSamples.some((sample) => sample.sample === "chest");
  return { actorId: actor.id, crownVisible, chestVisible, visibleSampleCount, sampleCount: 5,
    visible: crownVisible && chestVisible, blockedSamples };
}

/**
 * The solver only needs the two samples which can satisfy the gate.  Keep this
 * alongside the detailed probe so its slab/segment semantics cannot drift.
 */
export function actorCrownChestVisibleEarly(
  origin: Vec3,
  actor: { id: string; box: AxisAlignedBox; recumbent?: boolean },
  occluders: readonly GateOccluder[],
): boolean {
  for (const sample of actorSamplePoints(actor.box, actor.recumbent)) {
    if (sample.name !== "crown" && sample.name !== "chest") continue;
    for (const occluder of occluders) {
      if (occluder.actorId === actor.id) continue;
      const box = occluder.box;
      if (origin[0] >= box.min[0] && origin[0] <= box.max[0]
        && origin[1] >= box.min[1] && origin[1] <= box.max[1]
        && origin[2] >= box.min[2] && origin[2] <= box.max[2]) continue;
      if (segmentBoxHit(box, origin, sample.point) !== Infinity) return false;
    }
  }
  return true;
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-12 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, -1];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function cameraBasis(camera: GateCamera): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalise([camera.look[0] - camera.eye[0], camera.look[1] - camera.eye[1], camera.look[2] - camera.eye[2]]);
  const right = normalise(cross(forward, [0, 1, 0]));
  return { right, up: normalise(cross(right, forward)), forward };
}

export function projectPoint(camera: GateCamera, point: Vec3): { x: number; y: number; z: number } | null {
  const basis = cameraBasis(camera);
  const delta: Vec3 = [point[0] - camera.eye[0], point[1] - camera.eye[1], point[2] - camera.eye[2]];
  const z = delta[0] * basis.forward[0] + delta[1] * basis.forward[1] + delta[2] * basis.forward[2];
  if (z <= 1e-6) return null;
  const tan = Math.tan(camera.fov * Math.PI / 360);
  const x = (delta[0] * basis.right[0] + delta[1] * basis.right[1] + delta[2] * basis.right[2]) / (z * tan * (camera.aspect ?? 16 / 9));
  const y = (delta[0] * basis.up[0] + delta[1] * basis.up[1] + delta[2] * basis.up[2]) / (z * tan);
  return { x, y, z };
}

export function projectBox(camera: GateCamera, box: AxisAlignedBox): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    const p = projectPoint(camera, [x, y, z]);
    if (!p) continue;
    count += 1; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return count >= 4 ? { minX, maxX, minY, maxY } : null;
}

/** Self-contained Three-compatible column-major projection used in-page and offline. */
export function projectBoxFromMatrices(
  view: readonly number[],
  projection: readonly number[],
  box: AxisAlignedBox,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    const vx = (view[0] ?? 0) * x + (view[4] ?? 0) * y + (view[8] ?? 0) * z + (view[12] ?? 0);
    const vy = (view[1] ?? 0) * x + (view[5] ?? 0) * y + (view[9] ?? 0) * z + (view[13] ?? 0);
    const vz = (view[2] ?? 0) * x + (view[6] ?? 0) * y + (view[10] ?? 0) * z + (view[14] ?? 0);
    const vw = (view[3] ?? 0) * x + (view[7] ?? 0) * y + (view[11] ?? 0) * z + (view[15] ?? 1);
    const cx = (projection[0] ?? 0) * vx + (projection[4] ?? 0) * vy + (projection[8] ?? 0) * vz + (projection[12] ?? 0) * vw;
    const cy = (projection[1] ?? 0) * vx + (projection[5] ?? 0) * vy + (projection[9] ?? 0) * vz + (projection[13] ?? 0) * vw;
    const cz = (projection[2] ?? 0) * vx + (projection[6] ?? 0) * vy + (projection[10] ?? 0) * vz + (projection[14] ?? 0) * vw;
    const cw = (projection[3] ?? 0) * vx + (projection[7] ?? 0) * vy + (projection[11] ?? 0) * vz + (projection[15] ?? 0) * vw;
    if (Math.abs(cw) < 1e-8) continue;
    const ndcX = cx / cw, ndcY = cy / cw, ndcZ = cz / cw;
    if (ndcZ <= -1 || ndcZ >= 1) continue;
    count += 1; minX = Math.min(minX, ndcX); maxX = Math.max(maxX, ndcX);
    minY = Math.min(minY, ndcY); maxY = Math.max(maxY, ndcY);
  }
  return count >= 4 ? { minX, maxX, minY, maxY } : null;
}

export function meanFacingDegrees(eye: Vec3, actors: readonly GateActor[]): number {
  if (actors.length === 0) return 180;
  let sum = 0;
  for (const actor of actors) {
    const cx = (actor.box.min[0] + actor.box.max[0]) / 2, cz = (actor.box.min[2] + actor.box.max[2]) / 2;
    const tx = eye[0] - cx, tz = eye[2] - cz, length = Math.hypot(tx, tz);
    let degrees = 180;
    if (length > 1e-4) {
      const cosine = Math.max(-1, Math.min(1, (Math.sin(actor.heading) * tx + Math.cos(actor.heading) * tz) / length));
      degrees = Math.acos(cosine) * 180 / Math.PI;
    }
    sum += degrees;
  }
  return sum / actors.length;
}

/** Self-contained core shared byte-for-byte with the browser probe. */
export function measureNearOcclusionFromMatrix(
  matrix: readonly number[],
  fov: number,
  aspect: number,
  boxes: readonly AxisAlignedBox[],
): { fraction: number; nearRayCount: number; rayCount: 144 } {
  const origin: Vec3 = [matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0];
  const tan = Math.tan(fov * Math.PI / 360);
  const hitDistance = (box: AxisAlignedBox, direction: Vec3): number => {
    let first = 0, last = Infinity;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = origin[axis], delta = direction[axis];
      if (Math.abs(delta) < 1e-12) {
        if (value < box.min[axis] || value > box.max[axis]) return Infinity;
        continue;
      }
      let near = (box.min[axis] - value) / delta, far = (box.max[axis] - value) / delta;
      if (near > far) [near, far] = [far, near];
      first = Math.max(first, near); last = Math.min(last, far);
      if (last < first) return Infinity;
    }
    if (last <= 1e-6) return Infinity;
    return first > 1e-6 ? first : last;
  };
  let nearRayCount = 0;
  for (let row = 0; row < 9; row += 1) for (let column = 0; column < 16; column += 1) {
    let lx = (2 * ((column + 0.5) / 16) - 1) * aspect * tan;
    const ly = (1 - 2 * ((row + 0.5) / 9)) * tan;
    let lz = -1;
    const length = Math.hypot(lx, ly, lz);
    lx /= length; lz /= length;
    const localY = ly / length;
    const direction: Vec3 = [
      (matrix[0] ?? 0) * lx + (matrix[4] ?? 0) * localY + (matrix[8] ?? 0) * lz,
      (matrix[1] ?? 0) * lx + (matrix[5] ?? 0) * localY + (matrix[9] ?? 0) * lz,
      (matrix[2] ?? 0) * lx + (matrix[6] ?? 0) * localY + (matrix[10] ?? 0) * lz,
    ];
    // The gate records a boolean per viewport cell.  Once any hit is under a
    // metre, no later box can change that result.
    for (const box of boxes) {
      if (hitDistance(box, direction) < 1) { nearRayCount += 1; break; }
    }
  }
  return { fraction: nearRayCount / 144, nearRayCount, rayCount: 144 };
}

export function cameraWorldMatrix(camera: GateCamera): number[] {
  const basis = cameraBasis(camera);
  return [
    basis.right[0], basis.right[1], basis.right[2], 0,
    basis.up[0], basis.up[1], basis.up[2], 0,
    -basis.forward[0], -basis.forward[1], -basis.forward[2], 0,
    camera.eye[0], camera.eye[1], camera.eye[2], 1,
  ];
}

export function cameraViewProjectionMatrices(camera: GateCamera): { view: number[]; projection: number[] } {
  const basis = cameraBasis(camera), eye = camera.eye;
  const view = [
    basis.right[0], basis.up[0], -basis.forward[0], 0,
    basis.right[1], basis.up[1], -basis.forward[1], 0,
    basis.right[2], basis.up[2], -basis.forward[2], 0,
    -(basis.right[0] * eye[0] + basis.right[1] * eye[1] + basis.right[2] * eye[2]),
    -(basis.up[0] * eye[0] + basis.up[1] * eye[1] + basis.up[2] * eye[2]),
    basis.forward[0] * eye[0] + basis.forward[1] * eye[1] + basis.forward[2] * eye[2], 1,
  ];
  const f = 1 / Math.tan(camera.fov * Math.PI / 360), aspect = camera.aspect ?? 16 / 9;
  const near = 0.1, far = 2_000;
  const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0,
    (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  return { view, projection };
}

export function measureNearOcclusion(camera: GateCamera, boxes: readonly AxisAlignedBox[]): { fraction: number; nearRayCount: number; rayCount: 144 } {
  return measureNearOcclusionFromMatrix(cameraWorldMatrix(camera), camera.fov, camera.aspect ?? 16 / 9, boxes);
}

export function evaluateGate(camera: GateCamera, actors: readonly GateActor[], occluders: readonly GateOccluder[]): GateReading {
  const crownChest = actors.map((actor) => measureActorVisibility(camera.eye, actor, occluders));
  const matrices = cameraViewProjectionMatrices(camera);
  const extents = actors.map((actor) => projectBoxFromMatrices(matrices.view, matrices.projection, actor.box));
  const contained = extents.map((extent, index) => {
    if (!extent) return false;
    const actor = actors[index];
    if (!actor) return false;
    if (actor.primary && extent.maxY - extent.minY < 0.36) return false;
    return extent.minX >= -0.8 && extent.maxX <= 0.8 && extent.minY >= -0.8 && extent.maxY <= 0.8 && crownChest[index]?.visible === true;
  });
  const near = measureNearOcclusion(camera, occluders.map((item) => item.box));
  const facing = meanFacingDegrees(camera.eye, actors);
  const margins = extents.filter((extent) => extent !== null).map((extent) => Math.min(extent.minX + 1, 1 - extent.maxX, extent.minY + 1, 1 - extent.maxY));
  const containedActors = contained.filter(Boolean).length;
  const visibleActors = crownChest.filter((reading) => reading.visible).length;
  return { containedActors, totalActors: actors.length, visibleActors, crownChest, meanFacingDeg: facing,
    nearOcclusionFraction: near.fraction, nearRayCount: near.nearRayCount,
    minMargin: margins.length > 0 ? Math.min(...margins) : -1,
    gatePass: actors.length > 0 && containedActors === actors.length && facing <= 90 && near.fraction <= 0.1 };
}

function browserCallableSource(fn: (...args: never[]) => unknown): string {
  return `function(){var __name=function(inner){return inner;};return (${fn.toString()}).apply(null,arguments);}`;
}

export const ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE = browserCallableSource(measureActorVisibility);
export const NEAR_OCCLUSION_MATRIX_BROWSER_FUNCTION_SOURCE = browserCallableSource(measureNearOcclusionFromMatrix);
export const PROJECT_BOX_BROWSER_FUNCTION_SOURCE = browserCallableSource(projectBoxFromMatrices);
