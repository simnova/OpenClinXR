import type { Hono } from "hono";
import { hasFacultyAccess, type AuthIdentity } from "@openclinxr/auth";
import { type AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import {
  ASSEMBLED_EXAM_DISPOSITION_VALUES,
  assembledExamDispositionClaimBoundary,
  assembledExamDispositionNotEvidenceFor,
  assembledExamPacketDigest,
  createScenarioRuntimeDurableStoreFromApiPersistence,
  type ApiAssembledExamDispositionDecision,
  type ApiAssembledExamDispositionRecord,
  type ApiRuntimeDurableStore,
  type AssembledExamDispositionStatus,
  type AssembledExamDispositionValue,
} from "../runtime-durable-store.js";

/** Faculty disposition trail — decisions sit beside, not inside, the evidence packet. */
export const ASSEMBLED_EXAM_DISPOSITION_PATH = "/exam-runs/:examRunId/assembled-review-disposition";

class AssembledExamDispositionSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "AssembledExamDispositionSaveError";
  }
}

export function registerAssembledExamDispositionRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, assembledExamReviewPackets, assembledExamDispositions } = ctx;
  const durable = createScenarioRuntimeDurableStoreFromApiPersistence(persistence);

  app.get(ASSEMBLED_EXAM_DISPOSITION_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
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
    return context.json(toReadModel(packet, stored));
  });

  app.post(ASSEMBLED_EXAM_DISPOSITION_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }

    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
    const packet = await loadPacket(durable, assembledExamReviewPackets, examRunId);
    if (!packet) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }

    const overwrite = overwriteAttempt(body);
    if (overwrite) {
      return conflict(context, "overwrite_refused", overwrite);
    }

    const command = parseCommand(body, examRunId);
    if ("error" in command) {
      return context.json(command, 400);
    }

    const digest = assembledExamPacketDigest(packet);
    if (command.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "packet_digest_mismatch");
    }

    const identityMismatch = identityMutation(command, packet, context.get("identity"), body);
    if (identityMismatch) {
      return conflict(context, "identity_mutation", identityMismatch);
    }

    const producer = producerSelfReview(command.reviewerId, packet, context.get("identity"));
    if (producer) {
      return conflict(context, "producer_self_review", producer);
    }

    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    if (stored) {
      const last = stored.decisions[stored.decisions.length - 1];
      if (last?.status === "final") {
        return conflict(context, "finalized", "disposition_already_final");
      }
      if (stored.packetDigest !== digest) {
        return conflict(context, "stale_packet_digest", "stored_packet_digest_mismatch");
      }
      const lockedReviewer = stored.decisions[0]?.reviewerId;
      if (lockedReviewer && lockedReviewer !== command.reviewerId) {
        return conflict(context, "identity_mutation", "reviewer_mismatch");
      }
      if (command.decisionId && stored.decisions.some((item) => item.decisionId === command.decisionId)) {
        return conflict(context, "overwrite_refused", "decision_id_already_recorded");
      }
    }

    const sequence = (stored?.decisions.length ?? 0) + 1;
    const decision: ApiAssembledExamDispositionDecision = {
      decisionId: command.decisionId ?? `assembled_exam_disposition:${examRunId}:${sequence}`,
      examRunId,
      reviewerId: command.reviewerId,
      packetDigest: digest,
      disposition: command.disposition,
      status: command.status,
      rationale: command.rationale,
      attestedAt: command.attestedAt,
      sequence,
    };

    const record: ApiAssembledExamDispositionRecord = {
      examRunId,
      packetDigest: digest,
      evidencePacket: stored?.evidencePacket ?? packet,
      decisions: [...(stored?.decisions ?? []), decision],
      claimBoundary: assembledExamDispositionClaimBoundary,
      notEvidenceFor: assembledExamDispositionNotEvidenceFor,
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    };

    try {
      await persistDisposition(durable, assembledExamDispositions, record);
      return context.json(toReadModel(record.evidencePacket, record), 201);
    } catch (error) {
      if (error instanceof AssembledExamDispositionSaveError) {
        return context.json({
          error: "durable_save_failed",
          reason: error.message,
          notEvidenceFor: [...assembledExamDispositionNotEvidenceFor],
        }, 500);
      }
      throw error;
    }
  });
}

type ParsedCommand = {
  reviewerId: string;
  packetDigest: string;
  disposition: AssembledExamDispositionValue;
  status: AssembledExamDispositionStatus;
  rationale: string;
  attestedAt: string;
  decisionId?: string;
};

function parseCommand(
  body: Record<string, unknown>,
  examRunId: string,
): ParsedCommand | { error: string; reason: string } {
  const reviewerId = typeof body["reviewerId"] === "string" ? body["reviewerId"].trim() : "";
  if (reviewerId.length === 0) {
    return { error: "invalid_body", reason: "reviewerId_required" };
  }
  const packetDigest = typeof body["packetDigest"] === "string" ? body["packetDigest"].trim() : "";
  if (packetDigest.length === 0) {
    return { error: "invalid_body", reason: "packetDigest_required" };
  }
  const disposition = body["disposition"];
  if (!isDispositionValue(disposition)) {
    return { error: "invalid_body", reason: "disposition_required" };
  }
  const rationale = typeof body["rationale"] === "string" ? body["rationale"].trim() : "";
  if (rationale.length === 0) {
    return { error: "invalid_body", reason: "rationale_required" };
  }
  const attestedAt = typeof body["attestedAt"] === "string" ? body["attestedAt"].trim() : "";
  if (attestedAt.length === 0 || Number.isNaN(Date.parse(attestedAt))) {
    return { error: "invalid_body", reason: "attestedAt_required" };
  }
  const status = body["status"];
  if (status !== "draft" && status !== "final") {
    return { error: "invalid_body", reason: "status_required" };
  }
  const bodyExamRunId = typeof body["examRunId"] === "string" ? body["examRunId"].trim() : "";
  if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
    return { error: "invalid_body", reason: "examRunId_mismatch" };
  }
  const decisionId = typeof body["decisionId"] === "string" ? body["decisionId"].trim() : "";
  return {
    reviewerId,
    packetDigest,
    disposition,
    status,
    rationale,
    attestedAt,
    ...(decisionId.length > 0 ? { decisionId } : {}),
  };
}

function isDispositionValue(value: unknown): value is AssembledExamDispositionValue {
  return typeof value === "string"
    && (ASSEMBLED_EXAM_DISPOSITION_VALUES as readonly string[]).includes(value);
}

function overwriteAttempt(body: Record<string, unknown>): string | undefined {
  if ("evidencePacket" in body || "decisions" in body) {
    return "cannot_replace_evidence_or_trail";
  }
  return undefined;
}

function identityMutation(
  command: ParsedCommand,
  packet: AssembledExamReviewPacket,
  identity: AuthIdentity,
  body: Record<string, unknown>,
): string | undefined {
  const bodyLearnerId = typeof body["learnerId"] === "string" ? body["learnerId"].trim() : "";
  if (bodyLearnerId.length > 0 && bodyLearnerId !== (packet.learnerId ?? "")) {
    return "learner_mismatch";
  }
  if (identity.role === "faculty" && identity.subject.trim() !== command.reviewerId) {
    return "reviewer_mismatch";
  }
  return undefined;
}

function producerSelfReview(
  reviewerId: string,
  packet: AssembledExamReviewPacket,
  identity: AuthIdentity,
): string | undefined {
  const producers = producerIds(packet);
  if (producers.has(reviewerId)) {
    return "reviewer_is_producer";
  }
  if (identity.role === "learner") {
    return "learner_cannot_review";
  }
  const identityLearner = identity.learnerId?.trim();
  if (identityLearner && producers.has(identityLearner) && identity.role !== "admin") {
    return "reviewer_is_producer";
  }
  if (identity.role === "faculty" && identity.subject.trim() !== reviewerId) {
    return undefined;
  }
  if (producers.has(identity.subject.trim()) && identity.role === "faculty") {
    return "reviewer_is_producer";
  }
  return undefined;
}

function producerIds(packet: AssembledExamReviewPacket): Set<string> {
  const ids = new Set<string>();
  if (packet.learnerId) {
    ids.add(packet.learnerId);
  }
  for (const station of packet.stations) {
    const draftReviewer = station.reviewPacket.facultyScoreDraft.reviewerId.trim();
    if (draftReviewer.length > 0) {
      ids.add(draftReviewer);
    }
  }
  return ids;
}

function toReadModel(
  packet: AssembledExamReviewPacket,
  stored: ApiAssembledExamDispositionRecord | undefined,
): {
  examRunId: string;
  packetDigest: string;
  evidencePacket: AssembledExamReviewPacket;
  decisions: readonly ApiAssembledExamDispositionDecision[];
  current: ApiAssembledExamDispositionDecision | null;
  claimBoundary: typeof assembledExamDispositionClaimBoundary;
  notEvidenceFor: typeof assembledExamDispositionNotEvidenceFor;
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
} {
  const decisions = stored?.decisions ?? [];
  return {
    examRunId: packet.examRunId,
    packetDigest: stored?.packetDigest ?? assembledExamPacketDigest(packet),
    evidencePacket: packet,
    decisions,
    current: decisions[decisions.length - 1] ?? null,
    claimBoundary: assembledExamDispositionClaimBoundary,
    notEvidenceFor: assembledExamDispositionNotEvidenceFor,
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
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
    notEvidenceFor: [...assembledExamDispositionNotEvidenceFor],
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
    throw new AssembledExamDispositionSaveError(error);
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


