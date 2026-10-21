/**
 * Isolated-subject lab product-rig application (extracted from
 * isolated-subject-lab.ts by the file-size budget): eye-shading flag
 * resolution plus product rig lighting + scoped globe env. The ACES guard
 * stays in the lab (the eyeshade gate test pins it there).
 *
 * Behaviour is verbatim the lab inline block: eye runtime shading defaults
 * ON only for the portrait lab with a product rig (explicit false renders
 * the legacy eye).
 */

import type {
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { IsolatedSubjectSpec } from "./isolated-subject-lab.js";
import {
  applyProductRig,
  type ProductRigApplied,
} from "./isolated-subject-rig-variants.js";

export async function applyLabProductRig(
  scene: Scene,
  renderer: WebGLRenderer,
  spec: IsolatedSubjectSpec,
  headCentre: Vector3,
): Promise<{ productRig: ProductRigApplied | null; eyeRuntimeShading: boolean }> {
  // Eye runtime shading defaults ON only for the portrait lab with a
  // product rig; explicit false renders the legacy eye (PRE).
  const eyeRuntimeShading =
    spec.eyeRuntimeShading ?? (spec.portrait === true && spec.productEnvironmentId != null);
  const eyeScleraShade = spec.eyeScleraShade ?? eyeRuntimeShading;
  const eyeLidShadow = spec.eyeLidShadow ?? eyeRuntimeShading;
  if (eyeRuntimeShading && spec.productEnvironmentId == null) {
    throw new Error(
      "eyeRuntimeShading needs a productEnvironmentId (the globe envMap + lid margins live on the product rig) — refusing rather than shading a different rig",
    );
  }
  let productRig: ProductRigApplied | null = null;
  if (spec.productEnvironmentId) {
    productRig = await applyProductRig(scene, renderer, spec.productEnvironmentId, headCentre, {
      eyeShading: eyeRuntimeShading,
      scleraShade: eyeScleraShade,
      lidShadow: eyeLidShadow,
      scleraAtten: spec.eyeScleraAtten,
      lidBandM: spec.eyeLidBandM,
      lidDarken: spec.eyeLidDarken,
      corneaFresnel: spec.eyeCorneaFresnel,
      corneaFresnelGain: spec.eyeCorneaFresnelGain,
      corneaFresnelExponent: spec.eyeCorneaFresnelExponent,
      corneaFresnelFlat: spec.eyeCorneaFlat,
    });
  }

  // ACES guard lives in the lab (the eyeshade gate test pins it there):
  // the shaded eye is graded under ACESFilmic. This helper only resolves
  // flags and applies the rig.
  return { productRig, eyeRuntimeShading };
}
