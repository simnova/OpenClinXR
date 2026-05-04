import { createScenarioPlaceholderManifests, InMemoryAssetRegistry } from "@openclinxr/asset-registry";
import {
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  createExamStationRunQueue,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  evaluateBlueprintScenarioReadiness,
  evaluateScenarioVersionDrift,
  type ExamForm,
  type ExamStationRunQueue,
} from "@openclinxr/exam-assembly";
import { adminGraphqlDocuments, createGraphqlCodegenPlan, openClinXrAdminSchemaSdl } from "@openclinxr/graphql";
import { matchOpenClinXrRestRoute, routeById } from "@openclinxr/rest";
import { createDefaultScenarioRuntime, type PublicationTargetUse, type ReviewerEvidence, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createLearnerScenarioView, edChestPainScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import {
  createNoopTelemetryRecorder,
  openClinXrSpanNames,
  telemetryRouteAttributes,
  type TelemetryRecorder,
  type TelemetrySpanRecord,
} from "@openclinxr/telemetry";
import { Hono } from "hono";

type RuntimeTraceEvents = ReturnType<ScenarioRuntime["traceEvents"]>;
type RuntimeReviewPacket = ReturnType<ScenarioRuntime["reviewPacket"]>;

export type ApiStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};

export type ApiPersistenceSink = {
  saveExamForm?: (form: ExamForm) => Promise<void> | void;
  saveStationRunQueueSnapshot?: (snapshot: ApiStationRunQueueSnapshot) => Promise<void> | void;
  listStationRunQueueSnapshots?: (blueprintId: string) => Promise<ApiStationRunQueueSnapshot[]> | ApiStationRunQueueSnapshot[];
  saveTraceEvents?: (stationRunId: string, events: RuntimeTraceEvents) => Promise<void> | void;
  saveReviewPacket?: (stationRunId: string, packet: RuntimeReviewPacket) => Promise<void> | void;
};

export type ApiAppOptions = {
  telemetry?: TelemetryRecorder;
};

export function createApiApp(runtime: ScenarioRuntime = createDefaultScenarioRuntime(), persistence: ApiPersistenceSink = {}, options: ApiAppOptions = {}): Hono {
  const app = new Hono();
  const telemetry = options.telemetry ?? createNoopTelemetryRecorder();

  app.use("*", async (context, next) => {
    const started = performance.now();
    let errorType: string | undefined;

    try {
      await next();
    } catch (error) {
      errorType = error instanceof Error ? error.name : "unknown";
      throw error;
    } finally {
      await recordApiRouteSpan(telemetry, {
        method: context.req.method,
        url: context.req.url,
        statusCode: context.res.status,
        durationMs: Number((performance.now() - started).toFixed(2)),
        ...(errorType ? { errorType } : {}),
      });
    }
  });

  app.get(routeById("health").path, async (context) =>
    context.json({
      ok: true,
      service: "openclinxr-api",
      providerHealth: await runtime.providerHealth(),
    }),
  );

  app.get(routeById("providers-health").path, async (context) => context.json(await runtime.providerHealth()));

  app.get(routeById("admin-graphql-schema").path, (context) =>
    new Response(openClinXrAdminSchemaSdl, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );

  app.get(routeById("admin-graphql-codegen-plan").path, (context) => context.json(createGraphqlCodegenPlan()));

  app.get(routeById("admin-graphql-documents").path, (context) => context.json(adminGraphqlDocuments));

  app.get(routeById("learner-scenario").path, (context) => context.json(createLearnerScenarioView(edChestPainScenario)));

  app.get(routeById("scenario-bank-asset-readiness").path, (context) => context.json(createSeedBankAssetReadiness()));

  app.get(routeById("scenario-asset-readiness").path, (context) => context.json(runtime.assetReadiness()));

  app.post(routeById("scenario-publication-readiness").path, async (context) => {
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

  app.get(routeById("default-exam-blueprint").path, (context) => context.json(createDefaultClinicalSkillsBlueprint()));

  app.get(routeById("step2cs-seed-exam-blueprint").path, (context) => context.json(createStep2CsStyleSeedBlueprint()));

  app.get(routeById("step2cs-seed-exam-blueprint-readiness").path, (context) =>
    context.json(evaluateBlueprintScenarioReadiness(createStep2CsStyleSeedBlueprint(), scenarioBank)),
  );

  app.get(routeById("step2cs-seed-exam-timing-plan").path, (context) =>
    context.json(createExamTimingPlan(createStep2CsStyleSeedBlueprint())),
  );

  app.get(routeById("step2cs-seed-station-run-queue").path, (context) =>
    context.json(createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank)),
  );

  app.get(routeById("list-step2cs-seed-station-run-queue-snapshots").path, async (context) => {
    const blueprintId = createStep2CsStyleSeedBlueprint().blueprintId;
    return context.json(await Promise.resolve(persistence.listStationRunQueueSnapshots?.(blueprintId) ?? []));
  });

  app.post(routeById("create-step2cs-seed-station-run-queue-snapshot").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      snapshotId?: unknown;
      createdAt?: unknown;
      reviewerId?: unknown;
    };
    const snapshot: ApiStationRunQueueSnapshot = {
      snapshotId: typeof body.snapshotId === "string" && body.snapshotId.length > 0 ? body.snapshotId : `queue_snapshot_${Date.now()}`,
      createdAt: typeof body.createdAt === "string" && body.createdAt.length > 0 ? body.createdAt : new Date().toISOString(),
      ...(typeof body.reviewerId === "string" && body.reviewerId.length > 0 ? { reviewerId: body.reviewerId } : {}),
      queue: createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank),
    };

    await persistence.saveStationRunQueueSnapshot?.(snapshot);
    return context.json(snapshot, 201);
  });

  app.post(routeById("create-exam-form").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { examFormId?: string };
    const form = assembleExamForm({
      examFormId: body.examFormId ?? "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });
    await persistence.saveExamForm?.(form);
    return context.json(form, 201);
  });

  app.post(routeById("exam-form-version-drift").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { form?: unknown };
    if (!isExamForm(body.form)) {
      return context.json({ error: "invalid_exam_form" }, 400);
    }

    return context.json(evaluateScenarioVersionDrift(body.form, [edChestPainScenario]));
  });

  app.post(routeById("start-session").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { learnerId?: string; consentAccepted?: boolean };
    if (body.consentAccepted !== true) {
      return context.json({ error: "consent_required" }, 400);
    }
    const run = await runtime.startSession({ learnerId: body.learnerId ?? "learner_001", consentAccepted: true });
    await persistTraceSnapshot(runtime, persistence, run.stationRunId);

    return context.json(run, 201);
  });

  app.post(routeById("start-encounter").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number };

    try {
      const summary = runtime.startEncounter(stationRunId, { atSecond: body.atSecond ?? 60 });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(summary);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("append-trace-event").path, async (context) => {
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
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("actor-response").path, async (context) => {
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
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("voice-synthesis").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      actorId?: string;
      voiceId?: string;
      text?: string;
      atSecond?: number;
    };

    try {
      const result = await runtime.synthesizeActorSpeech(stationRunId, {
        actorId: body.actorId ?? "",
        voiceId: body.voiceId ?? "",
        text: body.text ?? "",
        atSecond: body.atSecond ?? 0,
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("submit-note").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number; text?: string };

    try {
      const result = runtime.submitNote(stationRunId, {
        atSecond: body.atSecond ?? 1260,
        text: body.text ?? "",
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(result);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get(routeById("review-packet").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");

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

    try {
      return context.json(runtime.traceEvents(stationRunId));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  return app;
}

async function recordApiRouteSpan(
  telemetry: TelemetryRecorder,
  input: {
    method: string;
    url: string;
    statusCode: number;
    durationMs: number;
    errorType?: string;
  },
): Promise<void> {
  const routeMatch = matchOpenClinXrRestRoute(input.method, new URL(input.url).pathname);
  const span: TelemetrySpanRecord = {
    name: openClinXrSpanNames.apiRoute,
    attributes: telemetryRouteAttributes({
      routeId: routeMatch?.route.id ?? "unmatched",
      ...(routeMatch?.params.stationRunId ? { stationRunId: routeMatch.params.stationRunId } : {}),
    }),
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    ...(input.errorType ? { errorType: input.errorType } : {}),
  };

  await Promise.resolve(telemetry.recordSpan(span)).catch(() => undefined);
}

async function persistTraceSnapshot(runtime: ScenarioRuntime, persistence: ApiPersistenceSink, stationRunId: string): Promise<void> {
  await persistence.saveTraceEvents?.(stationRunId, runtime.traceEvents(stationRunId));
}

function createSeedBankAssetReadiness() {
  const registry = new InMemoryAssetRegistry();
  for (const scenario of scenarioBank) {
    for (const manifest of createScenarioPlaceholderManifests(scenario)) {
      registry.upsert(manifest);
    }
  }

  return scenarioBank.map((scenario) => registry.evaluateScenarioReadiness(scenario));
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
