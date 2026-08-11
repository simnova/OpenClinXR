/**
 * #280 — additive pack-framing recording for the isolated subject lab.
 *
 * Records the camera the #270 framing code chose (fov/distance/position/target)
 * and the subject's world AABB corners, so a framing audit can distinguish
 * "framing clamped / has a floor" from "framing correct, subject thin or dark".
 *
 * Recording only — this module never positions the camera. The lab calls it
 * AFTER `frameCamera` and reads the values back as evidence.
 */

import { type Box3, type PerspectiveCamera, Vector3 } from "three";

export type PackCameraRecord = {
  fov: number;
  distance: number;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
};

/** World AABB corners (rounded to mm) + the pack camera for one pack view. */
export type PackFramingRecord = {
  packCamera: PackCameraRecord | null;
  boundsMin: { x: number; y: number; z: number };
  boundsMax: { x: number; y: number; z: number };
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Record the framing `frameCamera` chose. `view` absent = legacy framing →
 * returns the null camera (bounds corners are still recorded). The target is
 * what `frameCamera` passed to `camera.lookAt`: AABB center raised 5% of the
 * subject height.
 */
export function recordPackFraming(
  camera: PerspectiveCamera,
  bounds: Box3,
  view: string | undefined,
): PackFramingRecord {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const target = new Vector3(center.x, center.y + size.y * 0.05, center.z);
  return {
    packCamera: view
      ? {
          fov: camera.fov,
          distance: camera.position.distanceTo(target),
          position: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
          },
          target: { x: target.x, y: target.y, z: target.z },
        }
      : null,
    boundsMin: { x: round3(bounds.min.x), y: round3(bounds.min.y), z: round3(bounds.min.z) },
    boundsMax: { x: round3(bounds.max.x), y: round3(bounds.max.y), z: round3(bounds.max.z) },
  };
}
