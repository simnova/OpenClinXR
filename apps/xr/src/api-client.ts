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

export type SubmitNoteRequest = {
  atSecond: number;
  text: string;
};

export type StationApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export type StationApiClient = {
  startSession(input: StartSessionRequest): Promise<RuntimeSessionSummary>;
  startEncounter(stationRunId: string, input: StartEncounterRequest): Promise<RuntimeSessionSummary>;
  recordTraceAction(stationRunId: string, input: TraceActionRequest): Promise<unknown>;
  requestActorResponse(stationRunId: string, input: ActorResponseRequest): Promise<unknown>;
  submitNote(stationRunId: string, input: SubmitNoteRequest): Promise<unknown>;
};

export function createStationApiClient(options: StationApiClientOptions): StationApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;

  return {
    startSession: (input) => request(fetcher, baseUrl, "/sessions", input),
    startEncounter: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/start-encounter`, input),
    recordTraceAction: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/events`, input),
    requestActorResponse: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/actor-response`, input),
    submitNote: (stationRunId, input) => request(fetcher, baseUrl, `/sessions/${encodeURIComponent(stationRunId)}/note`, input),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
