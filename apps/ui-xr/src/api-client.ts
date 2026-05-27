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

  return {
    listLearnerRuntimeAssetBundles: () => get(fetcher, baseUrl, "/runtime/asset-bundles"),
    findLearnerRuntimeAssetBundleByScenarioStation: async (input) => {
      const response = await get<LearnerRuntimeAssetBundleListResponse>(fetcher, baseUrl, "/runtime/asset-bundles");
      return response.bundles.find((bundle) =>
        bundle.scenarioId === input.scenarioId
          && (input.stationId === undefined || input.stationId === null || bundle.stationId === input.stationId),
      ) ?? null;
    },
    getLearnerRuntimeAssetBundle: (bundleId) => get(fetcher, baseUrl, `/runtime/asset-bundles/${encodeURIComponent(bundleId)}`),
    startSession: (input) => request(fetcher, baseUrl, "/sessions", input),
    startEncounter: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/start-encounter`, input),
    recordTraceAction: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/events`, input),
    requestActorResponse: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/actor-response`, input),
    synthesizeActorSpeech: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/voice-synthesis`, input),
    submitNote: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/note`, input),
    listTraceEvents: (stationRunId) => get(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/trace-events`),
  };
}

async function request<TResponse>(fetcher: typeof fetch, baseUrl: string, path: string, body: unknown): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function get<TResponse>(fetcher: typeof fetch, baseUrl: string, path: string): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "GET",
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
