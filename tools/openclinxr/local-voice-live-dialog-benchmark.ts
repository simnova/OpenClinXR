import { pathToFileURL } from "node:url";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  MockVoiceProviderAdapter,
} from "../../packages/openclinxr/voice-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  runtimeReportPath?: string;
  modelCacheEvidencePath?: string;
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

export type LocalRealtimeVoiceModelCacheEvidenceReport = {
  kind: string;
  claim_scope?: string;
  generatedAt: string;
  cache_dir: string;
  approved_model_ids: string[];
  cache_exists: boolean;
  ready: boolean;
  models: Array<{
    model_id: string;
    approved?: boolean;
    ready: boolean;
    blockers: string[];
  }>;
  support_directories: Array<{
    name: string;
    reason: string;
  }>;
};

export type LocalVoiceLiveDialogBenchmarkReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: boolean;
    paidApisUsed: boolean;
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
    realPlaybackLatencyObserved: boolean;
    latencyEvidenceSource: "synthetic_mock" | "not_available";
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
  modelCache?: {
    evidenceFile: string | null;
    generatedAt: string | null;
    kind: string | null;
    claimScope: string | null;
    cacheDir: string | null;
    approvedModelIds: string[];
    cacheExists: boolean;
    ready: boolean;
    readyModelIds: string[];
    supportRuntimeObserved: boolean;
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  await runLocalVoiceLiveDialogBenchmarkCli(process.argv.slice(2));
}

export async function runLocalVoiceLiveDialogBenchmarkCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestLiveDialogReportPath();
    if (!validatePath) {
      throw new Error("Missing local voice live-dialog benchmark report to validate.");
    }
    const validation = validateLocalVoiceLiveDialogBenchmarkReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const runtimeReportPath = options.runtimeReportPath ?? await latestRuntimeReportPath();
  if (!runtimeReportPath) {
    throw new Error("Missing local voice runtime benchmark report. Run the approved local voice benchmark first or pass --runtime-report.");
  }
  const modelCacheEvidencePath = options.modelCacheEvidencePath ?? await latestModelCacheEvidencePath();

  const report = await buildLocalVoiceLiveDialogBenchmarkReport({
    runtimeBenchmarkFile: runtimeReportPath,
    runtimeBenchmark: await readJson<LocalVoiceRuntimeBenchmarkReport>(runtimeReportPath),
    modelCacheEvidenceFile: modelCacheEvidencePath,
    modelCacheEvidence: modelCacheEvidencePath
      ? await readJson<LocalRealtimeVoiceModelCacheEvidenceReport>(modelCacheEvidencePath)
      : undefined,
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
  const options: CliOptions = {
    validateLatest: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    if (arg === "--runtime-report") {
      options.runtimeReportPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model-cache-evidence") {
      options.modelCacheEvidencePath = requireValue(normalizedArgs, index, arg);
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

async function latestModelCacheEvidencePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/local-realtime-voice-model-cache-evidence-*.json");
  return files.sort().at(-1);
}

async function latestLiveDialogReportPath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/local-voice-live-dialog-benchmark-*.json");
  return files.sort().at(-1);
}

export async function buildLocalVoiceLiveDialogBenchmarkReport(input: {
  generatedAt?: string;
  runtimeBenchmarkFile: string;
  runtimeBenchmark: LocalVoiceRuntimeBenchmarkReport;
  modelCacheEvidenceFile?: string;
  modelCacheEvidence?: LocalRealtimeVoiceModelCacheEvidenceReport;
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
  const modelCache = inspectModelCache(input.modelCacheEvidenceFile, input.modelCacheEvidence);
  const safetyControls = inspectSafetyControls(input.runtimeBenchmark);
  const blockers = [
    ...mockStream.blockers.map((blocker) => `mock_stream:${blocker}`),
    ...runtimeStream.blockers.map((blocker) => `runtime_stream:${blocker}`),
    ...runtimeFit.blockers.map((blocker) => `runtime:${blocker}`),
    ...webxrPlayback.blockers.map((blocker) => `webxr_playback:${blocker}`),
    ...(modelCache?.blockers ?? []).map((blocker) => `model_cache:${blocker}`),
    ...safetyControls.blockers.map((blocker) => `safety_controls:${blocker}`),
  ];
  const passed = blockers.length === 0;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: input.runtimeBenchmark.policy.cloudApisUsed,
      paidApisUsed: input.runtimeBenchmark.policy.paidApisUsed,
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
    ...(modelCache ? { modelCache } : {}),
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

export function validateLocalVoiceLiveDialogBenchmarkReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  requireRecord(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireBoolean(value.policy.cloudApisUsed, "/policy/cloudApisUsed", errors);
    requireBoolean(value.policy.paidApisUsed, "/policy/paidApisUsed", errors);
    requireLiteral(value.policy.voiceRuntimeExecutionAllowed, false, "/policy/voiceRuntimeExecutionAllowed", errors);
    requireLiteral(value.policy.productionUseAllowed, false, "/policy/productionUseAllowed", errors);
    requireBoolean(value.policy.generatedAudioCommitted, "/policy/generatedAudioCommitted", errors);
  }
  requireRecord(value.input, "/input", errors);
  if (isRecord(value.input)) {
    requireString(value.input.runtimeBenchmarkFile, "/input/runtimeBenchmarkFile", errors);
    requireString(value.input.runtimeGeneratedAt, "/input/runtimeGeneratedAt", errors);
    requireNullableString(value.input.modelId, "/input/modelId", errors);
    requireString(value.input.runtimeStatus, "/input/runtimeStatus", errors);
  }
  validateMockStream(value.mockStream, errors);
  validateRuntimeFit(value.runtimeFit, errors);
  validateRuntimeStream(value.runtimeStream, errors);
  validateWebxrPlayback(value.webxrPlayback, errors);
  if (value.modelCache !== undefined) {
    validateModelCache(value.modelCache, errors);
  }
  validateSafetyControls(value.safetyControls, errors);
  requireRecord(value.verdict, "/verdict", errors);
  if (isRecord(value.verdict)) {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireLiteral(value.verdict.readyForLiveDialog, false, "/verdict/readyForLiveDialog", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
    requireStringArray(value.verdict.caveats, "/verdict/caveats", errors);
  }
  validateLiveDialogConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateMockStream(value: unknown, errors: string[]): void {
  requireRecord(value, "/mockStream", errors);
  if (!isRecord(value)) {
    return;
  }

  requireLiteral(value.provider, "deterministic-mock-voice-gateway", "/mockStream/provider", errors);
  requireNumber(value.transcriptEvents, "/mockStream/transcriptEvents", errors);
  requireNumber(value.audioChunks, "/mockStream/audioChunks", errors);
  requireNullableNumber(value.firstAudiblePlaybackLatencyMs, "/mockStream/firstAudiblePlaybackLatencyMs", errors);
  requireBoolean(value.realPlaybackLatencyObserved, "/mockStream/realPlaybackLatencyObserved", errors);
  requireOneOf(value.latencyEvidenceSource, ["synthetic_mock", "not_available"], "/mockStream/latencyEvidenceSource", errors);
  requireBoolean(value.visemeCuesPresent, "/mockStream/visemeCuesPresent", errors);
  requireBoolean(value.passed, "/mockStream/passed", errors);
  requireStringArray(value.blockers, "/mockStream/blockers", errors);
}

function validateRuntimeFit(value: unknown, errors: string[]): void {
  requireRecord(value, "/runtimeFit", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.fileGenerationOnly, "/runtimeFit/fileGenerationOnly", errors);
  requireNullableNumber(value.realTimeFactor, "/runtimeFit/realTimeFactor", errors);
  requireBoolean(value.realTimeCapable, "/runtimeFit/realTimeCapable", errors);
  requireStringArray(value.blockers, "/runtimeFit/blockers", errors);
}

function validateRuntimeStream(value: unknown, errors: string[]): void {
  requireRecord(value, "/runtimeStream", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.realLocalVoiceStreamObserved, "/runtimeStream/realLocalVoiceStreamObserved", errors);
  requireOneOf(value.evidenceSource, ["not_captured", "local_voice_runtime_stream"], "/runtimeStream/evidenceSource", errors);
  requireNullableNumber(value.firstAudiblePlaybackLatencyMs, "/runtimeStream/firstAudiblePlaybackLatencyMs", errors);
  requireBoolean(value.transcriptRoundTripObserved, "/runtimeStream/transcriptRoundTripObserved", errors);
  requireStringArray(value.blockers, "/runtimeStream/blockers", errors);
}

function validateWebxrPlayback(value: unknown, errors: string[]): void {
  requireRecord(value, "/webxrPlayback", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.observed, "/webxrPlayback/observed", errors);
  requireOneOf(value.evidenceSource, ["not_captured", "operator_or_cdp_capture"], "/webxrPlayback/evidenceSource", errors);
  requireStringArray(value.blockers, "/webxrPlayback/blockers", errors);
}

function validateModelCache(value: unknown, errors: string[]): void {
  requireRecord(value, "/modelCache", errors);
  if (!isRecord(value)) {
    return;
  }

  requireNullableString(value.evidenceFile, "/modelCache/evidenceFile", errors);
  requireNullableString(value.generatedAt, "/modelCache/generatedAt", errors);
  requireNullableString(value.kind, "/modelCache/kind", errors);
  requireNullableString(value.claimScope, "/modelCache/claimScope", errors);
  requireNullableString(value.cacheDir, "/modelCache/cacheDir", errors);
  requireStringArray(value.approvedModelIds, "/modelCache/approvedModelIds", errors);
  requireBoolean(value.cacheExists, "/modelCache/cacheExists", errors);
  requireBoolean(value.ready, "/modelCache/ready", errors);
  requireStringArray(value.readyModelIds, "/modelCache/readyModelIds", errors);
  requireBoolean(value.supportRuntimeObserved, "/modelCache/supportRuntimeObserved", errors);
  requireStringArray(value.blockers, "/modelCache/blockers", errors);
}

function validateSafetyControls(value: unknown, errors: string[]): void {
  requireRecord(value, "/safetyControls", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.disclosureRequired, "/safetyControls/disclosureRequired", errors);
  requireBoolean(value.generatedAudioCommitted, "/safetyControls/generatedAudioCommitted", errors);
  requireBoolean(value.misuseControlsRequired, "/safetyControls/misuseControlsRequired", errors);
  requireBoolean(value.retentionPolicyObserved, "/safetyControls/retentionPolicyObserved", errors);
  requireStringArray(value.blockers, "/safetyControls/blockers", errors);
}

function validateLiveDialogConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.verdict)) {
    return;
  }

  const expectedBlockers = expectedLiveDialogBlockers(value);
  if (Array.isArray(value.verdict.blockers)) {
    const verdictBlockers = new Set(value.verdict.blockers);
    for (const blocker of expectedBlockers) {
      if (!verdictBlockers.has(blocker)) {
        errors.push(`/verdict/blockers must include ${blocker}`);
      }
    }
  }

  const verdictPassed = value.verdict.passed;
  if (typeof verdictPassed === "boolean" && Array.isArray(value.verdict.blockers) && verdictPassed !== (value.verdict.blockers.length === 0)) {
    errors.push("/verdict/passed must match whether verdict blockers are empty");
  }
}

function expectedLiveDialogBlockers(value: Record<string, unknown>): string[] {
  const mockStream = isRecord(value.mockStream) ? value.mockStream : {};
  const runtimeStream = isRecord(value.runtimeStream) ? value.runtimeStream : {};
  const runtimeFit = isRecord(value.runtimeFit) ? value.runtimeFit : {};
  const webxrPlayback = isRecord(value.webxrPlayback) ? value.webxrPlayback : {};
  const modelCache = isRecord(value.modelCache) ? value.modelCache : {};
  const safetyControls = isRecord(value.safetyControls) ? value.safetyControls : {};

  return [
    ...stringArray(mockStream.blockers).map((blocker) => `mock_stream:${blocker}`),
    ...stringArray(runtimeStream.blockers).map((blocker) => `runtime_stream:${blocker}`),
    ...stringArray(runtimeFit.blockers).map((blocker) => `runtime:${blocker}`),
    ...stringArray(webxrPlayback.blockers).map((blocker) => `webxr_playback:${blocker}`),
    ...stringArray(modelCache.blockers).map((blocker) => `model_cache:${blocker}`),
    ...stringArray(safetyControls.blockers).map((blocker) => `safety_controls:${blocker}`),
  ];
}

function inspectModelCache(
  evidenceFile: string | undefined,
  evidence: LocalRealtimeVoiceModelCacheEvidenceReport | undefined,
): LocalVoiceLiveDialogBenchmarkReport["modelCache"] {
  if (!evidenceFile || !evidence) {
    return {
      evidenceFile: null,
      generatedAt: null,
      kind: null,
      claimScope: null,
      cacheDir: null,
      approvedModelIds: [],
      cacheExists: false,
      ready: false,
      readyModelIds: [],
      supportRuntimeObserved: false,
      blockers: ["missing_local_realtime_voice_model_cache_evidence_report"],
    };
  }

  const approvedModelIds = new Set(evidence.approved_model_ids);
  const modelApprovalBlockers = evidence.models.flatMap((model) => [
    approvedModelIds.has(model.model_id) ? undefined : `model:${model.model_id}:not_in_approved_model_ids`,
    model.approved === true ? undefined : `model:${model.model_id}:not_marked_approved`,
  ]).filter((blocker): blocker is string => typeof blocker === "string");
  const readyModelIds = evidence.models
    .filter((model) => model.ready && approvedModelIds.has(model.model_id) && model.approved === true)
    .map((model) => model.model_id);
  const ready = evidence.ready && readyModelIds.length > 0 && modelApprovalBlockers.length === 0;
  const blockers = [
    evidence.kind === "local_voice_evidence_check" ? undefined : "invalid_local_realtime_voice_model_cache_evidence_kind",
    evidence.cache_exists ? undefined : "cache_directory_missing",
    evidence.models.length > 0 ? undefined : "approved_model_weights_not_cached",
    ...modelApprovalBlockers,
    ready ? undefined : "real_moshi_or_qwen3_model_cache_missing",
    ...evidence.models.flatMap((model) =>
      model.ready ? [] : model.blockers.map((blocker) => `model:${model.model_id}:${blocker}`),
    ),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    evidenceFile,
    generatedAt: evidence.generatedAt,
    kind: evidence.kind,
    claimScope: evidence.claim_scope ?? null,
    cacheDir: evidence.cache_dir,
    approvedModelIds: evidence.approved_model_ids,
    cacheExists: evidence.cache_exists,
    ready,
    readyModelIds,
    supportRuntimeObserved: evidence.support_directories.some((entry) => entry.reason === "runtime_support_venv_not_model_weights"),
    blockers,
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
    realPlaybackLatencyObserved: false,
    latencyEvidenceSource: audio.length > 0 ? "synthetic_mock" : "not_available",
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
  const firstAudiblePlaybackLatencyMs = typeof input.firstAudiblePlaybackLatencyMs === "number"
    && Number.isFinite(input.firstAudiblePlaybackLatencyMs)
    && input.firstAudiblePlaybackLatencyMs > 0
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
    report.policy.cloudApisUsed ? "cloud_apis_used_in_source_runtime_benchmark" : undefined,
    report.policy.paidApisUsed ? "paid_apis_used_in_source_runtime_benchmark" : undefined,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireNullableString(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    errors.push(`${pathName} must be null or non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireNullableNumber(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`${pathName} must be null or finite number`);
  }
}

function requireLiteral<T extends string | boolean | number>(
  value: unknown,
  literal: T,
  pathName: string,
  errors: string[],
): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
