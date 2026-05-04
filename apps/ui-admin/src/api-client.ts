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
    createStep2CsSeedStationRunQueueSnapshot: (input) => post(fetcher, baseUrl, routeById("create-step2cs-seed-station-run-queue-snapshot").path, input),
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

async function post<TResponse>(fetcher: typeof fetch, baseUrl: string, path: string, body: unknown): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
