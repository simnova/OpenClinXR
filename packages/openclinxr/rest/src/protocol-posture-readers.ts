/**
 * Protocol posture readers and factories (moved from apps/api composition root).
 *
 * Readers and factories module: functions that read environment/evidence
 * and create posture objects. Validators stay in protocol-posture-validation.ts.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  OpenClinXrApiProtocolPostureEnvironment,
  OpenClinXrApiProtocolPostureEnvironmentOptions,
  BunRealtimeVoiceGatewayPostureEnvironment,
  BunRealtimeVoiceGatewayPostureEnvironmentOptions,
} from "./api-types.js";
import type { OpenClinXrApiProtocolPosture } from "./protocol-support.js";
import type { RealtimeVoiceGatewayPostureInput } from "@openclinxr/voice-gateway";
import { realtimeVoiceProtocol } from "@openclinxr/voice-gateway";
import { createOpenClinXrApiProtocolPosture } from "./protocol-support.js";
import {
  isPassedApiBunWebSocketRuntimeSmokeEvidence,
  isProtocolPostureEvidenceDiscoverySuppressed,
  isRecord,
  parseStringArray,
  parseFiniteNumber,
} from "./protocol-posture-validation.js";

export function readOptionalEvidenceFile(
  filePath: string,
  options:
    | BunRealtimeVoiceGatewayPostureEnvironmentOptions
    | OpenClinXrApiProtocolPostureEnvironmentOptions,
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

export function resolveRepoRelativePath(relativePath: string): string {
  const direct = path.resolve(process.cwd(), relativePath);
  if (existsSync(direct)) {
    return direct;
  }
  return path.resolve(process.cwd(), "../..", relativePath);
}

export function findLatestApiBunWebSocketRuntimeSmokeEvidencePath(): string | undefined {
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

export function resolveApiBunWebSocketRuntimeEvidencePath(
  environment: OpenClinXrApiProtocolPostureEnvironment,
  options: OpenClinXrApiProtocolPostureEnvironmentOptions,
): string | undefined {
  const configuredPath =
    environment.OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE ??
    environment.OPENCLINXR_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE;
  if (configuredPath) {
    return configuredPath;
  }

  const shouldDiscover =
    options.discoverLatestSmokeEvidence ??
    !isProtocolPostureEvidenceDiscoverySuppressed(environment);
  if (!shouldDiscover) {
    return undefined;
  }

  return findLatestApiBunWebSocketRuntimeSmokeEvidencePath();
}

export function readOptionalProtocolPostureEvidenceFile(
  filePath: string,
  options: OpenClinXrApiProtocolPostureEnvironmentOptions,
): unknown {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : resolveRepoRelativePath(filePath);
  return readOptionalEvidenceFile(resolvedPath, options);
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

export function createOpenClinXrApiProtocolPostureFromEnvironment(
  environment: OpenClinXrApiProtocolPostureEnvironment = {},
  options: OpenClinXrApiProtocolPostureEnvironmentOptions = {},
): OpenClinXrApiProtocolPosture {
  return createOpenClinXrApiProtocolPosture({
    apiBunWebSocketRuntimeVerified: readApiBunWebSocketRuntimeVerifiedFromEnvironment(environment, options),
  });
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
  if (!isRecord(rawEvidence) || rawEvidence["status"] !== "passed") {
    return undefined;
  }
  const websocket = isRecord(rawEvidence["websocket"]) ? rawEvidence["websocket"] : {};
  const eventTypesObserved = parseStringArray((websocket as Record<string, unknown>)["eventTypesObserved"]);
  const binaryMessages = parseFiniteNumber((websocket as Record<string, unknown>)["binaryMessages"]);
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
    ...(typeof rawEvidence["generatedAt"] === "string" ? { generatedAt: rawEvidence["generatedAt"] } : {}),
    status: "passed" as const,
    eventTypesObserved,
    binaryMessages,
    backendProtocolObserved: websocket["backendProtocolObserved"] === true,
    latencyFieldsObserved: websocket["latencyFieldsObserved"] === true,
    binaryEchoObserved: websocket["binaryEchoObserved"] === true,
  };

  return evidence.binaryMessages > 0 &&
    evidence["backendProtocolObserved"] &&
    evidence["latencyFieldsObserved"] &&
    evidence["binaryEchoObserved"] &&
    canonicalEventsObserved
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
  if (!isRecord(rawEvidence) || rawEvidence["status"] !== "passed") {
    return false;
  }

  const python = isRecord(rawEvidence["python"]) ? rawEvidence["python"] : {};
  const dependencies = isRecord(python["dependencies"]) ? python["dependencies"] : {};
  const health = isRecord(rawEvidence["health"]) ? rawEvidence["health"] : {};
  const capabilities = isRecord(rawEvidence["capabilities"]) ? rawEvidence["capabilities"] : {};
  const websocket = isRecord(rawEvidence["websocket"]) ? rawEvidence["websocket"] : {};
  const protocol = isRecord(websocket["protocol"]) ? websocket["protocol"] : {};
  const missingPackages = parseStringArray(python["missingPackages"]);
  const serverEventTypesObserved = parseStringArray(protocol["serverEventTypesObserved"]);
  const canonicalServerEventsObserved = [
    realtimeVoiceProtocol.serverEvents.backendReady,
    realtimeVoiceProtocol.serverEvents.voiceStarted,
    realtimeVoiceProtocol.serverEvents.audioChunk,
    realtimeVoiceProtocol.serverEvents.transcriptPartial,
    realtimeVoiceProtocol.serverEvents.transcriptFinal,
    realtimeVoiceProtocol.serverEvents.voiceStopped,
  ].every((eventType) => serverEventTypesObserved.includes(eventType));

  return (
    dependencies["fastapi"] === "available" &&
    dependencies["uvicorn"] === "available" &&
    dependencies["websockets"] === "available" &&
    missingPackages.length === 0 &&
    health["ok"] === true &&
    capabilities["ok"] === true &&
    websocket["connected"] === true &&
    protocol["canonicalProtocolObserved"] === true &&
    protocol["backendProtocolObserved"] === true &&
    protocol["latencyFieldsObserved"] === true &&
    websocket["binaryEchoObserved"] === true &&
    canonicalServerEventsObserved
  );
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

export function supportedRealtimeVoiceControlTypes(): string[] {
  return [
    realtimeVoiceProtocol.clientControlFrames.start,
    realtimeVoiceProtocol.clientControlFrames.stop,
    realtimeVoiceProtocol.clientControlFrames.audioMetadata,
    "start",
    "commit",
    "flush",
  ];
}
