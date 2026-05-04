import type { ApolloClient } from "@apollo/client";
import type { ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import type { BlueprintScenarioReadiness, ExamBlueprint, ExamStationRunQueue, ExamTimingPlan } from "@openclinxr/exam-assembly";
import {
  CreateStationRunQueueSnapshotDocument,
  ReviewPacketReplayDocument,
  SaveFacultyScoreDraftDocument,
  ScenarioBankDocument,
  ScenarioDetailDocument,
  StationRunQueueSnapshotsDocument,
  SubmitScenarioReviewDocument,
  type CreateStationRunQueueSnapshotMutation,
  type CreateStationRunQueueSnapshotMutationVariables,
  type ReviewPacketReplayQuery,
  type ReviewPacketReplayQueryVariables,
  type SaveFacultyScoreDraftMutation,
  type SaveFacultyScoreDraftMutationVariables,
  type ScenarioBankQuery,
  type ScenarioBankQueryVariables,
  type ScenarioDetailQuery,
  type ScenarioDetailQueryVariables,
  type ScenarioStatus,
  type StationRunQueueSnapshotsQuery,
  type StationRunQueueSnapshotsQueryVariables,
  type SubmitScenarioReviewMutation,
  type SubmitScenarioReviewMutationVariables,
} from "@openclinxr/graphql/client";
import { routeById } from "@openclinxr/rest";
import { print } from "graphql";

export type AdminApolloGraphqlClient = Pick<ApolloClient, "mutate" | "query">;

export type {
  BlueprintScenarioReadiness,
  ExamBlueprint,
  ExamStationRunQueue,
  ExamTimingPlan,
  ScenarioAssetReadiness,
};

export type AdminControlPlaneClientOptions = {
  apolloClient?: AdminApolloGraphqlClient;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type AdminControlPlaneClient = {
  getStep2CsSeedBlueprint(): Promise<ExamBlueprint>;
  getStep2CsSeedBlueprintReadiness(): Promise<BlueprintScenarioReadiness>;
  getStep2CsSeedTimingPlan(): Promise<ExamTimingPlan>;
  getStep2CsSeedStationRunQueue(): Promise<ExamStationRunQueue>;
  listScenarios(input?: ListScenariosInput): Promise<AdminScenario[]>;
  getScenarioDetail(input: GetScenarioDetailInput): Promise<AdminScenarioDetail>;
  getReviewPacketReplay(input: GetReviewPacketReplayInput): Promise<AdminReviewPacketReplay>;
  submitScenarioReview(input: SubmitScenarioReviewInput): Promise<AdminScenarioReviewResult>;
  saveFacultyScoreDraft(input: SaveFacultyScoreDraftInput): Promise<AdminReviewPacket>;
  listStep2CsSeedStationRunQueueSnapshots(): Promise<AdminStationRunQueueSnapshot[]>;
  createStep2CsSeedStationRunQueueSnapshot(input: CreateStationRunQueueSnapshotInput): Promise<AdminStationRunQueueSnapshot>;
  getScenarioBankAssetReadiness(): Promise<ScenarioAssetReadiness[]>;
};

export type ListScenariosInput = {
  status?: ScenarioStatus;
};

export type GetScenarioDetailInput = {
  scenarioId: string;
  version: number;
};

export type GetReviewPacketReplayInput = {
  stationRunId: string;
};

export type CreateStationRunQueueSnapshotInput = {
  snapshotId?: string;
  createdAt?: string;
  reviewerId?: string;
};

export type SubmitScenarioReviewInput = SubmitScenarioReviewMutationVariables["input"];
export type SaveFacultyScoreDraftInput = SaveFacultyScoreDraftMutationVariables["input"];

export type AdminScenario = ScenarioBankQuery["scenarios"][number];
export type AdminScenarioDetail = ScenarioDetailQuery;
export type AdminReviewPacketReplay = ReviewPacketReplayQuery;
export type AdminScenarioReviewResult = SubmitScenarioReviewMutation["submitScenarioReview"];
export type AdminReviewPacket = SaveFacultyScoreDraftMutation["saveFacultyScoreDraft"];
export type AdminStationRunQueueSnapshot = StationRunQueueSnapshotsQuery["stationRunQueueSnapshots"][number];

export const defaultAdminApiBaseUrl = import.meta.env.VITE_OPENCLINXR_API_BASE_URL ?? "";

const stationRunQueueSnapshotsDocument = print(StationRunQueueSnapshotsDocument);
const createStationRunQueueSnapshotDocument = print(CreateStationRunQueueSnapshotDocument);
const scenarioBankDocument = print(ScenarioBankDocument);
const scenarioDetailDocument = print(ScenarioDetailDocument);
const reviewPacketReplayDocument = print(ReviewPacketReplayDocument);
const submitScenarioReviewDocument = print(SubmitScenarioReviewDocument);
const saveFacultyScoreDraftDocument = print(SaveFacultyScoreDraftDocument);

export function buildAdminGraphqlEndpoint(baseUrl: string = defaultAdminApiBaseUrl): string {
  return `${normalizeBaseUrl(baseUrl)}${routeById("admin-graphql-execute").path}`;
}

export function createAdminControlPlaneClient(options: AdminControlPlaneClientOptions = {}): AdminControlPlaneClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultAdminApiBaseUrl);
  const fetcher = options.fetch ?? fetch;
  const apolloClient = options.apolloClient;

  return {
    getStep2CsSeedBlueprint: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint").path),
    getStep2CsSeedBlueprintReadiness: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint-readiness").path),
    getStep2CsSeedTimingPlan: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-timing-plan").path),
    getStep2CsSeedStationRunQueue: () => get(fetcher, baseUrl, routeById("step2cs-seed-station-run-queue").path),
    listScenarios: async (input = {}) => {
      const variables: ScenarioBankQueryVariables = input.status ? { status: input.status } : {};
      if (apolloClient) {
        const { data } = await apolloClient.query<ScenarioBankQuery, ScenarioBankQueryVariables>({
          query: ScenarioBankDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ScenarioBank missing_data");
        }
        return data.scenarios;
      }

      const data = await graphql<ScenarioBankQuery>(
        fetcher,
        baseUrl,
        "ScenarioBank",
        scenarioBankDocument,
        variables,
      );
      return data.scenarios;
    },
    getScenarioDetail: async (input) => {
      const variables: ScenarioDetailQueryVariables = {
        scenarioId: input.scenarioId,
        version: input.version,
      };
      if (apolloClient) {
        const { data } = await apolloClient.query<ScenarioDetailQuery, ScenarioDetailQueryVariables>({
          query: ScenarioDetailDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ScenarioDetail missing_data");
        }
        return data;
      }

      return graphql<ScenarioDetailQuery>(
        fetcher,
        baseUrl,
        "ScenarioDetail",
        scenarioDetailDocument,
        variables,
      );
    },
    getReviewPacketReplay: async (input) => {
      const variables: ReviewPacketReplayQueryVariables = {
        stationRunId: input.stationRunId,
      };
      if (apolloClient) {
        const { data } = await apolloClient.query<ReviewPacketReplayQuery, ReviewPacketReplayQueryVariables>({
          query: ReviewPacketReplayDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ReviewPacketReplay missing_data");
        }
        return data;
      }

      return graphql<ReviewPacketReplayQuery>(
        fetcher,
        baseUrl,
        "ReviewPacketReplay",
        reviewPacketReplayDocument,
        variables,
      );
    },
    submitScenarioReview: async (input) => {
      if (apolloClient) {
        const { data } = await apolloClient.mutate<SubmitScenarioReviewMutation, SubmitScenarioReviewMutationVariables>({
          mutation: SubmitScenarioReviewDocument,
          variables: { input },
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: SubmitScenarioReview missing_data");
        }
        return data.submitScenarioReview;
      }

      const data = await graphql<SubmitScenarioReviewMutation>(
        fetcher,
        baseUrl,
        "SubmitScenarioReview",
        submitScenarioReviewDocument,
        { input },
      );
      return data.submitScenarioReview;
    },
    saveFacultyScoreDraft: async (input) => {
      if (apolloClient) {
        const { data } = await apolloClient.mutate<SaveFacultyScoreDraftMutation, SaveFacultyScoreDraftMutationVariables>({
          mutation: SaveFacultyScoreDraftDocument,
          variables: { input },
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: SaveFacultyScoreDraft missing_data");
        }
        return data.saveFacultyScoreDraft;
      }

      const data = await graphql<SaveFacultyScoreDraftMutation>(
        fetcher,
        baseUrl,
        "SaveFacultyScoreDraft",
        saveFacultyScoreDraftDocument,
        { input },
      );
      return data.saveFacultyScoreDraft;
    },
    listStep2CsSeedStationRunQueueSnapshots: async () => {
      if (apolloClient) {
        const { data } = await apolloClient.query<StationRunQueueSnapshotsQuery, StationRunQueueSnapshotsQueryVariables>({
          query: StationRunQueueSnapshotsDocument,
          variables: { blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1" },
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: StationRunQueueSnapshots missing_data");
        }
        return data.stationRunQueueSnapshots;
      }

      const data = await graphql<StationRunQueueSnapshotsQuery>(
        fetcher,
        baseUrl,
        "StationRunQueueSnapshots",
        stationRunQueueSnapshotsDocument,
        { blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1" },
      );
      return data.stationRunQueueSnapshots;
    },
    createStep2CsSeedStationRunQueueSnapshot: async (input) => {
      if (apolloClient) {
        const { data } = await apolloClient.mutate<CreateStationRunQueueSnapshotMutation, CreateStationRunQueueSnapshotMutationVariables>({
          mutation: CreateStationRunQueueSnapshotDocument,
          variables: { input },
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: CreateStationRunQueueSnapshot missing_data");
        }
        return data.createStationRunQueueSnapshot;
      }

      const data = await graphql<CreateStationRunQueueSnapshotMutation>(
        fetcher,
        baseUrl,
        "CreateStationRunQueueSnapshot",
        createStationRunQueueSnapshotDocument,
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
  const url = buildAdminGraphqlEndpoint(baseUrl);
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
