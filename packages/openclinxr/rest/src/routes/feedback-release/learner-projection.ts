import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import {
  type ApiAssembledExamFeedbackReleaseRecord,
  type AssembledExamDispositionValue,
  assembledExamFeedbackReleaseClaimBoundary,
  assembledExamFeedbackReleaseNotEvidenceFor,
} from "../../runtime-durable-store.js";

export type LearnerSafeFeedbackReleaseProjection = {
  releaseId: string;
  examRunId: string;
  learnerId: string | null;
  releasedAt: string;
  disposition: AssembledExamDispositionValue;
  stations: readonly {
    stationOrder: number;
    scenarioId: string;
    patientNoteSubmitted: boolean;
    patientNote?: { submittedAtSecond: number; text: string };
  }[];
  claimBoundary: typeof assembledExamFeedbackReleaseClaimBoundary;
  notEvidenceFor: typeof assembledExamFeedbackReleaseNotEvidenceFor;
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export function projectLearnerSafeFeedbackRelease(input: {
  release: ApiAssembledExamFeedbackReleaseRecord;
  packet: AssembledExamReviewPacket;
  disposition: AssembledExamDispositionValue;
}): LearnerSafeFeedbackReleaseProjection {
  return {
    releaseId: input.release.releaseId,
    examRunId: input.release.examRunId,
    learnerId: input.packet.learnerId,
    releasedAt: input.release.releasedAt,
    disposition: input.disposition,
    stations: input.packet.stations.map((station) => {
      const note = station.reviewPacket.patientNote;
      return {
        stationOrder: station.identity.stationOrder,
        scenarioId: station.identity.scenarioId,
        patientNoteSubmitted: station.patientNoteSubmitted,
        ...(note
          ? { patientNote: { submittedAtSecond: note.submittedAtSecond, text: note.text } }
          : {}),
      };
    }),
    claimBoundary: assembledExamFeedbackReleaseClaimBoundary,
    notEvidenceFor: assembledExamFeedbackReleaseNotEvidenceFor,
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}
