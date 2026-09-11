import { type AuthIdentity, hasFacultyAccess } from "@openclinxr/auth";
import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { Hono } from "hono";
import type { ApiAppContext } from "../../api-app-context.js";
import type { ApiAppVariables } from "../../api-types.js";
import {
  type ApiAssembledExamDispositionRecord,
  type ApiFacultyAssessmentEvidenceCite,
  type ApiFacultyAssessmentRecord,
  type ApiRuntimeDurableStore,
  assembledExamDispositionClaimBoundary,
  assembledExamDispositionNotEvidenceFor,
  assembledExamFacultyAssessmentClaimBoundary,
  assembledExamFacultyAssessmentNotEvidenceFor,
  assembledExamPacketDigest,
  createScenarioRuntimeDurableStoreFromApiPersistence,
} from "../../runtime-durable-store.js";
import { type FacultyObservationInput, groundObservations } from "./grounding.js";

const FACULTY_ASSESSMENT_PATH = "/exam-runs/:examRunId/faculty-assessment";

class FacultyAssessmentSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "FacultyAssessmentSaveError";
  }
}

export function registerFacultyAssessmentRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, assembledExamReviewPackets, assembledExamDispositions } = ctx;
  const durable = createScenarioRuntimeDurableStoreFromApiPersistence(persistence);

  app.get(FACULTY_ASSESSMENT_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody("faculty_role_required"), 403);
    }
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }
    const packet = await loadPacket(durable, assembledExamReviewPackets, examRunId);
    if (!packet) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    const assessments = stored?.facultyAssessments ?? [];
    if (assessments.length === 0) {
      return context.json({ error: "faculty_assessment_not_found" }, 404);
    }
    return context.json(toReadModel(packet, stored));
  });

  app.post(FACULTY_ASSESSMENT_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody("faculty_role_required"), 403);
    }
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }
    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (overwriteAttempt(body)) {
      return conflict(context, "overwrite_refused", "cannot_replace_evidence_or_trail");
    }
    const packet = await loadPacket(durable, assembledExamReviewPackets, examRunId);
    if (!packet) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    const command = parseCommand(body, examRunId);
    if ("error" in command) {
      return context.json(command, 400);
    }
    const digest = assembledExamPacketDigest(packet);
    if (command.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "packet_digest_mismatch");
    }
    const identity = context.get("identity");
    if (identity.role === "faculty" && identity.subject.trim() !== command.raterId) {
      return conflict(context, "identity_mutation", "rater_mismatch");
    }
    const producer = producerSelfReview(command.raterId, packet, identity);
    if (producer) {
      return conflict(context, "producer_self_review", producer);
    }
    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    if (stored && stored.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "stored_packet_digest_mismatch");
    }
    const trail = [...(stored?.facultyAssessments ?? [])];
    const lockedRater = trail[0]?.raterId;
    if (lockedRater && lockedRater !== command.raterId) {
      return conflict(context, "identity_mutation", "rater_mismatch");
    }
    const current = trail[trail.length - 1];
    if (current?.status === "final") {
      return conflict(context, "finalized", "assessment_already_sealed");
    }
    if (command.assessmentId && trail.some((item) => item.assessmentId === command.assessmentId && item.status === "final")) {
      return conflict(context, "overwrite_refused", "assessment_id_already_sealed");
    }
    const grounded = groundObservations(packet, command.observations);
    if ("error" in grounded) {
      const status = grounded.error === "invalid_body" ? 400 : 409;
      return context.json({
        error: grounded.error,
        reason: grounded.reason,
        notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
      }, status);
    }
    if (command.status === "final") {
      if (grounded.length === 0) {
        return context.json({
          error: "completeness_incomplete",
          reason: "observations_required",
          notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
        }, 409);
      }
      if (command.narrativeFeedback.length === 0) {
        return context.json({
          error: "completeness_incomplete",
          reason: "narrative_feedback_required",
          notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
        }, 409);
      }
    }
    const now = command.attestedAt;
    const assessmentId = command.assessmentId
      ?? current?.assessmentId
      ?? `faculty_assessment:${examRunId}:1`;
    const createdAt = current?.createdAt ?? now;
    const assessment: ApiFacultyAssessmentRecord = {
      assessmentId,
      examRunId,
      packetDigest: digest,
      raterId: command.raterId,
      status: command.status,
      observations: grounded,
      narrativeFeedback: command.narrativeFeedback,
      createdAt,
      updatedAt: now,
      finalizedAt: command.status === "final" ? now : null,
      sealedAt: command.status === "final" ? now : null,
      claimBoundary: assembledExamFacultyAssessmentClaimBoundary,
      notEvidenceFor: assembledExamFacultyAssessmentNotEvidenceFor,
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    };
    const nextTrail = current
      ? [...trail.slice(0, -1), assessment]
      : [...trail, assessment];
    const record: ApiAssembledExamDispositionRecord = {
      examRunId,
      packetDigest: digest,
      evidencePacket: stored?.evidencePacket ?? packet,
      decisions: stored?.decisions ?? [],
      claimBoundary: assembledExamDispositionClaimBoundary,
      notEvidenceFor: assembledExamDispositionNotEvidenceFor,
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
      ...(stored?.feedbackReleases && stored.feedbackReleases.length > 0
        ? { feedbackReleases: stored.feedbackReleases }
        : {}),
      facultyAssessments: nextTrail,
    };
    try {
      await persistDisposition(durable, assembledExamDispositions, record);
      return context.json(toReadModel(packet, record), current ? 200 : 201);
    } catch (error) {
      if (error instanceof FacultyAssessmentSaveError) {
        return context.json({
          error: "durable_save_failed",
          reason: error.message,
          notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
        }, 500);
      }
      throw error;
    }
  });
}

type ParsedCommand = {
  raterId: string;
  packetDigest: string;
  status: "draft" | "final";
  narrativeFeedback: string;
  attestedAt: string;
  observations: readonly FacultyObservationInput[];
  assessmentId?: string;
};

function parseCommand(
  body: Record<string, unknown>,
  examRunId: string,
): ParsedCommand | { error: string; reason: string } {
  const raterId = typeof body["raterId"] === "string" ? body["raterId"].trim() : "";
  if (raterId.length === 0) {
    return { error: "invalid_body", reason: "raterId_required" };
  }
  const packetDigest = typeof body["packetDigest"] === "string" ? body["packetDigest"].trim() : "";
  if (packetDigest.length === 0) {
    return { error: "invalid_body", reason: "packetDigest_required" };
  }
  const status = body["status"];
  if (status !== "draft" && status !== "final") {
    return { error: "invalid_body", reason: "status_required" };
  }
  const attestedAt = typeof body["attestedAt"] === "string" ? body["attestedAt"].trim() : "";
  if (attestedAt.length === 0 || Number.isNaN(Date.parse(attestedAt))) {
    return { error: "invalid_body", reason: "attestedAt_required" };
  }
  const narrativeFeedback = typeof body["narrativeFeedback"] === "string"
    ? body["narrativeFeedback"].trim()
    : "";
  const bodyExamRunId = typeof body["examRunId"] === "string" ? body["examRunId"].trim() : "";
  if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
    return { error: "invalid_body", reason: "examRunId_mismatch" };
  }
  const observations = parseObservations(body["observations"]);
  if (!observations) {
    return { error: "invalid_body", reason: "observations_required" };
  }
  const assessmentId = typeof body["assessmentId"] === "string" ? body["assessmentId"].trim() : "";
  return {
    raterId,
    packetDigest,
    status,
    narrativeFeedback,
    attestedAt,
    observations,
    ...(assessmentId.length > 0 ? { assessmentId } : {}),
  };
}

function parseObservations(value: unknown): FacultyObservationInput[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const parsed: FacultyObservationInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    const rubricItemId = typeof record["rubricItemId"] === "string" ? record["rubricItemId"] : "";
    const stationRunId = typeof record["stationRunId"] === "string" ? record["stationRunId"] : "";
    const comment = typeof record["comment"] === "string" ? record["comment"] : "";
    const cites = parseCites(record["evidenceCites"]);
    if (!cites) {
      return undefined;
    }
    const observationId = typeof record["observationId"] === "string" ? record["observationId"].trim() : "";
    parsed.push({
      rubricItemId,
      stationRunId,
      comment,
      evidenceCites: cites,
      ...(observationId.length > 0 ? { observationId } : {}),
    });
  }
  return parsed;
}

function parseCites(value: unknown): ApiFacultyAssessmentEvidenceCite[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const cites: ApiFacultyAssessmentEvidenceCite[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    const packetField = typeof record["packetField"] === "string" ? record["packetField"].trim() : "";
    const stationRunId = typeof record["stationRunId"] === "string" ? record["stationRunId"].trim() : "";
    if (packetField.length === 0 || stationRunId.length === 0) {
      return undefined;
    }
    const sequence = record["sequence"];
    const durableEventRef = typeof record["durableEventRef"] === "string" ? record["durableEventRef"].trim() : "";
    const eventType = typeof record["eventType"] === "string" ? record["eventType"].trim() : "";
    const tag = typeof record["tag"] === "string" ? record["tag"].trim() : "";
    cites.push({
      packetField,
      stationRunId,
      ...(typeof sequence === "number" && Number.isInteger(sequence) ? { sequence } : {}),
      ...(durableEventRef.length > 0 ? { durableEventRef } : {}),
      ...(eventType.length > 0 ? { eventType } : {}),
      ...(tag.length > 0 ? { tag } : {}),
    });
  }
  return cites;
}

function overwriteAttempt(body: Record<string, unknown>): boolean {
  return "evidencePacket" in body
    || "decisions" in body
    || "feedbackReleases" in body
    || "facultyAssessments" in body;
}

function producerSelfReview(
  raterId: string,
  packet: AssembledExamReviewPacket,
  identity: AuthIdentity,
): string | undefined {
  const producers = new Set<string>();
  if (packet.learnerId) {
    producers.add(packet.learnerId);
  }
  for (const station of packet.stations) {
    const draftReviewer = station.reviewPacket.facultyScoreDraft.reviewerId.trim();
    if (draftReviewer.length > 0) {
      producers.add(draftReviewer);
    }
  }
  if (producers.has(raterId)) {
    return "reviewer_is_producer";
  }
  if (identity.role === "learner") {
    return "learner_cannot_review";
  }
  return undefined;
}

function toReadModel(
  packet: AssembledExamReviewPacket,
  stored: ApiAssembledExamDispositionRecord | undefined,
): Record<string, unknown> {
  const assessments = stored?.facultyAssessments ?? [];
  const current = assessments[assessments.length - 1] ?? null;
  return {
    examRunId: packet.examRunId,
    packetDigest: stored?.packetDigest ?? assembledExamPacketDigest(packet),
    current,
    assessments,
    claimBoundary: assembledExamFacultyAssessmentClaimBoundary,
    notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function forbiddenBody(reason: string) {
  return {
    error: "forbidden",
    reason,
    notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
  };
}

function conflict(
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

async function persistDisposition(
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

async function loadDisposition(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, ApiAssembledExamDispositionRecord>,
  examRunId: string,
): Promise<ApiAssembledExamDispositionRecord | undefined> {
  const fromSink = await durable.getAssembledExamDisposition(examRunId);
  return fromSink ?? memory.get(examRunId);
}

async function loadPacket(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, AssembledExamReviewPacket>,
  examRunId: string,
): Promise<AssembledExamReviewPacket | undefined> {
  const fromSink = await durable.getAssembledExamReviewPacket(examRunId);
  return fromSink ?? memory.get(examRunId);
}
