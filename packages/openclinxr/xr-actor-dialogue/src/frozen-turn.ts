import {
  playFrozenActorTurnOnSlot,
  type ActorTurnPlayback,
  type ActorTurnPlaybackStartContext,
  type LiveActorTurnConsumption,
} from "@openclinxr/xr-dialogue";
import { startHumanoidEmotionTransition as startPackageHumanoidEmotionTransition } from "@openclinxr/xr-humanoid-animation";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidDialogueEmotionContext,
  HumanoidDialogueGazeTarget,
  HumanoidExpressionEmotion,
} from "@openclinxr/xr-humanoid-animation";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";

export function playLiveFrozenActorTurn(
  deps: {
    animationSlotForActor: (actorId: string) => GeneratedHumanoidAnimationSlot | undefined;
    responseClipNames: (actorId: string) => string[];
    playClip: (actorId: string, clipName: string) => boolean;
    startFaceTransition: (actorId: string, emotion: HumanoidExpressionEmotion, nowMs: number) => void;
    nowMs: () => number;
    triggerDialogue: (
      actorId: string,
      text: string,
      gazeTarget: HumanoidDialogueGazeTarget,
      explicitEmotion: HumanoidExpressionEmotion | undefined,
      requirement: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
      emotionSource: HumanoidDialogueEmotionContext["source"] | undefined,
    ) => void;
  },
  plan: LiveActorTurnConsumption["plan"],
  execution: LiveActorTurnConsumption["execution"],
  gazeTarget: HumanoidDialogueGazeTarget,
  requirement: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
): ActorTurnPlayback {
  const slot = deps.animationSlotForActor(plan.actorId);
  return playFrozenActorTurnOnSlot(plan, execution, {
    nowMs: deps.nowMs(),
    clipNames: slot?.responseClips?.map((clip: { name: string }) => clip.name) ?? [],
    getSlot: (id: string) => deps.animationSlotForActor(id),
    speak: (ctx: ActorTurnPlaybackStartContext) => {
      deps.triggerDialogue(ctx.actorId, ctx.spokenText, gazeTarget, ctx.faceEmotion, requirement, "plan.dialogueEmotionTo");
      return true;
    },
    playClip: deps.playClip,
    startFaceTransition: (id: string, emotion: ActorTurnPlaybackStartContext["faceEmotion"], nowMs: number) => {
      const live = deps.animationSlotForActor(id);
      if (live) deps.startFaceTransition(id, emotion as HumanoidExpressionEmotion, nowMs);
    },
  });
}

export function startSlotEmotionTransition(
  slot: GeneratedHumanoidAnimationSlot,
  emotion: HumanoidExpressionEmotion,
  nowMs: number,
): void {
  startPackageHumanoidEmotionTransition(slot, emotion, nowMs);
}
