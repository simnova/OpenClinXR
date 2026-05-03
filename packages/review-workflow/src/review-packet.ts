import { evaluateRequiredTraceTags } from "@openclinxr/domain";
import { validateReviewPacket, type ReviewPacket } from "@openclinxr/shared-schemas";

export type ReviewTraceInput = {
  tag?: string;
  atSecond: number;
  eventType?: string;
};

export type BuildReviewPacketInput = {
  stationRunId: string;
  scenarioId: string;
  requiredTraceTags: readonly string[];
  traceEvents: readonly ReviewTraceInput[];
  facultyScoreDraft: ReviewPacket["facultyScoreDraft"];
};

export function buildReviewPacket(input: BuildReviewPacketInput): ReviewPacket {
  if (input.facultyScoreDraft.reviewerId.trim().length === 0) {
    throw new Error("Faculty score draft requires reviewer identity");
  }

  const { observed, missing } = evaluateRequiredTraceTags(input.requiredTraceTags, input.traceEvents);
  const packet: ReviewPacket = {
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    observedTraceTags: observed,
    missingRequiredTraceTags: missing,
    lateTraceTags: [],
    unsafeEvents: input.traceEvents
      .filter((event) => event.eventType?.startsWith("unsafe."))
      .map((event) => event.eventType)
      .filter((eventType): eventType is string => Boolean(eventType)),
    facultyScoreDraft: input.facultyScoreDraft,
  };

  const validation = validateReviewPacket(packet);
  if (!validation.ok) {
    throw new Error(`Invalid review packet: ${validation.errors.join("; ")}`);
  }

  return packet;
}

