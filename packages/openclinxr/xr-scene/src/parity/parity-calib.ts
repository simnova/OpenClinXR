/**
 * Aisha-parity calibration mode (P1a calib/spheres): hide the subject, render
 * a chrome sphere and a grey sphere at the P1a positions/radii.
 *
 * P1a placement (blender_reference.py): radius 0.035 m, gap 0.048 m either
 * side of the head_front depth point along the camera-right axis; chrome on
 * the camera-left (depth - gap*right), grey on camera-right. Centres arrive
 * in three-space (computed by the capture tool from cameras.json), so the
 * lab does no camera math here.
 */

import { Mesh, MeshStandardMaterial, SphereGeometry, type Object3D } from "three";

export type CalibSpheres = {
  radiusM: number;
  chromeCenter: [number, number, number];
  greyCenter: [number, number, number];
};

export type CalibReadback = CalibSpheres & {
  chromeMaterial: string;
  greyMaterial: string;
  subjectHidden: boolean;
};

/** P1a chrome: Principled metallic 1 / roughness 0, white base. */
export function buildChromeSphere(radiusM: number): Mesh {
  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0,
  });
  mat.name = "parity_calib_chrome";
  const mesh = new Mesh(new SphereGeometry(radiusM, 64, 32), mat);
  mesh.name = "P1A_CALIB_chrome";
  return mesh;
}

/** P1a grey: Principled base 0.18 (linear), metallic 0, roughness 0.5. */
export function buildGreySphere(radiusM: number): Mesh {
  const mat = new MeshStandardMaterial({ metalness: 0, roughness: 0.5 });
  // Numeric setRGB = working (linear) space: exact 0.18 linear like P1a.
  mat.color.setRGB(0.18, 0.18, 0.18);
  mat.name = "parity_calib_grey";
  const mesh = new Mesh(new SphereGeometry(radiusM, 64, 32), mat);
  mesh.name = "P1A_CALIB_grey";
  return mesh;
}

/** Hide the subject root, add both spheres at the recorded centres. */
export function installCalibSpheres(root: Object3D, spheres: CalibSpheres): CalibReadback {
  root.visible = false;
  const parent = root.parent;
  if (!parent) throw new Error("calib spheres: subject root has no parent scene");
  const chrome = buildChromeSphere(spheres.radiusM);
  chrome.position.set(...spheres.chromeCenter);
  const grey = buildGreySphere(spheres.radiusM);
  grey.position.set(...spheres.greyCenter);
  parent.add(chrome, grey);
  parent.updateMatrixWorld(true);
  return {
    ...spheres,
    chromeMaterial: "MeshStandardMaterial(metalness=1, roughness=0)",
    greyMaterial: "MeshStandardMaterial(color=0.18 linear, metalness=0, roughness=0.5)",
    subjectHidden: root.visible === false,
  };
}
