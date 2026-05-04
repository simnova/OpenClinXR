import type { ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import type { BlueprintScenarioReadiness, ExamBlueprint, ExamStationRunQueue, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { routeById } from "@openclinxr/rest";

export type AdminControlPlaneClientOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type AdminControlPlaneClient = {
  getStep2CsSeedBlueprint(): Promise<ExamBlueprint>;
  getStep2CsSeedBlueprintReadiness(): Promise<BlueprintScenarioReadiness>;
  getStep2CsSeedTimingPlan(): Promise<ExamTimingPlan>;
  getStep2CsSeedStationRunQueue(): Promise<ExamStationRunQueue>;
  listStep2CsSeedStationRunQueueSnapshots(): Promise<AdminStationRunQueueSnapshot[]>;
  createStep2CsSeedStationRunQueueSnapshot(input: CreateStationRunQueueSnapshotInput): Promise<AdminStationRunQueueSnapshot>;
  getScenarioBankAssetReadiness(): Promise<ScenarioAssetReadiness[]>;
};

export type CreateStationRunQueueSnapshotInput = {
  snapshotId?: string;
  createdAt?: string;
  reviewerId?: string;
};

export type AdminStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};

export const defaultAdminApiBaseUrl = import.meta.env.VITE_OPENCLINXR_API_BASE_URL ?? "";

export function createAdminControlPlaneClient(options: AdminControlPlaneClientOptions = {}): AdminControlPlaneClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultAdminApiBaseUrl);
  const fetcher = options.fetch ?? fetch;

  return {
    getStep2CsSeedBlueprint: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint").path),
    getStep2CsSeedBlueprintReadiness: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint-readiness").path),
    getStep2CsSeedTimingPlan: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-timing-plan").path),
    getStep2CsSeedStationRunQueue: () => get(fetcher, baseUrl, routeById("step2cs-seed-station-run-queue").path),
    listStep2CsSeedStationRunQueueSnapshots: async () => {
      const data = await graphql<{ stationRunQueueSnapshots: AdminStationRunQueueSnapshot[] }>(
        fetcher,
        baseUrl,
        "StationRunQueueSnapshots",
        stationRunQueueSnapshotsQuery,
        { blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1" },
      );
      return data.stationRunQueueSnapshots;
    },
    createStep2CsSeedStationRunQueueSnapshot: async (input) => {
      const data = await graphql<{ createStationRunQueueSnapshot: AdminStationRunQueueSnapshot }>(
        fetcher,
        baseUrl,
        "CreateStationRunQueueSnapshot",
        createStationRunQueueSnapshotMutation,
        { input },
      );
      return data.createStationRunQueueSnapshot;
    },
    getScenarioBankAssetReadiness: () => get(fetcher, baseUrl, routeById("scenario-bank-asset-readiness").path),
  };
}

async function get<TResponse>(fetcher: typeof fetch, baseUrl: string, path: string): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, { method: "GET" });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: GET ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function graphql<TData>(
  fetcher: typeof fetch,
  baseUrl: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const url = `${baseUrl}${routeById("admin-graphql-execute").path}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, operationName, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  const body = await response.json() as { data?: TData; errors?: Array<{ message?: string }> };
  if (body.errors?.length) {
    const message = body.errors.map((error) => error.message ?? "unknown_graphql_error").join("; ");
    throw new Error(`OpenClinXR admin GraphQL request failed: ${operationName} ${message}`);
  }
  if (!body.data) {
    throw new Error(`OpenClinXR admin GraphQL request failed: ${operationName} missing_data`);
  }

  return body.data;
}

const queueSnapshotSelection = `
  snapshotId
  createdAt
  reviewerId
  queue {
    blueprintId
    canStartLearnerExam
    breakCheckpoints {
      afterStationOrder
      atSecond
    }
    totalStationTimeSeconds
    summary {
      activationReady
      draftBlocked
      governanceBlocked
      missingScenario
    }
    stationQueue {
      stationOrder
      slotId
      label
      scenarioId
      scenarioVersion
      status
      blockers
      timing {
        stationOrder
        slotId
        label
        doorway {
          startsAtSecond
          endsAtSecond
          durationSeconds
        }
        encounter {
          startsAtSecond
          endsAtSecond
          durationSeconds
        }
        note {
          startsAtSecond
          endsAtSecond
          durationSeconds
        }
      }
    }
  }
`;

const stationRunQueueSnapshotsQuery = `
  query StationRunQueueSnapshots($blueprintId: ID!) {
    stationRunQueueSnapshots(blueprintId: $blueprintId) {
      ${queueSnapshotSelection}
    }
  }
`;

const createStationRunQueueSnapshotMutation = `
  mutation CreateStationRunQueueSnapshot($input: CreateStationRunQueueSnapshotInput!) {
    createStationRunQueueSnapshot(input: $input) {
      ${queueSnapshotSelection}
    }
  }
`;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
