import type { Page } from "playwright";

export const NEAR_OCCLUSION_RAYCAST_METHOD =
  "16x9 viewport-cell-centre pinhole rays; nearest positive intersection with each effectively visible mesh world AABB; near when first hit < 1.0 m";

export type NearOcclusionReading = {
  fraction: number;
  nearRayCount: number;
  rayCount: 144;
  thresholdMeters: 1;
  method: typeof NEAR_OCCLUSION_RAYCAST_METHOD;
};

/**
 * Browser-safe source shared by the capture probe and candidate refinement.
 * The caller supplies the same live camera, scene and world-box helper used by
 * the refinement, so candidate and recorded measurements cannot drift.
 */
export const NEAR_OCCLUSION_BROWSER_FUNCTION_SOURCE = String.raw`function (camera, scene, worldBoxOf) {
  const boxes = [];
  const effectivelyVisible = function (object) {
    let current = object;
    while (current && current !== scene) {
      if (current.visible === false) return false;
      current = current.parent;
    }
    return true;
  };
  scene.traverse(function (object) {
    if (!(object.isMesh || object.isSkinnedMesh)) return;
    if (!effectivelyVisible(object)) return;
    const box = worldBoxOf(object);
    if (box) boxes.push(box);
  });

  camera.updateMatrixWorld(true);
  const matrix = camera.matrixWorld.elements;
  const origin = [matrix[12], matrix[13], matrix[14]];
  const tanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
  const aspect = typeof camera.aspect === "number" && camera.aspect > 0 ? camera.aspect : 16 / 9;
  let nearRayCount = 0;
  const columns = 16;
  const rows = 9;

  const hitDistance = function (box, dx, dy, dz) {
    let tmin = 0;
    let tmax = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const value = axis === 0 ? origin[0] : axis === 1 ? origin[1] : origin[2];
      const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
      if (Math.abs(direction) < 1e-12) {
        if (value < box.min[axis] || value > box.max[axis]) return Infinity;
        continue;
      }
      let first = (box.min[axis] - value) / direction;
      let last = (box.max[axis] - value) / direction;
      if (first > last) { const swap = first; first = last; last = swap; }
      if (first > tmin) tmin = first;
      if (last < tmax) tmax = last;
      if (tmax < tmin) return Infinity;
    }
    if (tmax <= 1e-6) return Infinity;
    return tmin > 1e-6 ? tmin : tmax;
  };

  for (let row = 0; row < rows; row++) {
    const ndcY = 1 - 2 * ((row + 0.5) / rows);
    for (let column = 0; column < columns; column++) {
      const ndcX = 2 * ((column + 0.5) / columns) - 1;
      let lx = ndcX * aspect * tanHalfFov;
      let ly = ndcY * tanHalfFov;
      let lz = -1;
      const localLength = Math.hypot(lx, ly, lz);
      lx /= localLength; ly /= localLength; lz /= localLength;
      const dx = matrix[0] * lx + matrix[4] * ly + matrix[8] * lz;
      const dy = matrix[1] * lx + matrix[5] * ly + matrix[9] * lz;
      const dz = matrix[2] * lx + matrix[6] * ly + matrix[10] * lz;
      let nearest = Infinity;
      for (let i = 0; i < boxes.length; i++) {
        const distance = hitDistance(boxes[i], dx, dy, dz);
        if (distance < nearest) nearest = distance;
      }
      if (nearest < 1) nearRayCount += 1;
    }
  }
  return { fraction: nearRayCount / (columns * rows), nearRayCount: nearRayCount, rayCount: 144 };
}`;

/** Fraction of viewport rays that hit a supplied wall/door box before the encounter focus. */
export const FOREGROUND_BOX_OCCLUSION_BROWSER_FUNCTION_SOURCE = String.raw`function (camera, boxes, focusDistance) {
  camera.updateMatrixWorld(true);
  const matrix = camera.matrixWorld.elements;
  const origin = [matrix[12], matrix[13], matrix[14]];
  const tanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
  const aspect = typeof camera.aspect === "number" && camera.aspect > 0 ? camera.aspect : 16 / 9;
  let blocked = 0;
  for (let row = 0; row < 9; row++) for (let column = 0; column < 16; column++) {
    const ndcX = 2 * ((column + 0.5) / 16) - 1;
    const ndcY = 1 - 2 * ((row + 0.5) / 9);
    let lx = ndcX * aspect * tanHalfFov, ly = ndcY * tanHalfFov, lz = -1;
    const localLength = Math.hypot(lx, ly, lz);
    lx /= localLength; ly /= localLength; lz /= localLength;
    const direction = [
      matrix[0] * lx + matrix[4] * ly + matrix[8] * lz,
      matrix[1] * lx + matrix[5] * ly + matrix[9] * lz,
      matrix[2] * lx + matrix[6] * ly + matrix[10] * lz
    ];
    let nearest = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      let tmin = 0, tmax = Infinity, miss = false;
      for (let axis = 0; axis < 3 && !miss; axis++) {
        const value = origin[axis], delta = direction[axis];
        if (Math.abs(delta) < 1e-12) {
          if (value < box.min[axis] || value > box.max[axis]) miss = true;
          continue;
        }
        let first = (box.min[axis] - value) / delta;
        let last = (box.max[axis] - value) / delta;
        if (first > last) { const swap = first; first = last; last = swap; }
        if (first > tmin) tmin = first;
        if (last < tmax) tmax = last;
        if (tmax < tmin) miss = true;
      }
      const distance = miss || tmax <= 1e-6 ? Infinity : (tmin > 1e-6 ? tmin : tmax);
      if (distance < nearest) nearest = distance;
    }
    if (nearest < focusDistance) blocked += 1;
  }
  return blocked / 144;
}`;

export async function readNearOcclusionFromPage(page: Page): Promise<NearOcclusionReading> {
  const reading = await page.evaluate(`(() => {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return { fraction: 1, nearRayCount: 144, rayCount: 144 };
    scene.updateMatrixWorld(true);
    let camera = null;
    scene.traverse(function (object) {
      if (!camera && (object.isPerspectiveCamera || object.type === "PerspectiveCamera")) camera = object;
    });
    if (!camera) return { fraction: 1, nearRayCount: 144, rayCount: 144 };
    const worldBoxOf = function (object) {
      const geometry = object.geometry;
      if (!geometry) return null;
      if (!geometry.boundingBox && typeof geometry.computeBoundingBox === "function") geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      const matrix = object.matrixWorld && object.matrixWorld.elements;
      if (!bounds || !matrix) return null;
      const xs = [bounds.min.x, bounds.max.x], ys = [bounds.min.y, bounds.max.y], zs = [bounds.min.z, bounds.max.z];
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
        const x = xs[xi], y = ys[yi], z = zs[zi];
        const point = [
          matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
          matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
          matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
        ];
        for (let axis = 0; axis < 3; axis++) {
          if (point[axis] < min[axis]) min[axis] = point[axis];
          if (point[axis] > max[axis]) max[axis] = point[axis];
        }
      }
      return isFinite(min[0]) ? { min: min, max: max } : null;
    };
    const measure = (${NEAR_OCCLUSION_BROWSER_FUNCTION_SOURCE});
    return measure(camera, scene, worldBoxOf);
  })()`) as { fraction: number; nearRayCount: number; rayCount: number };
  return {
    fraction: reading.fraction,
    nearRayCount: reading.nearRayCount,
    rayCount: 144,
    thresholdMeters: 1,
    method: NEAR_OCCLUSION_RAYCAST_METHOD,
  };
}
