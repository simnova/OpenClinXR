import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildEncounterDynamicBehaviorCoverageSummary,
  buildEncounterFactorySummaryContracts,
  buildEncounterRuntimeBundlePublicationMetadata,
  buildEnvironmentGenerationQueue,
  buildEnvironmentGenerationWorkOrderQueue,
  buildGuardedRuntimeSelectorDisabledDecision,
  buildScenarioSceneGenerationPipelineWorkOrderQueue,
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  createScenarioPlaceholderManifests,
  ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS,
  evaluateEncounterRuntimeLearnerUseGate,
  InMemoryAssetRegistry,
  type RuntimeAssetReviewDecision,
} from "@openclinxr/asset-registry";
import {
  type AuthIdentity,
  canReadStationRun,
  DEFAULT_DEV_AUTH_IDENTITY,
  DEFAULT_DEV_AUTH_SECRET,
  hasFacultyAccess,
  parseBearerAuthorization,
  resolveSessionLearnerId,
  verifyAuthToken,
} from "@openclinxr/auth";
import {
  AssetGenerationCapabilityFacade,
  type AssetGenerationCapabilityId,
  type AssetGenerationJobPolicyInput,
  buildOpenClinXrCapabilityRoutingMatrix,
  evaluateRuntimeProviderReadinessSurface,
  type RuntimeProfile,
} from "@openclinxr/capability-gateway";
import {
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  createExamStationRunQueue,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  type ExamForm,
  type ExamStationRunQueue,
  evaluateBlueprintScenarioReadiness,
  evaluateScenarioVersionDrift,
} from "@openclinxr/exam-assembly";
import {
  AdminGraphqlReviewDecision,
  type AdminGraphqlRootValue,
  type AdminGraphqlScenario,
  AdminGraphqlScenarioStatus,
  adminGraphqlDocuments,
  createGraphqlCodegenPlan,
  executeAdminGraphql,
  openClinXrAdminSchemaSdl,
} from "@openclinxr/graphql";
import { matchOpenClinXrRestRoute, routeById } from "@openclinxr/rest";
import {
  buildFacultyScoreDraft,
  buildReviewDecisionDraft,
  FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR,
  type FacultyScoreDraft,
  type ReviewDecisionDraft,
} from "@openclinxr/review-workflow";
import {
  buildDynamicEncounterFactoryPlanningProjection,
  buildScenarioBankExamSequenceProjection,
  createLearnerScenarioView,
  edChestPainScenario,
  evaluateScenarioBankMaturity,
  scenarioBank,
} from "@openclinxr/scenario-fixtures";
import {
  createDefaultScenarioRuntime,
  type PublicationTargetUse,
  type ReviewerEvidence,
  type RouteRuntimeActorInteractionInput,
  type ScenarioRuntime,
  type ScenarioRuntimeActorTurn,
} from "@openclinxr/scenario-runtime";
import { type Scenario, validateScenario } from "@openclinxr/shared-schemas";
import {
  createTelemetryRecorder,
  openClinXrSpanNames,
  type RealTelemetryRecorder,
  type TelemetryRecorder,
  type TelemetryRunCounters,
  type TelemetrySnapshot,
  type TelemetrySpanRecord,
  telemetryRouteAttributes,
  summarizeTelemetrySpans,
} from "@openclinxr/telemetry";
import {
  createRealtimeVoiceGatewayPosture,
  type RealtimeVoiceGatewayPostureInput,
  type RealtimeVoiceProtocolLaneId,
  selectRealtimeVoiceProtocol,
} from "@openclinxr/voice-gateway";
import { Hono } from "hono";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolPosture } from "./protocol-support.js";

import type {
  RuntimeTraceEvents,
  RuntimeReviewPacket,
  ApiClinicalEventReviewProjection,
  ApiStationRunQueueSnapshot,
  ApiScenarioReviewerRole,
  ApiScenarioReviewDecisionRecord,
  ApiFacultyScoreDraftRecord,
  ApiFacultyReviewDecisionRecord,
  ApiPersistenceSink,
  ApiScenarioSceneGenerationRequestRecord,
  ApiMaterializationInputReviewDecision,
  ApiMaterializationInputReviewDecisionRecord,
  ApiRuntimeRealismEvidenceInputReviewDecision,
  ApiRuntimeRealismEvidenceInputReviewDecisionRecord,
  ApiRuntimeVisualEvidenceAttachment,
  ApiRuntimeVisualEvidenceAttachmentRecord,
  ApiRuntimeRealismEvidenceAttachmentSummary,
  ApiRuntimeVisualEvidenceAttachmentActionPacket,
  ApiRuntimeVisualEvidenceReplayProjection,
  ApiUiXrRuntimeEvidenceConsumerWorkflowSummary,
  ApiAssetReleaseLadderReplayProjection,
  ApiRuntimeEvidenceCaptureScaffold,
  ApiScenarioReviewGateSummary,
  ApiHumanReviewActionSummary,
  ApiAuthOptions,
  ApiAppOptions,
  ApiAppVariables,
} from "./api-types.js";
export type {
  RuntimeTraceEvents,
  RuntimeReviewPacket,
  ApiClinicalEventReviewProjection,
  ApiStationRunQueueSnapshot,
  ApiScenarioReviewerRole,
  ApiScenarioReviewDecisionRecord,
  ApiFacultyScoreDraftRecord,
  ApiFacultyReviewDecisionRecord,
  ApiPersistenceSink,
  ApiScenarioSceneGenerationRequestRecord,
  ApiMaterializationInputReviewDecision,
  ApiMaterializationInputReviewDecisionRecord,
  ApiRuntimeRealismEvidenceInputReviewDecision,
  ApiRuntimeRealismEvidenceInputReviewDecisionRecord,
  ApiRuntimeVisualEvidenceAttachment,
  ApiRuntimeVisualEvidenceAttachmentRecord,
  ApiRuntimeRealismEvidenceAttachmentSummary,
  ApiRuntimeVisualEvidenceAttachmentActionPacket,
  ApiRuntimeVisualEvidenceReplayProjection,
  ApiUiXrRuntimeEvidenceConsumerWorkflowSummary,
  ApiAssetReleaseLadderReplayProjection,
  ApiRuntimeEvidenceCaptureScaffold,
  ApiScenarioReviewGateSummary,
  ApiHumanReviewActionSummary,
  ApiAuthOptions,
  ApiAppOptions,
  ApiAppVariables,
} from "./api-types.js";
import {
  isRecord,
  readGeneratedJsonIfExists,
  readRepoGeneratedJsonIfExists,
  readMaterializationInputManifestSummaryForScenario,
  readPedsHumanoidMaterializationHandoffForScenario,
  attachPedsHumanoidMaterializationHandoff,
  readMaterializationAttachmentPlanSummaryForScenario,
  readMaterializationEvidenceAttachmentSummaryForScenario,
  readRuntimeEvidenceCaptureScaffoldForScenario,
  readRuntimeRealismEvidenceInputDraftForScenario,
  attachMaterializationInputManifestSummary,
  attachMaterializationAttachmentPlanSummary,
  attachMaterializationEvidenceAttachmentSummary,
  attachRuntimeRealismEvidenceInputDraft,
  attachRuntimeRealismEvidenceInputReviewDecisionRecord,
  attachRuntimeVisualEvidenceAttachmentSummary,
  attachRuntimeVisualEvidenceAttachmentActionPacket,
  attachRuntimeVisualEvidenceAttachmentRecord,
  attachRuntimeEvidenceCaptureScaffold,
  attachMaterializationInputReviewDecisionRecord,
  buildMaterializationInputReviewActionPacket,
  buildMaterializationInputReviewDecisionRecord,
  buildRuntimeRealismEvidenceInputReviewDecisionRecord,
  buildRuntimeRealismEvidenceAttachmentSummary,
  buildRuntimeVisualEvidenceAttachmentRecord,
  buildRuntimeVisualEvidenceAttachmentActionPacket,
  realtimeVoiceProtocolPreference,
  parseStringArray,
  createDefaultRealtimeVoiceGatewayPostureInput,
  telemetrySnapshotFromRecorder,
  asRealTelemetryRecorder,
} from "./api-support.js";
import { type ApiAppContext } from "./api-app-context.js";
import { ApiApplication, type ApiApp } from "./api-application.js";
import { registerReviewRoutes } from "./routes/review-routes.js";
import { registerEncounterSessionRoutes } from "./routes/encounter-session-routes.js";
import { registerCapabilityJobRoutes } from "./routes/capability-job-routes.js";
import { registerAuthoringRoutes } from "./routes/authoring-routes.js";
import { registerExamRoutes } from "./routes/exam-routes.js";
import { registerPlatformRoutes } from "./routes/platform-routes.js";
import { buildAssetReleaseLadderReplayProjection, createSeedBankAssetReadiness, createSeedBankSceneGenerationPipelineQueue, createSeedStationRunQueueSnapshot, findSeedBankAssetReadiness, summarizeClinicalEventReviewProjections, summarizeReviewReplayReadiness, uniqueStrings } from "./api-route-support.js";
import { registerRuntimeEvidenceRoutes } from "./routes/runtime-evidence-routes.js";
import { registerAdminGraphqlRoutes } from "./routes/admin-graphql-routes.js";
import { registerScenarioSceneGenerationRoutes } from "./routes/scenario-scene-generation-routes.js";



/** Narrow optional counter/snapshot surface without coupling callers to concrete recorder type. */


/**
 * Compose the API app.
 *
 * Thin composition root: phases are sequenced by {@link ApiApplication}, feature logic lives in
 * the per-domain route modules. Adding a domain = one line in {@link registerAllRoutes}.
 */
export function createApiApp(
  runtime: ScenarioRuntime = createDefaultScenarioRuntime(),
  persistence: ApiPersistenceSink = {},
  options: ApiAppOptions = {},
): ApiApp {
  return ApiApplication.create()
    .withContext(runtime, persistence, options)
    .withCoreMiddleware()
    .withRoutes(registerAllRoutes)
    .build().app;
}

/** Route registration surface — one line per domain (routes still inline here are mid-migration). */
function registerAllRoutes(app: ApiApp, ctx: ApiAppContext): void {
  const {
    runtime,
    persistence,
    telemetry,
    assetGenerationFacade,
    realtimeVoiceGatewayPosture,
    apiProtocolPosture,
    sessionOwners,
    adminScenarioOverrides,
    sceneGenerationRequests,
    runtimeRealismEvidenceInputReviewDecisions,
    runtimeVisualEvidenceAttachments,
    latestMaterializationInputReviewDecisionRecordForScenario,
    latestMaterializationInputReviewDecisionRecordForPacket,
  } = ctx;
  const { allowDevDefaultIdentity, secret: authSecret, defaultIdentity } = ctx.auth;


  registerPlatformRoutes(app, ctx);

  registerRuntimeEvidenceRoutes(app, ctx);
  registerAdminGraphqlRoutes(app, ctx);
  registerScenarioSceneGenerationRoutes(app, ctx);
  registerExamRoutes(app, ctx);
  registerAuthoringRoutes(app, ctx);
  registerCapabilityJobRoutes(app, ctx);
  registerEncounterSessionRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
}




























































