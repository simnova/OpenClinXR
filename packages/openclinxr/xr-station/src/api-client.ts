export type RuntimeSessionSummary = {
  stationRunId: string;
  scenarioId: string;
  phase: string;
};

export type StartSessionRequest = {
  learnerId: string;
  consentAccepted: boolean;
};

export type StartEncounterRequest = {
  atSecond: number;
};

export type TraceActionRequest = {
  eventType: string;
  atSecond: number;
  tag?: string;
  actorId?: string;
  /** Optional review-safe payload (e.g. clinical.touch region); additive. */
  payload?: Record<string, unknown>;
};

export type ActorResponseRequest = {
  actorId: string;
  learnerUtterance: string;
  atSecond: number;
  traceContextTags?: string[];
};

export type VoiceSynthesisRequest = {
  actorId: string;
  voiceId: string;
  text: string;
  atSecond: number;
};

export type SubmitNoteRequest = {
  atSecond: number;
  text: string;
};

export type TraceEventSummary = {
  stationRunId: string;
  sequence: number;
  eventType: string;
  occurredAt: string;
  atSecond: number;
  source: string;
  actorId?: string;
  tag?: string;
  payload?: Record<string, unknown>;
};

export type StationApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Optional static access token attached as `Authorization: Bearer …`. */
  accessToken?: string;
  /** Optional dynamic token provider (preferred when both are set). */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /**
   * The scenario the learner selected, for callers that hold it explicitly.
   *
   * A resolver rather than a value: the selection can change after the client is constructed
   * (`apps/ui-xr/src/main.ts:1464` builds the client once, at module scope), so a snapshot taken
   * at construction would go stale.
   *
   * Leaving this unset does NOT mean "no selection". It falls through to
   * `readAmbientSelectedScenarioId()`, which reads the same browser surfaces
   * `apps/ui-xr/src/main.ts:1017-1027` reads — which is what lets an UNEDITED `main.ts` carry the
   * learner's selection to the route.
   */
  selectedScenarioId?: () => string | null | undefined;
};

/** Per-request selection, for a caller that holds the id at the call site. Outranks both defaults. */
export type LearnerRuntimeAssetBundleRequest = {
  scenarioId?: string | null | undefined;
};

/**
 * The query parameters `apps/ui-xr/src/main.ts:1017-1027` reads the learner's selection from, in
 * its order. Duplicated as data rather than imported because `apps/**` may not be a dependency of
 * a package; the correspondence is asserted by this card's behavior test, not by a type.
 */
const SELECTED_SCENARIO_QUERY_PARAMS = ["scenarioId", "openclinxrScenarioId"] as const;

/** The storage key `apps/ui-xr/src/main.ts:1015` writes the resolved selection to. */
const SELECTED_SCENARIO_STORAGE_KEY = "openclinxr.scenarioId";

/**
 * The learner's selected scenario id as the BROWSER already holds it, or `undefined`.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A DEFAULT. `GET /runtime/asset-bundles/:bundleId` accepts
 * `?scenarioId=` and resolves it authored-first
 * (`packages/openclinxr/rest/src/routes/runtime-evidence-routes.ts`), but that parameter had ZERO
 * production callers: `getLearnerRuntimeAssetBundle` took no scenario argument and
 * `apps/ui-xr/src/main.ts:924` called it without one, so a persisted, reviewed case was served the
 * ED bay under its own id. `main.ts` is frozen outside this card's write roots, so the client
 * reads the selection from the same two places `main.ts` does.
 *
 * IT RETURNS `undefined` WHEN NOTHING IS SELECTED, and deliberately does NOT fall back to
 * `main.ts`'s default scenario constant. An invented default here would put a scenario id on every
 * request and change the no-selection response, which must stay byte-identical to
 * `createEdChestPainLocalLearnerRuntimeAssetBundle()` with no arguments.
 *
 * Outside a browser every branch is skipped: `location` and `localStorage` are absent under Node,
 * and a storage read can throw (private mode, blocked site data), so both are guarded.
 */
export function readAmbientSelectedScenarioId(): string | undefined {
  const browser = (globalThis as { window?: unknown }).window as
    | { location?: { search?: unknown }; localStorage?: { getItem?: (key: string) => string | null } }
    | undefined;
  if (!browser) return undefined;

  const search = browser.location?.search;
  if (typeof search === "string" && search.length > 0) {
    try {
      const params = new URLSearchParams(search);
      for (const name of SELECTED_SCENARIO_QUERY_PARAMS) {
        const selected = params.get(name)?.trim();
        if (selected) return selected;
      }
    } catch {
      // A malformed search string is not a selection. Fall through to storage.
    }
  }

  try {
    const stored = browser.localStorage?.getItem?.(SELECTED_SCENARIO_STORAGE_KEY)?.trim();
    if (stored) return stored;
  } catch {
    // Blocked site data is not a selection either.
  }
  return undefined;
}

/** Queue acquisition mode (#57). Not per-station body provenance. */
export type StationRunQueueScenarioSource = "fixture_offline" | "fixture_fallback" | "api_queue";

/** Per-station body provenance (#88). Mirrors ExamStationRunQueueScenarioBodySource. */
export type StationRunQueueScenarioBodySource = "api_authored" | "bank_residual";

export type StationRunQueueStationBodySource = {
  scenarioId: string;
  bodySource: StationRunQueueScenarioBodySource;
};

export type StationRunQueueSnapshotRequest = {
  snapshotId?: string;
  createdAt?: string;
  reviewerId?: string;
  /** #57 acquisition markers (API may ignore until control-plane extended). */
  scenarioSource?: StationRunQueueScenarioSource;
  fallbackActive?: boolean;
  fallbackReason?: string;
  /** #88 per-station body provenance (API may ignore until control-plane extended). */
  stationBodySources?: StationRunQueueStationBodySource[];
};

export type StationRunQueueSnapshotResponse = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: unknown;
  scenarioSource?: StationRunQueueScenarioSource;
  fallbackActive?: boolean;
  fallbackReason?: string;
  stationBodySources?: StationRunQueueStationBodySource[];
};

/** Minimal ApiPersistenceSink-compatible surface for station-run-queue snapshots (no mongo rewire). */
export type StationApiPersistenceSink = {
  saveStationRunQueueSnapshot?: (snapshot: StationRunQueueSnapshotResponse) => Promise<void> | void;
};

export type StationApiClient = {
  listLearnerRuntimeAssetBundles(): Promise<LearnerRuntimeAssetBundleListResponse>;
  findLearnerRuntimeAssetBundleByScenarioStation(input: {
    scenarioId: string;
    stationId?: string | null | undefined;
  }): Promise<LearnerRuntimeAssetBundleListResponse["bundles"][number] | null>;
  /**
   * Fetch one learner runtime asset bundle, carrying the learner's SELECTED scenario id.
   *
   * The id is resolved in this order, first non-empty wins:
   *   1. `input.scenarioId` — an explicit call site.
   *   2. `options.selectedScenarioId()` — a client configured with the selection.
   *   3. `readAmbientSelectedScenarioId()` — the browser surfaces `main.ts` already reads.
   * With none of the three the request is byte-identical to before this parameter existed.
   */
  getLearnerRuntimeAssetBundle(
    bundleId: string,
    input?: LearnerRuntimeAssetBundleRequest,
  ): Promise<LearnerRuntimeAssetBundle>;
  startSession(input: StartSessionRequest): Promise<RuntimeSessionSummary>;
  startEncounter(stationRunId: string, input: StartEncounterRequest): Promise<RuntimeSessionSummary>;
  recordTraceAction(stationRunId: string, input: TraceActionRequest): Promise<unknown>;
  requestActorResponse(stationRunId: string, input: ActorResponseRequest): Promise<unknown>;
  synthesizeActorSpeech(stationRunId: string, input: VoiceSynthesisRequest): Promise<unknown>;
  submitNote(stationRunId: string, input: SubmitNoteRequest): Promise<unknown>;
  listTraceEvents(stationRunId: string): Promise<TraceEventSummary[]>;
  /** Additive: POST seed station-run-queue snapshot via existing control-plane route. */
  createStationRunQueueSnapshot(input?: StationRunQueueSnapshotRequest): Promise<StationRunQueueSnapshotResponse>;
};

export type LearnerRuntimeAssetBundleListResponse = {
  productionCloudCall: false;
  bundles: Array<{
    bundleId: string;
    scenarioId: string;
    stationId: string;
    identityScope: "learner_runtime_opaque_bundle";
    actorCount: number;
    equipmentCount: number;
    retrievalMode: "local_fixture_fallback" | "persistence_sink";
  }>;
  notEvidenceFor: string[];
};

export function createStationApiClient(options: StationApiClientOptions): StationApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  const resolveAuthHeaders = () => resolveAuthorizationHeaders(options);

  return {
    listLearnerRuntimeAssetBundles: async () => get(fetcher, baseUrl, "/runtime/asset-bundles", await resolveAuthHeaders()),
    findLearnerRuntimeAssetBundleByScenarioStation: async (input) => {
      const response = await get<LearnerRuntimeAssetBundleListResponse>(
        fetcher,
        baseUrl,
        "/runtime/asset-bundles",
        await resolveAuthHeaders(),
      );
      return response.bundles.find((bundle) =>
        bundle.scenarioId === input.scenarioId
          && (input.stationId === undefined || input.stationId === null || bundle.stationId === input.stationId),
      ) ?? null;
    },
    getLearnerRuntimeAssetBundle: async (bundleId, input) => {
      const scenarioId = resolveSelectedScenarioId(options, input);
      const query = scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : "";
      return get(
        fetcher,
        baseUrl,
        `/runtime/asset-bundles/${encodeURIComponent(bundleId)}${query}`,
        await resolveAuthHeaders(),
      );
    },
    startSession: async (input) => request(fetcher, baseUrl, "/sessions", input, await resolveAuthHeaders()),
    startEncounter: async (stationRunId, input) =>
      request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/start-encounter`, input, await resolveAuthHeaders()),
    recordTraceAction: async (stationRunId, input) =>
      request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/events`, input, await resolveAuthHeaders()),
    requestActorResponse: async (stationRunId, input) =>
      request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/actor-response`, input, await resolveAuthHeaders()),
    synthesizeActorSpeech: async (stationRunId, input) =>
      request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/voice-synthesis`, input, await resolveAuthHeaders()),
    submitNote: async (stationRunId, input) =>
      request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/note`, input, await resolveAuthHeaders()),
    listTraceEvents: async (stationRunId) =>
      get(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/trace-events`, await resolveAuthHeaders()),
    createStationRunQueueSnapshot: async (input = {}) =>
      request(
        fetcher,
        baseUrl,
        "/exam-blueprints/step2cs-seed/station-run-queue/snapshots",
        input,
        await resolveAuthHeaders(),
      ),
  };
}

/**
 * Injected ApiPersistenceSink-shaped adapter over StationApiClient.
 * Persists station-run-queue snapshots via the existing API route; does not open mongo.
 */
export function createStationApiPersistenceSink(client: Pick<StationApiClient, "createStationRunQueueSnapshot">): StationApiPersistenceSink {
  return {
    saveStationRunQueueSnapshot: async (snapshot) => {
      const snapshotRequest: StationRunQueueSnapshotRequest = {
        snapshotId: snapshot.snapshotId,
        createdAt: snapshot.createdAt,
      };
      if (snapshot.reviewerId !== undefined) {
        snapshotRequest.reviewerId = snapshot.reviewerId;
      }
      // #57 — forward acquisition markers so review history can show fixture fallback.
      // #88 — forward per-station body provenance (mixed authored + bank residual).
      // API may still ignore unknown fields until the control-plane route is extended (residual).
      if (snapshot.scenarioSource !== undefined) {
        snapshotRequest.scenarioSource = snapshot.scenarioSource;
      }
      if (snapshot.fallbackActive !== undefined) {
        snapshotRequest.fallbackActive = snapshot.fallbackActive;
      }
      if (snapshot.fallbackReason !== undefined) {
        snapshotRequest.fallbackReason = snapshot.fallbackReason;
      }
      if (snapshot.stationBodySources !== undefined) {
        snapshotRequest.stationBodySources = snapshot.stationBodySources;
      }
      await client.createStationRunQueueSnapshot(snapshotRequest);
    },
  };
}

async function request<TResponse>(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  body: unknown,
  authHeaders: Record<string, string> = {},
): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function get<TResponse>(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  authHeaders: Record<string, string> = {},
): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "GET",
    ...(Object.keys(authHeaders).length > 0 ? { headers: authHeaders } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR API request failed: GET ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

/**
 * Explicit call site, then configured client, then the browser's own selection.
 *
 * Precedence matters: an ambient value survives a page's history and can be stale, so a caller
 * that names the id at the call site must not be overridden by it.
 */
function resolveSelectedScenarioId(
  options: Pick<StationApiClientOptions, "selectedScenarioId">,
  input: LearnerRuntimeAssetBundleRequest | undefined,
): string | undefined {
  const explicit = input?.scenarioId?.trim();
  if (explicit) return explicit;
  const configured = options.selectedScenarioId?.()?.trim();
  if (configured) return configured;
  return readAmbientSelectedScenarioId();
}

async function resolveAuthorizationHeaders(
  options: Pick<StationApiClientOptions, "accessToken" | "getAccessToken">,
): Promise<Record<string, string>> {
  const token = options.getAccessToken ? await options.getAccessToken() : options.accessToken;
  if (typeof token === "string" && token.trim().length > 0) {
    return { authorization: `Bearer ${token.trim()}` };
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
