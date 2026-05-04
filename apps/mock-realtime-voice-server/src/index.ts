import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server as NodeHttpServer, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { Hono } from "hono";
import WebSocket, { WebSocketServer, type RawData } from "ws";

export type StoppableServer = {
  httpUrl: string;
  wsUrl: string;
  stop: () => Promise<void>;
};

export type RealtimeVoiceGatewayPosture = {
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadsPerformed: false;
    productionUseAllowed: false;
  };
  transports: {
    websocket: {
      status: "working_spike_transport";
      path: "/voice/realtime/ws";
      codec: "opus";
    };
    webTransport: {
      status: "blocked_pending_runtime_support";
      blockers: string[];
    };
  };
  gatewayRuntime: {
    target: "bun-hono-http3";
    localVerifiedFallback: "node-hono-ws";
    blockers: string[];
  };
  backends: {
    pythonFastApi: {
      status: "source_present_not_executed" | "available_for_local_run";
      websocketPath: "/voice/realtime/ws";
      blockers: string[];
    };
    inferenceCandidates: Array<{
      id: "moshi-mlx" | "qwen3-tts";
      role: "full_duplex_speech_dialogue" | "streaming_tts_candidate";
      localExecutionClaimed: false;
    }>;
  };
};

export type RealtimeVoiceProxyHarnessInput = {
  gatewayUrl: string;
  audioChunks: Buffer[];
  targetLatencyMs: number;
};

export type RealtimeVoiceProxyHarnessResult = {
  controlFramesSent: number;
  binaryAudioChunksSent: number;
  transcriptEventsReceived: number;
  binaryAudioChunksReceived: number;
  backendProtocol: "python-fastapi-compatible-websocket";
  codec: "opus";
  roundTripLatencyMs: number;
  latencyBudget: {
    targetMs: number;
    passed: boolean;
  };
  receivedEventTypes: string[];
};

type BackendFixtureOptions = {
  port: number;
  artificialDelayMs?: number;
};

type RealtimeGatewayOptions = {
  port: number;
  backendUrl: string;
};

const realtimeVoicePath = "/voice/realtime/ws";

export function createRealtimeVoiceGatewayPosture(input: {
  bunAvailable: boolean;
  pythonBackendDependenciesInstalled: boolean;
  pythonInferenceRuntimeInstalled: boolean;
}): RealtimeVoiceGatewayPosture {
  return {
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    },
    transports: {
      websocket: {
        status: "working_spike_transport",
        path: realtimeVoicePath,
        codec: "opus",
      },
      webTransport: {
        status: "blocked_pending_runtime_support",
        blockers: [
          "quest_godot_webtransport_client_not_implemented",
          "bun_http3_webtransport_not_verified",
          "azure_http3_gateway_path_not_verified",
        ],
      },
    },
    gatewayRuntime: {
      target: "bun-hono-http3",
      localVerifiedFallback: "node-hono-ws",
      blockers: [
        ...(input.bunAvailable ? [] : ["bun_not_installed"]),
        "http3_webtransport_not_verified",
      ],
    },
    backends: {
      pythonFastApi: {
        status: input.pythonBackendDependenciesInstalled ? "available_for_local_run" : "source_present_not_executed",
        websocketPath: realtimeVoicePath,
        blockers: [
          ...(input.pythonBackendDependenciesInstalled ? [] : ["fastapi_uvicorn_websockets_not_installed"]),
          ...(input.pythonInferenceRuntimeInstalled ? [] : ["mlx_moshi_or_qwen3_tts_not_installed"]),
        ],
      },
      inferenceCandidates: [
        {
          id: "moshi-mlx",
          role: "full_duplex_speech_dialogue",
          localExecutionClaimed: false,
        },
        {
          id: "qwen3-tts",
          role: "streaming_tts_candidate",
          localExecutionClaimed: false,
        },
      ],
    },
  };
}

export async function startPythonCompatibleVoiceBackendFixture(options: BackendFixtureOptions): Promise<StoppableServer> {
  const delayMs = options.artificialDelayMs ?? 0;
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      writeNodeJson(response, {
        ok: true,
        service: "python-fastapi-compatible-voice-backend-fixture",
      });
      return;
    }
    response.writeHead(404).end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  let chunkIndex = 0;

  websocketServer.on("connection", (socket) => {
    sendJson(socket, { type: "backend.ready", backendProtocol: "python-fastapi-compatible-websocket" });

    socket.on("message", async (data, isBinary) => {
      await delay(delayMs);
      if (isBinary) {
        const chunk = toBuffer(data);
        sendJson(socket, {
          type: "audio.chunk",
          codec: "opus",
          chunkIndex,
          byteLength: chunk.byteLength,
        });
        socket.send(chunk, { binary: true });
        chunkIndex += 1;
        return;
      }

      const message = parseJsonFrame(data);
      if (message?.type === "voice.start") {
        sendJson(socket, { type: "voice.started", codec: "opus" });
        sendJson(socket, {
          type: "transcript.partial",
          text: "simulated local transcript",
          confidence: 0.88,
        });
        sendJson(socket, {
          type: "transcript.final",
          text: "simulated local transcript",
          confidence: 0.96,
        });
        return;
      }
      if (message?.type === "voice.stop") {
        sendJson(socket, { type: "voice.stopped" });
      }
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== realtimeVoicePath) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  await listen(server, options.port);
  const port = serverPort(server);
  return {
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}${realtimeVoicePath}`,
    stop: () => stopServers(websocketServer, server),
  };
}

export async function startRealtimeVoiceGatewayServer(options: RealtimeGatewayOptions): Promise<StoppableServer> {
  const app = createRealtimeVoiceGatewayHttpApp();
  const server = createServer((request, response) => {
    handleHonoHttpRequest(app, request, response).catch((error: unknown) => {
      writeNodeJson(response, {
        error: "gateway_http_error",
        detail: error instanceof Error ? error.message : "unknown",
      }, 500);
    });
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  websocketServer.on("connection", (clientSocket) => {
    const backendSocket = new WebSocket(options.backendUrl);
    const queuedMessages: Array<{ data: RawData; isBinary: boolean }> = [];

    backendSocket.on("open", () => {
      for (const message of queuedMessages.splice(0)) {
        backendSocket.send(message.data, { binary: message.isBinary });
      }
    });
    backendSocket.on("message", (data, isBinary) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(data, { binary: isBinary });
      }
    });
    backendSocket.on("close", () => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close();
      }
    });
    backendSocket.on("error", (error) => {
      sendJson(clientSocket, {
        type: "backend.error",
        message: error.message,
      });
    });

    clientSocket.on("message", (data, isBinary) => {
      if (backendSocket.readyState === WebSocket.OPEN) {
        backendSocket.send(data, { binary: isBinary });
        return;
      }
      queuedMessages.push({ data, isBinary });
    });
    clientSocket.on("close", () => {
      if (backendSocket.readyState === WebSocket.OPEN || backendSocket.readyState === WebSocket.CONNECTING) {
        backendSocket.close();
      }
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== realtimeVoicePath) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  await listen(server, options.port);
  const port = serverPort(server);
  return {
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}${realtimeVoicePath}`,
    stop: () => stopServers(websocketServer, server),
  };
}

export async function runRealtimeVoiceProxyHarness(input: RealtimeVoiceProxyHarnessInput): Promise<RealtimeVoiceProxyHarnessResult> {
  const startedAt = performance.now();
  const eventTypes: string[] = [];
  let transcriptEventsReceived = 0;
  let binaryAudioChunksReceived = 0;
  let resolved = false;

  return await new Promise<RealtimeVoiceProxyHarnessResult>((resolve, reject) => {
    const socket = new WebSocket(input.gatewayUrl);
    const timeout = setTimeout(() => {
      if (!resolved) {
        socket.close();
        reject(new Error("Timed out waiting for realtime voice proxy harness"));
      }
    }, 5_000);

    socket.on("open", () => {
      sendJson(socket, {
        type: "voice.start",
        sessionId: "voice-spike-session-001",
        codec: "opus",
        sampleRateHz: 48_000,
        targetBackend: "moshi-mlx",
      });
      for (const chunk of input.audioChunks) {
        socket.send(chunk, { binary: true });
      }
      sendJson(socket, { type: "voice.stop" });
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        binaryAudioChunksReceived += 1;
        return;
      }

      const message = parseJsonFrame(data);
      if (!message?.type) {
        return;
      }
      eventTypes.push(message.type);
      if (message.type.startsWith("transcript.")) {
        transcriptEventsReceived += 1;
      }
      if (message.type === "voice.stopped" && binaryAudioChunksReceived >= input.audioChunks.length) {
        resolved = true;
        clearTimeout(timeout);
        socket.close();
        const roundTripLatencyMs = Number((performance.now() - startedAt).toFixed(2));
        resolve({
          controlFramesSent: 2,
          binaryAudioChunksSent: input.audioChunks.length,
          transcriptEventsReceived,
          binaryAudioChunksReceived,
          backendProtocol: "python-fastapi-compatible-websocket",
          codec: "opus",
          roundTripLatencyMs,
          latencyBudget: {
            targetMs: input.targetLatencyMs,
            passed: roundTripLatencyMs < input.targetLatencyMs,
          },
          receivedEventTypes: eventTypes,
        });
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function createRealtimeVoiceGatewayHttpApp(): Hono {
  const app = new Hono();
  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "openclinxr-realtime-voice-gateway",
    }));
  app.get("/voice/realtime/posture", (context) =>
    context.json(createRealtimeVoiceGatewayPosture({
      bunAvailable: false,
      pythonBackendDependenciesInstalled: false,
      pythonInferenceRuntimeInstalled: false,
    })));
  return app;
}

async function handleHonoHttpRequest(app: Hono, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const webRequest = new Request(`http://${request.headers.host ?? "127.0.0.1"}${request.url ?? "/"}`, {
    method: request.method ?? "GET",
    headers: nodeHeadersToWebHeaders(request),
  });
  const webResponse = await app.fetch(webRequest);
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function nodeHeadersToWebHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

function sendJson(socket: WebSocket, body: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(body));
  }
}

function parseJsonFrame(data: RawData): { type?: string } | null {
  try {
    const text = toBuffer(data).toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as { type?: string } : null;
  } catch {
    return null;
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function writeNodeJson(response: ServerResponse, body: Record<string, unknown>, statusCode = 200): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function listen(server: NodeHttpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function serverPort(server: NodeHttpServer): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port");
  }
  return address.port;
}

async function stopServers(websocketServer: WebSocketServer, server: NodeHttpServer): Promise<void> {
  await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
