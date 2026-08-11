/**
 * Gaze drive -> skinned eye bones (#311).
 *
 * WHY: the case-authored `drive.gazeAversion` reached the runtime as a whole-body spin — the
 * previous wiring set `slot.root.rotation.y = gaze * 0.7`, feet included — while the eye bones
 * that every rail ships and skins were addressed by nothing. MADR 0052's 08:00 tick asks for eyes
 * "confirmed live, not merely present in the file"; `anny-candidate-preflight.ts:473` supplies a
 * name-regex `gazeEyeNodesPresent`, and presence is not drive.
 *
 * Resolution (#306 conventions): `resolvePoseBone` is identity-first, so the 23-bone Anny /
 * body-param rails (whose scene graph carries `eyeL`/`eyeR` directly) and the MPFB2 rig (dotted
 * stored names sanitised by three.js `PropertyBinding.sanitizeNodeName`, so the graph also shows
 * `eyeL`/`eyeR`) resolve to themselves. `findBonesBySanitisedName` then turns the resolved name
 * back into the live objects — scene-graph Bone nodes plus `SkinnedMesh.skeleton.bones`.
 *
 * Magnitude: keeps the pre-#311 `gaze * 0.7` yaw scale so the look-away is comparable to the old
 * body spin; the #311 contract does not assert how far, only WHICH nodes rotate. Assigned
 * absolutely (like the root yaw it replaces) so a zero gaze returns the eyes to rest.
 *
 * claimScope: scene-graph eye-bone yaw for gaze aversion.
 * notEvidenceFor: production eye tracking, head-gaze split, anatomical eye realism, validated
 * clinical communication scoring. The rails' eye-weighting anomalies are #296's business.
 */

import { resolvePoseBone } from "@openclinxr/asset-registry";
import type { Object3D } from "three";
import { collectJointNames, findBonesBySanitisedName } from "./pose-bone-runtime.js";

/** three.js `PropertyBinding.sanitizeNodeName` strips dots at load, so the graph sees `eyeL`. */
const EYE_BONE_LANDMARKS = ["eyeL", "eyeR"] as const;

/** Keep the pre-#311 body-spin magnitude so the look-away stays comparable. */
const GAZE_YAW_SCALE = 0.7;

/**
 * Drive the skinned eye bones on whatever rig `root` carries. Never rotates the root itself —
 * a gaze drive must not turn the whole figure on Y, feet included.
 */
export function applyGazeToHumanoid(root: Object3D, gaze: number): void {
  const yaw = Number.isFinite(gaze) ? gaze * GAZE_YAW_SCALE : 0;
  const jointNames = collectJointNames(root);
  const touched: string[] = [];
  for (const landmark of EYE_BONE_LANDMARKS) {
    const resolved = resolvePoseBone(landmark, jointNames);
    if (resolved === null) continue;
    const bones = findBonesBySanitisedName(root, resolved);
    if (bones.length === 0) continue;
    for (const bone of bones) {
      bone.rotation.y = yaw;
    }
    touched.push(resolved);
  }
  root.userData.openClinXrGazeBoneDrive = {
    gaze,
    yaw: Number(yaw.toFixed(4)),
    bonesTouched: touched,
    claimScope: "eye_bone_yaw_gaze_aversion",
    notEvidenceFor: [
      "production_eye_tracking",
      "head_gaze_split",
      "anatomical_eye_realism",
      "validated_clinical_communication_scoring",
    ],
  };
}
