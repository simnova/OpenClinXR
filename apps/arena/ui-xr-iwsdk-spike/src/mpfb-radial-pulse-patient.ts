import { Box3, type Object3D, type PerspectiveCamera, type Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RadialPulseSceneInteraction } from "./radial-pulse-scene.js";

export const radialPulsePatientAssetName = "mpfb-street-adult-male.glb" as const;
export const radialPulsePatientAssetUrl = new URL(
  "../../../ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb",
  import.meta.url,
).href;
export const radialPulseWristBoneName = "wrist.R" as const;
export const radialPulseWristRuntimeNodeName = "wristR" as const;

export async function loadMpfbRadialPulsePatient(input: {
  scene: Scene;
  camera: PerspectiveCamera;
  interaction: RadialPulseSceneInteraction;
}): Promise<Object3D> {
  try {
    const gltf = await new GLTFLoader().loadAsync(radialPulsePatientAssetUrl);
    const patient = gltf.scene;
    patient.name = "openclinxr.radial-pulse.mpfb-street-adult-male";
    normalizePatient(patient);
    input.scene.add(patient);
    poseRightArmForWristPresentation(patient);
    patient.updateWorldMatrix(true, true);
    const wrist = patient.getObjectByName(radialPulseWristRuntimeNodeName);
    if (!wrist) {
      throw new Error(`MPFB patient is missing ${radialPulseWristBoneName}`);
    }
    input.interaction.attachToWrist(wrist, radialPulsePatientAssetUrl);
    framePatientAndWrist(input.camera, patient, wrist);
    return patient;
  } catch (error) {
    input.interaction.recordPatientLoadFailure(radialPulsePatientAssetUrl);
    throw error;
  }
}

function poseRightArmForWristPresentation(patient: Object3D): void {
  const upperArm = patient.getObjectByName("upperarm01R");
  const lowerArm = patient.getObjectByName("lowerarm01R");
  const wrist = patient.getObjectByName(radialPulseWristRuntimeNodeName);
  if (!upperArm || !lowerArm || !wrist) {
    return;
  }
  upperArm.rotateZ(0.5);
  upperArm.rotateX(-0.12);
  lowerArm.rotateZ(-1.15);
  lowerArm.rotateX(0.18);
  wrist.rotateY(-0.28);
}

function normalizePatient(patient: Object3D): void {
  const initialBounds = new Box3().setFromObject(patient);
  const initialSize = initialBounds.getSize(new Vector3());
  const scale = 1.72 / Math.max(initialSize.y, 0.001);
  patient.scale.setScalar(scale);
  patient.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(patient);
  const center = bounds.getCenter(new Vector3());
  patient.position.set(-center.x - 0.25, 0.55 - bounds.min.y, -center.z);
}

function framePatientAndWrist(camera: PerspectiveCamera, patient: Object3D, wrist: Object3D): void {
  patient.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(patient);
  const torso = bounds.getCenter(new Vector3());
  torso.y += 0.12;
  const wristPosition = wrist.getWorldPosition(new Vector3());
  const focus = torso.lerp(wristPosition, 0.46);
  focus.y += 0.16;
  camera.fov = 44;
  camera.position.set(focus.x, focus.y + 0.03, bounds.max.z + 1.24);
  camera.lookAt(focus);
  camera.updateProjectionMatrix();
}
