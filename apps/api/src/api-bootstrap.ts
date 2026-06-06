import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import type { ExamForm } from "@openclinxr/exam-assembly";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createNoopTelemetryRecorder, type TelemetryRecorder } from "@openclinxr/telemetry";
import { type RealtimeVoiceGatewayPostureInput, realtimeVoiceProtocol } from "@openclinxr/voice-gateway";
import { type ApiPersistenceSink, type ApiScenarioReviewDecisionRecord, type ApiStationRunQueueSnapshot, createApiApp } from "./app.js";
import {
  createOpenClinXrApiProtocolPosture,
  type OpenClinXrApiProtocolPosture,
  type OpenClinXrApiProtocolSupport,
} from "./protocol-support.js";

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
  persistence?: ApiPersistenceSink;
  telemetry?: TelemetryRecorder;
  assetGenerationFacade?: AssetGenerationCapabilityFacade;
  realtimeVoiceGatewayPosture?: RealtimeVoiceGatewayPostureInput;
  apiProtocolPosture?: OpenClinXrApiProtocolPosture;
  protocolPostureEnvironment?: OpenClinXrApiProtocolPostureEnvironment;
  protocolPostureEnvironmentOptions?: OpenClinXrApiProtocolPostureEnvironmentOptions;
};

export type BunRealtimeVoiceGatewayPostureEnvironment = {
  OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL?: string;
  OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE?: string;
  OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE?: string;
};

export type BunRealtimeVoiceGatewayPostureEnvironmentOptions = {
  readEvidenceFile?: (filePath: string) => unknown;
};

export type OpenClinXrApiProtocolPostureEnvironment = {
  OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE?: string;
  OPENCLINXR_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE?: string;
  VITEST?: string;
  NODE_ENV?: string;
};

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
  const runtime = options.runtime ?? createDefaultScenarioRuntime();
  const telemetry = options.telemetry ?? createNoopTelemetryRecorder();
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
     port: options.port ?? Number(process.env['PORT'] ?? 3000),
   };
 }

export function createBunRealtimeVoiceGatewayPostureInputFromEnvironment(
  environment: BunRealtimeVoiceGatewayPostureEnvironment,
  options: BunRealtimeVoiceGatewayPostureEnvironmentOptions = {},
): RealtimeVoiceGatewayPostureInput {
  const pythonBackendWebSocketUrlConfigured = Boolean(environment.OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL);
  const pythonBackendProxyReachabilityEvidence = pythonBackendWebSocketUrlConfigured
    ? readPythonProxyReachabilityEvidenceFromEnvironment(environment, options)
    : undefined;
  const pythonBackendDependenciesInstalled = readPythonBackendRuntimeDependenciesEvidenceFromEnvironment(
    environment,
    options,
  );
  return {
    bunAvailable: true,
    pythonBackendWebSocketUrlConfigured,
    pythonBackendDependenciesInstalled,
    pythonInferenceRuntimeInstalled: false,
    ...(pythonBackendProxyReachabilityEvidence ? { pythonBackendProxyReachabilityEvidence } : {}),
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
    port: options.port ?? Number(process.env['PORT'] ?? 3000),
    websocketPath: "/voice/realtime/ws",
    canUpgradeWebSocketRequest: isRealtimeVoiceWebSocketUpgradeRequest,
    websocket: createBunRealtimeVoiceWebSocketHandler(websocketOptions),
    protocolSupport: startup.protocolSupport,
  };
}

function readPythonProxyReachabilityEvidenceFromEnvironment(
  environment: BunRealtimeVoiceGatewayPostureEnvironment,
  options: BunRealtimeVoiceGatewayPostureEnvironmentOptions,
): RealtimeVoiceGatewayPostureInput["pythonBackendProxyReachabilityEvidence"] {
  const evidenceFile = environment.OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE;
  if (!evidenceFile) {
    return undefined;
  }

  const rawEvidence = readOptionalEvidenceFile(evidenceFile, options);
  if (!isRecord(rawEvidence) || rawEvidence['status'] !== "passed") {
    return undefined;
  }
  const websocket = isRecord(rawEvidence['websocket']) ? rawEvidence['websocket'] : {};
  const eventTypesObserved = stringArray((websocket as Record<string, unknown>)['eventTypesObserved']);
  const binaryMessages = finiteNumber((websocket as Record<string, unknown>)['binaryMessages']);
  const canonicalEventsObserved = [
    "backend.ready",
    "voice.started",
    "audio.chunk",
    "transcript.partial",
    "transcript.final",
    "voice.stopped",
  ].every((eventType) => eventTypesObserved.includes(eventType));
  const evidence = {
    sourceFile: evidenceFile,
    ...(typeof rawEvidence['generatedAt'] === "string" ? { generatedAt: rawEvidence['generatedAt'] } : {}),
    status: "passed" as const,
    eventTypesObserved,
    binaryMessages,
    backendProtocolObserved: websocket['backendProtocolObserved'] === true,
    latencyFieldsObserved: websocket['latencyFieldsObserved'] === true,
    binaryEchoObserved: websocket['binaryEchoObserved'] === true,
  };

  return evidence.binaryMessages > 0
    && evidence['backendProtocolObserved']
    && evidence['latencyFieldsObserved']
    && evidence['binaryEchoObserved']
    && canonicalEventsObserved
    ? evidence
    : undefined;
}

function readPythonBackendRuntimeDependenciesEvidenceFromEnvironment(
  environment: BunRealtimeVoiceGatewayPostureEnvironment,
  options: BunRealtimeVoiceGatewayPostureEnvironmentOptions,
): boolean {
  const evidenceFile = environment.OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE;
  if (!evidenceFile) {
    return false;
  }

  const rawEvidence = readOptionalEvidenceFile(evidenceFile, options);
  if (!isRecord(rawEvidence) || rawEvidence['status'] !== "passed") {
    return false;
  }

  const python = isRecord(rawEvidence['python']) ? rawEvidence['python'] : {};
  const dependencies = isRecord(python['dependencies']) ? python['dependencies'] : {};
  const health = isRecord(rawEvidence['health']) ? rawEvidence['health'] : {};
  const capabilities = isRecord(rawEvidence['capabilities']) ? rawEvidence['capabilities'] : {};
  const websocket = isRecord(rawEvidence['websocket']) ? rawEvidence['websocket'] : {};
  const protocol = isRecord(websocket['protocol']) ? websocket['protocol'] : {};
  const missingPackages = stringArray(python['missingPackages']);
  const serverEventTypesObserved = stringArray(protocol['serverEventTypesObserved']);
  const canonicalServerEventsObserved = [
    realtimeVoiceProtocol.serverEvents.backendReady,
    realtimeVoiceProtocol.serverEvents.voiceStarted,
    realtimeVoiceProtocol.serverEvents.audioChunk,
    realtimeVoiceProtocol.serverEvents.transcriptPartial,
    realtimeVoiceProtocol.serverEvents.transcriptFinal,
    realtimeVoiceProtocol.serverEvents.voiceStopped,
  ].every((eventType) => serverEventTypesObserved.includes(eventType));

  return dependencies['fastapi'] === "available"
    && dependencies['uvicorn'] === "available"
    && dependencies['websockets'] === "available"
    && missingPackages.length === 0
    && health['ok'] === true
    && capabilities['ok'] === true
    && websocket['connected'] === true
    && protocol['canonicalProtocolObserved'] === true
    && protocol['backendProtocolObserved'] === true
    && protocol['latencyFieldsObserved'] === true
    && websocket['binaryEchoObserved'] === true
    && canonicalServerEventsObserved;
}

export function createOpenClinXrApiProtocolPostureFromEnvironment(
  environment: OpenClinXrApiProtocolPostureEnvironment = {},
  options: OpenClinXrApiProtocolPostureEnvironmentOptions = {},
): OpenClinXrApiProtocolPosture {
  return createOpenClinXrApiProtocolPosture({
    apiBunWebSocketRuntimeVerified: readApiBunWebSocketRuntimeVerifiedFromEnvironment(environment, options),
  });
}

export function readApiBunWebSocketRuntimeVerifiedFromEnvironment(
  environment: OpenClinXrApiProtocolPostureEnvironment,
  options: OpenClinXrApiProtocolPostureEnvironmentOptions = {},
): boolean {
  const evidenceFile = resolveApiBunWebSocketRuntimeEvidencePath(environment, options);
  if (!evidenceFile) {
    return false;
  }

  const rawEvidence = readOptionalProtocolPostureEvidenceFile(evidenceFile, options);
  return isPassedApiBunWebSocketRuntimeSmokeEvidence(rawEvidence);
}

function resolveApiBunWebSocketRuntimeEvidencePath(
  environment: OpenClinXrApiProtocolPostureEnvironment,
  options: OpenClinXrApiProtocolPostureEnvironmentOptions,
): string | undefined {
  const configuredPath = environment.OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE
    ?? environment.OPENCLINXR_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE;
  if (configuredPath) {
    return configuredPath;
  }

  const shouldDiscover = options.discoverLatestSmokeEvidence
    ?? !isProtocolPostureEvidenceDiscoverySuppressed(environment);
  if (!shouldDiscover) {
    return undefined;
  }

  return findLatestApiBunWebSocketRuntimeSmokeEvidencePath();
}

function isProtocolPostureEvidenceDiscoverySuppressed(environment: OpenClinXrApiProtocolPostureEnvironment): boolean {
  return environment.VITEST === "true"
    || environment.NODE_ENV === "test"
    || process.env.VITEST === "true"
    || process.env.NODE_ENV === "test";
}

function findLatestApiBunWebSocketRuntimeSmokeEvidencePath(): string | undefined {
  const docsDir = resolveRepoRelativePath("docs/openclinxr");
  if (!existsSync(docsDir)) {
    return undefined;
  }

  const latest = readdirSync(docsDir)
    .filter((fileName) => /^api-bun-websocket-runtime-smoke-.*\.json$/.test(fileName))
    .sort()
    .at(-1);
  return latest ? path.join("docs/openclinxr", latest) : undefined;
}

function resolveRepoRelativePath(relativePath: string): string {
  const direct = path.resolve(process.cwd(), relativePath);
  if (existsSync(direct)) {
    return direct;
  }
  return path.resolve(process.cwd(), "../..", relativePath);
}

function readOptionalProtocolPostureEvidenceFile(
  filePath: string,
  options: OpenClinXrApiProtocolPostureEnvironmentOptions,
): unknown {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : resolveRepoRelativePath(filePath);
  return readOptionalEvidenceFile(resolvedPath, options);
}

function isPassedApiBunWebSocketRuntimeSmokeEvidence(value: unknown): boolean {
  if (!isRecord(value) || value["status"] !== "passed") {
    return false;
  }

  const runtimeEvidenceBlockers = stringArray(value["runtimeEvidenceBlockers"]);
  if (runtimeEvidenceBlockers.length > 0) {
    return false;
  }

  const runtime = isRecord(value["runtime"]) ? value["runtime"] : {};
  const h3 = isRecord(runtime["h3"]) ? runtime["h3"] : {};
  if (h3["enabled"] === true || h3["h3TrueEnabled"] === true) {
    return false;
  }

  const health = isRecord(value["health"]) ? value["health"] : {};
  if (health["attempted"] !== true || health["ok"] !== true) {
    return false;
  }

  const websocket = isRecord(value["websocket"]) ? value["websocket"] : {};
  return websocket["attempted"] === true && websocket["connected"] === true;
}

function readOptionalEvidenceFile(
  filePath: string,
  options: BunRealtimeVoiceGatewayPostureEnvironmentOptions | OpenClinXrApiProtocolPostureEnvironmentOptions,
): unknown {
  try {
    if (options.readEvidenceFile) {
      return options.readEvidenceFile(filePath);
    }
    if (!existsSync(filePath)) {
      return undefined;
    }
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
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
      reason: "invalid_json_control_frame",
      detail: error instanceof Error ? error.message : "unknown",
    });
    return;
  }

  const controlType = typeof control['type'] === "string" ? control['type'] : "control";
  if (!isSupportedRealtimeVoiceControlType(controlType)) {
    sendBunWebSocketJson(socket, {
      type: "error",
      reason: "unsupported_control_type",
      controlType,
      supportedControlTypes: supportedRealtimeVoiceControlTypes(),
    });
    return;
  }

  sendBunWebSocketJson(socket, {
    type: "control.ack",
    controlType,
    received: sanitizeBunRealtimeVoiceControlFrame(control),
  });
  if (controlType === realtimeVoiceProtocol.clientControlFrames.start || controlType === "start" || controlType === "commit" || controlType === "flush") {
    sendBunWebSocketJson(socket, {
      type: "transcript.metadata",
      status: "ready",
      controlType,
    });
  }
}

function isSupportedRealtimeVoiceControlType(controlType: string): boolean {
  return supportedRealtimeVoiceControlTypes().includes(controlType);
}

function supportedRealtimeVoiceControlTypes(): string[] {
  return [
    realtimeVoiceProtocol.clientControlFrames.start,
    realtimeVoiceProtocol.clientControlFrames.stop,
    realtimeVoiceProtocol.clientControlFrames.audioMetadata,
    "start",
    "commit",
    "flush",
  ];
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
