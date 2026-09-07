/**
 * Role + scenario visuals attached to loaded humanoids and the station scene —
 * extracted verbatim from apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE).
 * Module state reads go through ctx; the package holds no mutable module state.
 */

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import type { AssetLoadingContext, AssetLoadingScenarioTheme } from "./types.js";

export type { AssetLoadingScenarioTheme };
export type HumanoidCueMode = "generated_glb" | "primitive_fallback";

export function configureSemanticRolePoseOverlay(ctx: AssetLoadingContext, mesh: Mesh, cueId: string): void {
  mesh.userData["openClinXrRolePoseCueId"] = cueId;
  mesh.userData["openClinXrRuntimeVisibilityPolicy"] = "semantic_role_pose_overlay_hidden_unless_affordance_or_debug_capture";
  if (!ctx.shouldShowAffordanceMarkers()) {
    mesh.visible = false;
  }
}

export function shouldShowProceduralHumanoidDetailCues(ctx: AssetLoadingContext, faceCueMode: HumanoidCueMode): boolean {
  // #368: capture mode is NOT a reason to draw the hand-authored face/role cue
  // primitives. An actor with real face geometry renders its real face in every
  // capture mode; only a primitive_fallback body (no face geometry) and the
  // deliberate affordance/debug marker surface still show them.
  return faceCueMode === "primitive_fallback" || ctx.shouldShowAffordanceMarkers();
}

export function addRoleSpecificHumanoidVisuals(
  ctx: AssetLoadingContext,
  humanoid: Group,
  actorId: string,
  faceCueMode: HumanoidCueMode = "generated_glb",
): void {
  addActorSpecificIdentityVariantCue(ctx, humanoid, actorId, faceCueMode);
  const showProceduralRoleCues = shouldShowProceduralHumanoidDetailCues(ctx, faceCueMode);
  if (!showProceduralRoleCues) {
    humanoid.userData["openClinXrProceduralRoleCuePolicy"] =
      "hidden_for_generated_glb_normal_runtime_to_keep_encounter_view_clean_and_asset_driven";
    return;
  }
  if (actorId === ctx.runtimePatientActorId()) {
    const leftRespiratoryArmCue = new Mesh(new BoxGeometry(0.05, 0.42, 0.045), new MeshStandardMaterial({ color: 0x0e8c92, roughness: 0.72, transparent: true, opacity: 0.86 }));
    leftRespiratoryArmCue.name = `${ctx.sceneObjectPrefix()}.pediatric-patient-left-arm-hunched-breathing-pose-cue`;
    leftRespiratoryArmCue.position.set(-0.17, 1.2, 0.345);
    leftRespiratoryArmCue.rotation.z = -0.68;
    configureSemanticRolePoseOverlay(ctx, leftRespiratoryArmCue, "pediatric_patient_left_arm_hunched_breathing_pose_cue");
    humanoid.add(leftRespiratoryArmCue);
    const rightRespiratoryArmCue = new Mesh(new BoxGeometry(0.05, 0.42, 0.045), new MeshStandardMaterial({ color: 0x0e8c92, roughness: 0.72, transparent: true, opacity: 0.86 }));
    rightRespiratoryArmCue.name = `${ctx.sceneObjectPrefix()}.pediatric-patient-right-arm-hunched-breathing-pose-cue`;
    rightRespiratoryArmCue.position.set(0.17, 1.2, 0.345);
    rightRespiratoryArmCue.rotation.z = 0.68;
    configureSemanticRolePoseOverlay(ctx, rightRespiratoryArmCue, "pediatric_patient_right_arm_hunched_breathing_pose_cue");
    humanoid.add(rightRespiratoryArmCue);
    const gown = new Mesh(new BoxGeometry(0.24, 0.1, 0.014), new MeshStandardMaterial({ color: 0xcfe5ee, roughness: 0.86, transparent: true, opacity: 0.72 }));
    gown.name = `${ctx.sceneObjectPrefix()}.patient-hospital-gown-torso`;
    gown.position.set(0, 1.26, 0.322);
    humanoid.add(gown);
    const pediatricHeightBand = new Mesh(new BoxGeometry(0.2, 0.045, 0.012), new MeshStandardMaterial({ color: 0x91d5ff, roughness: 0.74, transparent: true, opacity: 0.66 }));
    pediatricHeightBand.name = `${ctx.sceneObjectPrefix()}.pediatric-small-stature-band-cue`;
    pediatricHeightBand.position.set(0, 1.05, 0.33);
    humanoid.add(pediatricHeightBand);
    const blanket = new Mesh(new BoxGeometry(0.28, 0.08, 0.016), new MeshStandardMaterial({ color: 0xd8e6ef, roughness: 0.9, transparent: true, opacity: 0.68 }));
    blanket.name = `${ctx.sceneObjectPrefix()}.patient-bedside-blanket-cue`;
    blanket.position.set(0, 0.86, 0.326);
    humanoid.add(blanket);
    const chestGuard = new Mesh(new BoxGeometry(0.22, 0.05, 0.038), new MeshStandardMaterial({ color: 0xf2d0bd, roughness: 0.72 }));
    chestGuard.name = `${ctx.sceneObjectPrefix()}.patient-hand-to-chest-distress-cue`;
    chestGuard.position.set(0.02, 1.29, 0.335);
    humanoid.add(chestGuard);
    ctx.recordRoleDistinctCue(actorId, "patient_hand_to_chest_distress_cue", chestGuard.name);
    addScenarioSpecificPatientCue(ctx, humanoid, actorId);
    if (ctx.isPediatricAsthmaScenario()) {
      const nebulizerMask = new Mesh(new BoxGeometry(0.13, 0.07, 0.018), new MeshStandardMaterial({ color: 0xdce8ef, roughness: 0.52, transparent: true, opacity: 0.78 }));
      nebulizerMask.name = `${ctx.sceneObjectPrefix()}.pediatric-nebulizer-mask-face-cue`;
      nebulizerMask.position.set(0, 1.47, 0.344);
      humanoid.add(nebulizerMask);
      ctx.recordRoleDistinctCue(actorId, "pediatric_nebulizer_mask_face_cue", nebulizerMask.name);
      const cannulaTubing = new Mesh(new CylinderGeometry(0.008, 0.008, 0.42, 8), new MeshStandardMaterial({ color: 0xe5f3ff, roughness: 0.48, transparent: true, opacity: 0.82 }));
      cannulaTubing.name = `${ctx.sceneObjectPrefix()}.pediatric-oxygen-tubing-work-of-breathing-cue`;
      cannulaTubing.position.set(-0.15, 1.34, 0.35);
      cannulaTubing.rotation.z = 0.52;
      humanoid.add(cannulaTubing);
      ctx.recordRoleDistinctCue(actorId, "pediatric_oxygen_tubing_work_of_breathing_cue", cannulaTubing.name);
    }
    return;
  }
  if (actorId === ctx.runtimeClinicalTeamActorId()) {
    const badge = new Mesh(new BoxGeometry(0.12, 0.08, 0.016), new MeshStandardMaterial({ color: 0xf8f5df, roughness: 0.62 }));
    badge.name = `${ctx.sceneObjectPrefix()}.nurse-role-badge-cue`;
    badge.position.set(-0.16, 1.24, 0.31);
    humanoid.add(badge);
    const scrubVNeck = new Mesh(new BoxGeometry(0.18, 0.12, 0.014), new MeshStandardMaterial({ color: 0x073f4f, roughness: 0.82, transparent: true, opacity: 0.78 }));
    scrubVNeck.name = `${ctx.sceneObjectPrefix()}.nurse-scrub-v-neck-role-cue`;
    scrubVNeck.position.set(0, 1.31, 0.316);
    scrubVNeck.rotation.z = 0.78;
    humanoid.add(scrubVNeck);
    const nurseReachArm = new Mesh(new BoxGeometry(0.05, 0.54, 0.045), new MeshStandardMaterial({ color: 0x0b7b94, roughness: 0.72, transparent: true, opacity: 0.84 }));
    nurseReachArm.name = `${ctx.sceneObjectPrefix()}.nurse-reaching-to-oxygen-equipment-pose-cue`;
    nurseReachArm.position.set(-0.22, 1.16, 0.34);
    nurseReachArm.rotation.z = -0.88;
    configureSemanticRolePoseOverlay(ctx, nurseReachArm, "nurse_reaching_to_oxygen_equipment_pose_cue");
    humanoid.add(nurseReachArm);
    const scrubPocket = new Mesh(new BoxGeometry(0.2, 0.12, 0.018), new MeshStandardMaterial({ color: 0x0a4f5a, roughness: 0.8 }));
    scrubPocket.name = `${ctx.sceneObjectPrefix()}.nurse-scrub-pocket-cue`;
    scrubPocket.position.set(0.14, 1.08, 0.31);
    humanoid.add(scrubPocket);
    const stethoscope = new Mesh(new CylinderGeometry(0.006, 0.006, 0.34, 8), new MeshStandardMaterial({ color: 0x17212b, roughness: 0.58 }));
    stethoscope.name = `${ctx.sceneObjectPrefix()}.nurse-stethoscope-clinical-role-cue`;
    stethoscope.position.set(0.02, 1.2, 0.325);
    stethoscope.rotation.z = 0.42;
    humanoid.add(stethoscope);
    ctx.recordRoleDistinctCue(actorId, "nurse_stethoscope_clinical_role_cue", stethoscope.name);
    addScenarioSpecificClinicalTeamCue(ctx, humanoid, actorId);
    return;
  }
  if (actorId === ctx.runtimeFamilyActorId()) {
    const cardigan = new Mesh(new BoxGeometry(0.18, 0.22, 0.014), new MeshStandardMaterial({ color: 0x9a6a45, roughness: 0.84, transparent: true, opacity: 0.72 }));
    cardigan.name = `${ctx.sceneObjectPrefix()}.family-civilian-cardigan-cue`;
    cardigan.position.set(-0.08, 1.16, 0.322);
    humanoid.add(cardigan);
    const civilianShoulderBag = new Mesh(new BoxGeometry(0.08, 0.18, 0.03), new MeshStandardMaterial({ color: 0x5b3a24, roughness: 0.88, transparent: true, opacity: 0.8 }));
    civilianShoulderBag.name = `${ctx.sceneObjectPrefix()}.parent-civilian-shoulder-bag-cue`;
    civilianShoulderBag.position.set(-0.22, 1.0, 0.33);
    humanoid.add(civilianShoulderBag);
    const parentSupportArm = new Mesh(new BoxGeometry(0.052, 0.5, 0.046), new MeshStandardMaterial({ color: 0x93603a, roughness: 0.74, transparent: true, opacity: 0.86 }));
    parentSupportArm.name = `${ctx.sceneObjectPrefix()}.parent-supportive-hand-to-chest-pose-cue`;
    parentSupportArm.position.set(0.1, 1.2, 0.34);
    parentSupportArm.rotation.z = 0.72;
    configureSemanticRolePoseOverlay(ctx, parentSupportArm, "parent_supportive_hand_to_chest_pose_cue");
    humanoid.add(parentSupportArm);
    const parentConcernCue = new Mesh(new BoxGeometry(0.1, 0.06, 0.014), new MeshStandardMaterial({ color: 0xf3d6ba, roughness: 0.74, transparent: true, opacity: 0.76 }));
    parentConcernCue.name = `${ctx.sceneObjectPrefix()}.family-parent-hand-to-chest-anxiety-cue`;
    parentConcernCue.position.set(0.13, 1.28, 0.335);
    humanoid.add(parentConcernCue);
    ctx.recordRoleDistinctCue(actorId, "family_parent_hand_to_chest_anxiety_cue", parentConcernCue.name);
    addScenarioSpecificFamilyCue(ctx, humanoid, actorId);
  }
}

export function addScenarioSpecificPatientCue(ctx: AssetLoadingContext, humanoid: Group, actorId: string): void {
  const scenarioId = ctx.scenarioId();
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    const pregnancyCue = new Mesh(new SphereGeometry(0.16, 24, 16), new MeshStandardMaterial({ color: 0xe5c3a6, roughness: 0.78 }));
    pregnancyCue.name = `${ctx.sceneObjectPrefix()}.ob-pregnancy-abdomen-silhouette-cue`;
    pregnancyCue.position.set(0, 1.02, 0.34);
    pregnancyCue.scale.set(1.15, 0.78, 0.5);
    humanoid.add(pregnancyCue);
    ctx.recordRoleDistinctCue(actorId, "ob_pregnancy_abdomen_silhouette_cue", pregnancyCue.name);
  } else if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    const rlqCue = new Mesh(new BoxGeometry(0.12, 0.08, 0.018), new MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.74 }));
    rlqCue.name = `${ctx.sceneObjectPrefix()}.clinic-rlq-abdominal-pain-cue`;
    rlqCue.position.set(0.09, 1.0, 0.35);
    humanoid.add(rlqCue);
    ctx.recordRoleDistinctCue(actorId, "clinic_rlq_abdominal_pain_cue", rlqCue.name);
  } else if (scenarioId === "oncology_bad_news_family_v1") {
    const blanketCue = new Mesh(new BoxGeometry(0.34, 0.12, 0.018), new MeshStandardMaterial({ color: 0xbfd7ea, roughness: 0.9, transparent: true, opacity: 0.86 }));
    blanketCue.name = `${ctx.sceneObjectPrefix()}.oncology-consult-soft-blanket-cue`;
    blanketCue.position.set(0, 0.88, 0.33);
    humanoid.add(blanketCue);
    ctx.recordRoleDistinctCue(actorId, "oncology_serious_news_soft_consult_cue", blanketCue.name);
  } else if (scenarioId === "postop_fever_consult_pressure_v1") {
    const dressingCue = new Mesh(new BoxGeometry(0.24, 0.1, 0.02), new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.82 }));
    dressingCue.name = `${ctx.sceneObjectPrefix()}.postop-abdominal-dressing-cue`;
    dressingCue.position.set(0, 1.0, 0.35);
    humanoid.add(dressingCue);
    ctx.recordRoleDistinctCue(actorId, "postop_abdominal_dressing_fever_cue", dressingCue.name);
  }
}

export function addScenarioSpecificClinicalTeamCue(ctx: AssetLoadingContext, humanoid: Group, actorId: string): void {
  const scenarioId = ctx.scenarioId();
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    const bpCuffCue = new Mesh(new BoxGeometry(0.2, 0.08, 0.025), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.72 }));
    bpCuffCue.name = `${ctx.sceneObjectPrefix()}.ob-blood-pressure-cuff-workflow-cue`;
    bpCuffCue.position.set(-0.22, 1.1, 0.34);
    humanoid.add(bpCuffCue);
    ctx.recordRoleDistinctCue(actorId, "ob_bp_repeat_escalation_workflow_cue", bpCuffCue.name);
  } else if (scenarioId === "postop_fever_consult_pressure_v1") {
    const scrubCapCue = new Mesh(new BoxGeometry(0.24, 0.07, 0.02), new MeshStandardMaterial({ color: 0x2563eb, roughness: 0.72 }));
    scrubCapCue.name = `${ctx.sceneObjectPrefix()}.postop-surgery-resident-scrub-cap-cue`;
    scrubCapCue.position.set(0, 1.56, 0.32);
    humanoid.add(scrubCapCue);
    ctx.recordRoleDistinctCue(actorId, "postop_surgery_resident_pressure_cue", scrubCapCue.name);
  }
}

export function addScenarioSpecificFamilyCue(ctx: AssetLoadingContext, humanoid: Group, actorId: string): void {
  const scenarioId = ctx.scenarioId();
  if (scenarioId === "oncology_bad_news_family_v1") {
    const tissueCue = new Mesh(new BoxGeometry(0.1, 0.06, 0.03), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 }));
    tissueCue.name = `${ctx.sceneObjectPrefix()}.oncology-family-tissue-emotion-cue`;
    tissueCue.position.set(0.18, 1.2, 0.35);
    humanoid.add(tissueCue);
    ctx.recordRoleDistinctCue(actorId, "oncology_family_emotion_tissue_cue", tissueCue.name);
  } else if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    const interpreterBoundaryCue = new Mesh(new BoxGeometry(0.22, 0.06, 0.018), new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.76 }));
    interpreterBoundaryCue.name = `${ctx.sceneObjectPrefix()}.clinic-family-interpreter-boundary-cue`;
    interpreterBoundaryCue.position.set(0, 1.32, 0.34);
    humanoid.add(interpreterBoundaryCue);
    ctx.recordRoleDistinctCue(actorId, "clinic_family_interpreter_boundary_cue", interpreterBoundaryCue.name);
  }
}

export function addActorSpecificIdentityVariantCue(
  ctx: AssetLoadingContext,
  humanoid: Group,
  actorId: string,
  faceCueMode: HumanoidCueMode = "generated_glb",
): void {
  const actorRole = ctx.runtimeActorRole(actorId) ?? "actor";
  const actorHash = Array.from(actorId).reduce((hash: number, char: string) => hash + char.charCodeAt(0), 0);
  const hairPalette = [0x2f2118, 0x5c4033, 0x1f2937, 0x7c4a24, 0x111827];
  const accentPalette = [0x2563eb, 0x0f766e, 0xb45309, 0xbe123c, 0x6d28d9];
  const skinPalette = [0xf2d2b6, 0xc58f67, 0x8d5b3f, 0xe6b98f, 0x6f432f];
  const doorwayTheme = ctx.scenarioTheme();
  const hairColor = hairPalette[actorHash % hairPalette.length] ?? 0x2f2118;
  const skinColor = skinPalette[(actorHash + 2) % skinPalette.length] ?? 0xc58f67;
  const accentColor = actorRole === "patient" ? doorwayTheme.reusedAssetAccentColor : accentPalette[(actorHash + actorRole.length) % accentPalette.length] ?? doorwayTheme.reusedAssetAccentColor;
  const facialExpressionColor = actorRole === "patient" ? 0xbe123c : actorRole.includes("family") || actorRole.includes("parent") ? 0x92400e : 0x1d4ed8;
  const showProceduralFaceOverlay = shouldShowProceduralHumanoidDetailCues(ctx, faceCueMode);
  const cueIds = [
    "actor_specific_hair_face_variant_cue",
    "actor_specific_clothing_accent_variant_cue",
    "actor_specific_clothing_layer_silhouette_cue",
  ];
  const hairCapName = `${ctx.sceneObjectPrefix()}.${actorId}.actor-specific-hair-cap-variant-cue`;
  if (showProceduralFaceOverlay) {
    const hairCap = new Mesh(new SphereGeometry(0.155, 18, 10), new MeshStandardMaterial({ color: hairColor, roughness: 0.86 }));
    hairCap.name = hairCapName;
    hairCap.position.set(0, 1.78, 0.19);
    hairCap.scale.set(0.62, 0.16, 0.34);
    humanoid.add(hairCap);
  }
  if (showProceduralFaceOverlay) {
    cueIds.push("visible_eye_gaze_anchor_cue", "emotion_mouth_viseme_anchor_cue", "emotion_brow_tension_cue");
    const faceTonePatch = new Mesh(new SphereGeometry(0.105, 18, 12), new MeshStandardMaterial({ color: skinColor, roughness: 0.78, transparent: true, opacity: 0.88 }));
    faceTonePatch.name = `${ctx.sceneObjectPrefix()}.${actorId}.actor-specific-face-tone-and-cheek-volume-cue`;
    faceTonePatch.position.set(0, 1.62, 0.315);
    faceTonePatch.scale.set(0.82, 0.95, 0.24);
    humanoid.add(faceTonePatch);
    const leftEye = new Mesh(new SphereGeometry(0.018, 10, 8), new MeshStandardMaterial({ color: 0x111827, roughness: 0.48 }));
    leftEye.name = `${ctx.sceneObjectPrefix()}.${actorId}.left-eye-gaze-anchor-cue`;
    leftEye.position.set(-0.044, 1.642, 0.345);
    humanoid.add(leftEye);
    const rightEye = new Mesh(new SphereGeometry(0.018, 10, 8), new MeshStandardMaterial({ color: 0x111827, roughness: 0.48 }));
    rightEye.name = `${ctx.sceneObjectPrefix()}.${actorId}.right-eye-gaze-anchor-cue`;
    rightEye.position.set(0.044, 1.642, 0.345);
    humanoid.add(rightEye);
    const mouth = new Mesh(new BoxGeometry(0.075, 0.012, 0.01), new MeshStandardMaterial({ color: facialExpressionColor, roughness: 0.62 }));
    mouth.name = `${ctx.sceneObjectPrefix()}.${actorId}.emotion-mouth-line-viseme-anchor-cue`;
    mouth.position.set(0, 1.585, 0.35);
    mouth.rotation.z = actorRole === "patient" ? -0.08 : actorRole.includes("family") || actorRole.includes("parent") ? 0.12 : 0;
    humanoid.add(mouth);
    const brow = new Mesh(new BoxGeometry(0.13, 0.012, 0.008), new MeshStandardMaterial({ color: hairColor, roughness: 0.7 }));
    brow.name = `${ctx.sceneObjectPrefix()}.${actorId}.emotion-brow-tension-cue`;
    brow.position.set(0, 1.675, 0.346);
    brow.rotation.z = actorRole === "patient" ? -0.08 : actorRole.includes("family") || actorRole.includes("parent") ? 0.1 : 0.02;
    humanoid.add(brow);
    ctx.recordRoleDistinctCue(actorId, "visible_eye_gaze_anchor_cue", leftEye.name);
    ctx.recordRoleDistinctCue(actorId, "visible_eye_gaze_anchor_cue", rightEye.name);
    ctx.recordRoleDistinctCue(actorId, "emotion_mouth_viseme_anchor_cue", mouth.name);
    ctx.recordRoleDistinctCue(actorId, "emotion_brow_tension_cue", brow.name);
  }
  const torsoLayerName = `${ctx.sceneObjectPrefix()}.${actorId}.actor-specific-clothing-layer-silhouette-cue`;
  const roleAccentName = `${ctx.sceneObjectPrefix()}.${actorId}.actor-specific-role-accent-cue`;
  if (showProceduralFaceOverlay) {
    const torsoLayer = new Mesh(new BoxGeometry(0.31, 0.44, 0.018), new MeshStandardMaterial({ color: accentColor, roughness: 0.82, transparent: true, opacity: 0.38 }));
    torsoLayer.name = torsoLayerName;
    torsoLayer.position.set(0, 1.14, 0.315);
    humanoid.add(torsoLayer);
    const roleAccent = new Mesh(new BoxGeometry(0.2, 0.035, 0.016), new MeshStandardMaterial({ color: accentColor, roughness: 0.7 }));
    roleAccent.name = roleAccentName;
    roleAccent.position.set(0, 1.21, 0.34);
    humanoid.add(roleAccent);
  }
  humanoid.userData["openClinXrActorSpecificIdentityVariantCue"] = {
    actorId,
    actorRole,
    hairColor,
    skinColor,
    accentColor,
    cueIds,
    faceCueMode,
    proceduralCueVisibilityPolicy: showProceduralFaceOverlay
      ? "visible_for_fallback_or_explicit_visual_review_capture"
      : "metadata_only_for_generated_glb_normal_runtime_to_avoid_reused_proxy_clutter",
    reusedAssetAccentColor: doorwayTheme.reusedAssetAccentColor,
    runtimeThemePolicy: "actor_identity_cues_derive_from_encounter_runtime_theme_when_assets_are_reused",
    notEvidenceFor: "production humanoid asset readiness or validated identity realism",
  };
  ctx.recordRoleDistinctCue(actorId, "actor_specific_hair_face_variant_cue", hairCapName);
  ctx.recordRoleDistinctCue(actorId, "actor_specific_clothing_layer_silhouette_cue", torsoLayerName);
  ctx.recordRoleDistinctCue(actorId, "actor_specific_clothing_accent_variant_cue", roleAccentName);
}

export function addScenarioSpecificClinicalSetDressing(
  ctx: AssetLoadingContext,
  scene: Scene,
  doorwayTheme: AssetLoadingScenarioTheme,
): void {
  if (ctx.shouldUseCleanSourceComparatorCapture() && !ctx.isEdBayVisibleComparatorCapture()) {
    return;
  }
  const sid = ctx.scenarioId();
  // caseDerivedVirtualEnvironment props (peds/ed/ob) from factory; pure three primitives.
  if (sid !== "ob_headache_preeclampsia_triage_v1" && sid !== "peds_asthma_parent_anxiety_v1" && sid !== "ed_chest_pain_priority_v1") {
    return;
  }
  const linenMaterial = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.86 });
  const accentMaterial = new MeshStandardMaterial({ color: new Color(doorwayTheme.panelAccent), roughness: 0.78 });
  if (sid === "ob_headache_preeclampsia_triage_v1") {
    const bedFrame = new Mesh(new BoxGeometry(1.75, 0.16, 0.72), new MeshStandardMaterial({ color: 0xd8dee8, roughness: 0.72 }));
    bedFrame.name = `${ctx.sceneObjectPrefix()}.ob-triage-recliner-bed-frame`;
    bedFrame.position.set(-1.62, 0.42, -0.22);
    bedFrame.userData["openClinXrScenarioSetDressing"] =
      "ob_triage_recliner_generated_from_encounter_context";
    scene.add(bedFrame);
    const pillow = new Mesh(new BoxGeometry(0.46, 0.1, 0.34), linenMaterial.clone());
    pillow.name = `${ctx.sceneObjectPrefix()}.ob-triage-pillow`;
    pillow.position.set(-2.08, 0.62, -0.2);
    pillow.rotation.z = -0.06;
    pillow.userData["openClinXrScenarioSetDressing"] = "ob_headache_reclined_patient_context";
    scene.add(pillow);
    const blanket = new Mesh(new BoxGeometry(0.82, 0.055, 0.66), new MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.9 }));
    blanket.name = `${ctx.sceneObjectPrefix()}.ob-triage-blanket`;
    blanket.position.set(-1.45, 0.57, -0.18);
    blanket.userData["openClinXrScenarioSetDressing"] = "ob_triage_bed_linen_context";
    scene.add(blanket);
    const bpCuff = new Mesh(new BoxGeometry(0.2, 0.07, 0.03), new MeshStandardMaterial({ color: 0x111827, roughness: 0.74 }));
    bpCuff.name = `${ctx.sceneObjectPrefix()}.ob-severe-bp-cuff-on-side-rail`;
    bpCuff.position.set(-1.62, 0.73, 0.2);
    bpCuff.rotation.y = -0.12;
    bpCuff.userData["openClinXrScenarioSetDressing"] = "severe_blood_pressure_repeat_workflow_cue";
    scene.add(bpCuff);
    const urineCup = new Mesh(new CylinderGeometry(0.065, 0.05, 0.12, 18), new MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.66, transparent: true, opacity: 0.78 }));
    urineCup.name = `${ctx.sceneObjectPrefix()}.ob-urine-protein-cup-cue`;
    urineCup.position.set(0.18, 0.74, -0.58);
    urineCup.userData["openClinXrScenarioSetDressing"] = "preeclampsia_urine_protein_context_cue";
    scene.add(urineCup);
    const wallMonitor = new Group();
    wallMonitor.name = `${ctx.sceneObjectPrefix()}.ob-wall-vitals-monitor-group`;
    wallMonitor.userData["openClinXrScenarioSetDressing"] = 'severe_range_bp_vitals_monitor_generated_from_ob_case_definition';
    const monitorBack = new Mesh(new BoxGeometry(0.48, 0.28, 0.035), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.68 }));
    monitorBack.name = `${ctx.sceneObjectPrefix()}.ob-wall-vitals-monitor`;
    monitorBack.position.set(0.82, 1.42, -0.83);
    wallMonitor.add(monitorBack);
    const bpTrace = new Mesh(new BoxGeometry(0.36, 0.035, 0.018), new MeshBasicMaterial({ color: 0x60a5fa }));
    bpTrace.name = `${ctx.sceneObjectPrefix()}.ob-wall-vitals-severe-bp-trace`;
    bpTrace.position.set(0.82, 1.45, -0.8);
    wallMonitor.add(bpTrace);
    const privacyCurtain = new Mesh(new BoxGeometry(0.035, 1.12, 0.86), new MeshStandardMaterial({ color: 0xe9d5ff, roughness: 0.92, transparent: true, opacity: 0.62 }));
    privacyCurtain.name = `${ctx.sceneObjectPrefix()}.ob-triage-privacy-curtain-edge`;
    privacyCurtain.position.set(1.42, 0.92, -0.18);
    privacyCurtain.userData["openClinXrScenarioSetDressing"] = 'ob_triage_privacy_boundary_generated_from_encounter_environment';
    privacyCurtain.visible = false;
    privacyCurtain.userData["openClinXrObVisualReviewPolicy"] = "hidden_after_visual_review_showed_edge_artifact";
    scene.add(privacyCurtain);
    scene.add(wallMonitor);
    const escalationFolder = new Mesh(new BoxGeometry(0.44, 0.035, 0.3), accentMaterial);
    escalationFolder.name = `${ctx.sceneObjectPrefix()}.ob-escalation-plan-folder`;
    escalationFolder.position.set(0.5, 0.71, -0.56);
    escalationFolder.rotation.y = 0.1;
    escalationFolder.userData["openClinXrScenarioSetDressing"] = "ob_escalation_plan_workflow_cue";
    scene.add(escalationFolder);
    return;
  }
  // Render caseDerivedVirtualEnvironment room props for peds/ed (desktop-usable).
  if (sid === "peds_asthma_parent_anxiety_v1") {
    // props from case: exam_table, oxygen_delivery_system, peak_flow_meter, parent_chair, wall_chart (matches packet.ts caseDerivedVirtualEnvironment + runtime-state scaffold)
    const tableMat = new MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7 });
    const examTable = new Mesh(new BoxGeometry(1.6, 0.82, 0.7), tableMat);
    examTable.name = `${ctx.sceneObjectPrefix()}.peds-exam-table`;
    examTable.position.set(-0.8, 0.41, -0.65);
    examTable.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "exam_table_from_peds_asthma_clinic_exam_room";
    scene.add(examTable);
    const o2Tank = new Mesh(new CylinderGeometry(0.12, 0.12, 0.9, 12), new MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.6 }));
    o2Tank.name = `${ctx.sceneObjectPrefix()}.peds-oxygen-delivery-system`;
    o2Tank.position.set(1.1, 0.45, -0.35);
    o2Tank.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "oxygen_delivery_system_case_spec";
    scene.add(o2Tank);
    const peak = new Mesh(new BoxGeometry(0.22, 0.12, 0.18), new MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 }));
    peak.name = `${ctx.sceneObjectPrefix()}.peds-peak-flow-meter`;
    peak.position.set(0.6, 0.82, -0.9);
    peak.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "peak_flow_meter_parent_communication_cue";
    scene.add(peak);
    const chairSeat = new Mesh(new BoxGeometry(0.48, 0.08, 0.48), new MeshStandardMaterial({ color: 0x334155, roughness: 0.85 }));
    chairSeat.name = `${ctx.sceneObjectPrefix()}.peds-parent-chair-seat`;
    chairSeat.position.set(1.6, 0.38, -1.1);
    scene.add(chairSeat);
    const chairBack = new Mesh(new BoxGeometry(0.48, 0.55, 0.06), new MeshStandardMaterial({ color: 0x334155, roughness: 0.85 }));
    chairBack.name = `${ctx.sceneObjectPrefix()}.peds-parent-chair-back`;
    chairBack.position.set(1.6, 0.68, -1.32);
    scene.add(chairBack);
    const chart = new Mesh(new BoxGeometry(0.6, 0.4, 0.02), new MeshStandardMaterial({ color: 0xfefce8, roughness: 0.9 }));
    chart.name = `${ctx.sceneObjectPrefix()}.peds-wall-chart`;
    chart.position.set(-2.9, 1.6, -1.55);
    chart.rotation.y = 1.57;
    chart.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "wall_chart_clinic_review_cue";
    scene.add(chart);
  }
  if (sid === "ed_chest_pain_priority_v1") {
    // #97: skip case-derived gurney — procedural stretcher slot is the single visible bed.
    const monBack = new Mesh(new BoxGeometry(0.55, 0.32, 0.04), new MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 }));
    monBack.name = `${ctx.sceneObjectPrefix()}.ed-cardiac-monitor`;
    monBack.position.set(-2.6, 1.45, -1.4);
    monBack.rotation.y = 0.8;
    monBack.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "cardiac_monitor_priority_vitals";
    scene.add(monBack);
    const cart = new Mesh(new BoxGeometry(0.55, 0.7, 0.35), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.55 }));
    cart.name = `${ctx.sceneObjectPrefix()}.ed-crash-cart`;
    cart.position.set(2.1, 0.35, -0.4);
    cart.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "crash_cart_urgent_escalation";
    scene.add(cart);
    const ivPole = new Mesh(new CylinderGeometry(0.03, 0.03, 1.4, 6), new MeshStandardMaterial({ color: 0x64748b, roughness: 0.7 }));
    ivPole.name = `${ctx.sceneObjectPrefix()}.ed-iv-stand`;
    ivPole.position.set(-1.8, 0.7, -0.95);
    ivPole.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "iv_stand_fluid_case";
    scene.add(ivPole);
    const defib = new Mesh(new BoxGeometry(0.38, 0.28, 0.18), new MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 }));
    defib.name = `${ctx.sceneObjectPrefix()}.ed-defibrillator`;
    defib.position.set(1.7, 0.9, -1.25);
    defib.rotation.y = -0.4;
    defib.userData["openClinXrCaseDerivedVirtualEnvironmentProp"] = "defibrillator_chest_pain_priority";
    scene.add(defib);
  }
}

export function addReusableExteriorPreEncounterRoom(
  ctx: AssetLoadingContext,
  scene: Scene,
  doorwayTheme: AssetLoadingScenarioTheme,
  setAnteroom: (room: Group | null) => void,
): void {
  const exterior = new Group();
  setAnteroom(exterior);
  exterior.name = "openclinxr.reusable-pre-encounter-anteroom";
  exterior.userData["openClinXrReusableExteriorRoomPolicy"] =
    "reused_between_encounters_for_doorway_orientation_and_patient_note_capture_only";
  exterior.userData["openClinXrPortalPolicy"] =
    "clinical_world_beyond_doorway_is_generated_from_active_encounter_runtime_bundle";

  const exteriorFloor = new Mesh(new BoxGeometry(7, 0.082, 1.7), new MeshStandardMaterial({ color: 0x3f4852, roughness: 0.86 }));
  exteriorFloor.name = "openclinxr.reusable-pre-encounter-anteroom.floor";
  exteriorFloor.position.set(0, -0.035, 1.82);
  exteriorFloor.userData["openClinXrSceneNecessityPolicy"] = "reusable_exterior_floor_for_pre_encounter_note_capture_not_clinical_environment";
  exterior.add(exteriorFloor);

  const portalWallMaterial = new MeshStandardMaterial({ color: 0x111827, roughness: 0.92 });
  const leftWall = new Mesh(new BoxGeometry(0.72, 2.58, 0.045), portalWallMaterial);
  leftWall.name = "openclinxr.reusable-pre-encounter-anteroom.portal-left-wall";
  leftWall.position.set(-2.35, 1.25, 0.9);
  leftWall.userData["openClinXrPortalWallPolicy"] = "static_reusable_wall_segment_leaving_dynamic_encounter_window_open";
  exterior.add(leftWall);
  const rightWall = new Mesh(new BoxGeometry(0.72, 2.58, 0.045), portalWallMaterial);
  rightWall.name = "openclinxr.reusable-pre-encounter-anteroom.portal-right-wall";
  rightWall.position.set(2.35, 1.25, 0.9);
  rightWall.userData["openClinXrPortalWallPolicy"] = "static_reusable_wall_segment_leaving_dynamic_encounter_window_open";
  exterior.add(rightWall);
  const headerWall = new Mesh(new BoxGeometry(5.35, 0.34, 0.045), portalWallMaterial);
  headerWall.name = "openclinxr.reusable-pre-encounter-anteroom.portal-header-wall";
  headerWall.position.set(0, 2.45, 0.9);
  headerWall.userData["openClinXrPortalWallPolicy"] = "static_reusable_header_above_dynamic_encounter_window";
  exterior.add(headerWall);

  const portalOpening = new Mesh(new BoxGeometry(3.75, 2.0, 0.025), new MeshStandardMaterial({
    color: doorwayTheme.backgroundColor,
    roughness: 0.7,
    emissive: doorwayTheme.backgroundColor,
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  }));
  portalOpening.name = `${ctx.sceneObjectPrefix()}.encounter-portal-dynamic-opening`;
  portalOpening.position.set(0, 1.18, 0.86);
  portalOpening.userData["openClinXrPortalOpeningPolicy"] =
    "portal_surface_color_and_identity_derive_from_active_encounter_runtime_bundle";
  exterior.add(portalOpening);

  const portalFrameMaterial = new MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.62 });
  const portalAccentMaterial = new MeshStandardMaterial({ color: doorwayTheme.reusedAssetAccentColor, roughness: 0.54, emissive: doorwayTheme.reusedAssetAccentColor, emissiveIntensity: 0.12 });
  const leftJamb = new Mesh(new BoxGeometry(0.12, 2.2, 0.12), portalFrameMaterial);
  leftJamb.name = "openclinxr.reusable-pre-encounter-anteroom.portal-left-jamb";
  leftJamb.position.set(-1.95, 1.15, 0.74);
  exterior.add(leftJamb);
  const rightJamb = new Mesh(new BoxGeometry(0.12, 2.2, 0.12), portalFrameMaterial);
  rightJamb.name = "openclinxr.reusable-pre-encounter-anteroom.portal-right-jamb";
  rightJamb.position.set(1.95, 1.15, 0.74);
  exterior.add(rightJamb);
  const lintel = new Mesh(new BoxGeometry(4.02, 0.12, 0.12), portalFrameMaterial);
  lintel.name = "openclinxr.reusable-pre-encounter-anteroom.portal-lintel";
  lintel.position.set(0, 2.25, 0.74);
  exterior.add(lintel);
  const threshold = new Mesh(new BoxGeometry(4.1, 0.06, 0.18), portalAccentMaterial);
  threshold.name = `${ctx.sceneObjectPrefix()}.encounter-portal-dynamic-threshold`;
  threshold.position.set(0, 0.02, 0.72);
  threshold.userData["openClinXrPortalThresholdPolicy"] = "crossing_threshold_enters_dynamic_encounter_world";
  exterior.add(threshold);

  const notePanel = ctx.createReadablePanel({
    name: "openclinxr.reusable-pre-encounter-anteroom.patient-note-capture-cue",
    title: "Pre-Encounter",
    lines: [
      "Review doorway context, then enter.",
      "Patient note capture remains in this reusable exterior room.",
      "Clinical scene beyond portal is encounter-generated.",
    ],
    widthMeters: 1.55,
    heightMeters: 0.72,
    background: "#f8fafc",
    accent: "#64748b",
  });
  notePanel.mesh.position.set(-2.3, 1.35, 1.08);
  notePanel.mesh.rotation.y = 0.46;
  notePanel.mesh.userData["openClinXrReusableExteriorNotePolicy"] =
    "note_capture_affordance_reused_outside_dynamic_clinical_world";
  exterior.add(notePanel.mesh);

  if (ctx.shouldUseCleanSourceComparatorCapture() && !ctx.isEdBayVisibleComparatorCapture()) {
    exterior.visible = false;
    exterior.userData["openClinXrComparatorVisibilityPolicy"] = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  scene.add(exterior);
}
