import { type AuthIdentity, hasFacultyAccess } from "@openclinxr/auth";
import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { Hono } from "hono";
import type { ApiAppContext } from "../../api-app-context.js";
import type { ApiAppVariables } from "../../api-types.js";
import type {
  ApiFacultyAssessmentEvidenceCite,
  ApiFacultyAssessmentRecord,
  ApiFacultyAssessmentTransition,
} from "../../runtime-durable-store.js";
import {
  assembledExamFacultyAssessmentClaimBoundary,
  assembledExamFacultyAssessmentNotEvidenceFor,
  assembledExamPacketDigest,
  createScenarioRuntimeDurableStoreFromApiPersistence,
} from "../../runtime-durable-store.js";
import {
  type FacultyObservationInput,
  type GroundingFailure,
  groundObservations,
  isFacultyObservationRating,
} from "./grounding.js";
import { sealedAssessmentIdFor } from "./seal.js";
import { registerRaterCalibrationRoutes } from "../rater-calibration/index.js";
import {
  FacultyAssessmentSaveError,
  conflict,
  forbiddenBody,
  loadDisposition,
  loadPacket,
  nextDisposition,
  overwriteAttempt,
  persistDisposition,
  toReadModel,
} from "./store.js";

const FACULTY_ASSESSMENT_PATH = "/exam-runs/:examRunId/faculty-assessment";
const FACULTY_ASSESSMENT_SEAL_PATH = "/exam-runs/:examRunId/faculty-assessment/seal";

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
    const identity = context.get("identity");
    const viewerRaterId = identity.role === "faculty" ? identity.subject.trim() : undefined;
    const assessments = stored?.facultyAssessments ?? [];
    const visible = viewerRaterId
      ? assessments.filter((entry) => entry.raterId === viewerRaterId)
      : assessments;
    if (visible.length === 0) {
      return context.json({ error: "faculty_assessment_not_found" }, 404);
    }
    return context.json(toReadModel(packet, stored, viewerRaterId));
  });

  app.post(FACULTY_ASSESSMENT_SEAL_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody("faculty_role_required"), 403);
    }
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }
    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (overwriteAttempt(body) || sealCarriesWriteCommand(body)) {
      return conflict(context, "overwrite_refused", "seal_is_a_separate_command");
    }
    const packet = await loadPacket(durable, assembledExamReviewPackets, examRunId);
    if (!packet) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    const command = parseSealCommand(body, examRunId);
    if ("error" in command) {
      return context.json(command, 400);
    }
    const digest = assembledExamPacketDigest(packet);
    if (command.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "packet_digest_mismatch");
    }
    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    const trail = [...(stored?.facultyAssessments ?? [])];
    const identity = context.get("identity");
    const raterId = command.raterId
      ?? (identity.role === "faculty" ? identity.subject.trim() : trail[trail.length - 1]?.raterId ?? "");
    const raterIndex = trail.findIndex((entry) => entry.raterId === raterId);
    const current = raterIndex >= 0 ? trail[raterIndex] : undefined;
    if (!current) {
      return context.json({ error: "faculty_assessment_not_found" }, 404);
    }
    if (stored && stored.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "stored_packet_digest_mismatch");
    }
    if (identity.role === "faculty" && identity.subject.trim() !== raterId) {
      return conflict(context, "identity_mutation", "rater_mismatch");
    }
    if (current.raterId !== raterId) {
      return conflict(context, "identity_mutation", "rater_mismatch");
    }
    if (current.sealedAssessmentId && current.sealedAt) {
      return context.json(toReadModel(packet, stored, identity.role === "faculty" ? raterId : undefined), 200);
    }
    if (current.status !== "final") {
      return conflict(context, "not_final", "assessment_not_final");
    }
    const sealedAt = command.attestedAt;
    const sealed: ApiFacultyAssessmentRecord = {
      ...current,
      updatedAt: sealedAt,
      sealedAt,
      sealedAssessmentId: sealedAssessmentIdFor(digest, current),
      transitions: [
        ...current.transitions,
        { raterId, at: sealedAt, status: "sealed" },
      ],
    };
    const nextTrail = [...trail.slice(0, raterIndex), sealed, ...trail.slice(raterIndex + 1)];
    const record = nextDisposition(packet, digest, stored, nextTrail);
    try {
      await persistDisposition(durable, assembledExamDispositions, record);
      return context.json(
        toReadModel(packet, record, identity.role === "faculty" ? raterId : undefined),
        200,
      );
    } catch (error) {
      return saveFailure(context, error);
    }
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
    const raterIndex = trail.findIndex((entry) => entry.raterId === command.raterId);
    const current = raterIndex >= 0 ? trail[raterIndex] : undefined;
    if (current?.sealedAt || current?.sealedAssessmentId) {
      return conflict(context, "sealed", "assessment_already_sealed");
    }
    if (current?.status === "final") {
      return conflict(context, "finalized", "assessment_already_final");
    }
    const grounded = groundObservations(packet, command.observations);
    if ("error" in grounded) {
      return groundingResponse(context, grounded);
    }
    if (command.status === "final") {
      if (grounded.length === 0) {
        return conflict(context, "completeness_incomplete", "observations_required");
      }
      if (command.narrativeFeedback.length === 0) {
        return conflict(context, "completeness_incomplete", "narrative_feedback_required");
      }
    }
    const now = command.attestedAt;
    const assessmentId = command.assessmentId
      ?? current?.assessmentId
      ?? `faculty_assessment:${examRunId}:${command.raterId}`;
    const createdAt = current?.createdAt ?? now;
    const transitions = nextTransitions(current?.transitions, command.raterId, now, command.status, createdAt);
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
      sealedAt: null,
      sealedAssessmentId: null,
      transitions,
      claimBoundary: assembledExamFacultyAssessmentClaimBoundary,
      notEvidenceFor: assembledExamFacultyAssessmentNotEvidenceFor,
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    };
    const nextTrail = raterIndex >= 0
      ? [...trail.slice(0, raterIndex), assessment, ...trail.slice(raterIndex + 1)]
      : [...trail, assessment];
    const record = nextDisposition(packet, digest, stored, nextTrail);
    try {
      await persistDisposition(durable, assembledExamDispositions, record);
      const viewerRaterId = identity.role === "faculty" ? command.raterId : undefined;
      return context.json(toReadModel(packet, record, viewerRaterId), current ? 200 : 201);
    } catch (error) {
      return saveFailure(context, error);
    }
  });

  registerRaterCalibrationRoutes(app, ctx);
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
  if ("error" in observations) {
    return observations;
  }
  const assessmentId = typeof body["assessmentId"] === "string" ? body["assessmentId"].trim() : "";
  return {
    raterId,
    packetDigest,
    status,
    narrativeFeedback,
    attestedAt,
    observations: observations.ok,
    ...(assessmentId.length > 0 ? { assessmentId } : {}),
  };
}

function parseSealCommand(
  body: Record<string, unknown>,
  examRunId: string,
): { packetDigest: string; attestedAt: string; raterId?: string } | { error: string; reason: string } {
  const packetDigest = typeof body["packetDigest"] === "string" ? body["packetDigest"].trim() : "";
  if (packetDigest.length === 0) {
    return { error: "invalid_body", reason: "packetDigest_required" };
  }
  const attestedAt = typeof body["attestedAt"] === "string" ? body["attestedAt"].trim() : "";
  if (attestedAt.length === 0 || Number.isNaN(Date.parse(attestedAt))) {
    return { error: "invalid_body", reason: "attestedAt_required" };
  }
  const bodyExamRunId = typeof body["examRunId"] === "string" ? body["examRunId"].trim() : "";
  if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
    return { error: "invalid_body", reason: "examRunId_mismatch" };
  }
  const raterId = typeof body["raterId"] === "string" ? body["raterId"].trim() : "";
  return {
    packetDigest,
    attestedAt,
    ...(raterId.length > 0 ? { raterId } : {}),
  };
}

function parseObservations(
  value: unknown,
): { ok: FacultyObservationInput[] } | { error: "invalid_body"; reason: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "invalid_body", reason: "observations_required" };
  }
  const parsed: FacultyObservationInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { error: "invalid_body", reason: "observations_required" };
    }
    const record = item as Record<string, unknown>;
    if (!isFacultyObservationRating(record["rating"])) {
      return {
        error: "invalid_body",
        reason: typeof record["rating"] === "string" && record["rating"].length > 0
          ? "rating_invalid"
          : "rating_required",
      };
    }
    const rubricItemId = typeof record["rubricItemId"] === "string" ? record["rubricItemId"] : "";
    const stationRunId = typeof record["stationRunId"] === "string" ? record["stationRunId"] : "";
    const comment = typeof record["comment"] === "string" ? record["comment"] : "";
    const cites = parseCites(record["evidenceCites"]);
    if (!cites) {
      return { error: "invalid_body", reason: "observations_required" };
    }
    const observationId = typeof record["observationId"] === "string" ? record["observationId"].trim() : "";
    parsed.push({
      rubricItemId,
      stationRunId,
      rating: record["rating"],
      comment,
      evidenceCites: cites,
      ...(observationId.length > 0 ? { observationId } : {}),
    });
  }
  return { ok: parsed };
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

function sealCarriesWriteCommand(body: Record<string, unknown>): boolean {
  return "observations" in body
    || "status" in body
    || "narrativeFeedback" in body
    || "assessmentId" in body;
}

function nextTransitions(
  existing: readonly ApiFacultyAssessmentTransition[] | undefined,
  raterId: string,
  at: string,
  status: "draft" | "final",
  createdAt: string,
): ApiFacultyAssessmentTransition[] {
  if (!existing || existing.length === 0) {
    const draft: ApiFacultyAssessmentTransition = { raterId, at: createdAt, status: "draft" };
    return status === "final" ? [draft, { raterId, at, status: "final" }] : [draft];
  }
  if (status === "final") {
    return [...existing, { raterId, at, status: "final" }];
  }
  return [...existing];
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

function groundingResponse(
  context: { json: (body: Record<string, unknown>, status: 400 | 409 | 422) => Response },
  grounded: GroundingFailure,
): Response {
  if (grounded.error === "invalid_body") {
    return context.json({
      error: grounded.error,
      reason: grounded.reason,
      notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
    }, 400);
  }
  if (grounded.error === "observation_missing_evidence") {
    return context.json({
      error: grounded.error,
      reason: grounded.reason,
      notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
    }, 409);
  }
  return context.json({
    error: grounded.error,
    reason: grounded.reason,
    ...(grounded.rubricId ? { rubricId: grounded.rubricId } : {}),
    ...(grounded.evidenceId ? { evidenceId: grounded.evidenceId } : {}),
    notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
  }, 422);
}

function saveFailure(
  context: { json: (body: Record<string, unknown>, status: 500) => Response },
  error: unknown,
): Response {
  if (error instanceof FacultyAssessmentSaveError) {
    return context.json({
      error: "durable_save_failed",
      reason: error.message,
      notEvidenceFor: [...assembledExamFacultyAssessmentNotEvidenceFor],
    }, 500);
  }
  throw error;
}
