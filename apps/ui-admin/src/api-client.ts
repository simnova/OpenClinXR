import type { ApolloClient } from "@apollo/client";
import type {
  EncounterDynamicBehaviorCoverageSummary,
  EncounterFactoryDryRunSummary,
  EncounterFactoryInputPlanningSummary,
  EnvironmentGenerationQueue,
  EnvironmentGenerationWorkOrderQueue,
  ScenarioAssetReadiness,
  ScenarioSceneGenerationPipelineWorkOrderQueue,
} from "@openclinxr/asset-registry";
import type { BlueprintScenarioReadiness, ExamBlueprint, ExamStationRunQueue, ExamTimingPlan } from "@openclinxr/exam-assembly";
import {
  CreateStationRunQueueSnapshotDocument,
  type CreateStationRunQueueSnapshotMutation,
  type CreateStationRunQueueSnapshotMutationVariables,
  ReviewPacketReplayDocument,
  type ReviewPacketReplayQuery,
  type ReviewPacketReplayQueryVariables,
  SaveFacultyScoreDraftDocument,
  type SaveFacultyScoreDraftMutation,
  type SaveFacultyScoreDraftMutationVariables,
  ScenarioBankDocument,
  type ScenarioBankQuery,
  type ScenarioBankQueryVariables,
  ScenarioDetailDocument,
  type ScenarioDetailQuery,
  type ScenarioDetailQueryVariables,
  ScenarioReviewDecisionsDocument,
  type ScenarioReviewDecisionsQuery,
  type ScenarioReviewDecisionsQueryVariables,
  type ScenarioStatus,
  StationRunQueueSnapshotsDocument,
  type StationRunQueueSnapshotsQuery,
  type StationRunQueueSnapshotsQueryVariables,
  SubmitScenarioReviewDocument,
  type SubmitScenarioReviewMutation,
  type SubmitScenarioReviewMutationVariables,
} from "@openclinxr/graphql/client";
import { buildSessionRoutePath, routeById } from "@openclinxr/rest";
import type { Scenario } from "@openclinxr/shared-schemas";
import { print } from "graphql";

import type {
  AdminApolloGraphqlClient,
  AdminNoReadinessEvidenceClaim,
  AdminControlPlaneClientOptions,
  AdminControlPlaneClient,
  ListScenariosInput,
  GetScenarioDetailInput,
  ListScenarioReviewDecisionsInput,
  GetReviewPacketReplayInput,
  CreateLocalReviewReplaySeedInput,
  CreateLocalReviewReplaySeedResult,
  CreateStationRunQueueSnapshotInput,
  GetScenarioPublicationReadinessInput,
  AdminScenarioPublicationReadiness,
  AdminDynamicEncounterFactoryPlanningProjection,
  CreateScenarioSceneGenerationRequestInput,
  CreateScenarioSceneGenerationRequestResult,
  ScenarioReviewApprovalBoundary,
  ScenarioReviewGateSummary,
  HumanReviewActionSummary,
  SubmitScenarioSceneGenerationRequestReviewInput,
  SubmitScenarioSceneGenerationMaterializationInputReviewInput,
  ScenarioSceneGenerationRequestQueue,
  EncounterMaterializationInputManifestSummary,
  EncounterMaterializationAttachmentPlanSummary,
  EncounterMaterializationEvidenceAttachmentSummary,
  EncounterMaterializationInputReviewActionPacket,
  EncounterMaterializationInputReviewDecision,
  EncounterMaterializationInputReviewDecisionRecord,
  RuntimeRealismEvidenceInputReviewDecision,
  SubmitRuntimeRealismEvidenceInputReviewInput,
  RuntimeRealismEvidenceInputReviewDecisionRecord,
  RuntimeVisualEvidenceAttachmentSummary,
  RuntimeVisualEvidenceAttachment,
  SubmitRuntimeVisualEvidenceAttachmentInput,
  RuntimeVisualEvidenceAttachmentRecord,
  RuntimeVisualEvidenceAttachmentActionPacket,
  RuntimeEvidenceCaptureScaffold,
  ScenarioSceneGenerationRequestPublicationReadiness,
  AdminRuntimeProviderPlaneReadiness,
  AdminRuntimeProviderReadinessSurface,
  AdminRuntimeProviderReadiness,
  AdminPedsHumanoidMaterializationHandoff,
  AdminRuntimeSelectionReviewPacket,
  AdminScenarioBankMaturityReport,
  AdminScenarioBankExamSequenceProjection,
  AdminReviewReplayRuntimeEvidenceGateRef,
  AdminReviewReplayGeneratedBundlePosture,
  AdminReviewReplayEvidenceHandoff,
  AdminRuntimeVisualEvidenceReplayProjection,
  AdminAssetReleaseLadderReplayProjection,
  AdminReviewReplayProviderDisabledRemediation,
  AdminCaseDefinedHumanoidPerformanceContract,
  AdminCaseDefinedHumanoidRuntimeHandoff,
  AdminReviewReplayReadinessSummary,
  AdminReviewPacketReplay,
  AdminRuntimeProtocolSupport,
  AdminRuntimeProtocolPosture,
  AdminRealtimeVoicePosture,
  SubmitScenarioReviewInput,
  SaveFacultyScoreDraftInput,
  AdminFacultyScoreDraft,
  AdminFacultyScoreDraftRecord,
  PersistFacultyScoreDraftInput,
  SaveFacultyReviewDecisionInput,
  AdminFacultyReviewDecisionRecord,
  AdminScenario,
  AdminScenarioDetail,
  AdminScenarioReviewDecision,
  AdminScenarioReviewResult,
  AdminReviewPacket,
  AdminStationRunQueueSnapshot,
} from "./api-client-types.js";
import type { FacultyCompileLockClient } from "./faculty-compile-lock-types.js";
export * from "./api-client-types.js";

export const defaultAdminApiBaseUrl = import.meta.env['VITE_OPENCLINXR_API_BASE_URL'] ?? "";

const stationRunQueueSnapshotsDocument = print(StationRunQueueSnapshotsDocument);
const createStationRunQueueSnapshotDocument = print(CreateStationRunQueueSnapshotDocument);
const scenarioBankDocument = print(ScenarioBankDocument);
const scenarioDetailDocument = print(ScenarioDetailDocument);
const scenarioReviewDecisionsDocument = print(ScenarioReviewDecisionsDocument);
const reviewPacketReplayDocument = print(ReviewPacketReplayDocument);
const submitScenarioReviewDocument = print(SubmitScenarioReviewDocument);
const saveFacultyScoreDraftDocument = print(SaveFacultyScoreDraftDocument);

export function buildAdminGraphqlEndpoint(baseUrl: string = defaultAdminApiBaseUrl): string {
  return `${normalizeBaseUrl(baseUrl)}${routeById("admin-graphql-execute").path}`;
}

export function createAdminControlPlaneClient(options: AdminControlPlaneClientOptions = {}): AdminControlPlaneClient & FacultyCompileLockClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultAdminApiBaseUrl);
  const fetcher = options.fetch ?? fetch;
  const apolloClient = options.apolloClient;
  const authHeaders = () => resolveAuthorizationHeaders(options);

  return {
    getStep2CsSeedBlueprint: async () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint").path, await authHeaders()),
    getStep2CsSeedBlueprintReadiness: async () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint-readiness").path, await authHeaders()),
    getStep2CsSeedTimingPlan: async () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-timing-plan").path, await authHeaders()),
    getStep2CsSeedStationRunQueue: async () => get(fetcher, baseUrl, routeById("step2cs-seed-station-run-queue").path, await authHeaders()),
    getRuntimeProviderReadiness: async () => get(fetcher, baseUrl, routeById("runtime-provider-readiness").path, await authHeaders()),
    getRuntimeSelectionReviewPacket: async () => get(fetcher, baseUrl, routeById("runtime-selection-review-packet").path, await authHeaders()),
    getRuntimeProtocolPosture: async () => get(fetcher, baseUrl, routeById("runtime-protocols").path, await authHeaders()),
    getRealtimeVoicePosture: async () => get(fetcher, baseUrl, routeById("realtime-voice-posture").path, await authHeaders()),
    createLocalReviewReplaySeed: async (input = {}) => {
      const headers = await authHeaders();
      const session = await post<CreateLocalReviewReplaySeedResult>(
        fetcher,
        baseUrl,
        routeById("start-session").path,
        {
          learnerId: input.learnerId ?? "admin_review_seed",
          consentAccepted: true,
        },
        headers,
      );
      const stationRunId = requireStringField(session, "stationRunId", `POST ${baseUrl}${routeById("start-session").path}`);
      await post(fetcher, baseUrl, buildSessionRoutePath("start-encounter", stationRunId), { atSecond: 60 }, headers);
      await post(fetcher, baseUrl, buildSessionRoutePath("append-trace-event", stationRunId), {
        eventType: "learner.action",
        atSecond: 83,
        tag: "ecg_request",
        actorId: "patient_robert_hayes_v1",
      }, headers);
      await post(fetcher, baseUrl, buildSessionRoutePath("append-trace-event", stationRunId), {
        eventType: "learner.action",
        atSecond: 140,
        tag: "urgent_escalation",
        actorId: "nurse_amelia_singh_v1",
      }, headers);
      await post(fetcher, baseUrl, buildSessionRoutePath("append-trace-event", stationRunId), {
        eventType: "learner.action",
        atSecond: 190,
        tag: "team_communication",
        actorId: "spouse_linda_hayes_v1",
      }, headers);
      await post(fetcher, baseUrl, buildSessionRoutePath("submit-note", stationRunId), {
        atSecond: 960,
        text: "Chest pain requires urgent ECG escalation and team communication follow-up.",
      }, headers);

      return { stationRunId };
    },
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
        await authHeaders(),
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
        await authHeaders(),
      );
    },
    listScenarioReviewDecisions: async (input) => {
      const variables: ScenarioReviewDecisionsQueryVariables = {
        scenarioId: input.scenarioId,
        version: input.version,
      };
      if (apolloClient) {
        const { data } = await apolloClient.query<ScenarioReviewDecisionsQuery, ScenarioReviewDecisionsQueryVariables>({
          query: ScenarioReviewDecisionsDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ScenarioReviewDecisions missing_data");
        }
        return data.scenarioReviewDecisions;
      }

      const data = await graphql<ScenarioReviewDecisionsQuery>(
        fetcher,
        baseUrl,
        "ScenarioReviewDecisions",
        scenarioReviewDecisionsDocument,
        variables,
        await authHeaders(),
      );
      return data.scenarioReviewDecisions;
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
        return data as unknown as AdminReviewPacketReplay;
      }

      return graphql<ReviewPacketReplayQuery>(
        fetcher,
        baseUrl,
        "ReviewPacketReplay",
        reviewPacketReplayDocument,
        variables,
        await authHeaders(),
      ) as unknown as AdminReviewPacketReplay;
    },
    getReviewReplayReadinessSummary: async (input) =>
      get(fetcher, baseUrl, buildSessionRoutePath("review-replay-readiness-summary", input.stationRunId), await authHeaders()),
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
        await authHeaders(),
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
        await authHeaders(),
      );
      return data.saveFacultyScoreDraft;
    },
    persistFacultyScoreDraft: async (input) => {
      const { stationRunId, ...body } = input;
      return post(
        fetcher,
        baseUrl,
        buildSessionRoutePath("save-faculty-score-draft", stationRunId),
        {
          reviewerId: body.reviewerId,
          comments: body.comments,
          ...(body.rubricScores ? { rubricScores: { ...body.rubricScores } } : {}),
        },
        await authHeaders(),
      );
    },
    saveFacultyReviewDecision: async (input) => {
      const { stationRunId, ...body } = input;
      return post(
        fetcher,
        baseUrl,
        buildSessionRoutePath("save-faculty-review-decision", stationRunId),
        {
          reviewerId: body.reviewerId,
          ...(typeof body.comments === "string" ? { comments: body.comments } : {}),
          ...(body.rubricScores ? { rubricScores: { ...body.rubricScores } } : {}),
          ...(body.localDecision ? { localDecision: body.localDecision } : {}),
          ...(typeof body.hasDurableSummary === "boolean" ? { hasDurableSummary: body.hasDurableSummary } : {}),
          ...(typeof body.durableSummaryIsSafe === "boolean" ? { durableSummaryIsSafe: body.durableSummaryIsSafe } : {}),
          ...(typeof body.traceEventCount === "number" ? { traceEventCount: body.traceEventCount } : {}),
          ...(body.safetyFlagLabels ? { safetyFlagLabels: [...body.safetyFlagLabels] } : {}),
        },
        await authHeaders(),
      );
    },
    persistFacultyCompileLock: async (input) =>
      post(
        fetcher,
        baseUrl,
        routeById("save-faculty-compile-lock").path,
        {
          scenarioId: input.scenarioId,
          nodeId: input.nodeId,
          locked: input.locked,
          ...(input.overridePath === undefined ? {} : { overridePath: input.overridePath }),
          ...(input.overrideValue === undefined ? {} : { overrideValue: input.overrideValue }),
        },
        await authHeaders(),
      ),
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
        await authHeaders(),
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
        await authHeaders(),
      );
      return data.createStationRunQueueSnapshot;
    },
    getEdChestPainPublicationReadiness: async (input) =>
      post(fetcher, baseUrl, routeById("scenario-publication-readiness").path, input, await authHeaders()),
    getScenarioBankMaturity: async () => get(fetcher, baseUrl, routeById("scenario-bank-maturity").path, await authHeaders()),
    getScenarioBankExamSequence: async () => get(fetcher, baseUrl, routeById("scenario-bank-exam-sequence").path, await authHeaders()),
    getDynamicEncounterFactoryPlanning: async () =>
      get(fetcher, baseUrl, routeById("scenario-bank-dynamic-encounter-factory-planning").path, await authHeaders()),
    getScenarioBankAssetReadiness: async () => get(fetcher, baseUrl, routeById("scenario-bank-asset-readiness").path, await authHeaders()),
    getScenarioBankEnvironmentGenerationQueue: async () =>
      get(fetcher, baseUrl, routeById("scenario-bank-environment-generation-queue").path, await authHeaders()),
    getScenarioBankEnvironmentWorkOrderQueue: async () =>
      get(fetcher, baseUrl, routeById("scenario-bank-environment-work-order-queue").path, await authHeaders()),
    getScenarioBankSceneGenerationPipelineQueue: async () =>
      get(fetcher, baseUrl, routeById("scenario-bank-scene-generation-pipeline").path, await authHeaders()),
    listScenarioSceneGenerationRequests: async () =>
      get(fetcher, baseUrl, routeById("list-scenario-scene-generation-requests").path, await authHeaders()),
    createScenarioSceneGenerationRequest: async (input) =>
      post(fetcher, baseUrl, routeById("create-scenario-scene-generation-request").path, { scenarioId: input.scenarioId }, await authHeaders()),
    submitScenarioSceneGenerationRequestReview: async (input) =>
      post(
        fetcher,
        baseUrl,
        routeById("submit-scenario-scene-generation-request-review").path.replace(":requestId", encodeURIComponent(input.requestId)),
        { decisions: input.decisions },
        await authHeaders(),
      ),
    submitScenarioSceneGenerationMaterializationInputReview: async (input) =>
      post(
        fetcher,
        baseUrl,
        routeById("submit-scenario-scene-generation-materialization-input-review").path.replace(":requestId", encodeURIComponent(input.requestId)),
        { decisions: input.decisions },
        await authHeaders(),
      ),
    submitRuntimeRealismEvidenceInputReview: async (input) =>
      post(
        fetcher,
        baseUrl,
        routeById("submit-runtime-realism-evidence-input-review").path,
        { scenarioId: input.scenarioId, decisions: input.decisions },
        await authHeaders(),
      ),
    submitRuntimeVisualEvidenceAttachment: async (input) =>
      post(
        fetcher,
        baseUrl,
        routeById("submit-runtime-visual-evidence-attachment").path,
        { scenarioId: input.scenarioId, attachments: input.attachments },
        await authHeaders(),
      ),
    getScenarioSceneGenerationRequestPublicationReadiness: async (input) =>
      get(
        fetcher,
        baseUrl,
        routeById("scenario-scene-generation-request-publication-readiness").path.replace(":requestId", encodeURIComponent(input.requestId)),
        await authHeaders(),
      ),
    saveAuthoredScenario: async (scenario) =>
      post(fetcher, baseUrl, routeById("save-authored-scenario").path, { scenario }, await authHeaders()),
    listAuthoredScenarios: async () => get(fetcher, baseUrl, routeById("list-authored-scenarios").path, await authHeaders()),
    getAuthoredScenario: async (scenarioId) =>
      get(
        fetcher,
        baseUrl,
        routeById("get-authored-scenario").path.replace(":scenarioId", encodeURIComponent(scenarioId)),
        await authHeaders(),
      ),
  };
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
    cache: "no-store",
    ...(Object.keys(authHeaders).length > 0 ? { headers: authHeaders } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody['error'] === "string" ? errorBody['error'] : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: GET ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function post<TResponse = unknown>(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
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
    const errorCode = isRecord(errorBody) && typeof errorBody['error'] === "string" ? errorBody['error'] : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function graphql<TData>(
  fetcher: typeof fetch,
  baseUrl: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  authHeaders: Record<string, string> = {},
): Promise<TData> {
  const url = buildAdminGraphqlEndpoint(baseUrl);
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({ query, operationName, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody['error'] === "string" ? errorBody['error'] : "unknown_error";
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

async function resolveAuthorizationHeaders(
  options: Pick<AdminControlPlaneClientOptions, "accessToken" | "getAccessToken">,
): Promise<Record<string, string>> {
  const token = options.getAccessToken ? await options.getAccessToken() : options.accessToken;
  if (typeof token === "string" && token.trim().length > 0) {
    return { authorization: `Bearer ${token.trim()}` };
  }
  return {};
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringField(value: unknown, fieldName: string, context: string): string {
  if (isRecord(value) && typeof value[fieldName] === "string" && value[fieldName].trim().length > 0) {
    return value[fieldName];
  }

  throw new Error(`OpenClinXR admin API request failed: ${context} missing ${fieldName}`);
}

