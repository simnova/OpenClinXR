import type { ExamForm } from "@openclinxr/exam-assembly";
import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createNoopTelemetryRecorder, type TelemetryRecorder } from "@openclinxr/telemetry";
import type { RealtimeVoiceGatewayPostureInput } from "@openclinxr/voice-gateway";
import { createApiApp, type ApiPersistenceSink, type ApiScenarioReviewDecisionRecord, type ApiStationRunQueueSnapshot } from "./app.js";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolSupport } from "./protocol-support.js";

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
  protocolSupport: OpenClinXrApiProtocolSupport[];
};

export type OpenClinXrApiStartupOptions = {
  runtime?: ScenarioRuntime;
  persistence?: ApiPersistenceSink;
  telemetry?: TelemetryRecorder;
  assetGenerationFacade?: AssetGenerationCapabilityFacade;
  realtimeVoiceGatewayPosture?: RealtimeVoiceGatewayPostureInput;
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
    const protocolPosture = createOpenClinXrApiProtocolPosture();

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
  const runtime = options.runtime ?? createDefaultScenarioRuntime();
  const telemetry = options.telemetry ?? createNoopTelemetryRecorder();
  const assetGenerationFacade = options.assetGenerationFacade ?? new AssetGenerationCapabilityFacade();
  const realtimeVoiceGatewayPosture = options.realtimeVoiceGatewayPosture ?? createDefaultRealtimeVoiceGatewayPostureInput();

  return new OpenClinXrApiStartupBuilder()
    .initializeInfrastructureServices((serviceRegistry) => {
      serviceRegistry
        .registerInfrastructureService("scenarioRuntime", runtime)
        .registerInfrastructureService("apiPersistence", persistence)
        .registerInfrastructureService("telemetry", telemetry)
        .registerInfrastructureService("assetGenerationFacade", assetGenerationFacade);
    })
    .setContext((registry) => defaultContextFactory(registry, realtimeVoiceGatewayPosture))
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
    port: options.port ?? Number(process.env.PORT ?? 3000),
  };
}

export function createBunServerConfig(startup: StartedOpenClinXrApi = createOpenClinXrApiStartup().startUp(), options: { port?: number } = {}): BunServerConfig {
  return {
    runtime: "bun-hono",
    fetch: startup.fetch,
    port: options.port ?? Number(process.env.PORT ?? 3000),
    websocketPath: "/voice/realtime/ws",
    protocolSupport: startup.protocolSupport,
  };
}

function defaultContextFactory(
  serviceRegistry: ApiInfrastructureRegistry,
  realtimeVoiceGatewayPosture: RealtimeVoiceGatewayPostureInput = createDefaultRealtimeVoiceGatewayPostureInput(),
): ApiStartupContext {
  return {
    runtime: serviceRegistry.getInfrastructureService("scenarioRuntime"),
    persistence: serviceRegistry.getInfrastructureService("apiPersistence"),
    telemetry: serviceRegistry.getInfrastructureService("telemetry"),
    assetGenerationFacade: serviceRegistry.getInfrastructureService("assetGenerationFacade"),
    realtimeVoiceGatewayPosture,
  };
}

function defaultApplicationServicesFactory(context: ApiStartupContext): ApiApplicationServices {
  const app = createApiApp(context.runtime, context.persistence, {
    telemetry: context.telemetry,
    assetGenerationFacade: context.assetGenerationFacade,
    realtimeVoiceGatewayPosture: context.realtimeVoiceGatewayPosture,
  });
  return {
    fetch: (request) => app.fetch(request),
  };
}

function createDefaultRealtimeVoiceGatewayPostureInput(): RealtimeVoiceGatewayPostureInput {
  return {
    bunAvailable: false,
    pythonBackendDependenciesInstalled: false,
    pythonInferenceRuntimeInstalled: false,
  };
}

function createSingleUserMemoryPersistenceSink(): ApiPersistenceSink {
  const examForms = new Map<string, ExamForm>();
  const stationRunQueueSnapshots = new Map<string, ApiStationRunQueueSnapshot>();
  const scenarioReviewDecisions: ApiScenarioReviewDecisionRecord[] = [];

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
    saveReviewPacket: () => undefined,
  };
}
