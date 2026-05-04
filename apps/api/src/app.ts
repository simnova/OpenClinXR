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
import {
  AdminGraphqlReviewDecision,
  AdminGraphqlScenarioStatus,
  adminGraphqlDocuments,
  createGraphqlCodegenPlan,
  executeAdminGraphql,
  openClinXrAdminSchemaSdl,
  type AdminGraphqlScenario,
  type AdminGraphqlRootValue,
} from "@openclinxr/graphql";
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

export type ApiScenarioReviewDecisionRecord = {
  scenarioId: string;
  version: number;
  reviewerRole: keyof AdminGraphqlScenario["review"];
  reviewerId: string;
  decision: "approved" | "changes_requested";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

export type ApiPersistenceSink = {
  saveExamForm?: (form: ExamForm) => Promise<void> | void;
  saveStationRunQueueSnapshot?: (snapshot: ApiStationRunQueueSnapshot) => Promise<void> | void;
  listStationRunQueueSnapshots?: (blueprintId: string) => Promise<ApiStationRunQueueSnapshot[]> | ApiStationRunQueueSnapshot[];
  saveScenarioReviewDecision?: (record: ApiScenarioReviewDecisionRecord) => Promise<void> | void;
  listScenarioReviewDecisions?: () => Promise<ApiScenarioReviewDecisionRecord[]> | ApiScenarioReviewDecisionRecord[];
  saveTraceEvents?: (stationRunId: string, events: RuntimeTraceEvents) => Promise<void> | void;
  saveReviewPacket?: (stationRunId: string, packet: RuntimeReviewPacket) => Promise<void> | void;
};

export type ApiAppOptions = {
  telemetry?: TelemetryRecorder;
};

export function createApiApp(runtime: ScenarioRuntime = createDefaultScenarioRuntime(), persistence: ApiPersistenceSink = {}, options: ApiAppOptions = {}): Hono {
  const app = new Hono();
  const telemetry = options.telemetry ?? createNoopTelemetryRecorder();
  const adminScenarioOverrides = new Map<string, AdminGraphqlScenario>();

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

  app.post(routeById("admin-graphql-execute").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      query?: unknown;
      variables?: unknown;
      operationName?: unknown;
    };
    const graphqlOperationName = typeof body.operationName === "string" && body.operationName.length > 0 ? body.operationName : "anonymous";
    const graphqlStarted = performance.now();

    if (typeof body.query !== "string" || body.query.length === 0) {
      await recordGraphqlOperationSpan(telemetry, {
        operationName: graphqlOperationName,
        statusCode: 400,
        durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
        hasErrors: true,
      });
      return context.json({ errors: [{ message: "query_required" }] }, 400);
    }

    const result = await executeAdminGraphql(
      {
        query: body.query,
        ...(isRecord(body.variables) ? { variables: body.variables } : {}),
        ...(graphqlOperationName !== "anonymous" ? { operationName: graphqlOperationName } : {}),
      },
      createAdminGraphqlRoot(runtime, persistence, adminScenarioOverrides),
    );
    await recordGraphqlOperationSpan(telemetry, {
      operationName: graphqlOperationName,
      statusCode: 200,
      durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
      hasErrors: Boolean(result.errors?.length),
    });

    return context.json(result);
  });

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
    const snapshot = createSeedStationRunQueueSnapshot(body);

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

function createAdminGraphqlRoot(
  runtime: ScenarioRuntime,
  persistence: ApiPersistenceSink,
  scenarioOverrides: Map<string, AdminGraphqlScenario>,
): AdminGraphqlRootValue {
  return {
    assetReadiness: ({ scenarioId, version }) => findSeedBankAssetReadiness(String(scenarioId), version),
    scenario: async ({ scenarioId, version }) =>
      (await listAdminGraphqlScenarios(persistence, scenarioOverrides)).find((scenario) =>
        scenario.scenarioId === scenarioId && (version === undefined || scenario.version === version)
      ),
    scenarios: async ({ status }) =>
      (await listAdminGraphqlScenarios(persistence, scenarioOverrides)).filter((scenario) => status === undefined || scenario.status === status),
    reviewPacket: ({ stationRunId }) => runtime.reviewPacket(String(stationRunId)),
    traceEvents: ({ stationRunId }) => runtime.traceEvents(String(stationRunId)),
    submitScenarioReview: async ({ input }) => {
      const adminScenarios = await listAdminGraphqlScenarios(persistence, scenarioOverrides);
      const scenario = adminScenarios.find((candidate) => candidate.scenarioId === input.scenarioId && candidate.version === input.version);
      if (!scenario) {
        throw new Error(`Scenario not found: ${input.scenarioId} v${input.version}`);
      }

      const reviewGate = parseScenarioReviewGate(input.reviewerRole);
      validateScenarioReviewDecisionInput(input);

      const reviewDecision = toApiScenarioReviewDecisionRecord(input, reviewGate);
      const nextScenario = applyScenarioReviewDecision(scenario, reviewDecision);
      await persistence.saveScenarioReviewDecision?.(reviewDecision);
      scenarioOverrides.set(scenarioVersionKey(nextScenario.scenarioId, nextScenario.version), nextScenario);

      return nextScenario;
    },
    stationRunQueueSnapshots: async ({ blueprintId }) => Promise.resolve(persistence.listStationRunQueueSnapshots?.(blueprintId) ?? []),
    createStationRunQueueSnapshot: async ({ input }) => {
      const snapshot = createSeedStationRunQueueSnapshot(input);
      await persistence.saveStationRunQueueSnapshot?.(snapshot);
      return snapshot;
    },
    saveFacultyScoreDraft: async ({ input }) => {
      const stationRunId = String(input.stationRunId);
      const packet = runtime.saveFacultyScoreDraft(stationRunId, {
        reviewerId: String(input.reviewerId),
        comments: input.comments,
        rubricScores: isRecord(input.rubricScores) ? input.rubricScores : {},
      });
      await persistence.saveTraceEvents?.(stationRunId, runtime.traceEvents(stationRunId));
      await persistence.saveReviewPacket?.(stationRunId, packet);
      return packet;
    },
  };
}

async function listAdminGraphqlScenarios(
  persistence: ApiPersistenceSink,
  scenarioOverrides: Map<string, AdminGraphqlScenario>,
): Promise<AdminGraphqlScenario[]> {
  const reviewDecisions = await Promise.resolve(persistence.listScenarioReviewDecisions?.() ?? []);

  return scenarioBank.map((scenario) => {
    const scenarioKey = scenarioVersionKey(scenario.scenarioId, scenario.version);
    const baseScenario = scenarioOverrides.get(scenarioKey) ?? toAdminGraphqlScenario(scenario);

    return reviewDecisions
      .filter((decision) => decision.scenarioId === baseScenario.scenarioId && decision.version === baseScenario.version)
      .sort(compareScenarioReviewDecisions)
      .reduce(applyScenarioReviewDecision, baseScenario);
  });
}

function toAdminGraphqlScenario(scenario: (typeof scenarioBank)[number]): AdminGraphqlScenario {
  return {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    title: scenario.title,
    status: toAdminGraphqlScenarioStatus(scenario.status),
    clinicalObjectives: scenario.clinicalObjectives,
    actors: scenario.actors.map(({ hiddenFacts: _hiddenFacts, ...actor }) => actor),
    requiredTraceTags: scenario.requiredTraceTags,
    review: { ...scenario.review },
    governance: scenario.governance,
    equipment: [...(scenario.equipment ?? [])],
    assetNeeds: [...(scenario.assetNeeds ?? [])],
    ...(scenario.environment === undefined ? {} : { environment: scenario.environment }),
  };
}

function toAdminGraphqlScenarioStatus(status: (typeof scenarioBank)[number]["status"]): AdminGraphqlScenario["status"] {
  switch (status) {
    case "approved":
      return AdminGraphqlScenarioStatus.Approved;
    case "retired":
      return AdminGraphqlScenarioStatus.Archived;
    case "draft":
      return AdminGraphqlScenarioStatus.Draft;
  }
}

function scenarioVersionKey(scenarioId: string, version: number): string {
  return `${scenarioId}:${version}`;
}

function parseScenarioReviewGate(reviewerRole: string): keyof AdminGraphqlScenario["review"] {
  if (reviewerRole === "clinical" || reviewerRole === "psychometric" || reviewerRole === "legal" || reviewerRole === "simulationQa") {
    return reviewerRole;
  }

  throw new Error(`Unsupported scenario review gate: ${reviewerRole}`);
}

function validateScenarioReviewDecisionInput(input: {
  reviewerId: string | number;
  comments: string;
  evidenceRefs: Array<string>;
}): void {
  if (String(input.reviewerId).trim().length === 0) {
    throw new Error("Scenario review decision requires reviewerId.");
  }
  if (input.comments.trim().length === 0) {
    throw new Error("Scenario review decision requires comments.");
  }
  if (input.evidenceRefs.length === 0 || input.evidenceRefs.some((evidenceRef) => evidenceRef.trim().length === 0)) {
    throw new Error("Scenario review decision requires evidenceRefs.");
  }
}

function toApiScenarioReviewDecisionRecord(
  input: {
    scenarioId: string | number;
    version: number;
    reviewerId: string | number;
    decision: AdminGraphqlReviewDecision;
    comments: string;
    evidenceRefs: Array<string>;
  },
  reviewerRole: keyof AdminGraphqlScenario["review"],
): ApiScenarioReviewDecisionRecord {
  return {
    scenarioId: String(input.scenarioId),
    version: input.version,
    reviewerRole,
    reviewerId: String(input.reviewerId),
    decision: input.decision === AdminGraphqlReviewDecision.Approved ? "approved" : "changes_requested",
    comments: input.comments,
    evidenceRefs: [...input.evidenceRefs],
    reviewedAt: new Date().toISOString(),
  };
}

function applyScenarioReviewDecision(
  scenario: AdminGraphqlScenario,
  reviewDecision: ApiScenarioReviewDecisionRecord,
): AdminGraphqlScenario {
  const nextReview = {
    ...scenario.review,
    [reviewDecision.reviewerRole]: reviewDecision.decision,
  };

  return {
    ...scenario,
    review: nextReview,
    status: scenarioStatusForReview(nextReview),
  };
}

function compareScenarioReviewDecisions(left: ApiScenarioReviewDecisionRecord, right: ApiScenarioReviewDecisionRecord): number {
  return Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt);
}

function scenarioStatusForReview(review: AdminGraphqlScenario["review"]): AdminGraphqlScenario["status"] {
  if (Object.values(review).every((state) => state === "approved")) {
    return AdminGraphqlScenarioStatus.Approved;
  }
  if (Object.values(review).some((state) => state === "changes_requested")) {
    return AdminGraphqlScenarioStatus.Draft;
  }
  return AdminGraphqlScenarioStatus.ReadyForReview;
}

function createSeedStationRunQueueSnapshot(input: { snapshotId?: unknown; createdAt?: unknown; reviewerId?: unknown }): ApiStationRunQueueSnapshot {
  return {
    snapshotId: typeof input.snapshotId === "string" && input.snapshotId.length > 0 ? input.snapshotId : `queue_snapshot_${Date.now()}`,
    createdAt: typeof input.createdAt === "string" && input.createdAt.length > 0 ? input.createdAt : new Date().toISOString(),
    ...(typeof input.reviewerId === "string" && input.reviewerId.length > 0 ? { reviewerId: input.reviewerId } : {}),
    queue: createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank),
  };
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

async function recordGraphqlOperationSpan(
  telemetry: TelemetryRecorder,
  input: {
    operationName: string;
    statusCode: number;
    durationMs: number;
    hasErrors: boolean;
  },
): Promise<void> {
  await Promise.resolve(telemetry.recordSpan({
    name: openClinXrSpanNames.graphqlOperation,
    attributes: telemetryRouteAttributes({
      graphqlOperationName: input.operationName,
    }),
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    ...(input.hasErrors ? { errorType: "graphql_errors" } : {}),
  })).catch(() => undefined);
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

function findSeedBankAssetReadiness(scenarioId: string, version: number) {
  const scenarioExists = scenarioBank.some((scenario) => scenario.scenarioId === scenarioId && scenario.version === version);
  if (!scenarioExists) {
    throw new Error(`Scenario not found: ${scenarioId} v${version}`);
  }

  const readiness = createSeedBankAssetReadiness().find((candidate) => candidate.scenarioId === scenarioId);
  if (!readiness) {
    throw new Error(`Scenario asset readiness not found: ${scenarioId} v${version}`);
  }

  return readiness;
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
