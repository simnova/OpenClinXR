import { Euler, Mesh, MeshStandardMaterial, Scene, Texture } from "three";
import { expect, it } from "vitest";
import { applyBrowLash, applyEyePhysical } from "./parity-materials.js";

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
  expect(readback?.params["envMapIntensity"]).toBe(0.25);
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

const browLashMaterialNames = [
  "openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_ob_patient_aisha_v1_mat",
  "openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ob_patient_aisha_v1_mat",
];

function makeBrowLashScene() {
  const scene = new Scene();
  const materials = browLashMaterialNames.map(
    (name) => new MeshStandardMaterial({ name }),
  );
  for (const material of materials) scene.add(new Mesh(undefined, material));
  return { scene, materials };
}

it.each([0, 0.25])("binds the scene environment to brows and lashes at intensity %s", (envMapIntensity) => {
  const { scene, materials } = makeBrowLashScene();
  scene.environment = new Texture();
  scene.environmentRotation.set(0, Math.PI / 2, 0);
  scene.environmentIntensity = 1.7;
  const params = { colorScale: 0.5, envMapIntensity, roughness: 0.9 };
  const readback = applyBrowLash(scene, params, scene);

  expect(readback.map((entry) => entry.params.envMapIntensity)).toEqual([envMapIntensity, envMapIntensity]);
  expect(materials.map((material) => material.envMapIntensity)).toEqual([envMapIntensity, envMapIntensity]);
  expect(materials.map((material) => material.envMap)).toEqual([scene.environment, scene.environment]);
  for (const material of materials) {
    expect(material.envMapRotation.equals(scene.environmentRotation)).toBe(true);
  }
});

it("keeps brow and lash color and roughness readbacks when the scene has no environment", () => {
  const { scene, materials } = makeBrowLashScene();
  for (const material of materials) material.color.setRGB(0.8, 0.6, 0.4);
  const params = { colorScale: 0.5, envMapIntensity: 0.25, roughness: 0.75 };
  const readback = applyBrowLash(scene, params, scene);

  expect(readback.map((entry) => entry.params)).toEqual(
    materials.map(() => ({ ...params, color: [0.4, 0.3, 0.2] })),
  );
  for (const material of materials) {
    expect(material.envMap).toBeNull();
    expect(material.color.toArray()).toEqual([0.4, 0.3, 0.2]);
    expect(material.roughness).toBe(0.75);
  }
});
