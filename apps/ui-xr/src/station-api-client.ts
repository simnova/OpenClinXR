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
};

export function createStationApiClient(options: StationApiClientOptions): AssembledStationApiClient {
  const client = createBaseStationApiClient(options);
  return {
    ...client,
    startSession: (input) => client.startSession(input as StartSessionRequest),
  };
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
