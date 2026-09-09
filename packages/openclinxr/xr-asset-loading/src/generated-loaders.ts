/**
 * Generated humanoid / equipment / environment GLB loaders — extracted from
 * apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE). GLTFLoader callbacks stay in
 * the package; app state reads go through ctx. No mutable module state.
 */

import { type ActorPosture, resolveActorPosture } from "@openclinxr/asset-registry";
import { recordSceneAssetStatus, runtimeAssetAffordanceCueIds } from "@openclinxr/xr-capture-evidence";
import { applyGeneratedHumanoidRoleSpecificPosture } from "@openclinxr/xr-locomotion";
import {
  applyRealGarmentEvidenceSurfaces,
  assertHumanoidRootUpright,
  sleeveDeformCueForAssetPath,
} from "@openclinxr/xr-scene";
import { AnimationClip, BoxGeometry, type Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { registerGeneratedHumanoidAnimation } from "./humanoid-animation.js";
import { addRoleSpecificHumanoidVisuals } from "./role-visuals.js";
import type { AssetLoadingContext, HumanoidSourceComparator } from "./types.js";
import { runtimeHumanoidVariantAssetPath } from "./variant-paths.js";

export type LoadHumanoidOptions = {
  assetPath: string;
  assetId: string;
  objectName: string;
  actorId: string;
  roleTintColor: number;
  verticalOffsetMeters: number;
  posture?: ActorPosture | undefined;
};

export function readSelectedHumanoidSourceComparator(search: string): HumanoidSourceComparator {
  const selected = new URLSearchParams(search).get("humanoidSourceComparator")?.trim();
  return selected === "mpfb_ob_patient" || selected === "charmorph_antonia_patient" || selected === "charmorph_reom_patient" || selected === "reom_local_fitted_garment_patient" || selected === "reom_local_authored_curved_garment_patient" || selected === "reom_shirts01_cc0_patient" || selected === "reom_toigo_basic_tucked_tshirt_patient" || selected === "reom_namuhekam_polo_patient" || selected === "peds_anny_mpfb2_eye_rig_patient" || selected === "peds_anny_school_age_mpfb2_eye_patient" || selected === "peds_anny_comfy_masked_skin" || selected === "peds_anny_real_garment_patient" || selected === "peds_anny_real_garment_parent" || selected === "peds_anny_real_garment_nurse" || selected === "ed_anny_real_garment_patient" ? selected : null;
}

export function selectedHumanoidSourceComparator(): HumanoidSourceComparator {
  return readSelectedHumanoidSourceComparator(window.location.search);
}

export function comparatorCaptureSubjectActorId(ctx: AssetLoadingContext): string {
  const comparator = ctx.selectedHumanoidSourceComparator();
  if (comparator === "peds_anny_real_garment_parent") return ctx.runtimeFamilyActorId();
  if (comparator === "peds_anny_real_garment_nurse") return ctx.runtimeClinicalTeamActorId();
  return ctx.runtimePatientActorId();
}

export function frameComparatorCaptureOnNamedActor(
  ctx: AssetLoadingContext,
  actorId: string,
  humanoid: Group,
  modelAssetId: string,
): void {
  const comparator = ctx.selectedHumanoidSourceComparator();
  const namedActorId = comparator === "peds_anny_real_garment_parent"
    ? ctx.runtimeFamilyActorId()
    : comparator === "peds_anny_real_garment_nurse"
      ? ctx.runtimeClinicalTeamActorId()
      : null;
  ctx.frameCaptureOnNamedActor({
    actorId,
    humanoid,
    modelAssetId,
    comparator,
    namedActorId,
    cleanCapture: ctx.shouldUseCleanSourceComparatorCapture(),
  });
}

export function loadGeneratedHumanoidIntoActorSlot(
  ctx: AssetLoadingContext,
  actorSlot: Group,
  options: LoadHumanoidOptions,
): void {
  const primitiveFallbackChildren = [...actorSlot.children];
  for (const child of primitiveFallbackChildren) {
    child.visible = false;
  }
  const humanoidLoader = new GLTFLoader();
  humanoidLoader.setMeshoptDecoder(MeshoptDecoder);
  const actorSpecificAssetPath = runtimeHumanoidVariantAssetPath(ctx, options.actorId, options.assetPath);
  const humanoidSourceProvenance = ctx.sourceProvenanceForPath(actorSpecificAssetPath);
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: actorSpecificAssetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: false,
    ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
  });
  humanoidLoader.load(
    actorSpecificAssetPath,
    (gltf) => {
      const humanoid = gltf.scene;
      try { assertHumanoidRootUpright(humanoid); } catch (guardError) {
        // #67: refuse #58-class non-identity armature root before the figure is shown.
        console.error("[ui-xr] humanoid load refused by upright guard", actorSpecificAssetPath, guardError);
        recordSceneAssetStatus({ assetId: options.assetId, assetPath: actorSpecificAssetPath, sceneObjectName: options.objectName, status: "failed", fallbackActive: true, ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}) });
        for (const child of primitiveFallbackChildren) child.visible = true;
        return;
      }
      // #187: compose failures after a successful fetch must not leave a silent pending+primitive slot.
      try {
      humanoid.name = options.objectName;
      // #72 floor-standing zeros ED offsets; #105 elevated+scale re-solves so feet land near floor.
      const effectiveVerticalOffset = ctx.resolveEffectiveVerticalOffset({
        slotLocalY: actorSlot.position.y,
        verticalOffsetMeters: options.verticalOffsetMeters,
        slotScaleY: actorSlot.scale.y,
      });
      humanoid.position.set(0, effectiveVerticalOffset, 0);
      (humanoid.userData as Record<string, unknown>)["openClinXrEffectiveVerticalOffsetMeters"] = effectiveVerticalOffset;
      (humanoid.userData as Record<string, unknown>)["openClinXrRequestedVerticalOffsetMeters"] = options.verticalOffsetMeters;
      humanoid.rotation.y = 0;
      humanoid.scale.set(1, 1, 1);
      // #83: never default missing slotKind to primary_patient — that seated every telehealth actor.
      const slotUserData = actorSlot.userData as Record<string, unknown>;
      const slotKind =
        (typeof slotUserData["openClinXrSlotKind"] === "string" && (slotUserData["openClinXrSlotKind"] as string).length > 0
          ? slotUserData["openClinXrSlotKind"] as string
          : undefined)
        ?? "unknown_slot";
      const posture = options.posture
        ?? resolveActorPosture({
          scenarioId: ctx.selectedScenarioId(),
          environmentId: ctx.activeEnvironmentId(),
          slotKind,
        });
      (humanoid.userData as Record<string, unknown>)["openClinXrActorId"] = options.actorId;
      (humanoid.userData as Record<string, unknown>)["openClinXrAssetPath"] = actorSpecificAssetPath;
      slotUserData["openClinXrActorPosture"] = posture;
      slotUserData["openClinXrActorId"] = options.actorId;
      // #219: body-param library figures need flipped upper_arm Z hang (hm08 rest sense ≠ Anny).
      // Tag before clinical idle so load + frame-loop apply the library hang map.
      if (/body-param-.*-library\.glb/i.test(actorSpecificAssetPath)) {
        (humanoid.userData as Record<string, unknown>)["openClinXrHumanoidRail"] = "library";
        slotUserData["openClinXrHumanoidRail"] = "library";
      }
      if (posture === "supine") ctx.applySupine(humanoid);
      else ctx.applyPosture(humanoid, posture);
      ctx.morphTargetsNeutralized(humanoid);
      const humanoidSourceComparator = ctx.selectedHumanoidSourceComparator();
      const isRealGarmentPrimaryActor =
        ((humanoidSourceComparator === "peds_anny_real_garment_patient" || humanoidSourceComparator === "ed_anny_real_garment_patient") && options.actorId === ctx.runtimePatientActorId())
        || (humanoidSourceComparator === "peds_anny_real_garment_parent" && (options.actorId === ctx.runtimePatientActorId() || options.actorId === ctx.runtimeFamilyActorId()))
        || (humanoidSourceComparator === "peds_anny_real_garment_nurse" && (options.actorId === ctx.runtimePatientActorId() || options.actorId === ctx.runtimeClinicalTeamActorId()));
      const cleanSourceComparatorCapture = ctx.shouldUseCleanSourceComparatorCapture() && humanoidSourceComparator !== null && (
        options.actorId === ctx.runtimePatientActorId()
        || (humanoidSourceComparator === "peds_anny_real_garment_parent" && options.actorId === ctx.runtimeFamilyActorId())
        || (humanoidSourceComparator === "peds_anny_real_garment_nurse" && options.actorId === ctx.runtimeClinicalTeamActorId())
      );
      if (cleanSourceComparatorCapture) {
        actorSlot.traverse((object) => {
          if (object === actorSlot) return;
          object.visible = false;
          (object.userData as Record<string, unknown>)["openClinXrComparatorVisibilityPolicy"] = "hidden_preload_primitive_and_runtime_scaffolding_for_clean_source_capture";
        });
      }
      if (humanoidSourceComparator === "mpfb_ob_patient" && options.actorId === ctx.runtimePatientActorId()) {
        humanoid.position.y += 0.32;
        humanoid.scale.set(0.92, 0.92, 0.92);
        (humanoid.userData as Record<string, unknown>)["openClinXrHumanoidComparatorTransform"] =
          "mpfb_ob_patient_source_alignment_for_webxr_visual_comparison_only";
      }
      if (humanoidSourceComparator === "charmorph_antonia_patient" && options.actorId === ctx.runtimePatientActorId()) {
        humanoid.position.y += 0.24;
        humanoid.rotation.y = 0;
        humanoid.scale.set(1.08, 1.08, 1.08);
        (humanoid.userData as Record<string, unknown>)["openClinXrHumanoidComparatorTransform"] =
          "charmorph_antonia_patient_source_alignment_for_webxr_visual_comparison_only_target_facing";
      }
      if ((humanoidSourceComparator === "charmorph_reom_patient" || humanoidSourceComparator === "reom_local_fitted_garment_patient" || humanoidSourceComparator === "reom_local_authored_curved_garment_patient" || humanoidSourceComparator === "reom_shirts01_cc0_patient" || humanoidSourceComparator === "reom_toigo_basic_tucked_tshirt_patient" || humanoidSourceComparator === "reom_namuhekam_polo_patient") && options.actorId === ctx.runtimePatientActorId()) {
        humanoid.position.y += 0.2;
        humanoid.rotation.y = 0;
        humanoid.scale.set(1.04, 1.04, 1.04);
        (humanoid.userData as Record<string, unknown>)["openClinXrHumanoidComparatorTransform"] =
          `${humanoidSourceComparator}_source_alignment_for_webxr_visual_comparison_only_target_facing`;
      }
      if (
        (humanoidSourceComparator === "peds_anny_real_garment_patient"
          || humanoidSourceComparator === "ed_anny_real_garment_patient"
          || humanoidSourceComparator === "peds_anny_real_garment_parent"
          || humanoidSourceComparator === "peds_anny_real_garment_nurse")
        && isRealGarmentPrimaryActor
      ) {
        const taggedGarment = applyRealGarmentEvidenceSurfaces(humanoid, humanoidSourceComparator);
        (humanoid.userData as Record<string, unknown>)["openClinXrRealGarmentTopology"] = "embedded_from_phenotype_garmentLayers";
        const promotionByComparator: Record<string, string> = {
          peds_anny_real_garment_patient: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_peds_real_garment",
          peds_anny_real_garment_parent: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_peds_parent_real_garment",
          peds_anny_real_garment_nurse: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_peds_nurse_real_garment",
          ed_anny_real_garment_patient: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_ed_gown_geo_reorchestrate",
        };
        (humanoid.userData as Record<string, unknown>)["openClinXrPromotionFlow"] =
          promotionByComparator[humanoidSourceComparator]
          ?? "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_ed_gown_geo_reorchestrate";
        // Seed MouthGaze garmentGeometry on primary load (not gated on patient-speech timing).
        if (
          taggedGarment
          && ctx.isRealGarmentSleeveDeformCapture()
          && options.actorId === ctx.runtimePatientActorId()
        ) {
          // #314: derive source/cue from the ACTUAL loaded asset (actorSpecificAssetPath)
          // rather than the comparator — the parent/nurse comparators cast the patient
          // primary to the child (peds_patient_child.glb), so a comparator-keyed cue
          // would label the child's exam tshirt with the parent cardigan's provenance.
          const garmentSource = actorSpecificAssetPath;
          const sleeveDeformCue = sleeveDeformCueForAssetPath(actorSpecificAssetPath, humanoidSourceComparator);
          ctx.seedMouthGazeGarmentGeometry({
            comparator: humanoidSourceComparator,
            actorId: options.actorId,
            garmentName: taggedGarment.name || "real_garment_mesh",
            garmentVisible: taggedGarment.visible,
            garmentSource,
            sleeveDeformCue,
          });
        }
      }
      if (!cleanSourceComparatorCapture) {
        ctx.tintSceneMaterials(humanoid, options.roleTintColor, options.actorId);
      } else {
        (humanoid.userData as Record<string, unknown>)["openClinXrSourceComparatorMaterialPolicy"] =
          "source_materials_preserved_for_clean_comparator_capture_no_runtime_tint";
      }
      (humanoid.userData as Record<string, unknown>)["openClinXrClinicalIdlePoseClipPresent"] = ctx.clinicalIdleClipPresent(gltf.animations);
      // #153: skip standing clinical idle / role posture on supine — they overwrite the
      // recumbent limb map at load (frame loop already guards; load path did not).
      if (!cleanSourceComparatorCapture && posture !== "supine") {
        ctx.applyClinicalIdle(humanoid);
        applyGeneratedHumanoidRoleSpecificPosture(ctx.rolePostureContext(), humanoid, options.actorId);
      } else if (cleanSourceComparatorCapture) {
        (humanoid.userData as Record<string, unknown>)["openClinXrSourceComparatorPosturePolicy"] =
          "source_pose_preserved_for_clean_comparator_capture_no_runtime_posture_override";
      } else {
        (humanoid.userData as Record<string, unknown>)["openClinXrSupineLoadPosturePolicy"] =
          "clinical_idle_and_role_posture_skipped_for_supine_recumbent_map";
      }
      if (cleanSourceComparatorCapture) {
        (humanoid.userData as Record<string, unknown>)["openClinXrRoleSpecificVisualsPolicy"] = "skipped_for_clean_source_comparator_capture";
        ctx.suppressOverlaysForComparator(humanoid);
        humanoid.traverse((object) => {
          if (object instanceof Mesh) {
            object.frustumCulled = false;
            (object.userData as Record<string, unknown>)["openClinXrComparatorCullingPolicy"] =
              "frustum_culling_disabled_for_clean_source_comparator_capture_after_skinned_mesh_bounds_hid_body";
          }
        });
      } else {
        addRoleSpecificHumanoidVisuals(ctx, humanoid, options.actorId);
      }
      if (ctx.shouldShowComparatorDebugFaceCues() && (humanoidSourceComparator === "charmorph_antonia_patient" || humanoidSourceComparator === "charmorph_reom_patient") && options.actorId === ctx.runtimePatientActorId()) {
        ctx.faceReviewCues(humanoid);
      }
      if (!cleanSourceComparatorCapture && ctx.scenarioId() === 'ob_headache_preeclampsia_triage_v1') {
        const role = (ctx.runtimeActorRole(options.actorId) ?? '').toLowerCase();
        if (role.includes('patient')) ctx.applyRoleWardrobeCue(humanoid, 'patient');
        else if (role.includes('nurse') || role.includes('clinical') || role.includes('consultant') || role.includes('therapist')) ctx.applyRoleWardrobeCue(humanoid, 'clinical');
        else if (role.includes('family') || role.includes('spouse') || role.includes('parent')) ctx.applyRoleWardrobeCue(humanoid, 'family');
      }
      (humanoid.userData as Record<string, unknown>)["openClinXrAffordances"] = ["dialogue_target", "clinical_observation_target"];
      const dialogueTargetMarker = ctx.affordanceMarker(`${options.objectName}:dialogue_target`, options.roleTintColor);
      if (ctx.isMouthGazePoseReviewCaptureMode() || cleanSourceComparatorCapture || ctx.isRealGarmentSleeveDeformCapture()) {
        dialogueTargetMarker.visible = false;
        (dialogueTargetMarker.userData as Record<string, unknown>)["openClinXrCaptureVisibilityPolicy"] = "hidden_for_mouth_gaze_pose_realism_review";
      }
      humanoid.add(dialogueTargetMarker);
      if (!cleanSourceComparatorCapture) {
        humanoid.add(ctx.detailCues(options.assetId));
        humanoid.add(ctx.collisionCues(options.assetId));
      }
      const mouthCue = ctx.mouthCue(options.assetId, options.roleTintColor);
      humanoid.add(mouthCue);
      const gazeCue = ctx.gazeCue(options.assetId, options.roleTintColor);
      humanoid.add(gazeCue);
      const eyeFocusCue = ctx.eyeFocusCue(options.assetId);
      humanoid.add(eyeFocusCue);
      const expressionCue = ctx.expressionCue(options.assetId);
      humanoid.add(expressionCue);
      if (cleanSourceComparatorCapture) {
        for (const cleanCaptureCue of [mouthCue, gazeCue, eyeFocusCue, expressionCue]) {
          cleanCaptureCue.visible = false;
          (cleanCaptureCue.userData as Record<string, unknown>)["openClinXrComparatorVisibilityPolicy"] = "hidden_for_clean_source_comparator_capture";
        }
      }
      actorSlot.add(humanoid);
      // #315: after the named actor loads, frame the comparator capture on IT (not the
      // patient at the origin) via the proven fit-to-bounds solve, and record the target.
      frameComparatorCaptureOnNamedActor(ctx, options.actorId, humanoid, options.assetId);
      if (ctx.isCaptureShadowPath(ctx.selectedCaptureMode())) ctx.markActorCastShadow(humanoid);
      // Deterministic ED-bay-visible capture: a debug scene graph readback so the
      // capture script can verify camera pose without traversing live objects.
      if (ctx.isEdBayVisibleComparatorCapture()) {
        ctx.recordEdBayCameraPose();
      }
      if (ctx.isMouthGazePoseReviewCaptureMode()) {
        // #315 follow-up: the review subject is the comparator's NAMED actor — family for
        // _parent, clinical for _nurse, patient for the patient comparators. This block
        // previously hard-hid every non-patient slot, which re-hid the named parent/nurse
        // slots after the slot-visibility change and blanked the frame (7,479-byte PNG).
        const subjectForReview = comparatorCaptureSubjectActorId(ctx);
        if (options.actorId !== subjectForReview) {
          actorSlot.visible = false;
          slotUserData["openClinXrCaptureVisibilityPolicy"] = "hide_non_named_subject_actors_for_primary_humanoid_mouth_gaze_pose_review";
        }
      }
      const roleAnimationClipNames = ctx.roleClipNames(options.actorId);
      const gazeProbeAnimationClipNames = ctx.gazeProbeClipNames(gltf.animations);
      const activeRoleAnimationClipName = gltf.animations.find((clip: unknown): clip is AnimationClip =>
        clip instanceof AnimationClip && roleAnimationClipNames.includes(clip.name),
      )?.name ?? null;
      const activeGazeProbeAnimationClipName = gltf.animations.find((clip: unknown): clip is AnimationClip =>
        clip instanceof AnimationClip && gazeProbeAnimationClipNames.includes(clip.name),
      )?.name ?? null;
      registerGeneratedHumanoidAnimation(ctx, {
        assetId: options.assetId,
        actorId: options.actorId,
        actorSlot,
        humanoid,
        mouthCue,
        gazeCue,
        eyeFocusCue,
        expressionCue,
        animationClips: gltf.animations,
        roleAnimationClipNames,
        gazeProbeAnimationClipNames,
        playbackEnabled: !cleanSourceComparatorCapture || ctx.isRealGarmentSleeveDeformCapture(),
        fixedSourcePoseSampleSeconds: cleanSourceComparatorCapture && !ctx.isRealGarmentSleeveDeformCapture() ? 0.18 : null,
      });
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: actorSpecificAssetPath,
        sceneObjectName: options.objectName,
        status: "loaded",
        fallbackActive: false,
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "dialogue_target",
          "clinical_observation_target",
          "generated_humanoid_hair_clothing_eye_detail_cue",
          "phoneme_viseme_dialogue_cue",
          "dialogue_gaze_target_cue",
          "dialogue_eye_focus_target_cue",
          "scenario_emotion_expression_cue",
          "visible_runtime_mouth_shape_cue",
          "visible_runtime_eye_focus_cue",
          "visible_runtime_eyebrow_jaw_cheek_cue",
          "face_lip_eye_rig_contract_cue",
          "ragdoll_collision_proxy_cue",
          "physician_interaction_target_cue",
          ...(((humanoid.userData as Record<string, unknown>)["openClinXrClinicalIdlePoseClipPresent"]) ? ["authored_clinical_idle_pose_clip_cue"] : []),
        ]),
        animationPlayback: cleanSourceComparatorCapture
          ? "source_comparator_fixed_pose_sampled"
          : gltf.animations.length > 0
            ? roleAnimationClipNames.length > 0
              ? "gltf_role_animation_clip_playing"
              : "gltf_animation_clips_playing"
            : "procedural_dialogue_expression_gaze_fallback",
        roleAnimationClipNames,
        activeRoleAnimationClipName,
        gazeProbeAnimationClipNames,
        activeGazeProbeAnimationClipName,
        gazeProbePlayback: cleanSourceComparatorCapture ? "not_applicable" : activeGazeProbeAnimationClipName ? "gltf_gaze_probe_clip_playing" : "gaze_probe_clip_missing",
        ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
      });
      ctx.recordBootPhase("generated_humanoid_asset_loaded");
      } catch (composeError) {
        // Loud-and-degrade (#187): keep the session up, restore the primitive, surface the cause.
        console.error("[ui-xr] humanoid compose failed after GLB load", actorSpecificAssetPath, composeError);
        for (const child of primitiveFallbackChildren) child.visible = true;
        recordSceneAssetStatus({
          assetId: options.assetId,
          assetPath: actorSpecificAssetPath,
          sceneObjectName: options.objectName,
          status: "failed",
          fallbackActive: true,
          ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
        });
        ctx.recordBootPhase("generated_humanoid_asset_compose_failed", composeError);
      }
    },
    undefined,
    (error) => {
      // #187: loader path was silent vs upright-guard console.error — loud-and-degrade both paths.
      console.error("[ui-xr] humanoid GLB load failed", actorSpecificAssetPath, error);
      for (const child of primitiveFallbackChildren) {
        child.visible = true;
      }
      applyGeneratedHumanoidRoleSpecificPosture(ctx.rolePostureContext(), actorSlot, options.actorId);
      addRoleSpecificHumanoidVisuals(ctx, actorSlot, options.actorId, "primitive_fallback");
      (actorSlot.userData as Record<string, unknown>)["openClinXrGeneratedHumanoidFallbackPolicy"] =
        "primitive_actor_restored_when_generated_humanoid_asset_unavailable_to_avoid_empty_encounter_scene";
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: actorSpecificAssetPath,
        sceneObjectName: options.objectName,
        status: "failed",
        fallbackActive: true,
        ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "primitive_actor_restored_after_generated_humanoid_load_failed",
          "case_definition_driven_role_pose_applied_to_fallback_actor",
        ]),
      });
      ctx.recordBootPhase("generated_humanoid_asset_load_failed", error);
    },
  );
}

export type LoadSceneSlotOptions = {
  assetPath: string;
  assetId: string;
  objectName: string;
  /** Realized placement id when mounting one copy of a repeated asset id. */
  placementId?: string | undefined;
};

export function loadGeneratedEquipmentIntoSceneSlot(
  ctx: AssetLoadingContext,
  sceneSlot: Group,
  options: LoadSceneSlotOptions,
): void {
  const primitiveFallbackChildren = [...sceneSlot.children];
  const primitiveFallbackVisible = ctx.shouldShowPrimitiveFallbacks();
  ctx.registerEquipmentSlot(options.assetId, sceneSlot);
  const realizedPlacementId = options.placementId ?? options.assetId;
  (sceneSlot.userData as Record<string, unknown>)["openClinXrRuntimeEquipmentAssetId"] = options.assetId;
  (sceneSlot.userData as Record<string, unknown>)["openClinXrRuntimeEquipmentPlacementId"] = realizedPlacementId;
  ctx.addPediatricEquipmentCues(sceneSlot, options.assetId);
  for (const child of primitiveFallbackChildren) {
    child.visible = primitiveFallbackVisible;
    if (!primitiveFallbackVisible) {
      (child.userData as Record<string, unknown>)["openClinXrDynamicScenePolicy"] = "hidden_in_generated_encounter_scene_unless_fallback_debug_capture";
    }
  }
  const equipmentLoader = new GLTFLoader();
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: options.assetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: primitiveFallbackVisible,
  });
  equipmentLoader.load(
    options.assetPath,
    (gltf) => {
      const equipment = gltf.scene;
      equipment.name = options.objectName;
      (equipment.userData as Record<string, unknown>)["openClinXrAffordances"] = ["selectable_equipment_reference", "clinical_workflow_cue"];
      equipment.add(ctx.affordanceMarker(`${options.objectName}:equipment_reference`, 0x35d39b));
      if (ctx.shouldSuppressEquipmentModel(options.assetId, options.assetPath)) {
        recordSceneAssetStatus({
          assetId: options.assetId,
          assetPath: options.assetPath,
          sceneObjectName: options.objectName,
          status: "loaded",
          fallbackActive: true,
          affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
            "case_definition_equipment_loaded_from_runtime_bundle",
            "mismatched_placeholder_equipment_glb_suppressed",
            "semantic_pediatric_equipment_cues_visible",
          ]),
          animationPlayback: "not_applicable",
        });
        ctx.recordBootPhase("generated_equipment_placeholder_suppressed");
        return;
      }
      for (const child of primitiveFallbackChildren) {
        child.visible = false;
      }
      sceneSlot.add(ctx.normalizeEquipmentMount(equipment, sceneSlot));
      (sceneSlot.userData as Record<string, unknown>)["openClinXrEquipmentSource"] = "gltf";
      if (ctx.environmentStatePresent()) {
        ctx.applyEquipmentTraceVisuals();
      }
      ctx.refreshEquipmentMountEvidence();
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "loaded",
        fallbackActive: false,
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "selectable_equipment_reference",
          "clinical_workflow_cue",
        ]),
        animationPlayback: "not_applicable",
      });
      ctx.recordBootPhase("generated_equipment_asset_loaded");
    },
    undefined,
    (error) => {
      for (const child of primitiveFallbackChildren) {
        child.visible = primitiveFallbackVisible;
      }
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "failed",
        fallbackActive: primitiveFallbackVisible,
      });
      ctx.recordBootPhase("generated_equipment_asset_load_failed", error);
    },
  );
}

export function loadGeneratedEnvironmentIntoSceneSlot(
  ctx: AssetLoadingContext,
  sceneSlot: Group,
  options: LoadSceneSlotOptions,
): void {
  const environmentLoader = new GLTFLoader();
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: options.assetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: false,
  });
  environmentLoader.load(
    options.assetPath,
    (gltf) => {
      const environment = gltf.scene;
      environment.name = options.objectName;
      (environment.userData as Record<string, unknown>)["openClinXrAffordances"] = ["room_boundary_reference", "spatial_orientation_cue"];
      Object.assign(environment.userData, ctx.prepareEnvironmentShell(environment)); // #97 axis+bed
      environment.add(ctx.affordanceMarker(`${options.objectName}:room_boundary`, 0xf4d35e));
      sceneSlot.add(environment);
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "loaded",
        fallbackActive: false,
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "room_boundary_reference",
          "spatial_orientation_cue",
        ]),
        animationPlayback: "not_applicable",
      });
      ctx.recordBootPhase("generated_environment_asset_loaded");
    },
    undefined,
    (error) => {
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "failed",
        fallbackActive: false,
      });
      ctx.recordBootPhase("generated_environment_asset_load_failed", error);
    },
  );
}

export function addHumanoidSourceComparatorFaceReviewCues(ctx: AssetLoadingContext, humanoid: Group): void {
  const eyeMaterial = new MeshStandardMaterial({ color: 0x111827, roughness: 0.48 });
  const lipMaterial = new MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.56 });
  for (const z of [-0.36, 0.36]) {
    const leftEye = new Mesh(new SphereGeometry(0.018, 16, 8), eyeMaterial.clone());
    leftEye.name = `${ctx.sceneObjectPrefix()}.charmorph-comparator-left-eye-visible-review-cue`;
    leftEye.position.set(-0.035, 1.58, z);
    humanoid.add(leftEye);
    const rightEye = new Mesh(new SphereGeometry(0.018, 16, 8), eyeMaterial.clone());
    rightEye.name = `${ctx.sceneObjectPrefix()}.charmorph-comparator-right-eye-visible-review-cue`;
    rightEye.position.set(0.035, 1.58, z);
    humanoid.add(rightEye);
    const mouth = new Mesh(new BoxGeometry(0.085, 0.018, 0.012), lipMaterial.clone());
    mouth.name = `${ctx.sceneObjectPrefix()}.charmorph-comparator-mouth-viseme-visible-review-cue`;
    mouth.position.set(0, 1.535, z);
    humanoid.add(mouth);
  }
  (humanoid.userData as Record<string, unknown>)["openClinXrHumanoidComparatorFaceReviewCue"] =
    "visible_eye_mouth_cues_for_webxr_adversarial_screenshot_review_only";
}
