/**
 * Generated-humanoid animation slot registration — extracted verbatim from
 * apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE). Mixer/posture/clip reads go
 * through ctx; slot stores are ctx-owned. No mutable module state.
 */

import type { Scenario } from "@openclinxr/shared-schemas";
import { AnimationClip, AnimationMixer, type Group, type Line, type Mesh } from "three";
import { isDeliberateSelectionOnlyClip } from "./clip-names.js";
import type { AssetLoadingContext } from "./types.js";

export type RegisterAnimationInput = {
  assetId: string;
  actorId: string;
  actorSlot: Group;
  humanoid: Group;
  mouthCue: Mesh;
  gazeCue: Line;
  eyeFocusCue: Group;
  expressionCue: Group;
  animationClips: readonly unknown[];
  roleAnimationClipNames: readonly string[];
  gazeProbeAnimationClipNames: readonly string[];
  playbackEnabled: boolean;
  fixedSourcePoseSampleSeconds: number | null;
};

export function registerGeneratedHumanoidAnimation(ctx: AssetLoadingContext, input: RegisterAnimationInput): void {
  // #83: seated figures keep a mixer only for non-leg facial/upper clips when role clips exist.
  // Falling back to ALL glTF clips played standing armature tracks that overwrote the sit every frame
  // (re-apply helped only when it ran; full-body tracks + missing role names = bind/stand forever).
  const humanoidData = input.humanoid.userData as Record<string, unknown>;
  const slotData = input.actorSlot.userData as Record<string, unknown>;
  const isSeated =
    humanoidData["openClinXrActorPosture"] === "seated"
    || slotData["openClinXrActorPosture"] === "seated";
  const isSupine =
    humanoidData["openClinXrActorPosture"] === "supine"
    || slotData["openClinXrActorPosture"] === "supine";
  // #574: the #574 carve-out — a NAMED seated-rig role clip may play on a seated actor.
  // The clip was retargeted from a seated source take, so performing it does not fight the
  // sit (translation channels are constant; legs re-folded per frame by applyPosturePose).
  const oneShotResponseClipNames = new Set(ctx.touchResponseClipNames(input.actorId));
  const selectedRoleClips = input.animationClips.filter((clip: unknown): clip is AnimationClip =>
    clip instanceof AnimationClip
    && input.roleAnimationClipNames.includes(clip.name)
    && !oneShotResponseClipNames.has(clip.name),
  );
  const seatedRoleClipPlayable =
    isSeated && !isSupine
    && selectedRoleClips.length > 0
    && selectedRoleClips.every((clip) => ctx.seatedClipPlayable(
      clip.name,
      { translationBoneNames: ctx.translationBoneNames(clip.tracks as unknown[]) },
    ));
  // #150: no mixer for supine — standing tracks undo the recumbent plant.
  // #83 invariant intact for every other seated actor: no mixer without the carve-out.
  const mixer = input.playbackEnabled && input.animationClips.length > 0 && (!isSeated || seatedRoleClipPlayable) && !isSupine
    ? new AnimationMixer(input.humanoid)
    : undefined;
  // Response clips are registered on roleAnimationClipNames for discoverability but must not
  // auto-loop as role idle — they are one-shot via handleClinicalTouch / respondToTouch.
  const selectedGazeProbeClips = input.animationClips.filter((clip: unknown): clip is AnimationClip =>
    clip instanceof AnimationClip && input.gazeProbeAnimationClipNames.includes(clip.name),
  );
  // Never fall back to "play every clip" for seated/supine — neutral armatureAction is standing.
  const clipsToPlay = selectedRoleClips.length > 0
    ? [...selectedRoleClips, ...selectedGazeProbeClips]
    : isSeated || isSupine
      ? []
      // The fallback plays EVERY clip, so a locomotion take added to a shipped actor would loop
      // under an actor nobody selected it for. See isDeliberateSelectionOnlyClip.
      : input.animationClips.filter((clip: unknown): clip is AnimationClip =>
          clip instanceof AnimationClip && !isDeliberateSelectionOnlyClip(clip.name),
        );
  const fixedSourcePoseClip = selectedRoleClips[0] ?? input.animationClips.find((clip: unknown): clip is AnimationClip => clip instanceof AnimationClip);
  if (!input.playbackEnabled && fixedSourcePoseClip && input.fixedSourcePoseSampleSeconds !== null) {
    const fixedPoseMixer = new AnimationMixer(input.humanoid);
    fixedPoseMixer.clipAction(fixedSourcePoseClip).play();
    fixedPoseMixer.setTime(input.fixedSourcePoseSampleSeconds);
    input.humanoid.updateMatrixWorld(true);
  }
  if (mixer) {
    for (const clip of clipsToPlay) {
      mixer.clipAction(clip)?.play();
    }
  }
  // Seated: procedural sit is authoritative; re-apply once after any fixed-pose sample so legs stay folded.
  // #87: plant pelvis onto the chair seat (height from descent, not from hip fold past 95°).
  if (isSeated) {
    ctx.applyPosture(input.humanoid, "seated");
    // Aim flush with seat top; post-loop scale breathing opens gap slightly (still < 0.12).
    const plant = ctx.plantSeatedPelvis(input.humanoid, ctx.seatedChairHeight(), 0.0);
    humanoidData["openClinXrSeatedPlantDeltaY"] = plant.deltaY;
    humanoidData["openClinXrSeatedPlantPelvisBefore"] = plant.pelvisBefore;
    input.humanoid.updateMatrixWorld(true);
  }
  if (isSupine) {
    const deckStretcher = ctx.findStretcherInScene(input.actorSlot);
    ctx.applyAndPlantSupineDeck(input.humanoid, {
      deckTopWorldY: ctx.stretcherDeckTopWorldY(),
      deckCenter: { x: input.actorSlot.position.x, z: input.actorSlot.position.z },
      ...(deckStretcher ? { stretcher: deckStretcher } : {}),
    });
  }
  const activeRoleAnimationClipName = selectedRoleClips[0]?.name;
  const activeGazeProbeAnimationClipName = selectedGazeProbeClips[0]?.name;
  // #574 evidence: the carve-out decision is stamped so captures and tests can read
  // WHICH seated actor got a mixer and why, instead of re-deriving it from source.
  humanoidData["openClinXrSeatedRoleClipCarveout"] =
    mixer && isSeated && seatedRoleClipPlayable
      ? {
          admitted: true,
          clipNames: selectedRoleClips.map((clip) => clip.name),
          policy: "seated_role_clip_policy.seatedRoleClipIsPlayable",
        }
      : { admitted: false, clipNames: [] as string[], policy: "seated_role_clip_policy.seatedRoleClipIsPlayable" };
  // The clip the auto-play fallback deliberately excluded. Naming it on the SLOT is what lets a
  // locomotion consumer select it without either package re-declaring the prefix.
  const locomotionClip = input.animationClips.find(
    (clip: unknown): clip is AnimationClip =>
      clip instanceof AnimationClip && isDeliberateSelectionOnlyClip(clip.name),
  );
  humanoidData["openClinXrLocomotionClipName"] = locomotionClip?.name ?? null;
  const slot = {
    assetId: input.assetId,
    actorId: input.actorId,
    root: input.humanoid,
    actorSlot: input.actorSlot,
    baseY: input.humanoid.position.y,
    baseX: input.humanoid.position.x,
    baseScaleX: input.humanoid.scale.x,
    baseScaleY: input.humanoid.scale.y,
    baseScaleZ: input.humanoid.scale.z,
    baseRotationY: input.humanoid.rotation.y,
    baseZ: input.humanoid.position.z,
    phaseOffsetMs: ctx.animationSlots().length * 480,
    mouthCue: input.mouthCue,
    gazeCue: input.gazeCue,
    eyeFocusCue: input.eyeFocusCue,
    expressionCue: input.expressionCue,
    emotionExpression: ctx.createEmotionState(),
    sourceComparatorFreezeEnabled: !input.playbackEnabled && input.fixedSourcePoseSampleSeconds !== null,
    responseClips: input.animationClips.filter((clip: unknown): clip is AnimationClip => clip instanceof AnimationClip),
    ...(locomotionClip ? { locomotionClipName: locomotionClip.name } : {}),
    ...(mixer ? { mixer } : {}),
    ...(activeRoleAnimationClipName ? { activeRoleAnimationClipName } : {}),
    ...(activeGazeProbeAnimationClipName ? { activeGazeProbeAnimationClipName } : {}),
  };
  ctx.pushAnimationSlot(slot);
  ctx.setAnimationSlotByActor(input.actorId, slot);
  ctx.setActorSlotByActor(input.actorId, input.actorSlot);
  // Register case-driven clinical-touch hit regions for this actor, if any.
  const clinicalTouchScenario = ctx.clinicalTouchScenario();
  const clinicalTouchActor = clinicalTouchScenario?.actors.find((actor: Scenario["actors"][number]) => actor.actorId === input.actorId);
  if (clinicalTouchActor?.bodyMechanics?.touchResponses?.length) {
    ctx.registerTouchRegions(input.actorId, input.humanoid, clinicalTouchActor.bodyMechanics.touchResponses as unknown[]);
  }
  humanoidData["openClinXrAnimationPlayback"] = !input.playbackEnabled && fixedSourcePoseClip && input.fixedSourcePoseSampleSeconds !== null
    ? "source_comparator_fixed_pose_sampled"
    : mixer
    ? activeRoleAnimationClipName
      ? "gltf_role_animation_clip_playing"
      : "gltf_animation_clips_playing"
    : input.playbackEnabled ? "procedural_idle_breathing_fallback" : "source_comparator_animation_suppressed";
  humanoidData["openClinXrRoleAnimationClipNames"] = input.roleAnimationClipNames;
  humanoidData["openClinXrActiveRoleAnimationClipName"] = activeRoleAnimationClipName ?? null;
  humanoidData["openClinXrGazeProbeAnimationClipNames"] = input.gazeProbeAnimationClipNames;
  humanoidData["openClinXrActiveGazeProbeAnimationClipName"] = activeGazeProbeAnimationClipName ?? null;
  if (slot.sourceComparatorFreezeEnabled) {
    humanoidData["openClinXrSourceComparatorRuntimeFreezePolicy"] =
      "runtime_pose_speech_gaze_emotion_updates_disabled_for_clean_source_body_capture";
  }
  const comparatorForDialogue = ctx.selectedHumanoidSourceComparator();
  // parent/nurse real-garment primary is patient slot (role GLB centered for capture)
  if (input.actorId === ctx.runtimePatientActorId() && !slot.sourceComparatorFreezeEnabled) {
    const comparator = comparatorForDialogue;
    const isRealGarmentOrSchoolOrEd = comparator === "peds_anny_school_age_mpfb2_eye_patient" || comparator === "peds_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse" || comparator === "ed_anny_real_garment_patient";
    const dialogue = ctx.dialogueText();
    const spokenText = isRealGarmentOrSchoolOrEd && comparator !== "ed_anny_real_garment_patient" && input.actorId === ctx.runtimePatientActorId()
      ? ctx.visemeUtterance()
      : dialogue.line.trim() || dialogue.initial;
    const spokenEmotion = isRealGarmentOrSchoolOrEd && comparator !== "ed_anny_real_garment_patient" ? "anxious" as const : undefined;
    const spokenComparator = comparator;
    const spokenHumanoid = input.humanoid;
    const spokenActorId = input.actorId;
    window.requestAnimationFrame(() => {
      ctx.triggerDialogue(spokenActorId, spokenText, {
        kind: "learner_camera",
        actorId: null,
      }, spokenEmotion);
      if (isRealGarmentOrSchoolOrEd) {
        (spokenHumanoid.userData as Record<string, unknown>)["openClinXrVisemeTimelineComparatorEvidence"] = {
          comparator: spokenComparator,
          dialogueText: spokenText,
          traceTag: "work_of_breathing_assessment",
          mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
          morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue",
          notEvidenceFor: "production phoneme timing, validated facial animation, or clinical affect scoring",
        };
        // garmentGeometry surface prepared; real-garment (phenotype.garmentLayers) + school-age use embedded clothing regions from real topology
      }
    });
  }
  ctx.schedulePedsPlaybackIfReady();
  ctx.recordBootPhase(mixer ? "generated_humanoid_animation_clips_started" : "generated_humanoid_procedural_idle_started");
}
