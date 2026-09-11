import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type {
  ApiAssembledExamDispositionRecord,
  ApiFacultyAssessmentRecord,
  ApiRuntimeDurableStore,
} from "../../runtime-durable-store.js";
import {
  assembledExamDispositionClaimBoundary,
  assembledExamDispositionNotEvidenceFor,
  assembledExamFacultyAssessmentClaimBoundary,
  assembledExamFacultyAssessmentNotEvidenceFor,
  assembledExamPacketDigest,
} from "../../runtime-durable-store.js";

export class FacultyAssessmentSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "FacultyAssessmentSaveError";
  }
}

export function facultyAssessmentHonesty() {
  return {
    claimBoundary: assembledExamFacultyAssessmentClaimBoundary,
    notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
    scoringValidityClaimed: false as const,
    examEquivalenceGate: false as const,
  };
}

export function forbiddenBody(reason: string) {
  return {
    error: "forbidden",
    reason,
    notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
  };
}

export function conflict(
  context: { json: (body: Record<string, unknown>, status: 409) => Response },
  error: string,
  reason: string,
): Response {
  return context.json({
    error,
    reason,
    notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
  }, 409);
}

export function overwriteAttempt(body: Record<string, unknown>): boolean {
  return "evidencePacket" in body
    || "decisions" in body
    || "feedbackReleases" in body
    || "facultyAssessments" in body
    || "raterCalibrations" in body;
}

export function toReadModel(
  packet: AssembledExamReviewPacket,
  stored: ApiAssembledExamDispositionRecord | undefined,
  viewerRaterId?: string,
): Record<string, unknown> {
  const trail = stored?.facultyAssessments ?? [];
  const assessments = viewerRaterId
    ? trail.filter((entry) => entry.raterId === viewerRaterId)
    : trail;
  const current = assessments[assessments.length - 1] ?? null;
  return {
    examRunId: packet.examRunId,
    packetDigest: stored?.packetDigest ?? assembledExamPacketDigest(packet),
    current,
    assessments,
    ...facultyAssessmentHonesty(),
  };
}

export async function persistDisposition(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, ApiAssembledExamDispositionRecord>,
  record: ApiAssembledExamDispositionRecord,
): Promise<void> {
  try {
    await durable.saveAssembledExamDisposition(record.examRunId, record);
  } catch (error) {
    throw new FacultyAssessmentSaveError(error);
  }
  memory.set(record.examRunId, record);
}

export async function loadDisposition(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, ApiAssembledExamDispositionRecord>,
  examRunId: string,
): Promise<ApiAssembledExamDispositionRecord | undefined> {
  const fromSink = await durable.getAssembledExamDisposition(examRunId);
  return fromSink ?? memory.get(examRunId);
}

export async function loadPacket(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, AssembledExamReviewPacket>,
  examRunId: string,
): Promise<AssembledExamReviewPacket | undefined> {
  const fromSink = await durable.getAssembledExamReviewPacket(examRunId);
  return fromSink ?? memory.get(examRunId);
}

export function nextDisposition(
  packet: AssembledExamReviewPacket,
  digest: string,
  stored: ApiAssembledExamDispositionRecord | undefined,
  assessments: readonly ApiFacultyAssessmentRecord[],
): ApiAssembledExamDispositionRecord {
  const record: ApiAssembledExamDispositionRecord = {
    examRunId: packet.examRunId,
    packetDigest: digest,
    evidencePacket: stored?.evidencePacket ?? packet,
    decisions: stored?.decisions ?? [],
    claimBoundary: assembledExamDispositionClaimBoundary,
    notEvidenceFor: assembledExamDispositionNotEvidenceFor,
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
    facultyAssessments: assessments,
  };
  const withReleases = stored?.feedbackReleases && stored.feedbackReleases.length > 0
    ? { ...record, feedbackReleases: stored.feedbackReleases }
    : record;
  if (stored?.raterCalibrations && stored.raterCalibrations.length > 0) {
    return { ...withReleases, raterCalibrations: stored.raterCalibrations };
  }
  return withReleases;
}
