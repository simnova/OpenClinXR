/**
 * Station API client surface for assembled-station session start.
 * Wraps api-client so startSession can carry validated assembled identity
 * without widening the standalone request type used by existing tests.
 */

import type { ExamFormRunState } from "@openclinxr/exam-assembly";
import {
  createStationApiClient as createBaseStationApiClient,
  createStationApiPersistenceSink,
  type RuntimeSessionSummary,
  type StartSessionRequest,
  type StationApiClient,
  type StationApiClientOptions,
} from "./api-client.js";

export {
  createStationApiPersistenceSink,
  type RuntimeSessionSummary,
  type StationApiClient,
  type StationApiClientOptions,
};

export type AssembledStationFormWindow = {
  startsAtSecond: number;
  endsAtSecond: number;
};

export type AssembledStationContextPayload = {
  examRunId: string;
  scenarioId: string;
  stationOrder: number;
  formTiming: {
    doorway?: AssembledStationFormWindow;
    encounter: AssembledStationFormWindow;
    note: AssembledStationFormWindow;
  };
};

export type AssembledStartSessionRequest = StartSessionRequest & {
  scenarioId?: string;
  assembledStation?: AssembledStationContextPayload;
};

export type AssembledStationApiClient = Omit<StationApiClient, "startSession"> & {
  startSession(input: AssembledStartSessionRequest): Promise<RuntimeSessionSummary>;
  endEncounter(stationRunId: string, input: { atSecond: number }): Promise<RuntimeSessionSummary>;
  startNote(stationRunId: string, input: { atSecond: number }): Promise<RuntimeSessionSummary>;
};

export function createStationApiClient(options: StationApiClientOptions): AssembledStationApiClient {
  const client = createBaseStationApiClient(options);
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const url = `${baseUrl}${path}`;
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`OpenClinXR API request failed: POST ${url} ${response.status}`);
    }
    return response.json() as Promise<T>;
  };
  return {
    ...client,
    startSession: (input) => client.startSession(input as StartSessionRequest),
    endEncounter: (stationRunId, input) =>
      post(`/sessions/${encodeURIComponent(stationRunId)}/end-encounter`, input),
    startNote: (stationRunId, input) =>
      post(`/sessions/${encodeURIComponent(stationRunId)}/start-note`, input),
  };
}

export async function syncRemoteAssembledPhase(input: {
  client: AssembledStationApiClient | undefined;
  stationRunId: string | undefined;
  kind: "end_encounter" | "submit_note" | "encounter_timer_elapsed" | "note_timer_elapsed";
  atSecond: number;
  noteText: string;
}): Promise<void> {
  if (!input.client || !input.stationRunId) {
    return;
  }
  try {
    if (input.kind === "end_encounter" || input.kind === "encounter_timer_elapsed") {
      await input.client.endEncounter(input.stationRunId, { atSecond: input.atSecond });
      return;
    }
    await input.client.startNote(input.stationRunId, { atSecond: input.atSecond }).catch(() => undefined);
    await input.client.submitNote(input.stationRunId, { atSecond: input.atSecond, text: input.noteText });
  } catch {
    return;
  }
}

export function buildAssembledStationStartSessionInput(input: {
  learnerId: string;
  scenarioId: string;
  examRun: ExamFormRunState | null;
}): AssembledStartSessionRequest {
  const request: AssembledStartSessionRequest = {
    learnerId: input.learnerId,
    consentAccepted: true,
    scenarioId: input.scenarioId,
  };
  const station = input.examRun?.queue.stationQueue.find((item) => item.scenarioId === input.scenarioId);
  if (
    !input.examRun
    || !station
    || typeof station.scenarioId !== "string"
    || station.scenarioId !== input.scenarioId
    || !Number.isInteger(station.stationOrder)
    || station.stationOrder < 1
  ) {
    return request;
  }
  request.assembledStation = {
    examRunId: input.examRun.examRunId,
    scenarioId: station.scenarioId,
    stationOrder: station.stationOrder,
    formTiming: {
      doorway: {
        startsAtSecond: station.timing.doorway.startsAtSecond,
        endsAtSecond: station.timing.doorway.endsAtSecond,
      },
      encounter: {
        startsAtSecond: station.timing.encounter.startsAtSecond,
        endsAtSecond: station.timing.encounter.endsAtSecond,
      },
      note: {
        startsAtSecond: station.timing.note.startsAtSecond,
        endsAtSecond: station.timing.note.endsAtSecond,
      },
    },
  };
  return request;
}
