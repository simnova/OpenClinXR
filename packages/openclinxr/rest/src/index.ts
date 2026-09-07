export type OpenClinXrRestSurface = "control-plane" | "xr-runtime" | "admin-graphql";

export type OpenClinXrRestMethod = "GET" | "POST";

export type OpenClinXrRestRoute = {
  id: string;
  method: OpenClinXrRestMethod;
  path: `/${string}`;
  surface: OpenClinXrRestSurface;
  stationRunScoped: boolean;
  contractBoundary?: {
    posture: "read_only_review_packet";
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
  };
};

export type OpenClinXrRestRouteMatch = {
  route: (typeof openClinXrRestRoutes)[number];
  params: {
    stationRunId?: string;
    capabilityId?: string;
    jobId?: string;
    bundleId?: string;
    scenarioId?: string;
  };
};

export const openClinXrRestRoutes = Object.freeze([
  route("health", "GET", "/health", "control-plane"),
  /** Read-only local telemetry snapshot (spans + run/encounter counters). No export/network. */
  route("telemetry-metrics", "GET", "/telemetry/metrics", "control-plane"),
  route("providers-health", "GET", "/providers/health", "control-plane"),
  route("runtime-protocols", "GET", "/runtime/protocols", "control-plane"),
  route("runtime-provider-readiness", "GET", "/runtime/provider-readiness", "control-plane"),
  route("runtime-selection-review-packet", "GET", "/runtime/selection-review-packet", "control-plane", false, {
    posture: "read_only_review_packet",
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
  }),
  route("submit-runtime-realism-evidence-input-review", "POST", "/runtime/realism-evidence-input-review-decisions", "control-plane"),
  route("submit-runtime-visual-evidence-attachment", "POST", "/runtime/visual-evidence-attachments", "control-plane"),
  route("learner-runtime-asset-bundle-list", "GET", "/runtime/asset-bundles", "xr-runtime"),
  route("learner-runtime-asset-bundle", "GET", "/runtime/asset-bundles/:bundleId", "xr-runtime"),
  route("realtime-voice-posture", "GET", "/voice/realtime/posture", "xr-runtime"),
  route("admin-graphql-schema", "GET", "/admin/graphql/schema", "admin-graphql"),
  route("admin-graphql-codegen-plan", "GET", "/admin/graphql/codegen-plan", "admin-graphql"),
  route("admin-graphql-documents", "GET", "/admin/graphql/documents", "admin-graphql"),
  route("admin-graphql-execute", "POST", "/admin/graphql", "admin-graphql"),
  route("learner-scenario", "GET", "/scenarios/ed-chest-pain", "control-plane"),
  route("save-authored-scenario", "POST", "/scenarios", "control-plane"),
  route("list-authored-scenarios", "GET", "/scenarios", "control-plane"),
  route("get-authored-scenario", "GET", "/scenarios/:scenarioId", "control-plane"),
  route("scenario-bank-maturity", "GET", "/scenario-bank/maturity", "control-plane"),
  route("scenario-bank-exam-sequence", "GET", "/scenario-bank/exam-sequence", "control-plane"),
  route("scenario-bank-dynamic-encounter-factory-planning", "GET", "/scenario-bank/dynamic-encounter-factory/planning", "control-plane", false, {
    posture: "read_only_review_packet",
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
  }),
  route("scenario-bank-asset-readiness", "GET", "/scenario-bank/assets/readiness", "control-plane"),
  route("scenario-bank-environment-generation-queue", "GET", "/scenario-bank/environments/generation-queue", "control-plane"),
  route("scenario-bank-environment-work-order-queue", "GET", "/scenario-bank/environments/work-orders", "control-plane"),
  route("scenario-bank-scene-generation-pipeline", "GET", "/scenario-bank/scene-generation/pipeline", "control-plane"),
  route("list-scenario-scene-generation-requests", "GET", "/scenario-bank/scene-generation/requests", "control-plane"),
  route("create-scenario-scene-generation-request", "POST", "/scenario-bank/scene-generation/requests", "control-plane"),
  route("submit-scenario-scene-generation-request-review", "POST", "/scenario-bank/scene-generation/requests/:requestId/runtime-asset-review-decisions", "control-plane"),
  route("submit-scenario-scene-generation-materialization-input-review", "POST", "/scenario-bank/scene-generation/requests/:requestId/materialization-input-review-decisions", "control-plane"),
  route("scenario-scene-generation-request-publication-readiness", "GET", "/scenario-bank/scene-generation/requests/:requestId/publication-readiness", "control-plane"),
  route("scenario-asset-readiness", "GET", "/scenarios/ed-chest-pain/assets/readiness", "control-plane"),
  route("scenario-publication-readiness", "POST", "/scenarios/ed-chest-pain/publication-readiness", "control-plane"),
  route("default-exam-blueprint", "GET", "/exam-blueprints/default", "control-plane"),
  route("step2cs-seed-exam-blueprint", "GET", "/exam-blueprints/step2cs-seed", "control-plane"),
  route("step2cs-seed-exam-blueprint-readiness", "GET", "/exam-blueprints/step2cs-seed/readiness", "control-plane"),
  route("step2cs-seed-exam-timing-plan", "GET", "/exam-blueprints/step2cs-seed/timing-plan", "control-plane"),
  route("step2cs-seed-station-run-queue", "GET", "/exam-blueprints/step2cs-seed/station-run-queue", "control-plane"),
  route("list-step2cs-seed-station-run-queue-snapshots", "GET", "/exam-blueprints/step2cs-seed/station-run-queue/snapshots", "control-plane"),
  route("create-step2cs-seed-station-run-queue-snapshot", "POST", "/exam-blueprints/step2cs-seed/station-run-queue/snapshots", "control-plane"),
  route("create-exam-form", "POST", "/exam-forms", "control-plane"),
  route("exam-form-version-drift", "POST", "/exam-forms/version-drift", "control-plane"),
  route("submit-internal-capability-job", "POST", "/internal/capabilities/:capabilityId/jobs", "control-plane"),
  route("read-internal-capability-job", "GET", "/internal/capabilities/:capabilityId/jobs/:jobId", "control-plane"),
  route("start-session", "POST", "/sessions", "xr-runtime"),
  route("start-encounter", "POST", "/sessions/:stationRunId/start-encounter", "xr-runtime", true),
  route("append-trace-event", "POST", "/sessions/:stationRunId/events", "xr-runtime", true),
  route("record-clinical-action", "POST", "/sessions/:stationRunId/clinical-actions", "xr-runtime", true),
  route("actor-interaction-route", "POST", "/sessions/:stationRunId/actor-interaction-route", "xr-runtime", true),
  route("actor-response", "POST", "/sessions/:stationRunId/actor-response", "xr-runtime", true),
  route("voice-synthesis", "POST", "/sessions/:stationRunId/voice-synthesis", "xr-runtime", true),
  route("submit-note", "POST", "/sessions/:stationRunId/note", "xr-runtime", true),
  route("review-replay-readiness-summary", "GET", "/sessions/:stationRunId/review-replay-readiness", "xr-runtime", true),
  route("review-packet", "GET", "/sessions/:stationRunId/review-packet", "xr-runtime", true),
  route("trace-events", "GET", "/sessions/:stationRunId/trace-events", "xr-runtime", true),
  /** Faculty Q4 score-draft persistence (local review artifact; scoring gates stay false). */
  route("save-faculty-score-draft", "POST", "/sessions/:stationRunId/faculty-score-draft", "control-plane", true),
  /** Faculty Q4 review-decision persistence (local promote/hold only; notEvidenceFor preserved). */
  route("save-faculty-review-decision", "POST", "/sessions/:stationRunId/review-decision", "control-plane", true),
  /** Faculty compile-lock persistence (local review metadata only; no packet promote). */
  route("save-faculty-compile-lock", "POST", "/internal/faculty-compile-locks", "control-plane"),
] as const);

export type OpenClinXrRestRouteId = (typeof openClinXrRestRoutes)[number]["id"];

export const openClinXrRestRouteIds = Object.freeze(openClinXrRestRoutes.map((route) => route.id));

export function routeById(routeId: OpenClinXrRestRouteId): Extract<(typeof openClinXrRestRoutes)[number], { id: typeof routeId }> {
  const route = openClinXrRestRoutes.find((candidate) => candidate.id === routeId);
  if (!route) {
    throw new Error(`Unknown REST route: ${routeId}`);
  }

  return route as Extract<(typeof openClinXrRestRoutes)[number], { id: typeof routeId }>;
}

export function buildSessionRoutePath(routeId: OpenClinXrRestRouteId, stationRunId: string): string {
  if (stationRunId.trim().length === 0) {
    throw new Error("stationRunId is required");
  }

  const route = routeById(routeId);
  if (!route.stationRunScoped) {
    throw new Error(`Route ${routeId} is not station-run scoped`);
  }

  return route.path.replace(":stationRunId", encodeURIComponent(stationRunId));
}

export function matchOpenClinXrRestRoute(method: string, pathname: string): OpenClinXrRestRouteMatch | undefined {
  const normalizedMethod = method.toUpperCase();
  const pathSegments = splitPath(pathname);

  for (const route of openClinXrRestRoutes) {
    if (route.method !== normalizedMethod) {
      continue;
    }

    const params = matchRouteSegments(route.path, pathSegments);
    if (params) {
      return { route, params };
    }
  }

  return undefined;
}

function route<const TId extends string, const TMethod extends OpenClinXrRestMethod, const TPath extends `/${string}`>(
  id: TId,
  method: TMethod,
  path: TPath,
  surface: OpenClinXrRestSurface,
  stationRunScoped = false,
  contractBoundary?: OpenClinXrRestRoute["contractBoundary"],
): Readonly<{
  id: TId;
  method: TMethod;
  path: TPath;
  surface: OpenClinXrRestSurface;
  stationRunScoped: boolean;
  contractBoundary?: OpenClinXrRestRoute["contractBoundary"];
}> {
  return Object.freeze({
    id,
    method,
    path,
    surface,
    stationRunScoped,
    ...(contractBoundary ? { contractBoundary } : {}),
  });
}

function matchRouteSegments(routePath: string, pathSegments: string[]): OpenClinXrRestRouteMatch["params"] | undefined {
  const routeSegments = splitPath(routePath);
  if (routeSegments.length !== pathSegments.length) {
    return undefined;
  }

  const params: OpenClinXrRestRouteMatch["params"] = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const pathSegment = pathSegments[index];

    if (routeSegment === ":stationRunId") {
      params.stationRunId = decodePathSegment(pathSegment ?? "");
      continue;
    }
    if (routeSegment === ":capabilityId") {
      params.capabilityId = decodePathSegment(pathSegment ?? "");
      continue;
    }
    if (routeSegment === ":jobId") {
      params.jobId = decodePathSegment(pathSegment ?? "");
      continue;
    }
    if (routeSegment === ":bundleId") {
      params.bundleId = decodePathSegment(pathSegment ?? "");
      continue;
    }
    if (routeSegment === ":scenarioId") {
      params.scenarioId = decodePathSegment(pathSegment ?? "");
      continue;
    }

    if (routeSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

function splitPath(pathname: string): string[] {
  return pathname.split(/[?#]/, 1)[0]?.split("/").filter(Boolean) ?? [];
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export {
  listAdminGraphqlScenarios,
  toAdminGraphqlScenario,
} from "./admin-scenario-listing.js";
export type { ApiAppContext } from "./api-app-context.js";
export { createApiAppContext } from "./api-app-context.js";
export {
  type ApiFetchBody,
  type ApiFetchHeaders,
  type ApiFetchInput,
  type ApiFetchRequestLike,
  isApiFetchRequestLike,
} from "./api-fetch-request-validation.js";
export type { ApiApp, ApiLifecycleService, ApiLifecycleServiceInput, ComposedApiApp } from "./api-application.js";
export { ApiApplication, shutdownApiApp } from "./api-application.js";
export { registerCoreMiddleware } from "./api-middleware.js";
export {
  buildAssetReleaseLadderReplayProjection,
  createAdminGraphqlRoot,
  createSeedBankAssetReadiness,
  createSeedBankSceneGenerationPipelineQueue,
  createSeedStationRunQueueSnapshot,
  findSeedBankAssetReadiness,
  summarizeClinicalEventReviewProjections,
  summarizeReviewReplayReadiness,
  uniqueStrings,
} from "./api-route-support.js";
export {
  createDefaultRealtimeVoiceGatewayPostureInput,
  recordApiRouteSpan,
  telemetrySnapshotFromRecorder,
} from "./api-support.js";
export type * from "./api-types.js";
export type {
  ApiAppOptions,
  ApiAppVariables,
  ApiAuthOptions,
  ApiPersistenceSink,
} from "./api-types.js";
export { buildExamAssemblyScenarioPool } from "./exam-assembly-pool.js";
export {
  compileLocksPathFor,
  FACULTY_COMPILE_LOCK_CLAIM_BOUNDARY,
  FACULTY_COMPILE_LOCK_NOT_EVIDENCE_FOR,
  FACULTY_COMPILE_LOCK_OVERRIDE_PATHS,
  FACULTY_COMPILE_LOCKS_DIR,
  type FacultyCompileLockFile,
  type FacultyCompileLockFileLock,
  readFacultyCompileLocksRecord,
  resolveCompileLocksRepoRoot,
  writeFacultyCompileLock,
} from "./faculty-compile-lock-store.js";
export {
  type FactoryRunCaseRow,
  type FactoryRunRollupValue,
  type FactoryRunStationRow,
  parseFactoryRunRollup,
} from "./factory-run-rollup-validation.js";
export { createOpenClinXrApiProtocolPosture } from "./protocol-support.js";
export type { OpenClinXrApiProtocolPosture, OpenClinXrApiProtocolSupport } from "./protocol-support.js";
export { isRecord, reviewStatesFromRecord } from "./promotion-io-validation.js";
export { registerAdminGraphqlRoutes } from "./routes/admin-graphql-routes.js";
export { registerAssembledExamDispositionRoutes } from "./routes/assembled-exam-disposition-routes.js";
export { registerAssembledExamReviewRoutes } from "./routes/assembled-exam-review-routes.js";
export { registerAssembledExamRunRoutes } from "./routes/assembled-exam-run-routes.js";
export { registerAuthoringRoutes } from "./routes/authoring-routes.js";
export { registerCapabilityJobRoutes } from "./routes/capability-job-routes.js";
export { registerDialogueSeedAuthoringRoutes } from "./routes/dialogue-seed-authoring-routes.js";
export {
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH,
  registerEncounterBundlePromotionRoutes,
} from "./routes/encounter-bundle-promotion/index.js";
export { registerEncounterSessionRoutes } from "./routes/encounter-session-routes.js";
export { registerExamRoutes } from "./routes/exam-routes.js";
export { registerFacultyCompileLockRoutes } from "./routes/faculty-compile-lock-routes.js";
export { registerPlatformRoutes } from "./routes/platform-routes.js";
export { registerReviewRoutes } from "./routes/review-routes.js";
export { registerRuntimeEvidenceRoutes } from "./routes/runtime-evidence-routes.js";
export { registerScenarioSceneGenerationRoutes } from "./routes/scenario-scene-generation-routes.js";
export { registerSessionRoutes, resolveSessionRuntime } from "./routes/session-routes.js";
export {
  type ApiAssembledExamDispositionRecord,
  type ApiAssembledExamRunRecord,
  type ApiRuntimeDurableStore,
  createScenarioRuntimeDurableStoreFromApiPersistence,
} from "./runtime-durable-store.js";
export { parseStationPayloads } from "./station-payload-validation.js";
export {
  AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX,
  authoredScenarioContentIdentity,
  bindScenarioReviewDecisionToAuthoredIdentity,
  coerceAuthoredScenarioWrite,
  MISSING_AUTHORED_SCENARIO_REVIEW_IDENTITY_ERROR,
  neutralizeClientAssertedApprovedGates,
  persistAuthoredScenarioReviewPromotion,
  STALE_AUTHORED_SCENARIO_REVIEW_IDENTITY_ERROR,
} from "./scenario-review-promotion.js";
