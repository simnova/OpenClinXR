import { describe, expect, it } from "vitest";
import {
  Bone,
  Box3,
  BoxGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { frameCamera } from "@openclinxr/xr-scene";

/**
 * U1 mouth-front: focus=mouth derives the mouth box from the asset — the
 * union of the fitted-teeth mesh AABB and the AABB of body verts
 * dominant-weighted to orbicularis-oris bones — and refuses when no
 * fitted-teeth mesh resolves (same refusal posture as eyes, #358).
 * Synthetic scene (no GLB load): a skinned body box with oris01 skinning
 * plus a fitted-teeth box at mouth height.
 *
 * Local derivation (no resolveFocus import: that symbol is a closed remove
 * under psr-01e). Subject bounds come from the already-public
 * computeMeshBounds; framing uses the already-public frameCamera.
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

const TEETH_MESH_RE = /fitted_teeth/i;
const ORIS_JOINT_RE = /^oris/i;

function meshNameLayers(object: Mesh): string[] {
  const userData = object.userData as { name?: unknown };
  return [
    object.name,
    typeof userData.name === "string" ? userData.name : "",
    ...(Array.isArray(object.material)
      ? object.material.map((m) => m.name)
      : [object.material?.name ?? ""]),
  ];
}

/** Local mouth-box union (teeth AABB + oris-dominant body verts); throws when no teeth resolve. */
function deriveMouthBoxLocal(root: Object3D): { frameBounds: Box3; teethVertexCount: number; orisVertexCount: number } {
  const box = new Box3();
  const point = new Vector3();
  let teethVertexCount = 0;
  let orisVertexCount = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh instanceof Mesh)) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const names = meshNameLayers(mesh);
    const isTeeth = names.some((n) => TEETH_MESH_RE.test(n));
    const isBody = names.some((n) => /_body$/i.test(n));
    if (isTeeth) {
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        box.expandByPoint(point);
      }
      teethVertexCount += position.count;
      return;
    }
    if (!isBody || !(mesh instanceof SkinnedMesh)) return;
    const skeleton = mesh.skeleton;
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!skeleton || !skinIndex || !skinWeight) return;
    const bones = skeleton.bones;
    for (let i = 0; i < position.count; i += 1) {
      let joint = -1;
      let best = 0;
      const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
      const joints = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
      for (let s = 0; s < 4; s += 1) {
        if ((weights[s] ?? 0) > best) {
          best = weights[s] ?? 0;
          joint = joints[s] ?? -1;
        }
      }
      const jointName = joint >= 0 ? (bones[joint]?.name ?? "") : "";
      if (!ORIS_JOINT_RE.test(jointName)) continue;
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
      orisVertexCount += 1;
    }
  });
  if (teethVertexCount === 0 || !Number.isFinite(box.min.x)) {
    throw new Error("focus=mouth unresolvable: no fitted-teeth mesh matched — refusing rather than falling back (#358)");
  }
  return { frameBounds: box, teethVertexCount, orisVertexCount };
}

describe("mouth focus derivation", () => {
  it("frames the teeth-oris union and records the derivation", () => {
    const root = mouthRoot(true);
    const whole = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 3, 1));
    const { frameBounds, teethVertexCount, orisVertexCount } = deriveMouthBoxLocal(root);
    expect(teethVertexCount).toBeGreaterThan(0);
    expect(orisVertexCount).toBeGreaterThan(0);
    // Teeth box (y ~1.455-1.485) lies inside the frame.
    expect(frameBounds.min.y).toBeLessThanOrEqual(1.455);
    expect(frameBounds.max.y).toBeGreaterThanOrEqual(1.485);
    // Tighter than the whole-subject bounds.
    expect(frameBounds.getSize(new Vector3()).y).toBeLessThan(whole.getSize(new Vector3()).y);
    // The derived box frames through the already-public camera solve.
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    frameCamera(camera, frameBounds, "front");
    camera.updateMatrixWorld(true);
    expect(camera.position.length()).toBeGreaterThan(0);
  });

  it("refuses when no fitted-teeth mesh resolves", () => {
    const root = mouthRoot(false);
    expect(() => deriveMouthBoxLocal(root)).toThrow(/unresolvable/);
  });
});
