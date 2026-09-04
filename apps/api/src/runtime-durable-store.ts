import { createHash } from "node:crypto";
import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import type {
  AssembledExamPhase,
  AssembledExamPhaseTransitionType,
  AssembledExamReviewPacket,
} from "@openclinxr/review-workflow";
import type { ScenarioRuntimeDurableStore } from "@openclinxr/scenario-runtime";
import type { ApiPersistenceSink } from "./api-types.js";

export const assembledExamRunClaimBoundary = "assembled_exam_run_not_exam_equivalence" as const;

export const assembledExamRunNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
  "production_deployment",
] as const;

export type ApiAssembledExamStationBinding = {
  stationOrder: number;
  slotId: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
};

export type ApiAssembledExamAdmittedPhaseEvent = {
  examRunId: string;
  stationRunId: string;
  sequence: number;
  eventType: AssembledExamPhaseTransitionType;
  atSecond: number;
  formAtSecond: number;
  scenarioId: string;
  stationOrder: number;
  durableEventRef: string;
  phase: AssembledExamPhase;
  source: string;
  advanceReason?: string;
};

/** One durable assembled-exam aggregate. Resume reconstructs from this record alone. */
export type ApiAssembledExamRunRecord = {
  examRunId: string;
  learnerId: string;
  examFormId: string;
  blueprintId: string;
  form: ExamForm;
  timingPlan: ExamTimingPlan;
  orderedStations: ApiAssembledExamStationBinding[];
  admittedPhaseEvents: ApiAssembledExamAdmittedPhaseEvent[];
  claimBoundary: typeof assembledExamRunClaimBoundary;
  notEvidenceFor: typeof assembledExamRunNotEvidenceFor;
  examEquivalenceGate: false;
};

/**
 * Exam-run assembled review packet hooks. Optional on the API persistence sink;
 * the route persists/retrieves one exam-run artifact rather than flattening
 * per-station packets in transport.
 */
export type AssembledExamReviewDurableStore = {
  saveAssembledExamReviewPacket(
    examRunId: string,
    packet: AssembledExamReviewPacket,
  ): void | Promise<void>;
  getAssembledExamReviewPacket(
    examRunId: string,
  ): Promise<AssembledExamReviewPacket | undefined> | AssembledExamReviewPacket | undefined;
};

/** Canonical assembled-exam run aggregate. Persist before acknowledging mutations. */
export type AssembledExamRunDurableStore = {
  saveAssembledExamRun(
    examRunId: string,
    record: ApiAssembledExamRunRecord,
  ): void | Promise<void>;
  getAssembledExamRun(
    examRunId: string,
  ): Promise<ApiAssembledExamRunRecord | undefined> | ApiAssembledExamRunRecord | undefined;
};

export const assembledExamDispositionClaimBoundary =
  "assembled_exam_faculty_disposition_not_score_use" as const;

export const assembledExamDispositionNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "automated_scoring",
  "credentialing",
  "production_deployment",
] as const;

export const ASSEMBLED_EXAM_DISPOSITION_VALUES = [
  "hold",
  "needs_revision",
  "local_debrief_ready",
] as const;

export type AssembledExamDispositionValue = (typeof ASSEMBLED_EXAM_DISPOSITION_VALUES)[number];
export type AssembledExamDispositionStatus = "draft" | "final";

/** One attested faculty disposition. Append-only; never rewritten in place. */
export type ApiAssembledExamDispositionDecision = {
  decisionId: string;
  examRunId: string;
  reviewerId: string;
  packetDigest: string;
  disposition: AssembledExamDispositionValue;
  status: AssembledExamDispositionStatus;
  rationale: string;
  attestedAt: string;
  sequence: number;
};

/**
 * Durable faculty disposition aggregate. Evidence packet is stored by reference
 * to the immutable assembled-review artifact; decisions are an append-only trail.
 */
export type ApiAssembledExamDispositionRecord = {
  examRunId: string;
  packetDigest: string;
  evidencePacket: AssembledExamReviewPacket;
  decisions: readonly ApiAssembledExamDispositionDecision[];
  claimBoundary: typeof assembledExamDispositionClaimBoundary;
  notEvidenceFor: typeof assembledExamDispositionNotEvidenceFor;
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type AssembledExamDispositionDurableStore = {
  saveAssembledExamDisposition(
    examRunId: string,
    record: ApiAssembledExamDispositionRecord,
  ): void | Promise<void>;
  getAssembledExamDisposition(
    examRunId: string,
  ): Promise<ApiAssembledExamDispositionRecord | undefined> | ApiAssembledExamDispositionRecord | undefined;
};

export type ApiRuntimeDurableStore =
  ScenarioRuntimeDurableStore
  & AssembledExamReviewDurableStore
  & AssembledExamRunDurableStore
  & AssembledExamDispositionDurableStore;

/** SHA-256 hex of the stored assembled evidence packet. Stale-digest checks use this. */
export function assembledExamPacketDigest(packet: AssembledExamReviewPacket): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

/**
 * Adapts API persistence sink methods into ScenarioRuntime's optional durableStore
 * plus assembled-exam exam-run artifact hooks (review packet and run aggregate).
 * When wired at bootstrap, actor turns (generateActorResponse) and review packets
 * (reviewPacket / reviewPacketAndPersist) flow into the same sink used by REST paths.
 */
export function createScenarioRuntimeDurableStoreFromApiPersistence(
  sink: ApiPersistenceSink,
): ApiRuntimeDurableStore {
  return {
    saveReviewPacket(stationRunId, packet) {
      return sink.saveReviewPacket?.(stationRunId, packet);
    },
    saveActorTurn(stationRunId, turn) {
      return sink.saveActorTurn?.(stationRunId, turn);
    },
    saveAssembledExamReviewPacket(examRunId, packet) {
      return sink.saveAssembledExamReviewPacket?.(examRunId, packet);
    },
    getAssembledExamReviewPacket(examRunId) {
      return sink.getAssembledExamReviewPacket?.(examRunId);
    },
    saveAssembledExamRun(examRunId, record) {
      return sink.saveAssembledExamRun?.(examRunId, record);
    },
    getAssembledExamRun(examRunId) {
      return sink.getAssembledExamRun?.(examRunId);
    },
    saveAssembledExamDisposition(examRunId, record) {
      return sink.saveAssembledExamDisposition?.(examRunId, record);
    },
    getAssembledExamDisposition(examRunId) {
      return sink.getAssembledExamDisposition?.(examRunId);
    },
  };
}
