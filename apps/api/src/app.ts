import { assembleExamForm, createDefaultClinicalSkillsBlueprint, evaluateScenarioVersionDrift, type ExamForm } from "@openclinxr/exam-assembly";
import { createDefaultScenarioRuntime, type PublicationTargetUse, type ReviewerEvidence, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createLearnerScenarioView, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { Hono } from "hono";

export function createApiApp(runtime: ScenarioRuntime = createDefaultScenarioRuntime()): Hono {
  const app = new Hono();

  app.get("/health", async (context) =>
    context.json({
      ok: true,
      service: "openclinxr-api",
      providerHealth: await runtime.providerHealth(),
    }),
  );

  app.get("/providers/health", async (context) => context.json(await runtime.providerHealth()));

  app.get("/scenarios/ed-chest-pain", (context) => context.json(createLearnerScenarioView(edChestPainScenario)));

  app.get("/scenarios/ed-chest-pain/assets/readiness", (context) => context.json(runtime.assetReadiness()));

  app.post("/scenarios/ed-chest-pain/publication-readiness", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      targetUse?: unknown;
      reviewerEvidence?: unknown;
    };

    return context.json(
      runtime.scenarioPublicationReadiness({
        targetUse: parsePublicationTargetUse(body.targetUse),
        reviewerEvidence: parseReviewerEvidence(body.reviewerEvidence),
      }),
    );
  });

  app.get("/exam-blueprints/default", (context) => context.json(createDefaultClinicalSkillsBlueprint()));

  app.post("/exam-forms", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { examFormId?: string };
    const form = assembleExamForm({
      examFormId: body.examFormId ?? "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });
    return context.json(form, 201);
  });

  app.post("/exam-forms/version-drift", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { form?: unknown };
    if (!isExamForm(body.form)) {
      return context.json({ error: "invalid_exam_form" }, 400);
    }

    return context.json(evaluateScenarioVersionDrift(body.form, [edChestPainScenario]));
  });

  app.post("/sessions", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { learnerId?: string; consentAccepted?: boolean };
    if (body.consentAccepted !== true) {
      return context.json({ error: "consent_required" }, 400);
    }
    const run = await runtime.startSession({ learnerId: body.learnerId ?? "learner_001", consentAccepted: true });

    return context.json(run, 201);
  });

  app.post("/sessions/:stationRunId/start-encounter", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number };

    try {
      return context.json(runtime.startEncounter(stationRunId, { atSecond: body.atSecond ?? 60 }));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post("/sessions/:stationRunId/events", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      eventType?: string;
      atSecond?: number;
      tag?: string;
      actorId?: string;
    };

    try {
      const event = runtime.appendLearnerEvent(stationRunId, {
        eventType: body.eventType ?? "learner.action",
        atSecond: body.atSecond ?? 0,
        ...(body.tag ? { tag: body.tag } : {}),
        ...(body.actorId ? { actorId: body.actorId } : {}),
      });
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post("/sessions/:stationRunId/actor-response", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      actorId?: string;
      learnerUtterance?: string;
      atSecond?: number;
      traceContextTags?: unknown;
    };

    try {
      const result = await runtime.generateActorResponse(stationRunId, {
        actorId: body.actorId ?? "",
        learnerUtterance: body.learnerUtterance ?? "",
        atSecond: body.atSecond ?? 0,
        traceContextTags: Array.isArray(body.traceContextTags) ? body.traceContextTags.filter((tag): tag is string => typeof tag === "string") : [],
      });
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post("/sessions/:stationRunId/note", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number; text?: string };

    try {
      return context.json(
        runtime.submitNote(stationRunId, {
          atSecond: body.atSecond ?? 1260,
          text: body.text ?? "",
        }),
      );
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get("/sessions/:stationRunId/review-packet", (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      return context.json(runtime.reviewPacket(stationRunId));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get("/sessions/:stationRunId/trace-events", (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      return context.json(runtime.traceEvents(stationRunId));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  return app;
}

function sessionErrorResponse(context: { json: (body: { error: string }, status: 400 | 404 | 500 | 503) => Response }, error: unknown): Response {
  if (error instanceof Error && error.message.startsWith("Session not found")) {
    return context.json({ error: "session_not_found" }, 404);
  }
  if (error instanceof Error && error.message.startsWith("Actor not found")) {
    return context.json({ error: "actor_not_found" }, 400);
  }
  if (error instanceof Error && error.message.startsWith("Actor response generation failed")) {
    return context.json({ error: "actor_response_generation_failed" }, 503);
  }
  return context.json({ error: "runtime_error" }, 500);
}

function parsePublicationTargetUse(value: unknown): PublicationTargetUse {
  if (value === "pilot_research" || value === "summative") {
    return value;
  }
  return "local_formative";
}

function parseReviewerEvidence(value: unknown): ReviewerEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isReviewerEvidence);
}

function isReviewerEvidence(value: unknown): value is ReviewerEvidence {
  return isRecord(value)
    && typeof value.reviewerRole === "string"
    && typeof value.reviewerId === "string"
    && (value.decision === "approved" || value.decision === "changes_requested")
    && typeof value.comments === "string"
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every((ref) => typeof ref === "string")
    && typeof value.reviewedAt === "string";
}

function isExamForm(value: unknown): value is ExamForm {
  return isRecord(value)
    && typeof value.examFormId === "string"
    && Array.isArray(value.stationRefs)
    && value.stationRefs.every(isStationRef);
}

function isStationRef(value: unknown): value is ExamForm["stationRefs"][number] {
  return isRecord(value)
    && typeof value.order === "number"
    && typeof value.scenarioId === "string"
    && typeof value.scenarioVersion === "number"
    && typeof value.title === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
