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
  /** Optional bearer token for API AuthN (local JWT). */
  authToken?: string;
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
  const authToken = options.authToken;

  return {
    listLearnerRuntimeAssetBundles: () => get(fetcher, baseUrl, "/runtime/asset-bundles", authToken),
    findLearnerRuntimeAssetBundleByScenarioStation: async (input) => {
      const response = await get<LearnerRuntimeAssetBundleListResponse>(fetcher, baseUrl, "/runtime/asset-bundles", authToken);
      return response.bundles.find((bundle) =>
        bundle.scenarioId === input.scenarioId
          && (input.stationId === undefined || input.stationId === null || bundle.stationId === input.stationId),
      ) ?? null;
    },
    getLearnerRuntimeAssetBundle: (bundleId) => get(fetcher, baseUrl, `/runtime/asset-bundles/${encodeURIComponent(bundleId)}`, authToken),
    startSession: (input) => request(fetcher, baseUrl, "/sessions", input, authToken),
    startEncounter: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/start-encounter`, input, authToken),
    recordTraceAction: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/events`, input, authToken),
    requestActorResponse: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/actor-response`, input, authToken),
    synthesizeActorSpeech: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/voice-synthesis`, input, authToken),
    submitNote: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/note`, input, authToken),
    listTraceEvents: (stationRunId) => get(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/trace-events`, authToken),
  };
}

function buildHeaders(authToken: string | undefined, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["content-type"] = contentType;
  }
  if (authToken) {
    headers["authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

async function request<TResponse>(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  body: unknown,
  authToken?: string,
): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: buildHeaders(authToken, "application/json"),
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
  authToken?: string,
): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "GET",
    headers: buildHeaders(authToken),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR API request failed: GET ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
