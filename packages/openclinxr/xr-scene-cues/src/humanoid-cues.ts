import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { SceneCueHumanoidCueContext } from "./types.js";

export function createAffordanceMarker(ctx: SceneCueHumanoidCueContext, cueId: string, color: number): Mesh {
  const marker = new Mesh(
    new SphereGeometry(0.055, 16, 12),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.82 }),
  );
  marker.name = `${ctx.scenarioObjectPrefix}.glb-affordance.${cueId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  marker.userData["openClinXrAffordanceCueId"] = cueId;
  if (!ctx.shouldShowAffordanceMarkers()) {
    marker.visible = false;
    marker.userData["openClinXrDynamicScenePolicy"] = "hidden_in_generated_encounter_scene_unless_affordance_evidence_capture";
  }
  return marker;
}

export function createHumanoidSpeechMouthCue(ctx: SceneCueHumanoidCueContext, assetId: string, _color: number): Mesh {
  const cue = new Mesh(
    new BoxGeometry(0.13, 0.03, 0.014),
    new MeshBasicMaterial({ color: 0x7a3434, transparent: true, opacity: 0.58 }),
  );
  cue.name = `${ctx.scenarioObjectPrefix}.phoneme-mouth-cue.${assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  cue.position.set(0, 1.445, 0.306);
  cue.visible = false;
  cue.userData["openClinXrAffordances"] = ["phoneme_viseme_dialogue_cue", "visible_runtime_mouth_shape_cue"];
  return cue;
}

export function createHumanoidEyeGazeCue(ctx: SceneCueHumanoidCueContext, assetId: string, color: number): Line {
  const cue = new Line(
    new BufferGeometry().setFromPoints([
      new Vector3(0, 1.57, 0.29),
      new Vector3(0, 1.57, -0.55),
    ]),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  cue.name = `${ctx.scenarioObjectPrefix}.eye-gaze-cue.${assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  cue.visible = false;
  cue.userData["openClinXrAffordances"] = ["dialogue_gaze_target_cue"];
  return cue;
}

export function createHumanoidEyeFocusCue(ctx: SceneCueHumanoidCueContext, assetId: string): Group {
  const group = new Group();
  group.name = `${ctx.scenarioObjectPrefix}.eye-focus-cue.${assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  group.position.set(0, 1.57, 0.302);
  group.visible = false;
  group.userData["openClinXrAffordances"] = ["dialogue_eye_focus_target_cue", "visible_runtime_eye_focus_cue"];

  const eyeMaterial = new MeshBasicMaterial({ color: 0xf8fbff, transparent: true, opacity: 0.32 });
  const pupilMaterial = new MeshBasicMaterial({ color: 0x07121c, transparent: true, opacity: 0.4 });
  for (const x of [-0.045, 0.045]) {
    const eye = new Mesh(new SphereGeometry(0.012, 12, 8), eyeMaterial);
    eye.position.set(x, 0, 0);
    group.add(eye);
    const pupil = new Mesh(new SphereGeometry(0.0045, 8, 6), pupilMaterial);
    pupil.position.set(x, 0, 0.012);
    group.add(pupil);
  }
  return group;
}

export function createHumanoidExpressionCue(ctx: SceneCueHumanoidCueContext, assetId: string): Group {
  const safeAssetId = assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-");
  const group = new Group();
  group.name = `${ctx.scenarioObjectPrefix}.runtime-expression-cue.${safeAssetId}`;
  group.userData["openClinXrAffordances"] = [
    "scenario_emotion_expression_cue",
    "visible_runtime_eyebrow_jaw_cheek_cue",
  ];

  const browMaterial = new MeshBasicMaterial({ color: 0x26150d, transparent: true, opacity: 0.28 });
  for (const [name, x, rotation] of [["left", -0.068, -0.18], ["right", 0.068, 0.18]] as const) {
    const brow = new Mesh(new BoxGeometry(0.055, 0.006, 0.008), browMaterial);
    brow.name = `${ctx.scenarioObjectPrefix}.${name}-expressive-brow.${safeAssetId}`;
    brow.position.set(x, 1.625, 0.303);
    brow.rotation.z = rotation;
    group.add(brow);
  }

  const cheekMaterial = new MeshBasicMaterial({ color: 0xd8a07a, transparent: true, opacity: 0.18 });
  for (const x of [-0.115, 0.115]) {
    const cheek = new Mesh(new SphereGeometry(0.022, 10, 6), cheekMaterial);
    cheek.name = `${ctx.scenarioObjectPrefix}.emotion-cheek.${safeAssetId}`;
    cheek.position.set(x, 1.49, 0.297);
    cheek.scale.set(1.35, 0.65, 0.18);
    group.add(cheek);
  }

  const jaw = new Mesh(new BoxGeometry(0.095, 0.012, 0.010), new MeshBasicMaterial({ color: 0x7a3434, transparent: true, opacity: 0.24 }));
  jaw.name = `${ctx.scenarioObjectPrefix}.runtime-jaw-viseme-target.${safeAssetId}`;
  jaw.position.set(0, 1.405, 0.305);
  group.add(jaw);
  return group;
}

export function createRuntimeHumanoidDetailCues(ctx: SceneCueHumanoidCueContext, assetId: string): Group {
  const safeAssetId = assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-");
  const group = new Group();
  group.name = `${ctx.scenarioObjectPrefix}.generated-humanoid-detail-cues.${safeAssetId}`;
  group.userData["openClinXrAffordances"] = [
    "generated_humanoid_hair_clothing_eye_detail_cue",
    "generated_humanoid_asset_surface_detail_preferred",
  ];
  group.userData["openClinXrRuntimeDetailPolicy"] = {
    mode: "asset_surface_features_only_no_runtime_proxy_overlay",
    reason: "Local real Anny source + Blender procedural candidate GLB carries source topology plus surface hair, clothing, eye, brow, and lip geometry; runtime overlays must not obscure the generated humanoid.",
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
  return group;
}

export function createHumanoidInteractionCollisionCues(ctx: SceneCueHumanoidCueContext, assetId: string): Group {
  const safeAssetId = assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-");
  const group = new Group();
  group.name = `${ctx.scenarioObjectPrefix}.humanoid-interaction-collision.${safeAssetId}`;
  group.userData["openClinXrAffordances"] = [
    "face_lip_eye_rig_contract_cue",
    "ragdoll_collision_proxy_cue",
    "physician_interaction_target_cue",
  ];

  const collisionProxy = new Mesh(
    new BoxGeometry(0.56, 1.56, 0.34),
    new MeshBasicMaterial({ color: 0x58f5c6, transparent: true, opacity: 0.08, wireframe: true }),
  );
  collisionProxy.name = `${ctx.scenarioObjectPrefix}.ragdoll-collision-proxy.${safeAssetId}`;
  collisionProxy.position.set(0, 0.94, 0);
  collisionProxy.userData["openClinXrRagdollCollisionProxy"] = "local_interaction_volume_not_physics_claim";

  const interactionTarget = new Mesh(
    new BoxGeometry(0.46, 0.84, 0.035),
    new MeshBasicMaterial({ color: 0xf4d35e, transparent: true, opacity: 0.035, wireframe: true }),
  );
  interactionTarget.name = `${ctx.scenarioObjectPrefix}.physician-interaction-target.${safeAssetId}`;
  interactionTarget.position.set(0, 1.08, -0.22);
  interactionTarget.userData["openClinXrPhysicianInteractionTarget"] = "local_ray_or_hand_overlap_target";

  group.add(collisionProxy, interactionTarget);
  group.visible = false;
  group.userData["openClinXrRuntimeVisibilityPolicy"] = "hidden_by_default_semantic_collision_contract_only";
  return group;
}

