export type OpenClinXrRestSurface = "control-plane" | "xr-runtime" | "admin-graphql";

export type OpenClinXrRestMethod = "GET" | "POST";

export type OpenClinXrRestRoute = {
  id: string;
  method: OpenClinXrRestMethod;
  path: `/${string}`;
  surface: OpenClinXrRestSurface;
  stationRunScoped: boolean;
};

export type OpenClinXrRestRouteMatch = {
  route: (typeof openClinXrRestRoutes)[number];
  params: {
    stationRunId?: string;
  };
};

export const openClinXrRestRoutes = Object.freeze([
  route("health", "GET", "/health", "control-plane"),
  route("providers-health", "GET", "/providers/health", "control-plane"),
  route("admin-graphql-schema", "GET", "/admin/graphql/schema", "admin-graphql"),
  route("admin-graphql-codegen-plan", "GET", "/admin/graphql/codegen-plan", "admin-graphql"),
  route("admin-graphql-documents", "GET", "/admin/graphql/documents", "admin-graphql"),
  route("learner-scenario", "GET", "/scenarios/ed-chest-pain", "control-plane"),
  route("scenario-bank-asset-readiness", "GET", "/scenario-bank/assets/readiness", "control-plane"),
  route("scenario-asset-readiness", "GET", "/scenarios/ed-chest-pain/assets/readiness", "control-plane"),
  route("scenario-publication-readiness", "POST", "/scenarios/ed-chest-pain/publication-readiness", "control-plane"),
  route("default-exam-blueprint", "GET", "/exam-blueprints/default", "control-plane"),
  route("step2cs-seed-exam-blueprint", "GET", "/exam-blueprints/step2cs-seed", "control-plane"),
  route("step2cs-seed-exam-blueprint-readiness", "GET", "/exam-blueprints/step2cs-seed/readiness", "control-plane"),
  route("step2cs-seed-exam-timing-plan", "GET", "/exam-blueprints/step2cs-seed/timing-plan", "control-plane"),
  route("create-exam-form", "POST", "/exam-forms", "control-plane"),
  route("exam-form-version-drift", "POST", "/exam-forms/version-drift", "control-plane"),
  route("start-session", "POST", "/sessions", "xr-runtime"),
  route("start-encounter", "POST", "/sessions/:stationRunId/start-encounter", "xr-runtime", true),
  route("append-trace-event", "POST", "/sessions/:stationRunId/events", "xr-runtime", true),
  route("actor-response", "POST", "/sessions/:stationRunId/actor-response", "xr-runtime", true),
  route("voice-synthesis", "POST", "/sessions/:stationRunId/voice-synthesis", "xr-runtime", true),
  route("submit-note", "POST", "/sessions/:stationRunId/note", "xr-runtime", true),
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
  if (!stationRunId) {
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
): Readonly<{
  id: TId;
  method: TMethod;
  path: TPath;
  surface: OpenClinXrRestSurface;
  stationRunScoped: boolean;
}> {
  return Object.freeze({ id, method, path, surface, stationRunScoped });
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

    if (routeSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
