import { DEFAULT_DEV_AUTH_IDENTITY, DEFAULT_DEV_AUTH_SECRET } from "@openclinxr/auth";
import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import type { AdminGraphqlScenario } from "@openclinxr/graphql";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createTelemetryRecorder, type TelemetryRecorder } from "@openclinxr/telemetry";
import { createDefaultRealtimeVoiceGatewayPostureInput, isRecord } from "./api-support.js";
import type {
  ApiAppOptions,
  ApiMaterializationInputReviewDecisionRecord,
  ApiPersistenceSink,
  ApiRuntimeRealismEvidenceInputReviewDecision,
  ApiRuntimeRealismEvidenceInputReviewDecisionRecord,
  ApiRuntimeVisualEvidenceAttachment,
  ApiRuntimeVisualEvidenceAttachmentRecord,
  ApiScenarioSceneGenerationRequestRecord,
} from "./api-types.js";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolPosture } from "./protocol-support.js";

/**
 * Typed composition context for the API app (composition-root pattern).
 *
 * Before this existed, every route closed over ~10 `const`/`let` bindings declared inside
 * `createApiApp`, which made the routes impossible to move out of the god-file. Threading an
 * explicit context turns those dependencies — and the shared in-memory state — into a named,
 * typed contract that per-domain route modules receive as a parameter.
 *
 * `state` holds the genuinely mutable single-record fields (previously `let` bindings); the
 * maps/arrays are mutated in place, so they stay readonly references.
 *
 * Adapted from atlantis-cameras-v2 `apps/api/src/icd-api-application.ts` (IcdServices/IcdRuntime).
 */
export type ApiAppContext = {
  readonly runtime: ScenarioRuntime;
  readonly persistence: ApiPersistenceSink;
  readonly telemetry: TelemetryRecorder;
  readonly assetGenerationFacade: AssetGenerationCapabilityFacade;
  readonly realtimeVoiceGatewayPosture: ReturnType<typeof createDefaultRealtimeVoiceGatewayPostureInput>;
  readonly apiProtocolPosture: OpenClinXrApiProtocolPosture;
  readonly auth: {
    readonly allowDevDefaultIdentity: boolean;
    readonly secret: string;
    readonly defaultIdentity: typeof DEFAULT_DEV_AUTH_IDENTITY;
  };
  /** stationRunId → owner learnerId (attached at session-create). */
  readonly sessionOwners: Map<string, string>;
  /** stationRunId → ScenarioRuntime for sessions started with a non-default scenarioId. */
  readonly perSessionRuntime: Map<string, ScenarioRuntime>;
  readonly adminScenarioOverrides: Map<string, AdminGraphqlScenario>;
  readonly sceneGenerationRequests: ApiScenarioSceneGenerationRequestRecord[];
  readonly runtimeRealismEvidenceInputReviewDecisions: ApiRuntimeRealismEvidenceInputReviewDecision[];
  readonly runtimeVisualEvidenceAttachments: ApiRuntimeVisualEvidenceAttachment[];
  /** Mutable single-record slots (were `let` bindings inside the factory closure). */
  readonly state: {
    runtimeRealismEvidenceInputReviewDecisionRecord: ApiRuntimeRealismEvidenceInputReviewDecisionRecord | undefined;
    runtimeVisualEvidenceAttachmentRecord: ApiRuntimeVisualEvidenceAttachmentRecord | undefined;
  };
  readonly latestMaterializationInputReviewDecisionRecordForScenario: (
    scenarioId: string,
  ) => ApiMaterializationInputReviewDecisionRecord | undefined;
  readonly latestMaterializationInputReviewDecisionRecordForPacket: (
    packet: unknown,
  ) => ApiMaterializationInputReviewDecisionRecord | undefined;
};

/** Resolve options + create the shared in-memory state for one API app instance. */
export function createApiAppContext(
  runtime: ScenarioRuntime = createDefaultScenarioRuntime(),
  persistence: ApiPersistenceSink = {},
  options: ApiAppOptions = {},
): ApiAppContext {
  const sceneGenerationRequests: ApiScenarioSceneGenerationRequestRecord[] = [];

  const latestMaterializationInputReviewDecisionRecordForScenario = (
    scenarioId: string,
  ): ApiMaterializationInputReviewDecisionRecord | undefined =>
    sceneGenerationRequests.find((candidate) =>
      candidate.scenarioId === scenarioId && candidate.materializationInputReviewDecisionRecord
    )?.materializationInputReviewDecisionRecord;

  const latestMaterializationInputReviewDecisionRecordForPacket = (
    packet: unknown,
  ): ApiMaterializationInputReviewDecisionRecord | undefined => {
    if (!isRecord(packet) || typeof packet['selectedScenarioId'] !== "string") return undefined;
    return latestMaterializationInputReviewDecisionRecordForScenario(packet['selectedScenarioId']);
  };

  return {
    runtime,
    persistence,
    telemetry: options.telemetry ?? createTelemetryRecorder(),
    assetGenerationFacade: options.assetGenerationFacade ?? new AssetGenerationCapabilityFacade(),
    realtimeVoiceGatewayPosture:
      options.realtimeVoiceGatewayPosture ?? createDefaultRealtimeVoiceGatewayPostureInput(),
    apiProtocolPosture: options.apiProtocolPosture ?? createOpenClinXrApiProtocolPosture(),
    auth: {
      allowDevDefaultIdentity: options.auth?.allowDevDefaultIdentity !== false,
      secret: options.auth?.secret ?? DEFAULT_DEV_AUTH_SECRET,
      defaultIdentity: options.auth?.defaultIdentity ?? DEFAULT_DEV_AUTH_IDENTITY,
    },
    sessionOwners: new Map<string, string>(),
    perSessionRuntime: new Map<string, ScenarioRuntime>(),
    adminScenarioOverrides: new Map<string, AdminGraphqlScenario>(),
    sceneGenerationRequests,
    runtimeRealismEvidenceInputReviewDecisions: [],
    runtimeVisualEvidenceAttachments: [],
    state: {
      runtimeRealismEvidenceInputReviewDecisionRecord: undefined,
      runtimeVisualEvidenceAttachmentRecord: undefined,
    },
    latestMaterializationInputReviewDecisionRecordForScenario,
    latestMaterializationInputReviewDecisionRecordForPacket,
  };
}
