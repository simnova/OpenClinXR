
import {
  createDefaultScenarioRuntime,
  type ScenarioRuntime,
} from "@openclinxr/scenario-runtime";

import type {
  ApiPersistenceSink,
  ApiAppOptions,
} from "@openclinxr/rest";
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
} from "@openclinxr/rest";

import type { ApiAppContext } from "@openclinxr/rest";
import { ApiApplication, type ApiApp } from "@openclinxr/rest";
import { registerReviewRoutes } from "@openclinxr/rest";
import { registerEncounterSessionRoutes } from "@openclinxr/rest";
import { registerSessionRoutes } from "@openclinxr/rest";
import { registerCapabilityJobRoutes } from "@openclinxr/rest";
import { registerAuthoringRoutes } from "@openclinxr/rest";
import { registerDialogueSeedAuthoringRoutes } from "@openclinxr/rest";
import { registerExamRoutes } from "@openclinxr/rest";
import { registerPlatformRoutes } from "@openclinxr/rest";
import { registerRuntimeEvidenceRoutes } from "@openclinxr/rest";
import { registerAdminGraphqlRoutes } from "@openclinxr/rest";
import { registerScenarioSceneGenerationRoutes } from "@openclinxr/rest";
import { registerFacultyCompileLockRoutes } from "@openclinxr/rest";
import { createApiAppHarnessBridge } from "./scenario-promotion-bridge.js";
import { registerAssembledExamReviewRoutes } from "@openclinxr/rest";
import { registerAssembledExamDispositionRoutes } from "@openclinxr/rest";
import { registerAssembledExamRunRoutes } from "@openclinxr/rest";
import { registerEncounterBundlePromotionRoutes } from "@openclinxr/rest";
import { registerWorldCompileRoutes } from "@openclinxr/rest";
import { registerFactoryRunTableRoutes } from "@openclinxr/rest";



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
  const bridge = createApiAppHarnessBridge();
  registerPlatformRoutes(app, ctx);

  registerRuntimeEvidenceRoutes(app, ctx);
  registerAdminGraphqlRoutes(app, ctx);
  registerScenarioSceneGenerationRoutes(app, ctx);
  registerExamRoutes(app, ctx);
  registerAuthoringRoutes(app, ctx);
  registerDialogueSeedAuthoringRoutes(app, ctx);
  registerCapabilityJobRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerEncounterSessionRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerFacultyCompileLockRoutes(app, ctx, bridge.repoRoot);
  registerAssembledExamReviewRoutes(app, ctx);
  registerAssembledExamDispositionRoutes(app, ctx);
  registerAssembledExamRunRoutes(app, ctx);
  registerEncounterBundlePromotionRoutes(app, ctx);
  registerWorldCompileRoutes(app, bridge);
  registerFactoryRunTableRoutes(app, bridge);
}




























































