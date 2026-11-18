/**
 * Aisha-parity shadow lever (d): a DirectionalLight at the HDRI's brightest
 * direction, intensity derived so the P1a grey sphere matches. PCFSoft or
 * VSM, mapSize 4096, recorded bias.
 */

import {
  DirectionalLight,
  Mesh,
  PCFSoftShadowMap,
  VSMShadowMap,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { ParityShadows } from "./parity-types.js";

export type ShadowReadback = {
  type: "pcfsoft" | "vsm";
  mapSize: number;
  bias: number;
  intensity: number;
  direction: [number, number, number];
  directionSource: "hdr-brightest" | "spec";
  target: [number, number, number];
  /** P2b fix: meshes flagged so the key actually casts (hair) + receives. */
  casters: number;
  receivers: number;
};

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

/**
 * The subject centre arrives from the lab (framed AABB centre); target the
 * light there.
 */

export function applyParityShadow(
  scene: Scene,
  renderer: WebGLRenderer,
  root: Object3D,
  shadows: ParityShadows,
  brightestDir: [number, number, number],
  centre: [number, number, number],
): ShadowReadback {
  const type = shadows.type ?? "pcfsoft";
  const mapSize = shadows.mapSize ?? 4096;
  const bias = shadows.bias ?? (type === "vsm" ? -0.0001 : -0.00025);
  const intensity = shadows.intensity ?? 1.0;
  const direction: [number, number, number] = shadows.direction ?? brightestDir;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = type === "vsm" ? VSMShadowMap : PCFSoftShadowMap;
  const light = new DirectionalLight("#ffffff", intensity);
  light.name = "parity_shadow_key";
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = bias;
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 20;
  light.shadow.camera.left = -2;
  light.shadow.camera.right = 2;
  light.shadow.camera.top = 3;
  light.shadow.camera.bottom = -1;
  // Place 5 m out along the brightest direction from the subject centre.
  light.position.set(
    centre[0] + direction[0] * 5,
    centre[1] + direction[1] * 5,
    centre[2] + direction[2] * 5,
  );
  light.target.position.set(centre[0], centre[1], centre[2]);
  // P2b fix (step 4): the key must actually cast. three.js only renders
  // a shadow where a caster (castShadow) blocks a receiver (receiveShadow).
  // Scalp hair + brows/lashes cast (the hair-to-skin occluders); every mesh
  // receives so the face/neck/eyes record the hair shadow.
  let casters = 0;
  let receivers = 0;
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const nm = (o.name ?? "").toLowerCase();
    const isHair = nm.includes("hair") || nm.includes("brow") || nm.includes("lash");
    if (isHair && o.castShadow !== true) {
      o.castShadow = true;
      casters += 1;
    }
    if (o.receiveShadow !== true) {
      o.receiveShadow = true;
      receivers += 1;
    }
  });
  scene.add(light, light.target);
  return {
    type,
    mapSize,
    bias,
    intensity,
    direction: [round5(direction[0]), round5(direction[1]), round5(direction[2])],
    directionSource: shadows.direction ? "spec" : "hdr-brightest",
    target: [round5(centre[0]), round5(centre[1]), round5(centre[2])],
    casters,
    receivers,
  };
}
