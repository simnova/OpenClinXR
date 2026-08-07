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
};

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
  getLearnerRuntimeAssetBundle(bundleId: string): Promise<LearnerRuntimeAssetBundle>;
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
    getLearnerRuntimeAssetBundle: async (bundleId) =>
      get(fetcher, baseUrl, `/runtime/asset-bundles/${encodeURIComponent(bundleId)}`, await resolveAuthHeaders()),
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
      const request: StationRunQueueSnapshotRequest = {
        snapshotId: snapshot.snapshotId,
        createdAt: snapshot.createdAt,
      };
      if (snapshot.reviewerId !== undefined) {
        request.reviewerId = snapshot.reviewerId;
      }
      // #57 — forward acquisition markers so review history can show fixture fallback.
      // #88 — forward per-station body provenance (mixed authored + bank residual).
      // API may still ignore unknown fields until the control-plane route is extended (residual).
      if (snapshot.scenarioSource !== undefined) {
        request.scenarioSource = snapshot.scenarioSource;
      }
      if (snapshot.fallbackActive !== undefined) {
        request.fallbackActive = snapshot.fallbackActive;
      }
      if (snapshot.fallbackReason !== undefined) {
        request.fallbackReason = snapshot.fallbackReason;
      }
      if (snapshot.stationBodySources !== undefined) {
        request.stationBodySources = snapshot.stationBodySources;
      }
      await client.createStationRunQueueSnapshot(request);
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
