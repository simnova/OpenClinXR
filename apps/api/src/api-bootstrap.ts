import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import type { ExamForm } from "@openclinxr/exam-assembly";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import type { Scenario } from "@openclinxr/shared-schemas";
import { createTelemetryRecorder, type TelemetryRecorder } from "@openclinxr/telemetry";
import type { RealtimeVoiceGatewayPostureInput } from "@openclinxr/voice-gateway";
import {
  type ApiFacultyReviewDecisionRecord,
  type ApiFacultyScoreDraftRecord,
  type ApiPersistenceSink,
  type ApiScenarioReviewDecisionRecord,
  type ApiStationRunQueueSnapshot,
  createApiApp,
} from "./app.js";
import {
  createOpenClinXrApiProtocolPosture,
  type OpenClinXrApiProtocolPosture,
  type OpenClinXrApiProtocolSupport,
  createOpenClinXrApiProtocolPostureFromEnvironment,
} from "@openclinxr/rest";
import { createScenarioRuntimeDurableStoreFromApiPersistence } from "@openclinxr/rest";

export type AzureFunctionHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "OPTIONS" | "HEAD";

export type AzureFunctionHttpTrigger = {
  route: string;
  methods: AzureFunctionHttpMethod[];
};

export type AzureFunctionHttpHandlerSpec = {
  name: string;
  trigger: AzureFunctionHttpTrigger;
};

type ApiInfrastructureServices = {
  scenarioRuntime: ScenarioRuntime;
  apiPersistence: ApiPersistenceSink;
  telemetry: TelemetryRecorder;
  assetGenerationFacade: AssetGenerationCapabilityFacade;
};

type ApiInfrastructureServiceId = keyof ApiInfrastructureServices;

type ApiStartupContext = {
  runtime: ScenarioRuntime;
  persistence: ApiPersistenceSink;
  telemetry: TelemetryRecorder;
  assetGenerationFacade: AssetGenerationCapabilityFacade;
  realtimeVoiceGatewayPosture: RealtimeVoiceGatewayPostureInput;
  apiProtocolPosture: OpenClinXrApiProtocolPosture;
};

type ApiApplicationServices = {
  fetch: (request: Request) => Response | Promise<Response>;
};

export type StartedOpenClinXrApi = {
  fetch: (request: Request) => Response | Promise<Response>;
  handlerSpecs: AzureFunctionHttpHandlerSpec[];
  infrastructureServiceIds: ApiInfrastructureServiceId[];
  primaryRuntimeTarget: "bun-hono";
  localFallbackRuntimeTarget: "node-hono";
  protocolSupport: OpenClinXrApiProtocolSupport[];
};

export type NodeServerConfig = {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
};

export type BunServerConfig = {
  runtime: "bun-hono";
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
  websocketPath: "/voice/realtime/ws";
  canUpgradeWebSocketRequest: (request: Request) => boolean;
  websocket: BunRealtimeVoiceWebSocketHandler;
  protocolSupport: OpenClinXrApiProtocolSupport[];
};

export type BunRealtimeVoiceWebSocket = {
  data?: {
    audioChunks: number;
    audioBytes: number;
    proxyMode: "local_echo" | "python_backend_proxy";
    backendSocket?: BunRealtimeVoiceBackendWebSocket;
    queuedBackendFrames: Array<string | Uint8Array>;
  };
  send(frame: string | Uint8Array): number | undefined | Promise<number | undefined>;
};

export type BunRealtimeVoiceBackendWebSocket = {
  readyState?: number;
  send(frame: string | Uint8Array): number | undefined | Promise<number | undefined>;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown; message?: string; error?: unknown }) => void): void;
};

export type BunRealtimeVoiceBackendWebSocketFactory = (url: string) => BunRealtimeVoiceBackendWebSocket;

export type BunRealtimeVoiceWebSocketHandler = {
  open(socket: BunRealtimeVoiceWebSocket): void;
  message(socket: BunRealtimeVoiceWebSocket, message: string | ArrayBuffer | ArrayBufferView): void;
  close(socket: BunRealtimeVoiceWebSocket): void;
};

export type BunServerConfigOptions = {
  port?: number;
  pythonBackendWebSocketUrl?: string;
  backendWebSocketFactory?: BunRealtimeVoiceBackendWebSocketFactory;
};

export type OpenClinXrApiStartupOptions = {
  runtime?: ScenarioRuntime;
  modelGateway?: NonNullable<Parameters<typeof createDefaultScenarioRuntime>[0]>["modelGateway"];
  persistence?: ApiPersistenceSink;
  telemetry?: TelemetryRecorder;
  assetGenerationFacade?: AssetGenerationCapabilityFacade;
  realtimeVoiceGatewayPosture?: RealtimeVoiceGatewayPostureInput;
  apiProtocolPosture?: OpenClinXrApiProtocolPosture;
  protocolPostureEnvironment?: OpenClinXrApiProtocolPostureEnvironment;
  protocolPostureEnvironmentOptions?: OpenClinXrApiProtocolPostureEnvironmentOptions;
};

/** Env bag for Bun voice posture — compatible with NodeJS.ProcessEnv (index signature). */
export type BunRealtimeVoiceGatewayPostureEnvironment = Readonly<{
  [key: string]: string | undefined;
  OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL?: string;
  OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE?: string;
  OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE?: string;
}>;

export type BunRealtimeVoiceGatewayPostureEnvironmentOptions = {
  readEvidenceFile?: (filePath: string) => unknown;
};

export type OpenClinXrApiProtocolPostureEnvironment = Readonly<{
  [key: string]: string | undefined;
  OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE?: string;
  OPENCLINXR_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE?: string;
  VITEST?: string;
  NODE_ENV?: string;
}>;

export type OpenClinXrApiProtocolPostureEnvironmentOptions = {
  readEvidenceFile?: (filePath: string) => unknown;
  discoverLatestSmokeEvidence?: boolean;
};

class ApiInfrastructureRegistry {
  private readonly services = new Map<ApiInfrastructureServiceId, ApiInfrastructureServices[ApiInfrastructureServiceId]>();

  registerInfrastructureService<TId extends ApiInfrastructureServiceId>(id: TId, service: ApiInfrastructureServices[TId]): this {
    this.services.set(id, service);
    return this;
  }

  getInfrastructureService<TId extends ApiInfrastructureServiceId>(id: TId): ApiInfrastructureServices[TId] {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`Infrastructure service not registered: ${id}`);
    }
    return service as ApiInfrastructureServices[TId];
  }

  ids(): ApiInfrastructureServiceId[] {
    return Array.from(this.services.keys());
  }
}

export class OpenClinXrApiStartupBuilder {
  private readonly infrastructureRegistry = new ApiInfrastructureRegistry();
  private contextFactory: (registry: ApiInfrastructureRegistry) => ApiStartupContext = defaultContextFactory;
  private applicationServicesFactory: (context: ApiStartupContext) => ApiApplicationServices = defaultApplicationServicesFactory;
  private readonly handlerSpecs: AzureFunctionHttpHandlerSpec[] = [];

  initializeInfrastructureServices(configure: (registry: ApiInfrastructureRegistry) => void): this {
    configure(this.infrastructureRegistry);
    return this;
  }

  setContext(factory: (registry: ApiInfrastructureRegistry) => ApiStartupContext): this {
    this.contextFactory = factory;
    return this;
  }

  initializeApplicationServices(factory: (context: ApiStartupContext) => ApiApplicationServices): this {
    this.applicationServicesFactory = factory;
    return this;
  }

  registerAzureFunctionHttpHandler(name: string, trigger: AzureFunctionHttpTrigger): this {
    this.handlerSpecs.push({ name, trigger });
    return this;
  }

  startUp(): StartedOpenClinXrApi {
    const context = this.contextFactory(this.infrastructureRegistry);
    const applicationServices = this.applicationServicesFactory(context);
    const protocolPosture = context.apiProtocolPosture;

    return {
      fetch: applicationServices.fetch,
      handlerSpecs: [...this.handlerSpecs],
      infrastructureServiceIds: this.infrastructureRegistry.ids(),
      primaryRuntimeTarget: protocolPosture.primaryRuntimeTarget,
      localFallbackRuntimeTarget: protocolPosture.localFallbackRuntimeTarget,
      protocolSupport: protocolPosture.protocols,
    };
  }
}

export function createOpenClinXrApiStartup(options: OpenClinXrApiStartupOptions = {}): OpenClinXrApiStartupBuilder {
  const persistence = options.persistence ?? createSingleUserMemoryPersistenceSink();
  const runtime = options.runtime ?? createDefaultScenarioRuntime({
    durableStore: createScenarioRuntimeDurableStoreFromApiPersistence(persistence),
    ...(options.modelGateway ? { modelGateway: options.modelGateway } : {}),
  });
  const telemetry = options.telemetry ?? createTelemetryRecorder();
  const assetGenerationFacade = options.assetGenerationFacade ?? new AssetGenerationCapabilityFacade();
  const realtimeVoiceGatewayPosture = options.realtimeVoiceGatewayPosture ?? createDefaultRealtimeVoiceGatewayPostureInput();
  const apiProtocolPosture = options.apiProtocolPosture
    ?? createOpenClinXrApiProtocolPostureFromEnvironment(
      options.protocolPostureEnvironment ?? process.env as OpenClinXrApiProtocolPostureEnvironment,
      options.protocolPostureEnvironmentOptions ?? {},
    );

  return new OpenClinXrApiStartupBuilder()
    .initializeInfrastructureServices((serviceRegistry) => {
      serviceRegistry
        .registerInfrastructureService("scenarioRuntime", runtime)
        .registerInfrastructureService("apiPersistence", persistence)
        .registerInfrastructureService("telemetry", telemetry)
        .registerInfrastructureService("assetGenerationFacade", assetGenerationFacade);
    })
    .setContext((registry) => defaultContextFactory(registry, realtimeVoiceGatewayPosture, apiProtocolPosture))
    .initializeApplicationServices(defaultApplicationServicesFactory)
    .registerAzureFunctionHttpHandler("graphql-contract", {
      route: "admin/graphql/{*segments}",
      methods: ["GET", "POST", "OPTIONS"],
    })
    .registerAzureFunctionHttpHandler("rest", {
      route: "{*rest}",
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
    });
}

 export function createNodeServerConfig(startup: StartedOpenClinXrApi = createOpenClinXrApiStartup().startUp(), options: { port?: number } = {}): NodeServerConfig {
   return {
     fetch: startup.fetch,
     port: options.port ?? Number(process.env["PORT"] ?? 3000),
   };
 }



function defaultContextFactory(
  serviceRegistry: ApiInfrastructureRegistry,
  realtimeVoiceGatewayPosture: RealtimeVoiceGatewayPostureInput = createDefaultRealtimeVoiceGatewayPostureInput(),
  apiProtocolPosture: OpenClinXrApiProtocolPosture = createOpenClinXrApiProtocolPosture(),
): ApiStartupContext {
  return {
    runtime: serviceRegistry.getInfrastructureService("scenarioRuntime"),
    persistence: serviceRegistry.getInfrastructureService("apiPersistence"),
    telemetry: serviceRegistry.getInfrastructureService("telemetry"),
    assetGenerationFacade: serviceRegistry.getInfrastructureService("assetGenerationFacade"),
    realtimeVoiceGatewayPosture,
    apiProtocolPosture,
  };
}

function defaultApplicationServicesFactory(context: ApiStartupContext): ApiApplicationServices {
  const app = createApiApp(context.runtime, context.persistence, {
    telemetry: context.telemetry,
    assetGenerationFacade: context.assetGenerationFacade,
    realtimeVoiceGatewayPosture: context.realtimeVoiceGatewayPosture,
    apiProtocolPosture: context.apiProtocolPosture,
  });
  return {
    fetch: (request) => app.fetch(request),
  };
}

function createDefaultRealtimeVoiceGatewayPostureInput(): RealtimeVoiceGatewayPostureInput {
  return {
    bunAvailable: false,
    pythonBackendWebSocketUrlConfigured: false,
    pythonBackendDependenciesInstalled: false,
    pythonInferenceRuntimeInstalled: false,
  };
}

function createSingleUserMemoryPersistenceSink(): ApiPersistenceSink {
  const examForms = new Map<string, ExamForm>();
  const stationRunQueueSnapshots = new Map<string, ApiStationRunQueueSnapshot>();
  const scenarioReviewDecisions: ApiScenarioReviewDecisionRecord[] = [];
  /** In-memory durable surfaces for Q4 observability (default single-user sink). */
  const reviewPacketsByStationRunId = new Map<string, unknown[]>();
  const actorTurnsByStationRunId = new Map<string, unknown[]>();
  /** Authored scenario drafts keyed by scenarioId::version (list all; get latest by id). */
  const authoredScenarios = new Map<string, Scenario>();
  /** Faculty score drafts + local review decisions (Q4; gates stay false). */
  const facultyScoreDraftsByStationRunId = new Map<string, ApiFacultyScoreDraftRecord[]>();
  const facultyReviewDecisionsByStationRunId = new Map<string, ApiFacultyReviewDecisionRecord[]>();

  return {
    saveExamForm: (form) => {
      examForms.set(form.examFormId, form);
    },
    saveStationRunQueueSnapshot: (snapshot) => {
      stationRunQueueSnapshots.set(snapshot.snapshotId, snapshot);
    },
    listStationRunQueueSnapshots: (blueprintId) =>
      Array.from(stationRunQueueSnapshots.values())
        .filter((snapshot) => snapshot.queue.blueprintId === blueprintId)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    saveScenarioReviewDecision: (record) => {
      scenarioReviewDecisions.push({
        ...record,
        evidenceRefs: [...record.evidenceRefs],
      });
    },
    listScenarioReviewDecisions: () =>
      scenarioReviewDecisions
        .map((record) => ({ ...record, evidenceRefs: [...record.evidenceRefs] }))
        .sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt)),
    saveTraceEvents: () => undefined,
    saveReviewPacket: (stationRunId, packet) => {
      const packets = reviewPacketsByStationRunId.get(stationRunId) ?? [];
      packets.push(packet);
      reviewPacketsByStationRunId.set(stationRunId, packets);
    },
    saveActorTurn: (stationRunId, turn) => {
      const turns = actorTurnsByStationRunId.get(stationRunId) ?? [];
      turns.push(turn);
      actorTurnsByStationRunId.set(stationRunId, turns);
    },
    saveAuthoredScenario: (scenario) => {
      authoredScenarios.set(`${scenario.scenarioId}::${scenario.version}`, scenario);
    },
    listAuthoredScenarios: () =>
      Array.from(authoredScenarios.values()).sort(
        (a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.version - b.version,
      ),
    getAuthoredScenario: (scenarioId) => {
      const matches = Array.from(authoredScenarios.values())
        .filter((scenario) => scenario.scenarioId === scenarioId)
        .sort((a, b) => b.version - a.version);
      return matches[0];
    },
    saveFacultyScoreDraft: (record) => {
      const drafts = facultyScoreDraftsByStationRunId.get(record.stationRunId) ?? [];
      drafts.push({
        ...record,
        facultyScoreDraft: {
          ...record.facultyScoreDraft,
          rubricScores: { ...record.facultyScoreDraft.rubricScores },
          notEvidenceFor: [...record.facultyScoreDraft.notEvidenceFor],
        },
        notEvidenceFor: [...record.notEvidenceFor],
      });
      facultyScoreDraftsByStationRunId.set(record.stationRunId, drafts);
    },
    listFacultyScoreDrafts: (stationRunId) =>
      (facultyScoreDraftsByStationRunId.get(stationRunId) ?? []).map((record) => ({
        ...record,
        facultyScoreDraft: {
          ...record.facultyScoreDraft,
          rubricScores: { ...record.facultyScoreDraft.rubricScores },
          notEvidenceFor: [...record.facultyScoreDraft.notEvidenceFor],
        },
        notEvidenceFor: [...record.notEvidenceFor],
      })),
    saveFacultyReviewDecision: (record) => {
      const decisions = facultyReviewDecisionsByStationRunId.get(record.stationRunId) ?? [];
      decisions.push({
        ...record,
        facultyScoreDraft: {
          ...record.facultyScoreDraft,
          rubricScores: { ...record.facultyScoreDraft.rubricScores },
          notEvidenceFor: [...record.facultyScoreDraft.notEvidenceFor],
        },
        notEvidenceFor: [...record.notEvidenceFor],
      });
      facultyReviewDecisionsByStationRunId.set(record.stationRunId, decisions);
    },
    listFacultyReviewDecisions: (stationRunId) =>
      (facultyReviewDecisionsByStationRunId.get(stationRunId) ?? []).map((record) => ({
        ...record,
        facultyScoreDraft: {
          ...record.facultyScoreDraft,
          rubricScores: { ...record.facultyScoreDraft.rubricScores },
          notEvidenceFor: [...record.facultyScoreDraft.notEvidenceFor],
        },
        notEvidenceFor: [...record.notEvidenceFor],
      })),
  };
}
