/**
 * HVE-BVH scope guard (cap35 step 2a): the BVH acceleration in
 * see-through-pixels.ts must be per-instance only. A global
 * `Mesh.prototype.raycast = acceleratedRaycast` (or any
 * BufferGeometry.prototype patch) would change raycast behavior for every
 * other consumer in the process — this test fails if that happens.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { BufferGeometry, type Group, Mesh } from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import {
  countSeeThrough,
  loadScene,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";

const REPO_ROOT = repoRoot();
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_lit.png");
const STRUCT = join(
  REPO_ROOT,
  "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_structure.png",
);

describe("see-through BVH scope", () => {
  it("countSeeThrough leaves Mesh.prototype.raycast and BufferGeometry.prototype.computeBoundsTree untouched", async () => {
    expect(existsSync(GLB) && existsSync(LIT) && existsSync(STRUCT), "nurse files exist").toBe(true);
    const beforeRaycast = Mesh.prototype.raycast;
    const beforeCompute =
      (BufferGeometry.prototype as unknown as Record<string, unknown>)["computeBoundsTree"];
    expect(
      Mesh.prototype.raycast,
      "Mesh.prototype.raycast is the three.js built-in, not acceleratedRaycast (no global patch at import)",
    ).not.toBe(acceleratedRaycast);
    await countSeeThrough({ glbPath: GLB, litPath: LIT, structPath: STRUCT, classifySubject: true });
    expect(
      Mesh.prototype.raycast,
      "Mesh.prototype.raycast is the three.js built-in, not acceleratedRaycast (no global patch at runtime)",
    ).not.toBe(acceleratedRaycast);
    expect(Mesh.prototype.raycast, "Mesh.prototype.raycast unchanged after countSeeThrough").toBe(beforeRaycast);
    expect(
      (BufferGeometry.prototype as unknown as Record<string, unknown>)["computeBoundsTree"],
      "BufferGeometry.prototype.computeBoundsTree unchanged after countSeeThrough",
    ).toBe(beforeCompute);
    expect(
      (BufferGeometry.prototype as unknown as Record<string, unknown>)["computeBoundsTree"],
      "BufferGeometry.prototype.computeBoundsTree stays absent (no global patch)",
    ).toBeUndefined();
  }, 300_000);

  it("loadScene meshes carry an indirect per-instance MeshBVH and the accelerated raycast", async () => {
    expect(existsSync(GLB), "nurse GLB exists").toBe(true);
    const { model } = await loadScene(GLB);
    const meshes: Mesh[] = [];
    (model as Group).traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.length, "loadScene builds raycast meshes").toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(
        mesh.geometry.boundsTree,
        `${mesh.name}: geometry carries a boundsTree`,
      ).toBeInstanceOf(MeshBVH);
      expect(mesh.raycast, `${mesh.name}: instance raycast is acceleratedRaycast`).toBe(acceleratedRaycast);
      // three-mesh-bvh 0.9.14 exposes indirect mode as _indirectBuffer
      // (src/core/MeshBVH.js:65 @property doc; :184 `bvh._indirectBuffer =
      // indirectBuffer || null`): non-null iff the BVH leaves geometry.index
      // untouched, which keeps faceIndex numbering brute-force-identical.
      expect(
        (mesh.geometry.boundsTree as unknown as { _indirectBuffer: unknown })["_indirectBuffer"],
        `${mesh.name}: BVH is indirect (geometry.index untouched)`,
      ).not.toBeNull();
    }
  }, 300_000);
});
