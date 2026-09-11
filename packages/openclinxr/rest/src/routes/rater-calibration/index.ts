import { hasFacultyAccess } from "@openclinxr/auth";
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type { ApiAppContext } from "../../api-app-context.js";
import type { ApiAppVariables } from "../../api-types.js";
import type {
  ApiRaterCalibrationCriterionResolution,
  ApiRaterCalibrationRecord,
  AssembledExamCalibrationResolution,
} from "../../runtime-durable-store.js";
import {
  assembledExamPacketDigest,
  assembledExamRaterCalibrationNotEvidenceFor,
  createScenarioRuntimeDurableStoreFromApiPersistence,
} from "../../runtime-durable-store.js";
import {
  FacultyAssessmentSaveError,
  conflict,
  loadDisposition,
  loadPacket,
  overwriteAttempt,
  persistDisposition,
} from "../faculty-assessment/store.js";
import { anchorsFor, compareCriteria, sealedPair } from "./compare.js";
import { conflictBody, forbiddenBody, raterCalibrationHonesty } from "./honesty.js";

const RATER_CALIBRATION_PATH = "/exam-runs/:examRunId/rater-calibration";
const RATER_CALIBRATION_ADJUDICATE_PATH = "/exam-runs/:examRunId/rater-calibration/adjudicate";
const RESOLUTIONS = ["agree", "disagree", "inconclusive"] as const satisfies readonly AssembledExamCalibrationResolution[];

export function registerRaterCalibrationRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, assembledExamReviewPackets, assembledExamDispositions } = ctx;
  const durable = createScenarioRuntimeDurableStoreFromApiPersistence(persistence);

  app.get(RATER_CALIBRATION_PATH, async (context) => {
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
    const pair = sealedPair(stored?.facultyAssessments ?? []);
    if (!pair) {
      return context.json(conflictBody("independent_pair_incomplete", "both_raters_must_seal"), 409);
    }
    const [left, right] = pair;
    const criterionComparisons = compareCriteria(left, right);
    return context.json({
      examRunId,
      packetDigest: stored?.packetDigest ?? assembledExamPacketDigest(packet),
      leftSealedAssessmentId: left.sealedAssessmentId,
      rightSealedAssessmentId: right.sealedAssessmentId,
      leftRaterId: left.raterId,
      rightRaterId: right.raterId,
      criterionComparisons,
      anchors: anchorsFor(packet, criterionComparisons),
      adjudications: stored?.raterCalibrations ?? [],
      ...raterCalibrationHonesty(),
    });
  });

  app.post(RATER_CALIBRATION_ADJUDICATE_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody("faculty_role_required"), 403);
    }
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }
    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (overwriteAttempt(body) || adjudicateMutatesAssessment(body)) {
      return conflict(context, "overwrite_refused", "cannot_mutate_sealed_assessments");
    }
    const packet = await loadPacket(durable, assembledExamReviewPackets, examRunId);
    if (!packet) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    const command = parseAdjudicateCommand(body, examRunId);
    if ("error" in command) {
      return context.json(command, 400);
    }
    const digest = assembledExamPacketDigest(packet);
    if (command.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "packet_digest_mismatch");
    }
    const identity = context.get("identity");
    if (identity.role === "faculty" && identity.subject.trim() !== command.adjudicatorId) {
      return conflict(context, "identity_mutation", "adjudicator_mismatch");
    }
    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    if (!stored) {
      return context.json({ error: "faculty_assessment_not_found" }, 404);
    }
    if (stored.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "stored_packet_digest_mismatch");
    }
    const pair = sealedPair(stored.facultyAssessments ?? []);
    if (!pair) {
      return context.json(conflictBody("independent_pair_incomplete", "both_raters_must_seal"), 409);
    }
    const [left, right] = pair;
    if (left.sealedAssessmentId !== command.leftSealedAssessmentId
      || right.sealedAssessmentId !== command.rightSealedAssessmentId) {
      return conflict(context, "seal_mismatch", "sealed_assessment_ids_must_match_pair");
    }
    if (command.adjudicatorId === left.raterId || command.adjudicatorId === right.raterId) {
      return conflict(context, "producer_self_review", "adjudicator_is_rater");
    }
    const adjudication: ApiRaterCalibrationRecord = {
      adjudicationId: createHash("sha256").update(JSON.stringify({
        examRunId,
        digest,
        left: left.sealedAssessmentId,
        right: right.sealedAssessmentId,
        adjudicatorId: command.adjudicatorId,
        attestedAt: command.attestedAt,
        criterionResolutions: command.criterionResolutions,
      })).digest("hex"),
      examRunId,
      packetDigest: digest,
      leftSealedAssessmentId: command.leftSealedAssessmentId,
      rightSealedAssessmentId: command.rightSealedAssessmentId,
      adjudicatorId: command.adjudicatorId,
      attestedAt: command.attestedAt,
      criterionResolutions: command.criterionResolutions,
      ...raterCalibrationHonesty(),
    };
    const record: typeof stored = {
      ...stored,
      raterCalibrations: [...(stored.raterCalibrations ?? []), adjudication],
    };
    try {
      await persistDisposition(durable, assembledExamDispositions, record);
      return context.json({
        ...adjudication,
        notEvidenceFor: [...assembledExamRaterCalibrationNotEvidenceFor],
      }, 201);
    } catch (error) {
      if (error instanceof FacultyAssessmentSaveError) {
        return context.json({
          error: "durable_save_failed",
          reason: error.message,
          notEvidenceFor: [...assembledExamRaterCalibrationNotEvidenceFor],
        }, 500);
      }
      throw error;
    }
  });
}

function adjudicateMutatesAssessment(body: Record<string, unknown>): boolean {
  return "observations" in body
    || "status" in body
    || "narrativeFeedback" in body
    || "assessmentId" in body
    || "sealedAssessmentId" in body;
}

function parseAdjudicateCommand(
  body: Record<string, unknown>,
  examRunId: string,
): {
  packetDigest: string;
  attestedAt: string;
  adjudicatorId: string;
  leftSealedAssessmentId: string;
  rightSealedAssessmentId: string;
  criterionResolutions: readonly ApiRaterCalibrationCriterionResolution[];
} | { error: string; reason: string } {
  const packetDigest = typeof body["packetDigest"] === "string" ? body["packetDigest"].trim() : "";
  if (packetDigest.length === 0) {
    return { error: "invalid_body", reason: "packetDigest_required" };
  }
  const attestedAt = typeof body["attestedAt"] === "string" ? body["attestedAt"].trim() : "";
  if (attestedAt.length === 0 || Number.isNaN(Date.parse(attestedAt))) {
    return { error: "invalid_body", reason: "attestedAt_required" };
  }
  const adjudicatorId = typeof body["adjudicatorId"] === "string" ? body["adjudicatorId"].trim() : "";
  if (adjudicatorId.length === 0) {
    return { error: "invalid_body", reason: "adjudicatorId_required" };
  }
  const leftSealedAssessmentId = typeof body["leftSealedAssessmentId"] === "string"
    ? body["leftSealedAssessmentId"].trim()
    : "";
  const rightSealedAssessmentId = typeof body["rightSealedAssessmentId"] === "string"
    ? body["rightSealedAssessmentId"].trim()
    : "";
  if (leftSealedAssessmentId.length !== 64 || rightSealedAssessmentId.length !== 64) {
    return { error: "invalid_body", reason: "sealed_assessment_ids_required" };
  }
  const bodyExamRunId = typeof body["examRunId"] === "string" ? body["examRunId"].trim() : "";
  if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
    return { error: "invalid_body", reason: "examRunId_mismatch" };
  }
  const resolutions = parseResolutions(body["criterionResolutions"]);
  if ("error" in resolutions) {
    return resolutions;
  }
  return {
    packetDigest,
    attestedAt,
    adjudicatorId,
    leftSealedAssessmentId,
    rightSealedAssessmentId,
    criterionResolutions: resolutions.ok,
  };
}

function parseResolutions(
  value: unknown,
): { ok: ApiRaterCalibrationCriterionResolution[] } | { error: "invalid_body"; reason: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "invalid_body", reason: "criterionResolutions_required" };
  }
  const parsed: ApiRaterCalibrationCriterionResolution[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { error: "invalid_body", reason: "criterionResolutions_required" };
    }
    const record = item as Record<string, unknown>;
    const rubricItemId = typeof record["rubricItemId"] === "string" ? record["rubricItemId"].trim() : "";
    const stationRunId = typeof record["stationRunId"] === "string" ? record["stationRunId"].trim() : "";
    const note = typeof record["note"] === "string" ? record["note"].trim() : "";
    const resolution = record["resolution"];
    if (rubricItemId.length === 0 || stationRunId.length === 0 || note.length === 0) {
      return { error: "invalid_body", reason: "criterionResolutions_required" };
    }
    if (typeof resolution !== "string" || !(RESOLUTIONS as readonly string[]).includes(resolution)) {
      return { error: "invalid_body", reason: "resolution_invalid" };
    }
    parsed.push({
      rubricItemId,
      stationRunId,
      resolution: resolution as AssembledExamCalibrationResolution,
      note,
    });
  }
  return { ok: parsed };
}
