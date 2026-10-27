import vm from "node:vm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { POSED_WORLD_BOX_SOURCE } from "../lib/posed-world-bounds.js";

const compile = (src: string): ((obj: unknown) => Record<string, number>) =>
  new vm.Script(`(${src})`).runInNewContext() as (obj: unknown) => Record<string, number>;

function makeSkinnedBox(): { scene: THREE.Scene; mesh: THREE.SkinnedMesh; bone: THREE.Bone } {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.attributes.position.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone();
  mesh.add(bone);
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  return { scene, mesh, bone };
}

// Analytic 8-corner transform of rigid BoxGeometry(1,2,3) at position(-4,1,2), rotationY 0.3.
function rigidExpected(): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const c = Math.cos(0.3);
  const s = Math.sin(0.3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const x of [-0.5, 0.5]) {
    for (const y of [-1, 1]) {
      for (const z of [-1.5, 1.5]) {
        const wx = c * x + s * z - 4;
        const wy = y + 1;
        const wz = -s * x + c * z + 2;
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy);
        maxY = Math.max(maxY, wy);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      }
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

describe("posed worldBox constant", () => {
  it("poses 24-vertex skin to exact analytic bounds", () => {
    const worldBox = compile(POSED_WORLD_BOX_SOURCE);
    expect(POSED_WORLD_BOX_SOURCE).toMatch(/child\.position\.clone\(\)/);
    const { scene, mesh, bone } = makeSkinnedBox();
    expect(mesh.geometry.attributes.position.count).toBe(24);
    const rest = worldBox(mesh);
    expect(rest.minX).toBe(-0.5);
    expect(rest.maxX).toBe(0.5);
    bone.position.x = 2;
    scene.updateMatrixWorld(true);
    mesh.skeleton.update();
    const posed = worldBox(mesh);
    expect(posed.minX).toBe(1.5);
    expect(posed.maxX).toBe(2.5);
  });

  it("matches independent analytic bounds for a rigid rotated box", () => {
    const worldBox = compile(POSED_WORLD_BOX_SOURCE);
    const rigid = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial());
    rigid.position.set(-4, 1, 2);
    rigid.rotation.y = 0.3;
    rigid.updateWorldMatrix(true, false);
    const box = worldBox(rigid);
    const expected = rigidExpected();
    expect(box.minX).toBeCloseTo(expected.minX, 10);
    expect(box.maxX).toBeCloseTo(expected.maxX, 10);
    expect(box.minY).toBeCloseTo(expected.minY, 10);
    expect(box.maxY).toBeCloseTo(expected.maxY, 10);
    expect(box.minZ).toBeCloseTo(expected.minZ, 10);
    expect(box.maxZ).toBeCloseTo(expected.maxZ, 10);
  });

  it("rest-bound variant without getVertexPosition fails the analytic assertion", () => {
    const brokenSrc = POSED_WORLD_BOX_SOURCE.replace("child.getVertexPosition(vi, v)", "void 0");
    const broken = compile(brokenSrc);
    const { scene, mesh, bone } = makeSkinnedBox();
    bone.position.x = 2;
    scene.updateMatrixWorld(true);
    mesh.skeleton.update();
    const brokenPosed = broken(mesh);
    expect(brokenPosed.minX === 1.5 && brokenPosed.maxX === 2.5).toBe(false);
  });
});
