import { pathToFileURL } from "node:url";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  MockVoiceProviderAdapter,
} from "../../packages/openclinxr/voice-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  runtimeReportPath?: string;
  outputPath?: string;
  webxrPlaybackObserved?: boolean;
  realLocalVoiceStreamObserved?: boolean;
  firstAudiblePlaybackLatencyMs?: number;
  transcriptRoundTripObserved?: boolean;
};

export type LocalVoiceRuntimeBenchmarkReport = {
  generatedAt: string;
  status: string;
  policy: {
    cloudApisUsed: boolean;
    paidApisUsed: boolean;
    voiceInstallApproved: boolean;
    voiceSafetyReviewApproved: boolean;
    productionUseAllowed: boolean;
    generatedAudioCommitted: boolean;
  };
  runtime: Record<string, unknown>;
  audio: Record<string, unknown>;
  metrics: Record<string, unknown>;
  verdict: {
    passed: boolean;
    blockers: string[];
    caveats: string[];
  };
};

export type LocalVoiceLiveDialogBenchmarkReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    voiceRuntimeExecutionAllowed: false;
    productionUseAllowed: false;
    generatedAudioCommitted: boolean;
  };
  input: {
    runtimeBenchmarkFile: string;
    runtimeGeneratedAt: string;
    modelId: string | null;
    runtimeStatus: string;
  };
  mockStream: {
    provider: "deterministic-mock-voice-gateway";
    transcriptEvents: number;
    audioChunks: number;
    firstAudiblePlaybackLatencyMs: number | null;
    visemeCuesPresent: boolean;
    passed: boolean;
    blockers: string[];
  };
  runtimeFit: {
    fileGenerationOnly: boolean;
    realTimeFactor: number | null;
    realTimeCapable: boolean;
    blockers: string[];
  };
  runtimeStream: {
    realLocalVoiceStreamObserved: boolean;
    evidenceSource: "not_captured" | "local_voice_runtime_stream";
    firstAudiblePlaybackLatencyMs: number | null;
    transcriptRoundTripObserved: boolean;
    blockers: string[];
  };
  webxrPlayback: {
    observed: boolean;
    evidenceSource: "not_captured" | "operator_or_cdp_capture";
    blockers: string[];
  };
  safetyControls: {
    disclosureRequired: boolean;
    generatedAudioCommitted: boolean;
    misuseControlsRequired: boolean;
    retentionPolicyObserved: boolean;
    blockers: string[];
  };
  verdict: {
    passed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runtimeReportPath = options.runtimeReportPath ?? await latestRuntimeReportPath();
  if (!runtimeReportPath) {
    throw new Error("Missing local voice runtime benchmark report. Run the approved local voice benchmark first or pass --runtime-report.");
  }

  const report = await buildLocalVoiceLiveDialogBenchmarkReport({
    runtimeBenchmarkFile: runtimeReportPath,
    runtimeBenchmark: await readJson<LocalVoiceRuntimeBenchmarkReport>(runtimeReportPath),
    webxrPlaybackObserved: options.webxrPlaybackObserved,
    realLocalVoiceStreamObserved: options.realLocalVoiceStreamObserved,
    firstAudiblePlaybackLatencyMs: options.firstAudiblePlaybackLatencyMs,
    transcriptRoundTripObserved: options.transcriptRoundTripObserved,
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--runtime-report") {
      options.runtimeReportPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--webxr-playback-observed") {
      options.webxrPlaybackObserved = true;
      continue;
    }
    if (arg === "--real-local-voice-stream-observed") {
      options.realLocalVoiceStreamObserved = true;
      continue;
    }
    if (arg === "--first-audible-playback-latency-ms") {
      options.firstAudiblePlaybackLatencyMs = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--transcript-round-trip-observed") {
      options.transcriptRoundTripObserved = true;
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

async function latestRuntimeReportPath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/local-voice-runtime-benchmark-*.json");
  return files.sort().at(-1);
}

export async function buildLocalVoiceLiveDialogBenchmarkReport(input: {
  generatedAt?: string;
  runtimeBenchmarkFile: string;
  runtimeBenchmark: LocalVoiceRuntimeBenchmarkReport;
  webxrPlaybackObserved?: boolean;
  realLocalVoiceStreamObserved?: boolean;
  firstAudiblePlaybackLatencyMs?: number;
  transcriptRoundTripObserved?: boolean;
}): Promise<LocalVoiceLiveDialogBenchmarkReport> {
  const mockStream = await runMockStreamProbe();
  const runtimeFit = inspectRuntimeFit(input.runtimeBenchmark);
  const runtimeStream = inspectRuntimeStream({
    realLocalVoiceStreamObserved: input.realLocalVoiceStreamObserved ?? false,
    firstAudiblePlaybackLatencyMs: input.firstAudiblePlaybackLatencyMs,
    transcriptRoundTripObserved: input.transcriptRoundTripObserved ?? false,
  });
  const webxrPlayback = inspectWebxrPlayback(input.webxrPlaybackObserved ?? false);
  const safetyControls = inspectSafetyControls(input.runtimeBenchmark);
  const blockers = [
    ...mockStream.blockers.map((blocker) => `mock_stream:${blocker}`),
    ...runtimeStream.blockers.map((blocker) => `runtime_stream:${blocker}`),
    ...runtimeFit.blockers.map((blocker) => `runtime:${blocker}`),
    ...webxrPlayback.blockers.map((blocker) => `webxr_playback:${blocker}`),
    ...safetyControls.blockers.map((blocker) => `safety_controls:${blocker}`),
  ];
  const passed = blockers.length === 0;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      voiceRuntimeExecutionAllowed: false,
      productionUseAllowed: false,
      generatedAudioCommitted: input.runtimeBenchmark.policy.generatedAudioCommitted,
    },
    input: {
      runtimeBenchmarkFile: input.runtimeBenchmarkFile,
      runtimeGeneratedAt: input.runtimeBenchmark.generatedAt,
      modelId: stringValue(input.runtimeBenchmark.runtime.modelId),
      runtimeStatus: input.runtimeBenchmark.status,
    },
    mockStream,
    runtimeFit,
    runtimeStream,
    webxrPlayback,
    safetyControls,
    verdict: {
      passed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "Mock stream evidence proves gateway event shape only; it is not a real VibeVoice streaming or Quest playback capture.",
        "The source runtime benchmark is an existing file-generation smoke; this live-dialog report does not execute a voice runtime.",
      ],
    },
  };
}

async function runMockStreamProbe(): Promise<LocalVoiceLiveDialogBenchmarkReport["mockStream"]> {
  const gateway = createDefaultVoiceGateway({
    routeId: "voice-live-dialog-quality-benchmark-v1",
    adapters: [new MockVoiceProviderAdapter()],
  });
  const policy = {
    requestPolicyId: "voice-live-dialog-quality-benchmark-v1",
    safetyPolicyVersion: "clinical-simulation-safety-v1",
  };
  const transcript = await collectVoiceStream(gateway.transcribe({
    stationRunId: "voice_quality_benchmark_run_001",
    streamId: "learner-mic-001",
    language: "en-US",
    audioFormat: "mock/pcm",
    policy,
  }));
  const audio = await collectVoiceStream(gateway.synthesize({
    stationRunId: "voice_quality_benchmark_run_001",
    actorId: "patient_robert_hayes_v1",
    voiceId: "mock-robert-hayes",
    text: "The chest pressure is getting worse.",
    policy,
  }));
  const blockers = [
    transcript.length === 0 ? "missing_transcript_events" : undefined,
    audio.length === 0 ? "missing_audio_chunks" : undefined,
    audio.some((event) => !event.visemeCue) ? "missing_viseme_cues" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    provider: "deterministic-mock-voice-gateway",
    transcriptEvents: transcript.length,
    audioChunks: audio.length,
    firstAudiblePlaybackLatencyMs: audio[0]?.provenance.latencyMs ?? null,
    visemeCuesPresent: audio.length > 0 && audio.every((event) => Boolean(event.visemeCue)),
    passed: blockers.length === 0,
    blockers,
  };
}

function inspectRuntimeFit(report: LocalVoiceRuntimeBenchmarkReport): LocalVoiceLiveDialogBenchmarkReport["runtimeFit"] {
  const caveats = report.verdict.caveats.map((caveat) => caveat.toLowerCase());
  const fileGenerationOnly = caveats.some((caveat) => caveat.includes("file-based") || caveat.includes("file generation"));
  const realTimeFactor = numberMetric(report.metrics.realTimeFactor);
  const realTimeCapable = realTimeFactor !== null && realTimeFactor <= 1;
  const blockers = [
    fileGenerationOnly ? "runtime_file_generation_only" : undefined,
    realTimeCapable ? undefined : "real_time_factor_above_1",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    fileGenerationOnly,
    realTimeFactor,
    realTimeCapable,
    blockers,
  };
}

function inspectRuntimeStream(input: {
  realLocalVoiceStreamObserved: boolean;
  firstAudiblePlaybackLatencyMs?: number;
  transcriptRoundTripObserved: boolean;
}): LocalVoiceLiveDialogBenchmarkReport["runtimeStream"] {
  const firstAudiblePlaybackLatencyMs = typeof input.firstAudiblePlaybackLatencyMs === "number" && Number.isFinite(input.firstAudiblePlaybackLatencyMs)
    ? input.firstAudiblePlaybackLatencyMs
    : null;
  const blockers = [
    input.realLocalVoiceStreamObserved ? undefined : "real_local_voice_stream_benchmark_missing",
    input.realLocalVoiceStreamObserved && firstAudiblePlaybackLatencyMs === null ? "first_audible_playback_latency_missing" : undefined,
    input.realLocalVoiceStreamObserved && !input.transcriptRoundTripObserved ? "transcript_round_trip_not_observed" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    realLocalVoiceStreamObserved: input.realLocalVoiceStreamObserved,
    evidenceSource: input.realLocalVoiceStreamObserved ? "local_voice_runtime_stream" : "not_captured",
    firstAudiblePlaybackLatencyMs,
    transcriptRoundTripObserved: input.transcriptRoundTripObserved,
    blockers,
  };
}

function inspectWebxrPlayback(observed: boolean): LocalVoiceLiveDialogBenchmarkReport["webxrPlayback"] {
  return {
    observed,
    evidenceSource: observed ? "operator_or_cdp_capture" : "not_captured",
    blockers: observed ? [] : ["webxr_playback_not_observed"],
  };
}

function inspectSafetyControls(report: LocalVoiceRuntimeBenchmarkReport): LocalVoiceLiveDialogBenchmarkReport["safetyControls"] {
  const generatedAudioCommitted = report.policy.generatedAudioCommitted;
  const productionUseAllowed = report.policy.productionUseAllowed;
  const blockers = [
    productionUseAllowed ? "production_use_allowed_before_live_dialog_approval" : undefined,
    generatedAudioCommitted ? "generated_audio_committed" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    disclosureRequired: true,
    generatedAudioCommitted,
    misuseControlsRequired: true,
    retentionPolicyObserved: !generatedAudioCommitted,
    blockers,
  };
}

function numberMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a finite number`);
  }
  return parsed;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
