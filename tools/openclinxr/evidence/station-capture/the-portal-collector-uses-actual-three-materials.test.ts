import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CAMERA_SWEEP_SCENE_SOURCE } from "./camera-sweep-scene.js";

function runActualCollector(scene: THREE.Scene): { occluders: Array<{ name: string }> } | { error: string } {
  const context = vm.createContext({ __openClinXrDebugScene: scene, Math, Object, Array, Infinity, NaN, isFinite }, { name: "s83" });
  // CAMERA_SWEEP_SCENE_SOURCE reads globalThis.__openClinXrDebugScene; run unchanged via vm.
  const fn = vm.runInContext(`(${CAMERA_SWEEP_SCENE_SOURCE})`, context);
  return (fn as () => unknown)() as { occluders: Array<{ name: string }> } | { error: string };
}

function buildScene(meshes: THREE.Object3D[]): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Group();
  room.name = "openclinxr.station-environment.infinigen-room";
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshStandardMaterial());
  floor.position.set(0, -0.05, 0);
  room.add(floor);
  const holder = new THREE.Group();
  for (const m of meshes) holder.add(m);
  const actorRoot = new THREE.Group();
  actorRoot.userData.openClinXrActorId = "patient-1";
  actorRoot.userData.openClinXrActorPosture = "standing";
  const bone = new THREE.Bone();
  bone.position.set(0, 0.85, -2);
  const skeleton = new THREE.Skeleton([bone]);
  const geo = new THREE.BoxGeometry(0.6, 1.7, 0.4);
  const position = geo.attributes.position;
  if (!position) throw new Error("box geometry missing position");
  const count = position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) skinWeight[i * 4] = 1;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  const skinned = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
  skinned.add(bone);
  skinned.bind(skeleton);
  skinned.position.set(0, 0.85, 0);
  actorRoot.add(skinned);
  scene.add(room);
  scene.add(holder);
  scene.add(actorRoot);
  scene.add(new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100));
  scene.updateMatrixWorld(true);
  void readFileSync;
  return scene;
}

function plane(name: string, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.75, 2.0), material);
  mesh.position.set(0, 1.0, 0.86);
  mesh.name = name;
  return mesh;
}

function occludes(meshes: THREE.Object3D[], name: string): boolean {
  const snapshot = runActualCollector(buildScene(meshes));
  if ("error" in snapshot) throw new Error(`collector error: ${snapshot.error}`);
  return snapshot.occluders.some((o) => o.name === name);
}

describe("actual collector translucent-portal classification", () => {
  it("excludes the genuinely translucent portal plane but keeps the open frame", () => {
    const portal = plane("portal-opening", new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0.18, depthWrite: false,
    }));
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12), new THREE.MeshStandardMaterial());
    jamb.position.set(-1.9, 1.0, 0.86);
    jamb.name = "portal-jamb";
    expect(occludes([portal, jamb], "portal-opening")).toBe(false);
    expect(occludes([portal, jamb], "portal-jamb")).toBe(true);
  });

  it("keeps opaque, mixed, fully-opaque-transparent, no-blending, shader and depth-writing controls blocking", () => {
    expect(occludes([plane("ctl-opaque", new THREE.MeshStandardMaterial())], "ctl-opaque")).toBe(true);
    const mixed = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 0.05),
      [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.1, depthWrite: false })],
    );
    mixed.name = "ctl-mixed";
    expect(occludes([mixed], "ctl-mixed")).toBe(true);
    const reversed = mixed.material.slice().reverse();
    const mixedReversed = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), reversed);
    mixedReversed.name = "ctl-mixed-reversed";
    expect(occludes([mixedReversed], "ctl-mixed-reversed")).toBe(true);
    expect(occludes([plane("ctl-full-opaque", new THREE.MeshStandardMaterial({
      transparent: true, opacity: 1, depthWrite: false,
    }))], "ctl-full-opaque")).toBe(true);
    expect(occludes([plane("ctl-no-blend", new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.NoBlending,
    }))], "ctl-no-blend")).toBe(true);
    expect(occludes([plane("ctl-shader", new THREE.ShaderMaterial({ transparent: true, depthWrite: false }))], "ctl-shader")).toBe(true);
    expect(occludes([plane("ctl-clinical", new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0.7, depthWrite: true,
    }))], "ctl-clinical")).toBe(true);
  });

  it("keeps unknown MeshBasicMaterial, NaN/negative opacity, and customized standard shaders blocking", () => {
    expect(occludes([plane("ctl-basic", new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.1, depthWrite: false,
    }))], "ctl-basic")).toBe(true);
    const nanMat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
    nanMat.opacity = NaN;
    expect(occludes([plane("ctl-nan", nanMat)], "ctl-nan")).toBe(true);
    const negMat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
    negMat.opacity = -0.5;
    expect(occludes([plane("ctl-neg", negMat)], "ctl-neg")).toBe(true);
    const custom = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.1, depthWrite: false });
    custom.onBeforeCompile = () => {};
    expect(occludes([plane("ctl-custom", custom)], "ctl-custom")).toBe(true);
    const protoCustom = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.1, depthWrite: false });
    Object.setPrototypeOf(protoCustom, Object.assign(Object.create(Object.getPrototypeOf(protoCustom)), { onBeforeCompile: () => {} }));
    expect(occludes([plane("ctl-proto-custom", protoCustom)], "ctl-proto-custom")).toBe(true);
  });
});
