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
  send(frame: string | Uint8Array): void | number | Promise<void | number>;
};

export type BunRealtimeVoiceBackendWebSocket = {
  readyState?: number;
  send(frame: string | Uint8Array): void | number | Promise<void | number>;
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

export function createBunServerConfig(startup: StartedOpenClinXrApi = createOpenClinXrApiStartup().startUp(), options: BunServerConfigOptions = {}): BunServerConfig {
  const websocketOptions = {
    ...(options.pythonBackendWebSocketUrl ? { pythonBackendWebSocketUrl: options.pythonBackendWebSocketUrl } : {}),
    ...(options.backendWebSocketFactory ? { backendWebSocketFactory: options.backendWebSocketFactory } : {}),
  };

  return {
    runtime: "bun-hono",
    fetch: startup.fetch,
    port: options.port ?? Number(process.env.PORT ?? 3000),
    websocketPath: "/voice/realtime/ws",
    canUpgradeWebSocketRequest: isRealtimeVoiceWebSocketUpgradeRequest,
    websocket: createBunRealtimeVoiceWebSocketHandler(websocketOptions),
    protocolSupport: startup.protocolSupport,
  };
}

function isRealtimeVoiceWebSocketUpgradeRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === "/voice/realtime/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function createBunRealtimeVoiceWebSocketHandler(options: {
  pythonBackendWebSocketUrl?: string;
  backendWebSocketFactory?: BunRealtimeVoiceBackendWebSocketFactory;
} = {}): BunRealtimeVoiceWebSocketHandler {
  return {
    open(socket) {
      socket.data = {
        audioChunks: 0,
        audioBytes: 0,
        proxyMode: options.pythonBackendWebSocketUrl ? "python_backend_proxy" : "local_echo",
        queuedBackendFrames: [],
      };
      sendBunWebSocketJson(socket, {
        type: "gateway.ready",
        protocol: options.pythonBackendWebSocketUrl
          ? "bun-native-python-backend-proxy"
          : "bun-native-json-control-and-binary-audio-echo",
        backendUrlConfigured: Boolean(options.pythonBackendWebSocketUrl),
        readyForLiveDialog: false,
      });
      if (options.pythonBackendWebSocketUrl) {
        connectPythonVoiceBackend(socket, options.pythonBackendWebSocketUrl, options.backendWebSocketFactory);
      }
    },
    message(socket, message) {
      if (socket.data?.proxyMode === "python_backend_proxy") {
        forwardRealtimeVoiceFrameToBackend(socket, message);
        return;
      }

      if (typeof message === "string") {
        acknowledgeRealtimeVoiceControlFrame(socket, message);
        return;
      }

      const chunk = toUint8Array(message);
      const data = socket.data ?? {
        audioChunks: 0,
        audioBytes: 0,
        proxyMode: "local_echo" as const,
        queuedBackendFrames: [],
      };
      data.audioChunks += 1;
      data.audioBytes += chunk.byteLength;
      socket.data = data;
      sendBunWebSocketJson(socket, {
        type: "audio.metadata",
        chunkIndex: data.audioChunks,
        chunkBytes: chunk.byteLength,
        totalBytes: data.audioBytes,
        format: "opaque-binary",
      });
      sendBunWebSocketJson(socket, {
        type: "transcript.delta",
        text: "",
        isFinal: false,
        sourceChunkIndex: data.audioChunks,
      });
      socket.send(chunk);
    },
    close(socket) {
      socket.data?.backendSocket?.close();
      delete socket.data;
    },
  };
}

function connectPythonVoiceBackend(
  socket: BunRealtimeVoiceWebSocket,
  backendUrl: string,
  backendWebSocketFactory: BunRealtimeVoiceBackendWebSocketFactory | undefined,
): void {
  const factory = backendWebSocketFactory ?? defaultBunRealtimeVoiceBackendWebSocketFactory();
  if (!factory) {
    sendBunWebSocketJson(socket, {
      type: "backend.error",
      reason: "backend_websocket_client_unavailable",
    });
    return;
  }

  try {
    const backendSocket = factory(backendUrl);
    if (!socket.data) {
      backendSocket.close();
      return;
    }
    socket.data.backendSocket = backendSocket;
    backendSocket.addEventListener("open", () => flushQueuedBackendFrames(socket));
    backendSocket.addEventListener("message", (event) => {
      const frame = backendEventDataToFrame(event.data);
      if (frame) {
        socket.send(frame);
      }
    });
    backendSocket.addEventListener("close", () => {
      sendBunWebSocketJson(socket, { type: "backend.closed" });
    });
    backendSocket.addEventListener("error", (event) => {
      sendBunWebSocketJson(socket, {
        type: "backend.error",
        reason: "backend_websocket_error",
        message: event.message ?? (event.error instanceof Error ? event.error.message : "unknown"),
      });
    });
  } catch (error) {
    sendBunWebSocketJson(socket, {
      type: "backend.error",
      reason: "backend_websocket_connect_failed",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

function forwardRealtimeVoiceFrameToBackend(
  socket: BunRealtimeVoiceWebSocket,
  message: string | ArrayBuffer | ArrayBufferView,
): void {
  const frame = typeof message === "string" ? message : toUint8Array(message);
  const data = socket.data;
  if (!data?.backendSocket) {
    sendBunWebSocketJson(socket, {
      type: "backend.error",
      reason: "backend_websocket_not_connected",
    });
    return;
  }
  if (data.backendSocket.readyState === 1) {
    data.backendSocket.send(frame);
    return;
  }
  data.queuedBackendFrames.push(frame);
}

function flushQueuedBackendFrames(socket: BunRealtimeVoiceWebSocket): void {
  const data = socket.data;
  if (!data?.backendSocket || data.backendSocket.readyState !== 1) {
    return;
  }
  for (const frame of data.queuedBackendFrames.splice(0)) {
    data.backendSocket.send(frame);
  }
}

function backendEventDataToFrame(data: unknown): string | Uint8Array | null {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return toUint8Array(data);
  }
  return null;
}

function defaultBunRealtimeVoiceBackendWebSocketFactory(): BunRealtimeVoiceBackendWebSocketFactory | undefined {
  const WebSocketCtor = (globalThis as { WebSocket?: new(url: string) => unknown }).WebSocket;
  return WebSocketCtor ? (url) => new WebSocketCtor(url) as BunRealtimeVoiceBackendWebSocket : undefined;
}

function acknowledgeRealtimeVoiceControlFrame(socket: BunRealtimeVoiceWebSocket, payload: string): void {
  let control: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payload) as unknown;
    control = isRecord(parsed) ? parsed : { type: "control", value: parsed };
  } catch (error) {
    sendBunWebSocketJson(socket, {
      type: "error",
      reason: "invalid JSON control frame",
      detail: error instanceof Error ? error.message : "unknown",
    });
    return;
  }

  const controlType = typeof control.type === "string" ? control.type : "control";
  sendBunWebSocketJson(socket, {
    type: "control.ack",
    controlType,
    received: sanitizeBunRealtimeVoiceControlFrame(control),
  });
  if (controlType === "voice.start" || controlType === "start" || controlType === "commit" || controlType === "flush") {
    sendBunWebSocketJson(socket, {
      type: "transcript.metadata",
      status: "ready",
      controlType,
    });
  }
}

function sanitizeBunRealtimeVoiceControlFrame(control: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(control)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      sanitized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[key] = `list[${value.length}]`;
      continue;
    }
    if (isRecord(value)) {
      sanitized[key] = `object[${Object.keys(value).length}]`;
      continue;
    }
    sanitized[key] = typeof value;
  }
  return sanitized;
}

function sendBunWebSocketJson(socket: BunRealtimeVoiceWebSocket, payload: Record<string, unknown>): void {
  socket.send(JSON.stringify(payload));
}

function toUint8Array(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (message instanceof Uint8Array) {
    return message;
  }
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return new Uint8Array(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
