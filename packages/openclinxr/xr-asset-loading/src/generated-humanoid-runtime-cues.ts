/**
 * Runtime face-cue handles for a loaded generated-GLB humanoid. The GLB's own eye, morph-target
 * body and eyebrow meshes own the face; procedural cue geometry attaches only on the explicit
 * affordance/debug surface (card tsk_c84df724a40437c6).
 */
import { type Group, type Line, Mesh } from "three";
import { shouldShowProceduralHumanoidDetailCues } from "./role-visuals.js";
import type { AssetLoadingContext } from "./types.js";

export type GeneratedHumanoidRuntimeCues = {
  mouthCue: Mesh;
  gazeCue: Line;
  eyeFocusCue: Group;
  expressionCue: Group;
};

/**
 * Builds the runtime cue handles used by animation while attaching procedural
 * face geometry only on the explicit affordance/debug surface.
 */
export function addGeneratedHumanoidRuntimeCues(
  ctx: AssetLoadingContext,
  humanoid: Group,
  input: {
    assetId: string;
    objectName: string;
    actorId: string;
    roleTintColor: number;
    cleanSourceComparatorCapture: boolean;
  },
): GeneratedHumanoidRuntimeCues {
  const dialogueTargetMarker = ctx.affordanceMarker(`${input.objectName}:dialogue_target`, input.roleTintColor);
  if (ctx.isMouthGazePoseReviewCaptureMode() || input.cleanSourceComparatorCapture || ctx.isRealGarmentSleeveDeformCapture()) {
    dialogueTargetMarker.visible = false;
    dialogueTargetMarker.userData["openClinXrCaptureVisibilityPolicy"] = "hidden_for_mouth_gaze_pose_realism_review";
  }
  humanoid.add(dialogueTargetMarker);
  if (!input.cleanSourceComparatorCapture) {
    humanoid.add(ctx.detailCues(input.assetId));
    humanoid.add(ctx.collisionCues(input.assetId));
  }
  const mouthCue = ctx.mouthCue(input.assetId, input.roleTintColor);
  const gazeCue = ctx.gazeCue(input.assetId, input.roleTintColor);
  const eyeFocusCue = ctx.eyeFocusCue(input.assetId);
  const expressionCue = ctx.expressionCue(input.assetId);
  const proceduralFaceCuesVisible = shouldShowProceduralHumanoidDetailCues(ctx, "generated_glb")
    && !input.cleanSourceComparatorCapture;
  for (const cue of [mouthCue, gazeCue, eyeFocusCue, expressionCue]) {
    if (proceduralFaceCuesVisible) {
      humanoid.add(cue);
    } else {
      cue.visible = false;
      cue.userData["openClinXrGeneratedHumanoidFaceCuePolicy"] =
        "detached_placeholder_glb_face_parts_own_runtime_expression";
    }
  }
  recordGeneratedHumanoidFaceCueOwners(ctx, humanoid, input.actorId);
  return { mouthCue, gazeCue, eyeFocusCue, expressionCue };
}

/**
 * A generated GLB owns its facial cues through authored meshes/morph targets,
 * not through the procedural review primitives used by the fallback actor.
 */
export function recordGeneratedHumanoidFaceCueOwners(
  ctx: AssetLoadingContext,
  humanoid: Group,
  actorId: string,
): void {
  const meshes: Mesh[] = [];
  humanoid.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  const morphNames = (mesh: Mesh): string[] => Object.keys(mesh.morphTargetDictionary ?? {});
  const labels = (mesh: Mesh): string => [
    mesh.name,
    ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => material.name),
  ].join(" ");
  const eyeOwner = meshes.find((mesh) => /(^|[_.-])eyes?([_.-]|$)/iu.test(labels(mesh)) && !/eyebrow|eyelash/iu.test(labels(mesh)));
  const mouthOwner = meshes.find((mesh) => morphNames(mesh).some((name) => /^(mouth|viseme[_-])/iu.test(name)))
    ?? meshes.find((mesh) => /(^|[_.-])(mouth|tongue|teeth)([_.-]|$)/iu.test(labels(mesh)));
  const browOwner = meshes.find((mesh) => /eyebrow/iu.test(labels(mesh)))
    ?? meshes.find((mesh) => morphNames(mesh).some((name) => /^eyebrows?[_-]/iu.test(name)));
  const owners = [
    ["visible_eye_gaze_anchor_cue", eyeOwner],
    ["emotion_mouth_viseme_anchor_cue", mouthOwner],
    ["emotion_brow_tension_cue", browOwner],
  ] as const;
  for (const [cueId, owner] of owners) {
    if (!owner) continue;
    owner.userData["openClinXrGeneratedHumanoidFaceCueOwner"] = cueId;
    ctx.recordRoleDistinctCue(actorId, cueId, owner.name);
  }
}
