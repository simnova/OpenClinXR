import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import { routeById } from "@openclinxr/rest";
import { buildFacultyScoreDraft, buildReviewDecisionDraft, FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR } from "@openclinxr/review-workflow";
import type { ApiFacultyReviewDecisionRecord } from "../api-types.js";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { coerceRubricScores, createApiFacultyScoreDraftRecord, denyIfCannotReadStationRun, persistTraceSnapshot, sessionErrorResponse, summarizeClinicalEventReviewProjections, summarizeReviewReplayReadiness } from "../api-route-support.js";
import { isRecord, parseStringArray } from "../api-support.js";

/** Review domain routes (composition-root migration). */
export function registerReviewRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { runtime, persistence, sessionOwners } = ctx;

  app.get(routeById("review-packet").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const ownershipDenied = denyIfCannotReadStationRun(context.get("identity"), sessionOwners, stationRunId);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }

    try {
      const packet = runtime.reviewPacket(stationRunId);
      await persistence.saveReviewPacket?.(stationRunId, packet);
      return context.json(packet);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get(routeById("trace-events").path, (context) => {
    const stationRunId = context.req.param("stationRunId");
    const ownershipDenied = denyIfCannotReadStationRun(context.get("identity"), sessionOwners, stationRunId);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }

    try {
      return context.json(runtime.traceEvents(stationRunId));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get(routeById("review-replay-readiness-summary").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      const clinicalEventReviewSummary = summarizeClinicalEventReviewProjections(
        await persistence.listClinicalEventReviewProjections?.(stationRunId) ?? [],
      );
      return context.json(summarizeReviewReplayReadiness({
        stationRunId,
        packet: runtime.reviewPacket(stationRunId),
        clinicalEventReviewSummary,
        traceEvents: runtime.traceEvents(stationRunId),
        ...(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord
          ? { runtimeRealismEvidenceInputReviewDecisionRecord: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord }
          : {}),
        ...(ctx.state.runtimeVisualEvidenceAttachmentRecord
          ? { runtimeVisualEvidenceAttachmentRecord: ctx.state.runtimeVisualEvidenceAttachmentRecord }
          : {}),
      }));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  /**
   * NEW faculty-only route — do not mirror this gate onto existing routes.
   * Default dev identity is admin (faculty access) so single-user tests stay green.
   */
  app.post(routeById("save-faculty-score-draft").path, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      reviewerId?: unknown;
      comments?: unknown;
      rubricScores?: unknown;
    };

    try {
      const facultyScoreDraft = buildFacultyScoreDraft({
        reviewerId: typeof body.reviewerId === "string" ? body.reviewerId : "",
        comments: typeof body.comments === "string" ? body.comments : "",
        ...(isRecord(body.rubricScores) ? { rubricScores: coerceRubricScores(body.rubricScores) } : {}),
      });

      // Keep runtime packet in sync when session exists (GraphQL path parity).
      let scenarioId = "unknown_scenario";
      try {
        const packet = runtime.saveFacultyScoreDraft(stationRunId, {
          reviewerId: facultyScoreDraft.reviewerId,
          comments: facultyScoreDraft.comments.length > 0 ? facultyScoreDraft.comments : "faculty draft",
          rubricScores: { ...facultyScoreDraft.rubricScores },
        });
        scenarioId = packet.scenarioId;
        await persistTraceSnapshot(runtime, persistence, stationRunId);
        await persistence.saveReviewPacket?.(stationRunId, packet);
      } catch {
        // Session may be absent for pure draft-persistence; continue with sink-only write.
        try {
          scenarioId = runtime.reviewPacket(stationRunId).scenarioId;
        } catch {
          scenarioId = "unknown_scenario";
        }
      }

      const record = createApiFacultyScoreDraftRecord({
        stationRunId,
        scenarioId,
        facultyScoreDraft,
      });
      await persistence.saveFacultyScoreDraft?.(record);
      return context.json(record, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  /**
   * NEW faculty-only route — local promote/hold decision only.
   * runtimePromotionAllowed / productionManifestPromotionAllowed / scoringValidityClaimed always false.
   */
  app.post(routeById("save-faculty-review-decision").path, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      reviewerId?: unknown;
      comments?: unknown;
      rubricScores?: unknown;
      localDecision?: unknown;
      hasDurableSummary?: unknown;
      durableSummaryIsSafe?: unknown;
      traceEventCount?: unknown;
      safetyFlagLabels?: unknown;
    };

    try {
      const packet = runtime.reviewPacket(stationRunId);
      const facultyScoreDraftInput = {
        reviewerId: typeof body.reviewerId === "string" && body.reviewerId.trim().length > 0
          ? body.reviewerId
          : packet.facultyScoreDraft.reviewerId,
        comments: typeof body.comments === "string" ? body.comments : packet.facultyScoreDraft.comments,
        ...(isRecord(body.rubricScores) ? { rubricScores: coerceRubricScores(body.rubricScores) } : {}),
      };
      const decisionDraft = buildReviewDecisionDraft({
        stationRunId,
        scenarioId: packet.scenarioId,
        packet,
        facultyScoreDraft: facultyScoreDraftInput,
        hasDurableSummary: body.hasDurableSummary === true,
        durableSummaryIsSafe: body.durableSummaryIsSafe === true,
        traceEventCount: typeof body.traceEventCount === "number" ? body.traceEventCount : 0,
        safetyFlagLabels: parseStringArray(body.safetyFlagLabels),
      });

      // Persist gated score draft as well (same sink surface).
      const draftRecord = createApiFacultyScoreDraftRecord({
        stationRunId,
        scenarioId: packet.scenarioId,
        facultyScoreDraft: decisionDraft.facultyScoreDraft,
      });
      await persistence.saveFacultyScoreDraft?.(draftRecord);

      const localDecision = body.localDecision === "local_promote_candidate" ? "local_promote_candidate" : "hold";
      const decisionRecord: ApiFacultyReviewDecisionRecord = {
        stationRunId,
        scenarioId: packet.scenarioId,
        decisionId: `faculty_review_decision:${stationRunId}:${Date.now()}`,
        savedAt: new Date().toISOString(),
        localDecision,
        decisionDraft,
        facultyScoreDraft: decisionDraft.facultyScoreDraft,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
        scoringValidityClaimed: false,
        notEvidenceFor: [...FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR, "production_asset_readiness", "quest_readiness"],
        claimScope: "faculty_local_review_decision_gated_not_score_use",
      };
      await persistence.saveFacultyReviewDecision?.(decisionRecord);
      return context.json(decisionRecord, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

}
