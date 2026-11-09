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

import {
  DirectionalLight,
  type Light,
  Matrix4,
  Quaternion,
  type Scene,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { IsolatedSubjectSpec } from "./isolated-subject-lab.js";
import {
  applyProductRig,
  type ProductRigApplied,
} from "./isolated-subject-rig-variants.js";

type ProductPatientStaging = {
  scenarioId: string;
  actorId: string;
  matrix: number[];
};

type ProductStagingBridge = {
  resolveProductPatientStagingTransform: (input: {
    scenarioId?: string;
    environmentId: string;
  }) => Promise<ProductPatientStaging>;
};

type ProductPatientYawOverride = {
  source: string;
  yawRadians: number;
};

export type LabProductRigApplied = ProductRigApplied & {
  patientStaging: ProductPatientStaging;
  labSubjectRootMatrix: number[];
  anchorMatrix: number[];
  legacyCastAnchorRemoved: true;
  patientYawOverride?: ProductPatientYawOverride & {
    baseYawRadians: number;
    appliedMatrix: number[];
  };
};

/** Preserve staging position/scale while replacing only its +Y rotation. */
export function stagedPatientRootWithYaw(
  patientStagingMatrix: number[],
  yawRadians?: number,
): Matrix4 {
  const stagedPatientRoot = new Matrix4().fromArray(patientStagingMatrix);
  if (yawRadians == null) return stagedPatientRoot;
  const position = new Vector3();
  const scale = new Vector3();
  stagedPatientRoot.decompose(position, new Quaternion(), scale);
  return new Matrix4().compose(
    position,
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawRadians),
    scale,
  );
}

/** Map app-room world coordinates into the lab while preserving patient-root coordinates. */
export function productRigAnchorMatrix(stagedPatientRoot: Matrix4, labSubjectRoot: Matrix4): Matrix4 {
  return labSubjectRoot.clone().multiply(stagedPatientRoot.clone().invert());
}

/** Replace the legacy cast-to-head translation before the product-rig frame is rendered. */
export function reanchorProductRigFromStagedPatient(input: {
  lights: Light[];
  legacyTranslation: Vector3;
  stagedPatientRoot: Matrix4;
  labSubjectRoot: Matrix4;
}): Matrix4 {
  const anchor = productRigAnchorMatrix(input.stagedPatientRoot, input.labSubjectRoot);
  for (const light of input.lights) {
    if (light.userData?.["openClinXrLightingRig"] !== true) continue;
    light.position.sub(input.legacyTranslation).applyMatrix4(anchor);
    if (light instanceof DirectionalLight) {
      light.target.position.sub(input.legacyTranslation).applyMatrix4(anchor);
    }
  }
  return anchor;
}

export async function applyLabProductRig(
  scene: Scene,
  renderer: WebGLRenderer,
  spec: IsolatedSubjectSpec,
  _headCentre: Vector3,
): Promise<{ productRig: LabProductRigApplied | null; eyeRuntimeShading: boolean }> {
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
  let productRig: LabProductRigApplied | null = null;
  if (spec.productEnvironmentId) {
    const productInputs = spec as IsolatedSubjectSpec & {
      productScenarioId?: string;
      productPatientYawOverride?: ProductPatientYawOverride;
    };
    const productScenarioId = productInputs.productScenarioId;
    const applied = await applyProductRig(scene, renderer, spec.productEnvironmentId, _headCentre, {
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
    const bridge = (window as unknown as { __openClinXrProductLightingRigFns?: ProductStagingBridge })
      .__openClinXrProductLightingRigFns;
    if (!bridge) {
      throw new Error("product rig needs the app patient-staging bridge — refusing rather than restoring castThree");
    }
    const labSubjectRoot = (window as unknown as {
      __openClinXrIsolatedSceneRoot?: { matrixWorld: Matrix4; updateMatrixWorld: (force: boolean) => void };
    }).__openClinXrIsolatedSceneRoot;
    if (!labSubjectRoot) {
      throw new Error("product rig needs the isolated lab subject root before staging can be preserved");
    }
    const patientStaging = await bridge.resolveProductPatientStagingTransform({
      environmentId: spec.productEnvironmentId,
      ...(productScenarioId ? { scenarioId: productScenarioId } : {}),
    });
    const baseYawRadians = Math.atan2(
      patientStaging.matrix[8] ?? Number.NaN,
      patientStaging.matrix[0] ?? Number.NaN,
    );
    const stagedPatientRoot = stagedPatientRootWithYaw(
      patientStaging.matrix,
      productInputs.productPatientYawOverride?.yawRadians,
    );
    labSubjectRoot.updateMatrixWorld(true);
    const lights: Light[] = [];
    scene.traverse((node) => {
      const light = node as Light;
      if (light.isLight) lights.push(light);
    });
    const anchor = reanchorProductRigFromStagedPatient({
      lights,
      legacyTranslation: new Vector3(...applied.translationDelta),
      stagedPatientRoot,
      labSubjectRoot: labSubjectRoot.matrixWorld,
    });
    scene.updateMatrixWorld(true);
    productRig = {
      ...applied,
      patientStaging,
      labSubjectRootMatrix: labSubjectRoot.matrixWorld.toArray(),
      anchorMatrix: anchor.toArray(),
      legacyCastAnchorRemoved: true,
      ...(productInputs.productPatientYawOverride
        ? {
            patientYawOverride: {
              ...productInputs.productPatientYawOverride,
              baseYawRadians,
              appliedMatrix: stagedPatientRoot.toArray(),
            },
          }
        : {}),
    };
  }

  // ACES guard lives in the lab (the eyeshade gate test pins it there):
  // the shaded eye is graded under ACESFilmic. This helper only resolves
  // flags and applies the rig.
  return { productRig, eyeRuntimeShading };
}
