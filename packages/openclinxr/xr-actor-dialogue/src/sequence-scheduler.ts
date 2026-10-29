import { phonemesForText } from "@openclinxr/xr-dialogue/package-actor-turn";
import { humanoidDialogueDurationMs as packageHumanoidDialogueDurationMs } from "@openclinxr/xr-humanoid-animation";
import { speechClockNowMs, speechClockRemainingMs } from "./speech-clock.js";
import type {
  ActorDialoguePlaybackEvidence,
  ActorDialogueSequence,
  ActorDialogueTurn,
} from "./types.js";

/** Slot seam for the single-domain speech clock. */
export type SpeechClockSlot = {
  activeSpeech?: { startedAtMs: number; durationMs: number } | undefined;
  root?: { userData?: Record<string, unknown> } | undefined;
} | undefined;

/** Internal scheduler host. Optional on the public playback deps so existing consumers keep compiling. */
export type SequenceSchedulerHost = {
  nowMs?: () => number;
  animationSlotForActor?: (actorId: string) => { activeSpeech?: { startedAtMs: number; durationMs: number } | undefined } | undefined;
  slotHasActor?: (actorId: string) => boolean;
  reviewCaptureMode?: () => boolean;
  liveTurnForTrace?: (tag: string) => { caption?: string } | undefined;
  sequenceGeneration?: () => number;
  reportUtteranceEnd?: (endsAtMs: number) => void;
};

export type ScheduledSequenceTurn = {
  turn: ActorDialogueTurn;
  input: {
    turns: ActorDialogueTurn[];
    latestTurnIndex: number;
    latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
    latestTraceTag: string | null;
    latestSequence: ActorDialogueSequence | null;
    latestSequenceStepIndex: number;
  };
};

export const SEQUENCE_EARLIEST_STEP_GAP_MS = 1150;

export function utteranceDurationMs(reviewCaptureMode: boolean, text: string): number {
  return packageHumanoidDialogueDurationMs(phonemesForText(text).length, reviewCaptureMode);
}

export function remainingSpeechMs(
  activeSpeech: { startedAtMs: number; durationMs: number } | undefined,
  nowMs: number,
  slot?: SpeechClockSlot,
): number {
  if (!activeSpeech) return 0;
  return speechClockRemainingMs(activeSpeech, speechClockNowMs(slot, nowMs));
}

export function scheduleDurationGovernedSequence(
  deps: { scheduleTimeout: (callback: () => void, delayMs: number) => void } & SequenceSchedulerHost & {
    playTurn: (turn: ActorDialogueTurn, input: ScheduledSequenceTurn["input"]) => void;
  },
  sequence: ActorDialogueSequence,
  fallbackTurns: ActorDialogueTurn[],
): void {
  const generationOf = deps.sequenceGeneration;
  const generation = generationOf ? generationOf() : 0;
  const scheduleStep = (stepIndex: number, delayMs: number): void => {
    deps.scheduleTimeout(() => {
      if (generationOf && generationOf() !== generation) return;
      const step = sequence.turns[stepIndex];
      if (!step) return;
      if (deps.slotHasActor && !deps.slotHasActor(step.actorId)) return;
      const previous = stepIndex > 0 ? sequence.turns[stepIndex - 1] : undefined;
      if (previous && deps.animationSlotForActor && deps.nowMs) {
        const previousSlot = deps.animationSlotForActor(previous.actorId) as SpeechClockSlot;
        const previousSpeech = previousSlot?.activeSpeech;
        const remaining = remainingSpeechMs(previousSpeech, deps.nowMs(), previousSlot);
        if (remaining > 0) {
          scheduleStep(stepIndex, remaining);
          return;
        }
      }
      deps.playTurn(step, {
        turns: fallbackTurns,
        latestTurnIndex: fallbackTurns.findIndex(
          (fallbackTurn) => fallbackTurn.turnId === step.turnId && fallbackTurn.actorId === step.actorId,
        ),
        latestTriggerSource: "trace_action",
        latestTraceTag: sequence.traceTag,
        latestSequence: sequence,
        latestSequenceStepIndex: stepIndex,
      });
      const reviewMode = deps.reviewCaptureMode ? deps.reviewCaptureMode() : false;
      const liveCaption = deps.liveTurnForTrace ? deps.liveTurnForTrace(step.cue)?.caption : undefined;
      if (deps.reportUtteranceEnd && deps.nowMs) {
        deps.reportUtteranceEnd(deps.nowMs() + utteranceDurationMs(reviewMode, liveCaption ?? step.text));
      }
      const next = stepIndex + 1;
      if (next < sequence.turns.length) {
        scheduleStep(next, Math.max(SEQUENCE_EARLIEST_STEP_GAP_MS, utteranceDurationMs(reviewMode, liveCaption ?? step.text)));
      }
    }, delayMs);
  };
  if (sequence.turns.length > 0) scheduleStep(0, 0);
}
