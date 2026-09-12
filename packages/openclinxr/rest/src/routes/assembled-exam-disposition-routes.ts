import { hasFacultyAccess } from "@openclinxr/auth";
import type { Hono } from "hono";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { createScenarioRuntimeDurableStoreFromApiPersistence } from "../runtime-durable-store.js";
import { registerFacultyAssessmentRoutes } from "./faculty-assessment/index.js";
import {
  appendAssembledExamFacultyDispositionCommand,
  facultyDispositionConflictBody,
  readAssembledExamFacultyDisposition,
} from "./faculty-disposition-service/index.js";
import { registerFeedbackReleaseRoutes } from "./feedback-release/index.js";

/** Faculty disposition trail — decisions sit beside, not inside, the evidence packet. */
export const ASSEMBLED_EXAM_DISPOSITION_PATH = "/exam-runs/:examRunId/assembled-review-disposition";

export function registerAssembledExamDispositionRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, assembledExamReviewPackets, assembledExamDispositions } = ctx;
  const stores = {
    durable: createScenarioRuntimeDurableStoreFromApiPersistence(persistence),
    packets: assembledExamReviewPackets,
    dispositions: assembledExamDispositions,
  };

  app.get(ASSEMBLED_EXAM_DISPOSITION_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }

    const trail = await readAssembledExamFacultyDisposition(stores, examRunId);
    if (!trail) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    return context.json(trail);
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
    const result = await appendAssembledExamFacultyDispositionCommand(
      stores,
      examRunId,
      body,
      context.get("identity"),
    );
    if (result.kind === "ok") {
      return context.json(result.trail, 201);
    }
    if (result.kind === "not_found") {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    if (result.kind === "invalid") {
      return context.json({ error: result.error, reason: result.reason }, 400);
    }
    if (result.kind === "save_failed") {
      return context.json(facultyDispositionConflictBody(result.error, result.reason), 500);
    }
    return context.json(facultyDispositionConflictBody(result.error, result.reason), 409);
  });

  registerFeedbackReleaseRoutes(app, ctx);
  registerFacultyAssessmentRoutes(app, ctx);
}
