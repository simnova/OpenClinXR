import { Mesh, MeshStandardMaterial, Scene, Texture } from "three";
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
  applyEyePhysical(scene, { envMapIntensity: 0.25 }, scene.environment);
  expect(eye.material.envMap).toBe(scene.environment);
  expect(eye.material.envMapIntensity).toBe(0.25);
  expect(eye.material.envMap).not.toBeNull();
});

it("keeps the eye material envMap null when the environment argument is omitted", () => {
  const { scene, eye } = makeEyeScene();
  applyEyePhysical(scene, { envMapIntensity: 0.25 });
  expect(eye.material.envMap).toBeNull();
});
