import { Box3, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { frameCameraForBounds } from "./candidate-capture-geometry.js";

function boundsCorners(bounds: Box3): Vector3[] {
  const min = bounds.min;
  const max = bounds.max;
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z),
  ];
}

describe("frameCameraForBounds (unrigged equipment framing)", () => {
  it("frames a scaled handheld thermometer so its long axis clears the 35° FOV with margin", () => {
    // capture pipeline: initial thermometer 1.0 (x) × 0.22 (y) × 0.22 (z) →
    // baseScale = 2.2 / 0.22 = 10 → planted AABB 10 × 2.2 × 2.2, seated on y=0.
    const baseScale = 2.2 / 0.22;
    const bounds = new Box3(
      new Vector3(-0.5 * baseScale, 0, -0.11 * baseScale),
      new Vector3(0.5 * baseScale, 0.22 * baseScale, 0.11 * baseScale),
    );

    for (const view of ["front", "side", "three_quarter"] as const) {
      const camera = new PerspectiveCamera(35, 1, 0.01, 100);
      frameCameraForBounds(camera, bounds, view);

      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const longestExtent = Math.max(size.x, size.y, size.z);
      // The fixed humanoid camera (4.8 m from origin) sits INSIDE a 10 m-long prop.
      // frameCameraForBounds must back the camera off to at least the longest extent.
      expect(camera.position.distanceTo(center)).toBeGreaterThanOrEqual(longestExtent);

      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      for (const corner of boundsCorners(bounds)) {
        const ndc = corner.clone().project(camera);
        // 0.95 (not 1.0) asserts real margin, not a borderline clip.
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(0.95);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(0.95);
        expect(ndc.z).toBeGreaterThanOrEqual(-1);
        expect(ndc.z).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the humanoid live-rig framing in view (regression guard)", () => {
    // Standing humanoid ~1.8 m tall, planted on y=0, centered on x/z.
    const bounds = new Box3(
      new Vector3(-0.4, 0, -0.25),
      new Vector3(0.4, 1.8, 0.25),
    );
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    frameCameraForBounds(camera, bounds, "front");
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    for (const corner of boundsCorners(bounds)) {
      const ndc = corner.clone().project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(0.95);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(0.95);
    }
  });
});
