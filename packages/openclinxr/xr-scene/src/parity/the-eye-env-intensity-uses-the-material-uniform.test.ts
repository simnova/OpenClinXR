import { Euler, Mesh, MeshStandardMaterial, Scene, Texture } from "three";
import { expect, it } from "vitest";
import { applyEyePhysical } from "./parity-materials.js";

function makeEyeScene() {
  const scene = new Scene();
  const material = new MeshStandardMaterial();
  material.name = "mat_makeclothes_library_eyes_x";
  const eye = new Mesh(undefined, material);
  scene.environment = new Texture();
  scene.add(eye);
  return { scene, eye };
}

it("material.envMap non-null -> material.envMapIntensity is the uniform", () => {
  const { scene, eye } = makeEyeScene();
  const [readback] = applyEyePhysical(scene, { envMapIntensity: 0.25 }, scene);
  expect(readback?.params.envMapIntensity).toBe(0.25);
  expect(eye.material.envMap).toBe(scene.environment);
  expect(eye.material.envMapIntensity).toBe(0.25);
  expect(eye.material.envMap).not.toBeNull();
});

it("keeps the eye material envMap null when the environment argument is omitted", () => {
  const { scene, eye } = makeEyeScene();
  eye.material.envMapIntensity = 0.6;
  const [readback] = applyEyePhysical(scene, { envMapIntensity: 0.25 });
  expect(readback?.params).not.toHaveProperty("envMapIntensity");
  expect(eye.material.envMap).toBeNull();
  expect(eye.material.envMapRotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  expect(eye.material.envMapIntensity).toBe(0.6);
});

it("inherits the rotated scene environment and its intensity", () => {
  const { scene, eye } = makeEyeScene();
  scene.environmentRotation = new Euler(0, (90 * Math.PI) / 180, 0);
  scene.environmentIntensity = 1.7;
  applyEyePhysical(scene, {}, scene);
  expect(eye.material.envMapRotation.y).toBeCloseTo(Math.PI / 2, 6);
  expect(eye.material.envMapIntensity).toBe(1.7);
});

it("keeps the scene rotation when eye environment intensity is explicitly zero", () => {
  const { scene, eye } = makeEyeScene();
  scene.environmentRotation = new Euler(0, (90 * Math.PI) / 180, 0);
  scene.environmentIntensity = 1.7;
  applyEyePhysical(scene, { envMapIntensity: 0 }, scene);
  expect(eye.material.envMapRotation.y).toBeCloseTo(Math.PI / 2, 6);
  expect(eye.material.envMapIntensity).toBe(0);
});

it("inherits the default scene environment rotation and intensity", () => {
  const { scene, eye } = makeEyeScene();
  applyEyePhysical(scene, {}, scene);
  expect(eye.material.envMapRotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  expect(eye.material.envMapIntensity).toBe(1);
});
