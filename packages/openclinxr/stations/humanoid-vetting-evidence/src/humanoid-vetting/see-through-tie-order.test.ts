/**
 * HVE-BVH tie order (cap35 FU1 F1, FU2 F1/F2): three's Raycaster sorts hits
 * by distance only and Array.sort is stable, so equal-distance ties keep
 * insertion order — BVH traversal order on the accelerated path, (object
 * traversal, face) order on the brute-force path. sortHitsBruteForceOrder
 * restores the brute-force order using the live tree's depth-first position.
 * Every case below casts the SAME model twice — first brute force (no
 * boundsTree, Mesh.prototype.raycast), then after per-instance BVH wiring —
 * keeps object.uuid, and compares {uuid, faceIndex, distance} at every
 * index. The appended/nested case wires the base model first, appends after,
 * then strips everything back to brute force for the oracle cast, so the
 * oracle and the BVH cast share every object identity.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { sortHitsBruteForceOrder } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";

const PX = 0.5;
const PY = 0.25;
const PZ = 5;

const mat = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });

function triGeom(verts: number[]): BufferGeometry {
  const geom = new BufferGeometry();
  geom.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  geom.setIndex([0, 1, 2]);
  return geom;
}

function starGeom(faces: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < faces; i++) {
    const phi = (i * 2 * Math.PI) / faces;
    const cx = PX + 2 * Math.cos(phi);
    const cy = PY + 2 * Math.sin(phi);
    const a0 = phi * 2;
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * 2 * Math.PI) / 3;
      pos.push(cx + 5 * Math.cos(a), cy + 5 * Math.sin(a), 0);
    }
    idx.push(i * 3, i * 3 + 1, i * 3 + 2);
  }
  const geom = new BufferGeometry();
  geom.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geom.setIndex(idx);
  return geom;
}

function newMesh(name: string, geom: BufferGeometry): Mesh {
  const mesh = new Mesh(geom, mat);
  mesh.name = name;
  return mesh;
}

/** Mirror loadScene's per-instance BVH wiring. */
function accelerate(mesh: Mesh): void {
  mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { verbose: false, indirect: true });
  mesh.raycast = acceleratedRaycast;
}

/** Restore the exact brute-force path: default raycast, no bounds tree. */
function stripToBrute(mesh: Mesh): void {
  mesh.raycast = Mesh.prototype.raycast;
  delete mesh.geometry.boundsTree;
}

function allMeshes(model: Group): Mesh[] {
  const out: Mesh[] = [];
  model.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

type ShapedHit = { uuid: string; faceIndex: number; distance: number };

function castShaped(model: Group): ShapedHit[] {
  model.updateMatrixWorld(true);
  const rc = new Raycaster();
  rc.far = 100;
  rc.near = 0.01;
  rc.ray.set(new Vector3(PX, PY, PZ), new Vector3(0, 0, -1));
  return rc.intersectObject(model, true).map((h) => ({
    uuid: h.object.uuid,
    faceIndex: h.faceIndex ?? -1,
    distance: h.distance,
  }));
}

describe("brute-force tie order", () => {
  it("cross-mesh coplanar ties keep traversal order on both paths", () => {
    const model = new Group();
    const ma = newMesh("tie-mesh-a", triGeom([-5, -1, 0, 6, -1, 0, 8, 3, 0]));
    const mb = newMesh("tie-mesh-b", triGeom([-5, -1, 0, 6, -1, 0, -10, 3, 0]));
    model.add(ma, mb);
    const brute = castShaped(model);
    expect(brute).toEqual([
      { uuid: ma.uuid, faceIndex: 0, distance: 5 },
      { uuid: mb.uuid, faceIndex: 0, distance: 5 },
    ]);
    for (const m of allMeshes(model)) accelerate(m);
    const rc = new Raycaster();
    rc.far = 100;
    rc.near = 0.01;
    rc.ray.set(new Vector3(PX, PY, PZ), new Vector3(0, 0, -1));
    const vHits = rc.intersectObject(model, true);
    sortHitsBruteForceOrder(model, vHits);
    expect(
      vHits.map((h) => ({ uuid: h.object.uuid, faceIndex: h.faceIndex ?? -1, distance: h.distance })),
    ).toEqual(brute);
  });

  it("same-mesh coplanar ties resolve to brute-force face order with the helper", () => {
    const model = new Group();
    const solo = newMesh("tie-solo", starGeom(24));
    model.add(solo);
    const brute = castShaped(model);
    expect(brute.map((h) => h.faceIndex)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(brute[0]).toEqual({ uuid: solo.uuid, faceIndex: 0, distance: 5 });
    for (const m of allMeshes(model)) accelerate(m);
    const rc = new Raycaster();
    rc.far = 100;
    rc.near = 0.01;
    rc.ray.set(new Vector3(PX, PY, PZ), new Vector3(0, 0, -1));
    const vHits = rc.intersectObject(model, true);
    // The hazard is real on three-mesh-bvh 0.9.14: traversal order differs.
    expect(vHits.map((h) => h.faceIndex)).not.toEqual(brute.map((h) => h.faceIndex));
    expect(vHits[0]?.faceIndex).not.toBe(0);
    sortHitsBruteForceOrder(model, vHits);
    expect(vHits.map((h) => ({ uuid: h.object.uuid, faceIndex: h.faceIndex ?? -1, distance: h.distance }))).toEqual(
      brute,
    );
  });

  it("meshes appended or nested after BVH wiring sort at their live brute-force position", () => {
    const model = new Group();
    const solo = newMesh("tie-solo", starGeom(24));
    model.add(solo);
    for (const m of allMeshes(model)) accelerate(m);
    // Append AFTER wiring: a nested mesh (child of an existing child) and a
    // direct child, both coplanar with the base star at the same distance.
    const nested = newMesh("tie-nested", triGeom([-5, -1, 0, 6, -1, 0, 8, 3, 0]));
    solo.add(nested);
    const appended = newMesh("tie-appended", triGeom([-5, -1, 0, 6, -1, 0, -10, 3, 0]));
    model.add(appended);
    // Oracle: strip everything back to the exact brute-force path (same uuids).
    for (const m of allMeshes(model)) stripToBrute(m);
    const brute = castShaped(model);
    expect(brute).toEqual([
      ...Array.from({ length: 24 }, (_, i) => ({ uuid: solo.uuid, faceIndex: i, distance: 5 })),
      { uuid: nested.uuid, faceIndex: 0, distance: 5 },
      { uuid: appended.uuid, faceIndex: 0, distance: 5 },
    ]);
    // BVH path over the same objects, then the live-tree tie order.
    for (const m of allMeshes(model)) accelerate(m);
    const rc = new Raycaster();
    rc.far = 100;
    rc.near = 0.01;
    rc.ray.set(new Vector3(PX, PY, PZ), new Vector3(0, 0, -1));
    const vHits = rc.intersectObject(model, true);
    sortHitsBruteForceOrder(model, vHits);
    expect(vHits.map((h) => ({ uuid: h.object.uuid, faceIndex: h.faceIndex ?? -1, distance: h.distance }))).toEqual(
      brute,
    );
  });
});
