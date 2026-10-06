import { describe, expect, it } from "vitest";
import {
  Bone,
  Box3,
  BoxGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { resolveFocus } from "@openclinxr/xr-scene";

/**
 * U1 mouth-front: focus=mouth derives the mouth box from the asset — the
 * union of the fitted-teeth mesh AABB and the AABB of body verts
 * dominant-weighted to orbicularis-oris bones — and refuses when no
 * fitted-teeth mesh resolves (same refusal posture as eyes, #358).
 * Synthetic scene (no GLB load): a skinned body box with oris01 skinning
 * plus a fitted-teeth box at mouth height.
 */
function mouthRoot(teeth: boolean): Object3D {
  const root = new Object3D();
  const bodyGeom = new BoxGeometry(0.4, 1.7, 0.3);
  bodyGeom.translate(0, 0.85, 0);
  const count = bodyGeom.getAttribute("position").count;
  const skinIndex = new Float32BufferAttribute(new Float32Array(count * 4), 4);
  const skinWeight = new Float32BufferAttribute(new Float32Array(count * 4), 4);
  for (let i = 0; i < count; i += 1) {
    skinIndex.setXYZW(i, 1, 0, 0, 0);
    skinWeight.setXYZW(i, 1, 0, 0, 0);
  }
  bodyGeom.setAttribute("skinIndex", skinIndex);
  bodyGeom.setAttribute("skinWeight", skinWeight);
  const rootBone = new Bone();
  rootBone.name = "root";
  const oris = new Bone();
  oris.name = "oris01";
  oris.position.set(0, 1.45, 0.1);
  rootBone.add(oris);
  const body = new SkinnedMesh(bodyGeom, new MeshBasicMaterial());
  body.name = "mpfb_test_body";
  body.add(rootBone);
  body.bind(new Skeleton([rootBone, oris]));
  root.add(body);
  if (teeth) {
    const teethGeom = new BoxGeometry(0.05, 0.03, 0.02);
    teethGeom.translate(0, 1.47, 0.12);
    const teethMesh = new Mesh(teethGeom, new MeshBasicMaterial());
    teethMesh.name = "openclinxr_fitted_teeth_test";
    root.add(teethMesh);
  }
  root.updateMatrixWorld(true);
  return root;
}

describe("mouth focus derivation", () => {
  it("frames the teeth-oris union and records the derivation", () => {
    const root = mouthRoot(true);
    const whole = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 3, 1));
    const { focusRegion, frameBounds } = resolveFocus(root, "mouth", whole);
    expect(focusRegion?.kind).toBe("mouth_box");
    if (focusRegion?.kind !== "mouth_box") throw new Error("unreachable");
    expect(focusRegion.teethVertexCount).toBeGreaterThan(0);
    expect(focusRegion.orisVertexCount).toBeGreaterThan(0);
    // Teeth box (y ~1.455-1.485) lies inside the frame.
    expect(frameBounds.min.y).toBeLessThanOrEqual(1.455);
    expect(frameBounds.max.y).toBeGreaterThanOrEqual(1.485);
    // Tighter than the whole-body fallback box.
    expect(frameBounds.getSize(new Vector3()).y).toBeLessThan(whole.getSize(new Vector3()).y);
  });

  it("refuses when no fitted-teeth mesh resolves", () => {
    const root = mouthRoot(false);
    const whole = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 3, 1));
    expect(() => resolveFocus(root, "mouth", whole)).toThrow(/unresolvable/);
  });
});
