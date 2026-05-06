import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
};

export type GodotQuestVoiceEvidence = {
  schemaVersion?: string;
  generatedAt?: string;
  classification?: {
    lane?: string;
    scope?: string;
    notEvidenceFor?: string[];
  };
  device?: {
    app?: string;
    performedOnPhysicalQuest3?: boolean;
    headsetConnectedViaUsbC?: boolean;
    godotVersion?: string;
    buildProfile?: string;
  };
  gateway?: {
    endpoint?: string;
    serverRuntime?: string;
    cloudApisUsed?: boolean;
    paidApisUsed?: boolean;
    http3Enabled?: boolean;
    webTransportUsed?: boolean;
    quicUsed?: boolean;
    web3Used?: boolean;
  };
  transport?: {
    webSocketConnected?: boolean;
    jsonControlFramesObserved?: string[];
    binaryPacketsSent?: number;
    binaryPacketsReceived?: number;
    binaryRoundTripObserved?: boolean;
    firstBinaryRoundTripLatencyMs?: number | null;
    reconnects?: number;
  };
  audio?: {
    microphoneCaptureObserved?: boolean;
    opusEncodeDecodeObserved?: boolean;
    playbackObserved?: boolean;
    codec?: string;
    sampleRateHz?: number;
  };
  latency?: {
    endToEndLatencyMs?: {
      firstPacket?: number | null;
      p50?: number | null;
      p95?: number | null;
      sampleCount?: number;
    };
  };
  safety?: {
    rawAudioCommitted?: boolean;
    noCloudApis?: boolean;
    noPaidApis?: boolean;
  };
  claims?: {
    readyForProductionRuntime?: boolean;
    readyForClinicalVoiceUse?: boolean;
    readyForLowLatencyVoiceClaim?: boolean;
  };
};

export type GodotQuestVoiceEvidenceReadiness = {
  readyForBinaryTransportEvidence: boolean;
  readyForQuestAudioPipelineEvidence: boolean;
  readyForLatencyMeasurementEvidence: boolean;
  readyForProductionRuntime: false;
  readyForClinicalVoiceClaim: false;
  blockers: string[];
  satisfiedConditions: string[];
  nextSteps: string[];
};

export type GodotQuestVoiceEvidenceReport = {
  generatedAt: string;
  inputFile?: string;
  evidence: GodotQuestVoiceEvidence;
  result: GodotQuestVoiceEvidenceReadiness;
};

const requiredNotEvidenceFor = [
  "production_voice_runtime_readiness",
  "clinical_voice_dialog_quality",
  "grok_voice_parity",
  "webxr_client_readiness",
  "low_latency_voice_readiness",
] as const;

const requiredJsonControlFrames = [
  "voice.start",
  "voice.audio_metadata",
  "voice.stop",
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const evidence = JSON.parse(await readFile(options.inputPath, "utf8")) as GodotQuestVoiceEvidence;
  const report = buildGodotQuestVoiceEvidenceReport({
    inputFile: options.inputPath,
    evidence,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.readyForBinaryTransportEvidence) {
    process.exitCode = 1;
  }
}

export function buildGodotQuestVoiceEvidenceReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: GodotQuestVoiceEvidence;
}): GodotQuestVoiceEvidenceReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateGodotQuestVoiceEvidence(input.evidence),
  };
}

export function evaluateGodotQuestVoiceEvidence(
  evidence: GodotQuestVoiceEvidence,
): GodotQuestVoiceEvidenceReadiness {
  const blockers = [
    ...schemaBoundaryBlockers(evidence),
    ...policyBoundaryBlockers(evidence),
    ...transportBlockers(evidence),
    ...audioBlockers(evidence),
    ...latencyBlockers(evidence),
    ...claimBoundaryBlockers(evidence),
  ];
  const uniqueBlockers = uniqueStrings(blockers);
  const readyForBinaryTransportEvidence = !uniqueBlockers.some((blocker) => (
    blocker.includes("websocket")
    || blocker.includes("binary")
    || blocker.includes("json_control")
    || blocker.includes("physical_quest")
    || blocker.includes("endpoint")
    || blocker.includes("schema_version")
    || blocker.includes("classification")
    || blocker.includes("app_not")
    || blocker.includes("raw_audio")
  ));
  const readyForQuestAudioPipelineEvidence = readyForBinaryTransportEvidence
    && !uniqueBlockers.some((blocker) => (
      blocker.includes("microphone")
      || blocker.includes("opus")
      || blocker.includes("playback")
      || blocker.includes("sample_rate")
      || blocker.includes("codec")
    ));
  const readyForLatencyMeasurementEvidence = readyForQuestAudioPipelineEvidence
    && !uniqueBlockers.some((blocker) => blocker.startsWith("latency_"));

  return {
    readyForBinaryTransportEvidence,
    readyForQuestAudioPipelineEvidence,
    readyForLatencyMeasurementEvidence,
    readyForProductionRuntime: false,
    readyForClinicalVoiceClaim: false,
    blockers: uniqueBlockers,
    satisfiedConditions: satisfiedConditions(evidence, {
      readyForBinaryTransportEvidence,
      readyForQuestAudioPipelineEvidence,
      readyForLatencyMeasurementEvidence,
      blockers: uniqueBlockers,
    }),
    nextSteps: nextSteps(uniqueBlockers),
  };
}

function schemaBoundaryBlockers(evidence: GodotQuestVoiceEvidence): string[] {
  const notEvidenceFor = evidence.classification?.notEvidenceFor ?? [];
  return [
    evidence.schemaVersion === "openclinxr.godot-quest-voice-evidence.v1"
      ? undefined
      : "schema_version_not_godot_quest_voice_evidence_v1",
    evidence.classification?.lane === "godot_quest_voice_transport"
      ? undefined
      : "classification_lane_not_godot_quest_voice_transport",
    evidence.classification?.scope === "physical_quest_developer_evidence"
      ? undefined
      : "classification_scope_not_physical_quest_developer_evidence",
    evidence.device?.app === "apps/ui-quest-voice-godot" ? undefined : "device_app_not_godot_sidecar",
    evidence.device?.performedOnPhysicalQuest3 === true ? undefined : "physical_quest3_device_not_confirmed",
    evidence.device?.headsetConnectedViaUsbC === true ? undefined : "quest_usb_c_connection_not_confirmed",
    typeof evidence.device?.godotVersion === "string" && evidence.device.godotVersion.trim().length > 0
      ? undefined
      : "godot_version_missing",
    ...requiredNotEvidenceFor.map((claim) => (
      notEvidenceFor.includes(claim) ? undefined : `missing_not_evidence_for_${claim}`
    )),
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function policyBoundaryBlockers(evidence: GodotQuestVoiceEvidence): string[] {
  return [
    evidence.gateway?.cloudApisUsed === false && evidence.safety?.noCloudApis === true
      ? undefined
      : "cloud_apis_used",
    evidence.gateway?.paidApisUsed === false && evidence.safety?.noPaidApis === true
      ? undefined
      : "paid_apis_used",
    evidence.gateway?.http3Enabled === false ? undefined : "http3_enabled_outside_current_godot_voice_evidence_scope",
    evidence.gateway?.webTransportUsed === false
      ? undefined
      : "webtransport_used_outside_current_godot_voice_evidence_scope",
    evidence.gateway?.quicUsed === false ? undefined : "quic_used_outside_current_godot_voice_evidence_scope",
    evidence.gateway?.web3Used === false ? undefined : "web3_used_outside_current_godot_voice_evidence_scope",
    evidence.safety?.rawAudioCommitted === false ? undefined : "raw_audio_committed",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function transportBlockers(evidence: GodotQuestVoiceEvidence): string[] {
  const observedFrames = evidence.transport?.jsonControlFramesObserved ?? [];
  return [
    isLocalWebSocketUrl(evidence.gateway?.endpoint) ? undefined : "gateway_endpoint_not_local_websocket",
    evidence.gateway?.serverRuntime === "bun_hono_gateway" ? undefined : "server_runtime_not_bun_hono_gateway",
    evidence.transport?.webSocketConnected === true ? undefined : "websocket_not_connected",
    ...requiredJsonControlFrames.map((frame) => (
      observedFrames.includes(frame) ? undefined : `json_control_frame_missing:${frame}`
    )),
    positiveInteger(evidence.transport?.binaryPacketsSent) ? undefined : "binary_packets_sent_missing",
    positiveInteger(evidence.transport?.binaryPacketsReceived) ? undefined : "binary_packets_received_missing",
    evidence.transport?.binaryRoundTripObserved === true ? undefined : "binary_roundtrip_not_observed",
    positiveNumber(evidence.transport?.firstBinaryRoundTripLatencyMs)
      ? undefined
      : "binary_first_roundtrip_latency_missing_or_nonpositive",
    nonNegativeInteger(evidence.transport?.reconnects) ? undefined : "reconnect_count_missing_or_invalid",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function audioBlockers(evidence: GodotQuestVoiceEvidence): string[] {
  return [
    evidence.audio?.microphoneCaptureObserved === true ? undefined : "quest_microphone_capture_not_observed",
    evidence.audio?.opusEncodeDecodeObserved === true ? undefined : "opus_encode_decode_not_observed",
    evidence.audio?.playbackObserved === true ? undefined : "quest_playback_not_observed",
    evidence.audio?.codec === "opus" ? undefined : "codec_not_opus",
    evidence.audio?.sampleRateHz === 48000 ? undefined : "sample_rate_not_48000_hz",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function latencyBlockers(evidence: GodotQuestVoiceEvidence): string[] {
  const latency = evidence.latency?.endToEndLatencyMs;
  const p50 = latency?.p50;
  const p95 = latency?.p95;
  return [
    positiveNumber(latency?.firstPacket) ? undefined : "latency_first_packet_missing_or_nonpositive",
    positiveNumber(p50) ? undefined : "latency_p50_missing_or_nonpositive",
    positiveNumber(p95) ? undefined : "latency_p95_missing_or_nonpositive",
    Number.isFinite(p50) && Number.isFinite(p95) && Number(p95) >= Number(p50) ? undefined : "latency_p95_less_than_p50",
    typeof latency?.sampleCount === "number" && Number.isInteger(latency.sampleCount) && latency.sampleCount >= 10
      ? undefined
      : "latency_sample_count_under_10",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function claimBoundaryBlockers(evidence: GodotQuestVoiceEvidence): string[] {
  return [
    evidence.claims?.readyForProductionRuntime === false ? undefined : "ready_for_production_runtime_must_be_false",
    evidence.claims?.readyForClinicalVoiceUse === false ? undefined : "ready_for_clinical_voice_use_must_be_false",
    evidence.claims?.readyForLowLatencyVoiceClaim === false ? undefined : "ready_for_low_latency_voice_claim_must_be_false",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function satisfiedConditions(
  evidence: GodotQuestVoiceEvidence,
  result: Pick<
    GodotQuestVoiceEvidenceReadiness,
    "readyForBinaryTransportEvidence" | "readyForQuestAudioPipelineEvidence" | "readyForLatencyMeasurementEvidence" | "blockers"
  >,
): string[] {
  return [
    evidence.schemaVersion === "openclinxr.godot-quest-voice-evidence.v1"
      ? "schema_version_godot_quest_voice_evidence_v1"
      : undefined,
    evidence.classification?.lane === "godot_quest_voice_transport"
    && evidence.classification.scope === "physical_quest_developer_evidence"
      ? "classification_physical_quest_developer_evidence"
      : undefined,
    evidence.device?.performedOnPhysicalQuest3 === true && evidence.device.headsetConnectedViaUsbC === true
      ? "physical_quest3_device_recorded"
      : undefined,
    isLocalWebSocketUrl(evidence.gateway?.endpoint) && evidence.gateway?.serverRuntime === "bun_hono_gateway"
      ? "local_websocket_gateway_recorded"
      : undefined,
    result.readyForBinaryTransportEvidence ? "binary_websocket_roundtrip_observed" : undefined,
    result.readyForQuestAudioPipelineEvidence ? "quest_microphone_codec_playback_observed" : undefined,
    result.readyForLatencyMeasurementEvidence ? "latency_measurement_recorded_without_low_latency_claim" : undefined,
    evidence.claims?.readyForProductionRuntime === false
    && evidence.claims.readyForClinicalVoiceUse === false
    && evidence.claims.readyForLowLatencyVoiceClaim === false
      ? "safety_boundaries_preserved"
      : undefined,
  ].filter((condition): condition is string => typeof condition === "string");
}

function nextSteps(blockers: string[]): string[] {
  const steps = [
    blockers.some((blocker) => blocker.includes("physical_quest3") || blocker.includes("usb_c"))
      ? "Run the Godot sidecar on the physical Quest 3 over USB-C and record device/build metadata."
      : undefined,
    blockers.some((blocker) => blocker.includes("websocket") || blocker.includes("binary") || blocker.includes("json_control"))
      ? "Connect the sidecar to the local Bun/Hono gateway and capture JSON control plus binary packet round-trip evidence."
      : undefined,
    blockers.some((blocker) => blocker.includes("microphone") || blocker.includes("opus") || blocker.includes("playback"))
      ? "Record separate Quest microphone capture, Opus encode/decode, and playback observations before claiming audio-pipeline evidence."
      : undefined,
    blockers.some((blocker) => blocker.startsWith("latency_"))
      ? "Capture at least 10 end-to-end Quest audio latency samples with first-packet, p50, and p95 values."
      : undefined,
    blockers.some((blocker) => blocker.includes("cloud") || blocker.includes("paid") || blocker.includes("http3")
      || blocker.includes("webtransport") || blocker.includes("quic") || blocker.includes("web3"))
      ? "Keep this evidence lane local WebSocket-only; move HTTP/3, WebTransport, QUIC, Web3, cloud, or paid usage to separate approvals."
      : undefined,
  ].filter((step): step is string => typeof step === "string");
  return uniqueStrings(steps);
}

function isLocalWebSocketUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "ws:" || parsed.protocol === "wss:")
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
  } catch {
    return false;
  }
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--input") {
      options.inputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
