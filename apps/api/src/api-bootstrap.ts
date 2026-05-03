import type { ExamForm } from "@openclinxr/exam-assembly";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createNoopTelemetryRecorder, type TelemetryRecorder } from "@openclinxr/telemetry";
import { createApiApp, type ApiPersistenceSink } from "./app.js";

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
};

type ApiInfrastructureServiceId = keyof ApiInfrastructureServices;

type ApiStartupContext = {
  runtime: ScenarioRuntime;
  persistence: ApiPersistenceSink;
  telemetry: TelemetryRecorder;
};

type ApiApplicationServices = {
  fetch: (request: Request) => Response | Promise<Response>;
};

export type StartedOpenClinXrApi = {
  fetch: (request: Request) => Response | Promise<Response>;
  handlerSpecs: AzureFunctionHttpHandlerSpec[];
  infrastructureServiceIds: ApiInfrastructureServiceId[];
};

export type NodeServerConfig = {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
};

export type OpenClinXrApiStartupOptions = {
  runtime?: ScenarioRuntime;
  persistence?: ApiPersistenceSink;
  telemetry?: TelemetryRecorder;
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

    return {
      fetch: applicationServices.fetch,
      handlerSpecs: [...this.handlerSpecs],
      infrastructureServiceIds: this.infrastructureRegistry.ids(),
    };
  }
}

export function createOpenClinXrApiStartup(options: OpenClinXrApiStartupOptions = {}): OpenClinXrApiStartupBuilder {
  const persistence = options.persistence ?? createNoopPersistenceSink();
  const runtime = options.runtime ?? createDefaultScenarioRuntime();
  const telemetry = options.telemetry ?? createNoopTelemetryRecorder();

  return new OpenClinXrApiStartupBuilder()
    .initializeInfrastructureServices((serviceRegistry) => {
      serviceRegistry
        .registerInfrastructureService("scenarioRuntime", runtime)
        .registerInfrastructureService("apiPersistence", persistence)
        .registerInfrastructureService("telemetry", telemetry);
    })
    .setContext(defaultContextFactory)
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

function defaultContextFactory(serviceRegistry: ApiInfrastructureRegistry): ApiStartupContext {
  return {
    runtime: serviceRegistry.getInfrastructureService("scenarioRuntime"),
    persistence: serviceRegistry.getInfrastructureService("apiPersistence"),
    telemetry: serviceRegistry.getInfrastructureService("telemetry"),
  };
}

function defaultApplicationServicesFactory(context: ApiStartupContext): ApiApplicationServices {
  const app = createApiApp(context.runtime, context.persistence, { telemetry: context.telemetry });
  return {
    fetch: (request) => app.fetch(request),
  };
}

function createNoopPersistenceSink(): ApiPersistenceSink {
  return {
    saveExamForm: (_form: ExamForm) => undefined,
    saveTraceEvents: () => undefined,
    saveReviewPacket: () => undefined,
  };
}
