import { supportedRealtimeVoiceControlTypes } from "./protocol-posture-readers.js";
/**
 * Protocol posture validation predicates (moved from apps/api composition root).
 *
 * Validator-only module: predicates whose names start with is/validate/parse/assert.
 * Readers and factories stay in protocol-posture-readers.ts.
 */

import type {
  OpenClinXrApiProtocolPostureEnvironment,
} from "./api-types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const _realtimeVoiceProtocol = {
  clientControlFrames: {
    start: "voice.start",
    stop: "voice.stop",
    audioMetadata: "voice.audio_metadata",
  },
  serverEvents: {
    backendReady: "backend.ready",
    backendError: "backend.error",
    voiceStarted: "voice.started",
    voiceStopped: "voice.stopped",
    audioChunk: "audio.chunk",
    transcriptPartial: "transcript.partial",
    transcriptFinal: "transcript.final",
  },
} as const;

export function isPassedApiBunWebSocketRuntimeSmokeEvidence(value: unknown): boolean {
  if (!isRecord(value) || value["status"] !== "passed") {
    return false;
  }

  const runtimeEvidenceBlockers = parseStringArray(value["runtimeEvidenceBlockers"]);
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

export function isProtocolPostureEvidenceDiscoverySuppressed(
  environment: OpenClinXrApiProtocolPostureEnvironment,
): boolean {
  return (
    environment["VITEST"] === "true" ||
    environment["NODE_ENV"] === "test" ||
    process.env["VITEST"] === "true" ||
    process.env["NODE_ENV"] === "test"
  );
}

export function isRealtimeVoiceWebSocketUpgradeRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === "/voice/realtime/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export function isSupportedRealtimeVoiceControlType(controlType: string): boolean {
  return supportedRealtimeVoiceControlTypes().includes(controlType);
}