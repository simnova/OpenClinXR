import { Vector3 } from "three";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidAnimationRuntimeContext,
  HumanoidDialogueEmotionContext,
  HumanoidDialogueGazeTarget,
  HumanoidSpeechPlayback,
} from "./types.js";
import { clampDialogueFacingYaw, normalizeHumanoidAnimationAngle } from "./face-rig.js";

export function buildHumanoidSpeechEvidence(
  actorId: string | null,
  assetId: string | null,
  text: string | null,
  phonemeSequence: string[],
  visemeSequence: string[],
  gazeTarget: HumanoidDialogueGazeTarget | null,
  emotionContext?: HumanoidDialogueEmotionContext,
  actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
): HumanoidSpeechEvidence {
  return {
    source: "local_dialogue_phoneme_viseme_mapping",
    activeActorId: actorId,
    activeAssetId: assetId,
    lastText: text,
    phonemeSequence,
    visemeSequence,
    emotionSource: emotionContext?.source,
    scenarioBaselineMood: emotionContext?.baselineMood,
    scenarioEmotionCueIds: emotionContext?.cueIds,
    activeActorRuntimeRealismRequirement: actorRuntimeRealismRequirement,
    activeActorRealismLaunchBadge: actorRuntimeRealismRequirement
      ? buildRuntimeActorRealismLaunchBadge(actorRuntimeRealismRequirement)
      : undefined,
    gazeTargetKind: gazeTarget?.kind ?? null,
    gazeTargetActorId: gazeTarget?.actorId ?? null,
    notEvidenceFor: [
      "clinical_speech_quality",
      "production_lip_sync",
      "production_eye_tracking",
      "scoring_validity",
    ],
  };
}

export function buildRuntimeActorRealismLaunchBadge(
  requirement: NonNullable<HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"]>,
): NonNullable<HumanoidSpeechEvidence["activeActorRealismLaunchBadge"]> {
  return {
    actorId: requirement.actorId,
    actorRole: requirement.role,
    status: "realismBlocked",
    blockers: [
      "actor_specific_humanoid_realism_gate_not_attached",
      "runtime_realism_evidence_not_attached_to_actor_badge",
      "humanoid_visual_qa_evidence_not_attached_to_actor_badge",
    ],
    claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
  };
}

export function humanoidDialogueDurationMs(phonemeCount: number, reviewCaptureMode: boolean): number {
  const baseDurationMs = Math.max(900, Math.min(4800, phonemeCount * 90));
  return reviewCaptureMode ? Math.max(baseDurationMs, 45_000) : baseDurationMs;
}

export function orientHumanoidEyeFocusCue(
  slot: GeneratedHumanoidAnimationSlot,
  gazeOrigin: Vector3,
  boundedTarget: Vector3,
): void {
  const offset = boundedTarget.clone().sub(gazeOrigin);
  const horizontal = Math.max(0.001, Math.hypot(offset.x, offset.z));
  slot.eyeFocusCue.visible = true;
  slot.eyeFocusCue.rotation.y = Math.atan2(offset.x, -offset.z);
  slot.eyeFocusCue.rotation.x = -Math.atan2(offset.y, horizontal) * 0.45;
}

export function orientHumanoidTowardGazeTarget(slot: GeneratedHumanoidAnimationSlot, targetWorld: Vector3): void {
  const targetInActorSlot = slot.actorSlot.worldToLocal(targetWorld.clone());
  const direction = targetInActorSlot.sub(slot.root.position);
  const desiredYaw = Math.atan2(direction.x, direction.z) + Math.PI;
  const boundedYaw = slot.baseRotationY + clampDialogueFacingYaw(normalizeHumanoidAnimationAngle(desiredYaw - slot.baseRotationY));
  slot.root.rotation.y += normalizeHumanoidAnimationAngle(boundedYaw - slot.root.rotation.y) * 0.14;
  slot.root.userData["openClinXrDialogueFacingCue"] = "speaking_humanoid_turns_toward_gaze_target";
}

export function resolveHumanoidGazeTargetWorld(
  ctx: HumanoidAnimationRuntimeContext,
  speech: HumanoidSpeechPlayback,
  camera: import("three").PerspectiveCamera,
): Vector3 {
  if (speech.gazeTargetKind === "actor" && speech.gazeTargetActorId) {
    const targetActorSlot = ctx.actorSlotsByActorId.get(speech.gazeTargetActorId);
    if (targetActorSlot) {
      const position = targetActorSlot.getWorldPosition(new Vector3());
      position.y += 1.18;
      return position;
    }
  }
  return camera.getWorldPosition(new Vector3());
}

export function updateHumanoidGazeCue(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  speech: HumanoidSpeechPlayback,
  camera: import("three").PerspectiveCamera,
): void {
  const gazeOrigin = new Vector3(0, 1.57, 0.29);
  const targetWorld = resolveHumanoidGazeTargetWorld(ctx, speech, camera);
  const targetLocal = slot.root.worldToLocal(targetWorld.clone());
  const boundedTarget = targetLocal.sub(gazeOrigin).clampLength(0.35, 1.15).add(gazeOrigin);
  slot.gazeCue.geometry.setFromPoints([gazeOrigin, boundedTarget]);
  slot.gazeCue.visible = true;
  orientHumanoidEyeFocusCue(slot, gazeOrigin, boundedTarget);
  orientHumanoidTowardGazeTarget(slot, targetWorld);
  slot.gazeCue.userData["openClinXrCurrentGazeTargetKind"] = speech.gazeTargetKind;
  slot.gazeCue.userData["openClinXrCurrentGazeTargetActorId"] = speech.gazeTargetActorId;
  slot.eyeFocusCue.userData["openClinXrCurrentGazeTargetKind"] = speech.gazeTargetKind;
  slot.eyeFocusCue.userData["openClinXrCurrentGazeTargetActorId"] = speech.gazeTargetActorId;
}

export function updateVirtualDeviceActorSpeechPulses(ctx: HumanoidAnimationRuntimeContext, nowMs: number): void {
  for (const [actorId, speech] of ctx.activeVirtualDeviceSpeechByActorId) {
    const device = ctx.virtualDeviceSlotsByActorId.get(actorId);
    if (!device) {
      ctx.activeVirtualDeviceSpeechByActorId.delete(actorId);
      continue;
    }
    const progress = (nowMs - speech.startedAtMs) / speech.durationMs;
    if (progress >= 1) {
      device.scale.setScalar(1);
      device.userData["openClinXrVirtualDeviceSpeechPulse"] = "idle";
      ctx.activeVirtualDeviceSpeechByActorId.delete(actorId);
      continue;
    }
    const pulse = 1 + Math.sin(nowMs / 95) * 0.055;
    device.scale.setScalar(pulse);
    device.userData["openClinXrVirtualDeviceSpeechPulse"] = "active_non_humanoid_dialogue_pulse";
  }
}

/** Local type-guard twin: keep call sites honest about unshaped floor userData. */
export function isGeneratedRuntimeDrive(value: unknown): value is { locomotion?: unknown } {
  return typeof value === "object" && value !== null;
}
