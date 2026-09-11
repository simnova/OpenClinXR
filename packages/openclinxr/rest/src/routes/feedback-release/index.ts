import { type AuthIdentity, hasFacultyAccess } from "@openclinxr/auth";
import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { Hono } from "hono";
import type { ApiAppContext } from "../../api-app-context.js";
import type { ApiAppVariables } from "../../api-types.js";
import {
  type ApiAssembledExamDispositionRecord,
  type ApiAssembledExamFeedbackReleaseRecord,
  type ApiRuntimeDurableStore,
  assembledExamFeedbackReleaseClaimBoundary,
  assembledExamFeedbackReleaseNotEvidenceFor,
  assembledExamPacketDigest,
  createScenarioRuntimeDurableStoreFromApiPersistence,
} from "../../runtime-durable-store.js";
import { projectLearnerSafeFeedbackRelease } from "./learner-projection.js";
import { feedbackReleaseCompleteness, feedbackReleasePolicyBlockers } from "./policy.js";

const FEEDBACK_RELEASE_PATH = "/exam-runs/:examRunId/feedback-release";
const FEEDBACK_RELEASE_WITHDRAW_PATH = "/exam-runs/:examRunId/feedback-release/withdraw";

class FeedbackReleaseSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "FeedbackReleaseSaveError";
  }
}

export function registerFeedbackReleaseRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, assembledExamReviewPackets, assembledExamDispositions } = ctx;
  const durable = createScenarioRuntimeDurableStoreFromApiPersistence(persistence);

  app.post(FEEDBACK_RELEASE_PATH, async (context) => {
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

    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    if (!stored) {
      return conflict(context, "policy_blocker", "disposition_missing");
    }

    const command = parseReleaseCommand(body, examRunId);
    if ("error" in command) {
      return context.json(command, 400);
    }

    const digest = assembledExamPacketDigest(packet);
    if (command.packetDigest !== digest || stored.packetDigest !== digest) {
      return conflict(context, "stale_packet_digest", "packet_digest_mismatch");
    }

    const identity = context.get("identity");
    if (identity.role === "faculty" && identity.subject.trim() !== command.releasedBy) {
      return conflict(context, "identity_mutation", "released_by_mismatch");
    }

    const completeness = feedbackReleaseCompleteness(packet);
    if (!completeness.complete) {
      return context.json({
        error: "completeness_incomplete",
        reason: "assembled_exam_incomplete",
        omissions: completeness.omissions,
        notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
      }, 409);
    }

    const policy = feedbackReleasePolicyBlockers(stored);
    if (policy.length > 0) {
      return context.json({
        error: "policy_blocker",
        reason: policy[0],
        policyBlockers: policy,
        notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
      }, 409);
    }

    const trail = stored.feedbackReleases ?? [];
    if (command.releaseId && trail.some((item) => item.releaseId === command.releaseId)) {
      return conflict(context, "overwrite_refused", "release_id_already_recorded");
    }

    const current = stored.decisions[stored.decisions.length - 1];
    if (!current) {
      return conflict(context, "policy_blocker", "disposition_missing");
    }

    const active = trail.find((item) => item.status === "active");
    const sequence = trail.length + 1;
    const release: ApiAssembledExamFeedbackReleaseRecord = {
      releaseId: command.releaseId ?? `feedback_release:${examRunId}:${sequence}`,
      examRunId,
      packetDigest: digest,
      dispositionDecisionId: current.decisionId,
      releasedBy: command.releasedBy,
      releasedAt: command.releasedAt,
      status: "active",
      supersedesReleaseId: active?.releaseId ?? null,
      withdrawnAt: null,
      withdrawnBy: null,
    };

    const nextTrail = [
      ...trail.map((item) => item.status === "active" ? { ...item, status: "superseded" as const } : item),
      release,
    ];

    try {
      await persistDisposition(durable, assembledExamDispositions, {
        ...stored,
        feedbackReleases: nextTrail,
      });
      return context.json(facultyReleaseReceipt(release), 201);
    } catch (error) {
      if (error instanceof FeedbackReleaseSaveError) {
        return context.json({
          error: "durable_save_failed",
          reason: error.message,
          notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
        }, 500);
      }
      throw error;
    }
  });

  app.post(FEEDBACK_RELEASE_WITHDRAW_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody("faculty_role_required"), 403);
    }

    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }

    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
    const releaseId = typeof body["releaseId"] === "string" ? body["releaseId"].trim() : "";
    const withdrawnAt = typeof body["withdrawnAt"] === "string" ? body["withdrawnAt"].trim() : "";
    if (releaseId.length === 0) {
      return context.json({ error: "invalid_body", reason: "releaseId_required" }, 400);
    }
    if (withdrawnAt.length === 0 || Number.isNaN(Date.parse(withdrawnAt))) {
      return context.json({ error: "invalid_body", reason: "withdrawnAt_required" }, 400);
    }

    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    const trail = stored?.feedbackReleases ?? [];
    const target = trail.find((item) => item.releaseId === releaseId);
    if (!stored || !target) {
      return context.json({ error: "feedback_release_not_found" }, 404);
    }
    if (target.status !== "active") {
      return conflict(context, "overwrite_refused", "release_not_active");
    }

    const withdrawnBy = context.get("identity").subject.trim();
    const nextTrail = trail.map((item) =>
      item.releaseId === releaseId
        ? { ...item, status: "withdrawn" as const, withdrawnAt, withdrawnBy }
        : item,
    );

    try {
      await persistDisposition(durable, assembledExamDispositions, {
        ...stored,
        feedbackReleases: nextTrail,
      });
      const withdrawn = nextTrail.find((item) => item.releaseId === releaseId);
      return context.json(facultyReleaseReceipt(withdrawn ?? target), 200);
    } catch (error) {
      if (error instanceof FeedbackReleaseSaveError) {
        return context.json({
          error: "durable_save_failed",
          reason: error.message,
          notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
        }, 500);
      }
      throw error;
    }
  });

  app.get(FEEDBACK_RELEASE_PATH, async (context) => {
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }

    const packet = await loadPacket(durable, assembledExamReviewPackets, examRunId);
    if (!packet) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }

    const ownershipDenied = denyLearnerRead(context.get("identity"), packet.learnerId);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }

    const stored = await loadDisposition(durable, assembledExamDispositions, examRunId);
    const active = stored?.feedbackReleases?.find((item) => item.status === "active");
    if (!stored || !active) {
      return context.json({ error: "feedback_release_not_available" }, 404);
    }

    const current = stored.decisions[stored.decisions.length - 1];
    if (!current) {
      return context.json({ error: "feedback_release_not_available" }, 404);
    }

    return context.json(projectLearnerSafeFeedbackRelease({
      release: active,
      packet,
      disposition: current.disposition,
    }));
  });
}

type ParsedReleaseCommand = {
  packetDigest: string;
  releasedAt: string;
  releasedBy: string;
  releaseId?: string;
};

function parseReleaseCommand(
  body: Record<string, unknown>,
  examRunId: string,
): ParsedReleaseCommand | { error: string; reason: string } {
  const packetDigest = typeof body["packetDigest"] === "string" ? body["packetDigest"].trim() : "";
  if (packetDigest.length === 0) {
    return { error: "invalid_body", reason: "packetDigest_required" };
  }
  const releasedAt = typeof body["releasedAt"] === "string" ? body["releasedAt"].trim() : "";
  if (releasedAt.length === 0 || Number.isNaN(Date.parse(releasedAt))) {
    return { error: "invalid_body", reason: "releasedAt_required" };
  }
  const releasedBy = typeof body["releasedBy"] === "string" ? body["releasedBy"].trim() : "";
  if (releasedBy.length === 0) {
    return { error: "invalid_body", reason: "releasedBy_required" };
  }
  const bodyExamRunId = typeof body["examRunId"] === "string" ? body["examRunId"].trim() : "";
  if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
    return { error: "invalid_body", reason: "examRunId_mismatch" };
  }
  const releaseId = typeof body["releaseId"] === "string" ? body["releaseId"].trim() : "";
  return {
    packetDigest,
    releasedAt,
    releasedBy,
    ...(releaseId.length > 0 ? { releaseId } : {}),
  };
}

function overwriteAttempt(body: Record<string, unknown>): boolean {
  return "evidencePacket" in body
    || "decisions" in body
    || "feedbackReleases" in body
    || "projection" in body;
}

function facultyReleaseReceipt(release: ApiAssembledExamFeedbackReleaseRecord): Record<string, unknown> {
  return {
    releaseId: release.releaseId,
    examRunId: release.examRunId,
    packetDigest: release.packetDigest,
    dispositionDecisionId: release.dispositionDecisionId,
    releasedBy: release.releasedBy,
    releasedAt: release.releasedAt,
    status: release.status,
    supersedesReleaseId: release.supersedesReleaseId,
    withdrawnAt: release.withdrawnAt,
    withdrawnBy: release.withdrawnBy,
    claimBoundary: assembledExamFeedbackReleaseClaimBoundary,
    notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function forbiddenBody(reason: string) {
  return {
    error: "forbidden",
    reason,
    notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
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
    notEvidenceFor: [...assembledExamFeedbackReleaseNotEvidenceFor],
  }, 409);
}

function denyLearnerRead(
  identity: AuthIdentity,
  learnerId: string | null,
): { status: 403; body: { error: string; reason: string } } | undefined {
  if (hasFacultyAccess(identity)) {
    return undefined;
  }
  const subject = identity.learnerId?.trim() || identity.subject.trim();
  if (identity.role === "learner" && learnerId && subject === learnerId) {
    return undefined;
  }
  return { status: 403, body: { error: "forbidden", reason: "run_ownership_required" } };
}

async function persistDisposition(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, ApiAssembledExamDispositionRecord>,
  record: ApiAssembledExamDispositionRecord,
): Promise<void> {
  try {
    await durable.saveAssembledExamDisposition(record.examRunId, record);
  } catch (error) {
    throw new FeedbackReleaseSaveError(error);
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
