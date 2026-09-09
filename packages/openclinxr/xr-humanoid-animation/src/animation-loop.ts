import type { PerspectiveCamera } from "three";
import { generatedDriveScalar } from "@openclinxr/xr-runtime-state";
import {
  applyGeneratedScalarVisemeToRoot,
  applyGazeToHumanoid,
  applyNamedSpeechVisemes,
  expressionWeightsForEmotion,
  phonemesForText,
  visemesForText,
} from "@openclinxr/xr-dialogue";
import {
  applyPosturePose,
  applySupinePoseHoldingIncline,
  holdSupinePlantFrame,
  reapplySupineHeadToStoredPillow,
} from "@openclinxr/xr-pose";
import { applyRealGarmentEvidenceSurfaces, sleeveDeformCueForAssetPath } from "@openclinxr/xr-scene";
import {
  applyHumanoidFaceRigControls,
  applyHumanoidMorphTargetCue,
  computeAffectRampIntensity,
  computeHumanoidEyeMotionMetrics,
  normalizeHumanoidAnimationAngle,
  resetHumanoidFaceRigControls,
  roundHumanoidExpressionWeights,
  startHumanoidEmotionTransition,
  updateHumanoidEmotionExpression,
  visemeOpenness,
} from "./face-rig.js";
import { buildHumanoidSpeechEvidence, resolveHumanoidGazeTargetWorld, updateHumanoidGazeCue, updateVirtualDeviceActorSpeechPulses } from "./gaze-evidence.js";
import { recordRuntimeHumanoidActingCueEvidence, writeHumanoidSpeechFrameEvidence, writeMouthGazePoseComparatorEvidence } from "./speech-evidence.js";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidActingCueRecord,
  HumanoidAnimationRuntimeContext,
  HumanoidExpressionWeights,
  HumanoidRuntimeDrive,
} from "./types.js";

export function pediatricAsthmaActingOverlayForSlot(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  t: number,
  isSpeaking: boolean,
): {
  cueIds: string[];
  intensity: number;
  rotationX: number;
  rotationZ: number;
  scaleXDelta: number;
  scaleYDelta: number;
  scaleZDelta: number;
  respiratoryRateCueHz?: number | undefined;
  gazeTargetActorId?: string | null | undefined;
} {
  if (!ctx.isPediatricAsthmaRuntimeScenario()) {
    return { cueIds: [], intensity: 0, rotationX: 0, rotationZ: 0, scaleXDelta: 0, scaleYDelta: 0, scaleZDelta: 0 };
  }
  if (slot.actorId !== ctx.runtimePatientActorId()) {
    return { cueIds: ["scenario_actor_idle_attention_shift_cue"], intensity: 0.01, rotationX: 0, rotationZ: 0, scaleXDelta: 0, scaleYDelta: 0, scaleZDelta: 0 };
  }
  const respiratoryRateCueHz = 0.78;
  const respiratoryPulse = Math.max(0, Math.sin(t * Math.PI * 2 * respiratoryRateCueHz));
  const targetActorId = Math.sin(t * 0.34) > 0 ? ctx.runtimeFamilyActorId() : ctx.runtimeClinicalTeamActorId();
  return {
    cueIds: [
      "pediatric_asthma_visible_work_of_breathing_idle_cue",
      "pediatric_patient_shoulder_hunch_respiratory_distress_cue",
      "pediatric_patient_idle_gaze_alternates_parent_nurse_learner",
      ...(isSpeaking ? ["pediatric_dialogue_breathing_overlay_preserved_while_speaking"] : []),
    ],
    intensity: Number((0.028 + respiratoryPulse * 0.032).toFixed(3)),
    rotationX: -0.018 - respiratoryPulse * 0.018,
    rotationZ: Math.sin(t * 1.7) * 0.01,
    scaleXDelta: respiratoryPulse * 0.012,
    scaleYDelta: -respiratoryPulse * 0.006,
    scaleZDelta: respiratoryPulse * 0.028,
    respiratoryRateCueHz,
    gazeTargetActorId: targetActorId,
  };
}

export function updateGeneratedHumanoidAnimations(
  ctx: HumanoidAnimationRuntimeContext,
  deltaSeconds: number,
  nowMs: number,
  camera: PerspectiveCamera,
  drive?: HumanoidRuntimeDrive | null,
): void {
  const actorCues: HumanoidActingCueRecord[] = [];
  for (const slot of ctx.slots) {
    if (slot.sourceComparatorFreezeEnabled) {
      slot.mouthCue.visible = false;
      slot.gazeCue.visible = false;
      slot.eyeFocusCue.visible = false;
      slot.expressionCue.visible = false;
      slot.root.userData["openClinXrBodyMotionCue"] = {
        cueIds: ["source_comparator_runtime_pose_freeze_cue"],
        mode: "source_comparator_runtime_pose_updates_disabled",
        intensity: 0,
        notEvidenceFor: "runtime acting, body-motion realism, Quest headset kinematic certification, or production animation quality",
      };
      actorCues.push({
        actorId: slot.actorId,
        role: ctx.runtimeActorRole(slot.actorId) ?? null,
        cueIds: (slot.root.userData["openClinXrBodyMotionCue"] as { cueIds: string[] }).cueIds,
        bodyMotionMode: "source_comparator_runtime_pose_updates_disabled",
      });
      continue;
    }
    slot.mixer?.update(deltaSeconds);
    const rootUserData = slot.root.userData as Record<string, unknown>;
    const actorSlotUserData = slot.actorSlot.userData as Record<string, unknown>;
    const isSupineFrame =
      rootUserData["openClinXrActorPosture"] === "supine"
      || actorSlotUserData["openClinXrActorPosture"] === "supine";
    const isSeatedFrame =
      rootUserData["openClinXrActorPosture"] === "seated"
      || actorSlotUserData["openClinXrActorPosture"] === "seated";
    const seatedClipPerforming = isSeatedFrame && ctx.seatedClipPerforming(slot.root, slot.actorId);
    if (!isSupineFrame && !seatedClipPerforming) {
      ctx.applyIdlePosture(slot.root);
      ctx.applyRolePosture(slot.root, slot.actorId);
    }
    if (isSeatedFrame) {
      applyPosturePose(slot.root, "seated");
    }
    if (isSupineFrame) {
      applySupinePoseHoldingIncline(slot.root);
    }
    const t = (nowMs + slot.phaseOffsetMs) / 1000;
    const breathing = Math.sin(t * 1.15);
    const isSpeaking = slot.activeSpeech !== undefined;
    const dialogueLean = isSpeaking ? -0.035 + Math.sin(t * 2.6) * 0.008 : Math.sin(t * 0.51) * 0.006;
    const emotionalSway = Math.sin(t * 0.43) * 0.012;
    const dialogueWeightShift = isSpeaking ? Math.sin(t * 3.1) * 0.008 : 0;
    const pediatricAsthmaOverlay = pediatricAsthmaActingOverlayForSlot(ctx, slot, t, isSpeaking);
    if (drive && !isSupineFrame) {
      const locomotion = generatedDriveScalar(drive.locomotion);
      if (locomotion !== null) {
        slot.root.position.z = slot.baseZ + locomotion * 0.6;
      }
      const gaze = generatedDriveScalar(drive.gazeAversion ?? drive.gaze);
      if (gaze !== null) applyGazeToHumanoid(slot.root, gaze);
      const viseme = generatedDriveScalar(drive.lipSyncViseme ?? drive.lipSync);
      if (viseme !== null) applyGeneratedScalarVisemeToRoot(slot.root, viseme);
    }
    if (isSupineFrame) {
      holdSupinePlantFrame(slot.root, {
        x: slot.baseX, y: slot.baseY, z: slot.baseZ,
        scaleX: slot.baseScaleX, scaleY: slot.baseScaleY, scaleZ: slot.baseScaleZ,
      }, breathing);
      reapplySupineHeadToStoredPillow(slot.root);
    } else {
      slot.root.position.y = slot.baseY + breathing * 0.018;
      // COMPOSE, matching the line above and the scale lines below. This was the only component
      // that ASSIGNED: slot.baseX is captured at xr-asset-loading/src/humanoid-animation.ts:119
      // and was never read, so any child-local X the placement chain resolved was erased on the
      // next frame. Latent until now only because the loader zeroes the humanoid child
      // (generated-loaders.ts:112), which is exactly the offset this card set makes non-zero.
      slot.root.position.x = slot.baseX + emotionalSway + dialogueWeightShift;
      slot.root.rotation.x = dialogueLean + pediatricAsthmaOverlay.rotationX;
      slot.root.rotation.z = Math.sin(t * 0.72) * 0.012 + pediatricAsthmaOverlay.rotationZ;
      slot.root.scale.x = slot.baseScaleX + pediatricAsthmaOverlay.scaleXDelta;
      slot.root.scale.y = slot.baseScaleY + breathing * 0.012 + pediatricAsthmaOverlay.scaleYDelta;
      slot.root.scale.z = slot.baseScaleZ + pediatricAsthmaOverlay.scaleZDelta;
    }
    slot.root.userData["openClinXrBodyMotionCue"] = {
      cueIds: isSpeaking
        ? [
            "scenario_dialogue_body_lean_cue",
            "idle_breathing_sway_cue",
            "emotion_microstep_weight_shift_cue",
            ...pediatricAsthmaOverlay.cueIds,
          ]
        : ["idle_breathing_sway_cue", ...pediatricAsthmaOverlay.cueIds],
      mode: pediatricAsthmaOverlay.cueIds.length > 0
        ? "scenario_pediatric_respiratory_distress_idle_overlay"
        : isSpeaking ? "scenario_dialogue_body_motion_runtime" : "procedural_idle_body_motion",
      intensity: Number((Math.abs(dialogueLean) + Math.abs(dialogueWeightShift) + Math.abs(breathing) * 0.02 + pediatricAsthmaOverlay.intensity).toFixed(3)),
      notEvidenceFor: "full-body motion-capture realism or Quest headset kinematic certification",
    };
    if (pediatricAsthmaOverlay.gazeTargetActorId) {
      slot.root.userData["openClinXrIdleGazeAlternationCue"] = {
        targetActorId: pediatricAsthmaOverlay.gazeTargetActorId,
        cueIds: ["pediatric_patient_idle_gaze_alternates_parent_nurse_learner"],
        notEvidenceFor: "production eye tracking or validated clinical communication scoring",
      };
    }
    const bodyMotionCue = slot.root.userData["openClinXrBodyMotionCue"] as { cueIds: string[]; mode: HumanoidActingCueRecord["bodyMotionMode"] };
    actorCues.push({
      actorId: slot.actorId,
      role: ctx.runtimeActorRole(slot.actorId) ?? null,
      cueIds: bodyMotionCue.cueIds,
      respiratoryRateCueHz: pediatricAsthmaOverlay.respiratoryRateCueHz,
      gazeAlternationTargetActorId: pediatricAsthmaOverlay.gazeTargetActorId,
      bodyMotionMode: bodyMotionCue.mode,
    });
    updateHumanoidSpeechCue(ctx, slot, nowMs, camera);
  }
  ctx.recordActingCueEvidence(actorCues);
  updateVirtualDeviceActorSpeechPulses(ctx, nowMs);
}

export function updateHumanoidSpeechCue(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  nowMs: number,
  camera: PerspectiveCamera,
): void {
  const speech = slot.activeSpeech;
  if (!speech) {
    slot.mouthCue.visible = false;
    slot.gazeCue.visible = false;
    slot.eyeFocusCue.visible = false;
    slot.expressionCue.visible = false;
    slot.expressionCue.scale.set(1, 1, 1);
    resetHumanoidFaceRigControls(slot);
    (slot as unknown as Record<string, unknown>)["_liveAffectRamp"] = undefined;
    startHumanoidEmotionTransition(slot, "neutral", nowMs);
    applyHumanoidMorphTargetCue(slot, 0, "rest", updateHumanoidEmotionExpression(slot, nowMs).weights, applyNamedSpeechVisemes);
    slot.root.rotation.y += normalizeHumanoidAnimationAngle(slot.baseRotationY - slot.root.rotation.y) * 0.08;
    return;
  }
  if (ctx.shouldUseCleanHumanoidSourceComparatorCapture()) {
    slot.mouthCue.visible = false;
    slot.gazeCue.visible = false;
    slot.eyeFocusCue.visible = false;
    slot.expressionCue.visible = false;
    slot.expressionCue.scale.set(1, 1, 1);
    return;
  }
  const progress = (nowMs - speech.startedAtMs) / speech.durationMs;
  if (progress >= 1) {
    slot.activeSpeech = undefined;
    slot.mouthCue.visible = false;
    slot.gazeCue.visible = false;
    slot.eyeFocusCue.visible = false;
    slot.expressionCue.visible = false;
    slot.expressionCue.scale.set(1, 1, 1);
    resetHumanoidFaceRigControls(slot);
    (slot as unknown as Record<string, unknown>)["_liveAffectRamp"] = undefined;
    startHumanoidEmotionTransition(slot, "neutral", nowMs);
    applyHumanoidMorphTargetCue(slot, 0, "rest", updateHumanoidEmotionExpression(slot, nowMs).weights, applyNamedSpeechVisemes);
    return;
  }
  let viseme = "rest";
  let openness = 0.35;
  let activeDialogueTurnRef: {
    traceTag: string;
    turnId: unknown;
    source: "bundle_dialogue_turn";
    affectTimelineEmotion: string;
    affectTimeline: {
      emotion: string;
      intensity: number;
      onsetMs: number;
      transitionMs: number;
      decayMs: number;
      liveRampIntensity: number;
    } | null;
  } | undefined;
  let liveSource: "live_blueprint_dialogue_emotion_source" | undefined;
  if (ctx.scenarioIdForEvidence() === "peds_asthma_parent_anxiety_v1" && speech.actorId) {
    const bundleTurns = ctx.bundleTurnsForScenario();
    const matchingTurn = bundleTurns.find((turn) => turn.actorId === speech.actorId);
    const rtTurn = matchingTurn ? ctx.runtimeTurnForTraceTag(matchingTurn.cue) : undefined;
    if (matchingTurn && rtTurn) {
      try {
        const ttext = matchingTurn.text || speech.text;
        const phon = phonemesForText(ttext);
        void phon;
        const vseq = visemesForText(ttext);
        const p = Math.min(1, Math.max(0, progress));
        const lidx = Math.min(vseq.length - 1, Math.max(0, Math.floor(p * vseq.length)));
        viseme = vseq[lidx] ?? "rest";
        openness = visemeOpenness(viseme) * (0.65 + Math.sin(nowMs / 58) * 0.18);
        const timeline = rtTurn.affectTimeline ?? matchingTurn.affectTimeline;
        const liveTurn = ctx.liveTurnForCue(matchingTurn.cue);
        const turnEmotion = liveTurn?.faceEmotion ?? speech.emotion;
        const bundleAffectEmotion = timeline?.emotion
          ? ctx.normalizeLiveEmotion(String(timeline.emotion))
          : speech.emotion;
        const elapsedMs = nowMs - speech.startedAtMs;
        const rampIntensity = computeAffectRampIntensity(elapsedMs, speech.durationMs, timeline);
        (slot as unknown as Record<string, unknown>)["_liveAffectRamp"] = timeline ? {
          emotion: turnEmotion,
          intensity: Number(rampIntensity.toFixed(3)),
          onsetMs: timeline.onsetMs,
          transitionMs: timeline.transitionMs,
          decayMs: timeline.decayMs,
          sourceIntensity: timeline.intensity,
        } : undefined;
        activeDialogueTurnRef = {
          traceTag: matchingTurn.cue,
          turnId: (matchingTurn as unknown as Record<string, unknown>)["turnId"],
          source: "bundle_dialogue_turn",
          affectTimelineEmotion: bundleAffectEmotion,
          affectTimeline: timeline ? {
            emotion: timeline.emotion,
            intensity: timeline.intensity,
            onsetMs: timeline.onsetMs,
            transitionMs: timeline.transitionMs,
            decayMs: timeline.decayMs,
            liveRampIntensity: Number(rampIntensity.toFixed(3)),
          } : null,
        };
        liveSource = "live_blueprint_dialogue_emotion_source";
      } catch {
        (slot as unknown as Record<string, unknown>)["_liveAffectRamp"] = undefined;
      }
    }
  }
  if (viseme === "rest" && openness === 0.35 && speech.visemeSequence?.length) {
    const index = Math.min(speech.visemeSequence.length - 1, Math.max(0, Math.floor(progress * speech.visemeSequence.length)));
    viseme = speech.visemeSequence[index] ?? "rest";
    openness = visemeOpenness(viseme) * (0.65 + Math.sin(nowMs / 58) * 0.18);
  }
  slot.mouthCue.visible = true;
  slot.mouthCue.scale.set(1 + openness * 1.4, 1 + openness * 3.6, 1);
  const expressionState = updateHumanoidEmotionExpression(slot, nowMs);
  const ramp = (slot as unknown as Record<string, unknown>)["_liveAffectRamp"] as
    | { emotion: string; intensity: number }
    | undefined;
  let effWeights: HumanoidExpressionWeights = expressionState.weights;
  if (ramp && ramp.intensity > 0.01) {
    const peakW = expressionWeightsForEmotion(ctx.normalizeLiveEmotion(ramp.emotion) || expressionState.targetEmotion);
    const i = ramp.intensity;
    effWeights = {
      mouthOpen: Math.min(0.95, peakW.mouthOpen * i * 0.85 + expressionState.weights.mouthOpen * 0.15),
      browConcern: Math.min(0.95, peakW.browConcern * i * 0.85 + expressionState.weights.browConcern * 0.15),
      cheekTension: Math.min(0.95, peakW.cheekTension * i * 0.85 + expressionState.weights.cheekTension * 0.15),
    };
  }
  slot.expressionCue.visible = true;
  slot.expressionCue.scale.set(1 + effWeights.cheekTension * 0.22, 1 + effWeights.browConcern * 0.16, 1);
  slot.expressionCue.position.y = -openness * 0.012 + effWeights.browConcern * 0.012;
  slot.root.userData["openClinXrRuntimeExpressionCue"] = {
    expressionSource: liveSource ? "live_blueprint_dialogue_emotion_source" : "scenario_dialogue_viseme_gaze_runtime",
    currentViseme: viseme,
    currentEmotion: expressionState.currentEmotion,
    targetEmotion: expressionState.targetEmotion,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    expressionWeights: roundHumanoidExpressionWeights(effWeights),
    cueIds: [
      "visible_runtime_mouth_shape_cue",
      "visible_runtime_eye_focus_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "emotion_aligned_expression_transition_cue",
    ],
  };
  slot.mouthCue.userData["openClinXrCurrentPhoneme"] = speech.phonemeSequence[0] ?? "sil";
  slot.mouthCue.userData["openClinXrCurrentViseme"] = viseme;
  const eyeMotion = computeHumanoidEyeMotionMetrics(speech, nowMs);
  applyHumanoidFaceRigControls(
    slot,
    openness,
    viseme,
    speech,
    camera,
    eyeMotion,
    effWeights,
    (entry, entryCamera) => resolveHumanoidGazeTargetWorld(ctx, entry, entryCamera),
    (entry, entryOpenness, entryViseme, entryWeights) =>
      applyHumanoidMorphTargetCue(entry, entryOpenness, entryViseme, entryWeights, applyNamedSpeechVisemes),
  );
  const existingSpeechEvidence = ctx.currentSpeechEvidence();
  if (!existingSpeechEvidence) {
    buildHumanoidSpeechEvidence(
      speech.actorId,
      speech.assetId,
      speech.text,
      speech.phonemeSequence,
      speech.visemeSequence,
      { kind: speech.gazeTargetKind, actorId: speech.gazeTargetActorId },
      speech.emotionContext,
      speech.actorRuntimeRealismRequirement,
    );
  }
  writeHumanoidSpeechFrameEvidence(
    ctx,
    slot,
    speech,
    viseme,
    openness,
    expressionState,
    eyeMotion,
    effWeights,
    activeDialogueTurnRef,
    liveSource,
    nowMs,
    buildHumanoidSpeechEvidence,
    roundHumanoidExpressionWeights,
  );
  recordMouthGazePoseComparatorEvidence(ctx, slot, speech, viseme, openness, expressionState, nowMs);
  updateHumanoidGazeCue(ctx, slot, speech, camera);
}

export function recordMouthGazePoseComparatorEvidence(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  speech: import("./types.js").HumanoidSpeechPlayback,
  viseme: string,
  openness: number,
  expressionState: ReturnType<typeof updateHumanoidEmotionExpression>,
  nowMs: number,
): void {
  if (!ctx.isMouthGazePoseReviewCaptureMode()) {
    return;
  }
  const comparator = ctx.selectedHumanoidSourceComparator();
  const isPedsRealGarmentOrSchoolForEvidence = comparator === "peds_anny_school_age_mpfb2_eye_patient" || comparator === "peds_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse" || comparator === "ed_anny_real_garment_patient";
  const evidencePrimaryActorId = ctx.runtimePatientActorId();
  if (!isPedsRealGarmentOrSchoolForEvidence || speech.actorId !== evidencePrimaryActorId) {
    return;
  }
  const morphCue = slot.root.userData["openClinXrMorphTargetRuntimeCue"] as {
    appliedTargetCount?: number;
  } | undefined;
  void morphCue;
  const speechEvidence = ctx.currentSpeechEvidence() as unknown as Record<string, unknown> | undefined;
  void speechEvidence;
  let garmentGeometry: {
    name: string;
    visible: boolean;
    source: string;
    hasVisibleVolume: boolean;
    hasSeamFoldHints: boolean;
    sleeveDeform?: string;
  } | null = null;
  if (comparator === "peds_anny_real_garment_patient" || comparator === "ed_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse") {
    const tagged = applyRealGarmentEvidenceSurfaces(slot.root, comparator);
    if (tagged) {
      const loadedAssetPath = ctx.assetPathForSlot(slot);
      const garmentSource =
        loadedAssetPath
        || (comparator === "ed_anny_real_garment_patient"
          ? "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"
          : comparator === "peds_anny_real_garment_parent"
            ? "/generated-humanoids/peds_anxious_parent.glb"
            : comparator === "peds_anny_real_garment_nurse"
              ? "/generated-humanoids/peds_nurse_kevin.glb"
              : "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb");
      const sleeveDeformCue = sleeveDeformCueForAssetPath(loadedAssetPath, comparator);
      garmentGeometry = {
        name: tagged.name || "real_garment_mesh",
        visible: tagged.visible,
        source: garmentSource,
        hasVisibleVolume: true,
        hasSeamFoldHints: true,
        sleeveDeform: sleeveDeformCue,
      };
    }
  }
  writeMouthGazePoseComparatorEvidence(
    ctx,
    slot,
    speech,
    viseme,
    openness,
    expressionState,
    nowMs,
    garmentGeometry,
    roundHumanoidExpressionWeights,
    ctx.writeComparatorEvidenceRecord,
  );
}
