import type { AuthIdentity } from "@openclinxr/auth";
import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { ApiPersistenceSink } from "../../api-types.js";
import {
  type ApiAssembledExamDispositionDecision,
  type ApiAssembledExamDispositionRecord,
  type ApiRuntimeDurableStore,
  ASSEMBLED_EXAM_DISPOSITION_VALUES,
  type AssembledExamDispositionStatus,
  type AssembledExamDispositionValue,
  assembledExamDispositionClaimBoundary,
  assembledExamDispositionNotEvidenceFor,
  assembledExamPacketDigest,
  createScenarioRuntimeDurableStoreFromApiPersistence,
} from "../../runtime-durable-store.js";

export class AssembledExamDispositionSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "AssembledExamDispositionSaveError";
  }
}

export type FacultyDispositionStores = {
  durable: ApiRuntimeDurableStore;
  packets: Map<string, AssembledExamReviewPacket>;
  dispositions: Map<string, ApiAssembledExamDispositionRecord>;
};

export type FacultyDispositionReadModel = {
  examRunId: string;
  packetDigest: string;
  evidencePacket: AssembledExamReviewPacket;
  decisions: readonly ApiAssembledExamDispositionDecision[];
  current: ApiAssembledExamDispositionDecision | null;
  claimBoundary: typeof assembledExamDispositionClaimBoundary;
  notEvidenceFor: typeof assembledExamDispositionNotEvidenceFor;
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type FacultyDispositionConflictCode =
  | "stale_packet_digest"
  | "producer_self_review"
  | "identity_mutation"
  | "overwrite_refused"
  | "finalized";

export type FacultyDispositionAppendResult =
  | { kind: "ok"; trail: FacultyDispositionReadModel }
  | { kind: "not_found" }
  | { kind: "invalid"; error: "invalid_body"; reason: string }
  | { kind: "conflict"; error: FacultyDispositionConflictCode; reason: string }
  | { kind: "save_failed"; error: "durable_save_failed"; reason: string };

type ParsedCommand = {
  reviewerId: string;
  packetDigest: string;
  disposition: AssembledExamDispositionValue;
  status: AssembledExamDispositionStatus;
  rationale: string;
  attestedAt: string;
  decisionId?: string;
};

export function facultyDispositionStores(
  persistence: ApiPersistenceSink,
  packets: Map<string, AssembledExamReviewPacket> = new Map(),
  dispositions: Map<string, ApiAssembledExamDispositionRecord> = new Map(),
): FacultyDispositionStores {
  return {
    durable: createScenarioRuntimeDurableStoreFromApiPersistence(persistence),
    packets,
    dispositions,
  };
}

export function facultyDispositionConflictBody(error: string, reason: string): {
  error: string;
  reason: string;
  notEvidenceFor: string[];
} {
  return {
    error,
    reason,
    notEvidenceFor: [...assembledExamDispositionNotEvidenceFor],
  };
}

export async function readAssembledExamFacultyDisposition(
  stores: FacultyDispositionStores,
  examRunId: string,
): Promise<FacultyDispositionReadModel | undefined> {
  const packet = await loadPacket(stores, examRunId);
  if (!packet) {
    return undefined;
  }
  const stored = await loadDisposition(stores, examRunId);
  return toReadModel(packet, stored);
}

export async function appendAssembledExamFacultyDispositionCommand(
  stores: FacultyDispositionStores,
  examRunId: string,
  body: Record<string, unknown>,
  identity: AuthIdentity,
): Promise<FacultyDispositionAppendResult> {
  const packet = await loadPacket(stores, examRunId);
  if (!packet) {
    return { kind: "not_found" };
  }

  const overwrite = overwriteAttempt(body);
  if (overwrite) {
    return { kind: "conflict", error: "overwrite_refused", reason: overwrite };
  }

  const command = parseCommand(body, examRunId);
  if ("error" in command) {
    return { kind: "invalid", error: "invalid_body", reason: command.reason };
  }

  const digest = assembledExamPacketDigest(packet);
  if (command.packetDigest !== digest) {
    return { kind: "conflict", error: "stale_packet_digest", reason: "packet_digest_mismatch" };
  }

  const identityMismatch = identityMutation(command, packet, identity, body);
  if (identityMismatch) {
    return { kind: "conflict", error: "identity_mutation", reason: identityMismatch };
  }

  const producer = producerSelfReview(command.reviewerId, packet, identity);
  if (producer) {
    return { kind: "conflict", error: "producer_self_review", reason: producer };
  }

  const stored = await loadDisposition(stores, examRunId);
  if (stored) {
    const last = stored.decisions[stored.decisions.length - 1];
    if (last?.status === "final") {
      return { kind: "conflict", error: "finalized", reason: "disposition_already_final" };
    }
    if (stored.packetDigest !== digest) {
      return { kind: "conflict", error: "stale_packet_digest", reason: "stored_packet_digest_mismatch" };
    }
    const lockedReviewer = stored.decisions[0]?.reviewerId;
    if (lockedReviewer && lockedReviewer !== command.reviewerId) {
      return { kind: "conflict", error: "identity_mutation", reason: "reviewer_mismatch" };
    }
    if (command.decisionId && stored.decisions.some((item) => item.decisionId === command.decisionId)) {
      return { kind: "conflict", error: "overwrite_refused", reason: "decision_id_already_recorded" };
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
    ...(stored?.feedbackReleases && stored.feedbackReleases.length > 0
      ? { feedbackReleases: stored.feedbackReleases }
      : {}),
    ...(stored?.facultyAssessments && stored.facultyAssessments.length > 0
      ? { facultyAssessments: stored.facultyAssessments }
      : {}),
  };

  try {
    await persistDisposition(stores, record);
    return { kind: "ok", trail: toReadModel(record.evidencePacket, record) };
  } catch (error) {
    if (error instanceof AssembledExamDispositionSaveError) {
      return { kind: "save_failed", error: "durable_save_failed", reason: error.message };
    }
    throw error;
  }
}

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
  if (body["evidencePacket"] != null || body["decisions"] != null) {
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
): FacultyDispositionReadModel {
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

async function persistDisposition(
  stores: FacultyDispositionStores,
  record: ApiAssembledExamDispositionRecord,
): Promise<void> {
  try {
    await stores.durable.saveAssembledExamDisposition(record.examRunId, record);
  } catch (error) {
    throw new AssembledExamDispositionSaveError(error);
  }
  stores.dispositions.set(record.examRunId, record);
}

async function loadDisposition(
  stores: FacultyDispositionStores,
  examRunId: string,
): Promise<ApiAssembledExamDispositionRecord | undefined> {
  const fromSink = await stores.durable.getAssembledExamDisposition(examRunId);
  return fromSink ?? stores.dispositions.get(examRunId);
}

async function loadPacket(
  stores: FacultyDispositionStores,
  examRunId: string,
): Promise<AssembledExamReviewPacket | undefined> {
  const fromSink = await stores.durable.getAssembledExamReviewPacket(examRunId);
  return fromSink ?? stores.packets.get(examRunId);
}
