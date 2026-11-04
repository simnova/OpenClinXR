import { resolvePoseBone } from "@openclinxr/asset-registry";
import { collectJointNames, findBonesBySanitisedName } from "@openclinxr/xr-pose";
import { Quaternion, Vector3, type Group, type Object3D } from "three";

const restQuaternions = new WeakMap<Object3D, Quaternion>();
const WORLD_UP = new Vector3(0, 1, 0);
const LOCAL_RIGHT = new Vector3(1, 0, 0);
/** MPFB eye bones point along local +Y (Blender bone axis); that axis is the gaze. */
const LOCAL_GAZE = new Vector3(0, 1, 0);

/**
 * Rotate `bone` by `angle` about a WORLD axis. Object3D.rotateOnWorldAxis assumes an unrotated
 * parent; MPFB eye parents are rotated ~168 deg about X, which flipped the yaw sign and leaked
 * pitch (measured on mpfb-ob-patient-aisha: 0.3 rad yaw -> -16.2 deg gaze yaw, 2.2 deg pitch).
 * The axis is moved into the parent's frame first.
 */
function rotateAboutWorldAxis(bone: Object3D, worldAxis: Vector3, angle: number, parentInverse: Quaternion): void {
  if (angle === 0) return;
  const axis = worldAxis.clone().applyQuaternion(parentInverse).normalize();
  bone.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, angle));
}

/** Apply absolute procedural gaze to MPFB eye bones when legacy rig controls are absent. */
export function applyHumanoidEyeBoneGaze(
  root: Group,
  leftControl: Object3D | undefined,
  rightControl: Object3D | undefined,
  leftPitch: number,
  leftYaw: number,
  rightPitch: number,
  rightYaw: number,
): void {
  if (leftControl || rightControl) return;
  const jointNames = collectJointNames(root);
  const headName = resolvePoseBone("head", jointNames);
  if (headName === null) return;
  const head = findBonesBySanitisedName(root, headName)[0];
  if (!head) return;
  root.updateMatrixWorld(true);
  const headRight = LOCAL_RIGHT.clone()
    .applyQuaternion(head.getWorldQuaternion(new Quaternion()))
    .normalize();
  const drives = [
    { landmark: "eyeL", pitch: leftPitch, yaw: leftYaw },
    { landmark: "eyeR", pitch: rightPitch, yaw: rightYaw },
  ] as const;
  for (const drive of drives) {
    const eyeName = resolvePoseBone(drive.landmark, jointNames);
    if (eyeName === null) continue;
    for (const bone of findBonesBySanitisedName(root, eyeName)) {
      let rest = restQuaternions.get(bone);
      if (!rest) {
        rest = bone.quaternion.clone();
        restQuaternions.set(bone, rest);
      }
      bone.quaternion.copy(rest);
      const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
      const restWorldForward = LOCAL_GAZE.clone()
        .applyQuaternion(parentWorld.clone().multiply(rest))
        .normalize();
      bone.userData["openClinXrEyeRestWorldForward"] = restWorldForward.toArray();
      bone.userData["openClinXrEyeHeadWorldRight"] = headRight.toArray();
      const parentInverse = parentWorld.clone().invert();
      rotateAboutWorldAxis(bone, WORLD_UP, drive.yaw, parentInverse);
      rotateAboutWorldAxis(bone, headRight, drive.pitch, parentInverse);
      bone.rotation.setFromQuaternion(bone.quaternion);
    }
  }
  root.updateMatrixWorld(true);
}
