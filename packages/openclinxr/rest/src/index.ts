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
  };
};

export const openClinXrRestRoutes = Object.freeze([
  route("health", "GET", "/health", "control-plane"),
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
