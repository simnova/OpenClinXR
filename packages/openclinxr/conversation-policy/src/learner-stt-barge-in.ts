import { resolveLearnerBargeIn } from "./barge-in.js";
import { CANONICAL_TURN_CLOCK_MS_PER_SECOND } from "./canonical-interruption.js";
import type {
  ActorTurnInProgress,
  BargeInContext,
  BargeInResolution,
  LearnerBargeInInput,
} from "./types.js";

/** STT barge-in record as consumed by conversation-policy (structural, no voice-gateway import). */
export type LearnerSttBargeInRecord = {
  stationRunId: string;
  transcript?: string;
  interruption: {
    interruptionId: string;
    turnId: string | null;
    clockMs: number;
  } | null;
};

export function learnerBargeInInputFromStt(
  stt: LearnerSttBargeInRecord,
): LearnerBargeInInput | null {
  if (!stt.interruption) {
    return null;
  }
  return {
    atSecond: Math.trunc(stt.interruption.clockMs / CANONICAL_TURN_CLOCK_MS_PER_SECOND),
    atMs: stt.interruption.clockMs,
    interruptionId: stt.interruption.interruptionId,
    stationRunId: stt.stationRunId,
    ...(stt.interruption.turnId ? { turnId: stt.interruption.turnId } : {}),
    ...(stt.transcript ? { learnerUtterance: stt.transcript } : {}),
  };
}

export function resolveLearnerBargeInFromStt(
  stt: LearnerSttBargeInRecord,
  inProgress: ActorTurnInProgress | null | undefined,
  context: BargeInContext = {},
): BargeInResolution {
  const input = learnerBargeInInputFromStt(stt);
  if (!input) {
    return resolveLearnerBargeIn(null, { atSecond: 0, stationRunId: stt.stationRunId }, context);
  }
  return resolveLearnerBargeIn(inProgress, input, context);
}
