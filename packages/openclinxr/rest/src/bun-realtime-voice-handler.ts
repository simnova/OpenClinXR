import { supportedRealtimeVoiceControlTypes } from "./protocol-posture-readers.js";
/**
 * Bun realtime voice WebSocket handler and server config (moved from apps/api composition root).
 *
 * This module contains the Bun-specific WebSocket handling logic for the realtime voice gateway.
 */

import type {
  BunServerConfigOptions,
  BunRealtimeVoiceWebSocket,
  BunRealtimeVoiceBackendWebSocket,
  BunRealtimeVoiceBackendWebSocketFactory,
  BunRealtimeVoiceWebSocketHandler,
  StartedOpenClinXrApi,
  BunServerConfig,
} from "./api-types.js";
import { isRealtimeVoiceWebSocketUpgradeRequest } from "./protocol-posture-validation.js";
import { createOpenClinXrApiProtocolPosture } from "./protocol-support.js";
import {
  isSupportedRealtimeVoiceControlType,
  isRecord,
} from "./protocol-posture-validation.js";
import { realtimeVoiceProtocol } from "@openclinxr/voice-gateway";

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

function defaultBunRealtimeVoiceBackendWebSocketFactory(): BunRealtimeVoiceBackendWebSocketFactory | undefined {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
  return WebSocketCtor ? (url) => new WebSocketCtor(url) as BunRealtimeVoiceBackendWebSocket : undefined;
}

function flushQueuedBackendFrames(socket: BunRealtimeVoiceWebSocket): void {
  const data = socket.data;
  const backendSocket = data?.backendSocket;
  if (data === undefined || backendSocket === undefined || backendSocket.readyState !== 1) {
    return;
  }
  for (const frame of data.queuedBackendFrames.splice(0)) {
    backendSocket.send(frame);
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

function acknowledgeRealtimeVoiceControlFrame(
  socket: BunRealtimeVoiceWebSocket,
  payload: string,
): void {
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

  const controlType = typeof control["type"] === "string" ? control["type"] : "control";
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
  if (
    controlType === realtimeVoiceProtocol.clientControlFrames.start ||
    controlType === "start" ||
    controlType === "commit" ||
    controlType === "flush"
  ) {
    sendBunWebSocketJson(socket, {
      type: "transcript.metadata",
      status: "ready",
      controlType,
    });
  }
}

export function createBunRealtimeVoiceWebSocketHandler(
  options: {
    pythonBackendWebSocketUrl?: string;
    backendWebSocketFactory?: BunRealtimeVoiceBackendWebSocketFactory;
  } = {},
): BunRealtimeVoiceWebSocketHandler {
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

function createDefaultOpenClinXrApiStartup(): StartedOpenClinXrApi {
  return {
    fetch: async () => new Response("OK"),
    handlerSpecs: [],
    infrastructureServiceIds: [],
    primaryRuntimeTarget: "bun-hono",
    localFallbackRuntimeTarget: "node-hono",
    protocolSupport: createOpenClinXrApiProtocolPosture({}).protocols,
  };
}

export function createBunServerConfig(
  startup: StartedOpenClinXrApi = createDefaultOpenClinXrApiStartup(),
  options: BunServerConfigOptions = {},
): BunServerConfig {
  const websocketOptions = {
    ...(options.pythonBackendWebSocketUrl ? { pythonBackendWebSocketUrl: options.pythonBackendWebSocketUrl } : {}),
    ...(options.backendWebSocketFactory ? { backendWebSocketFactory: options.backendWebSocketFactory } : {}),
  };

  return {
    runtime: "bun-hono",
    fetch: startup.fetch,
    port: options.port ?? Number(process.env["PORT"] ?? 3000),
    websocketPath: "/voice/realtime/ws",
    canUpgradeWebSocketRequest: isRealtimeVoiceWebSocketUpgradeRequest,
    websocket: createBunRealtimeVoiceWebSocketHandler(websocketOptions),
    protocolSupport: startup.protocolSupport,
  };
}