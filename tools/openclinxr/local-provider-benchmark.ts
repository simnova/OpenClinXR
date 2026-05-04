import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
  envFilePath?: string;
};

export type BenchmarkStatus = "passed" | "not_configured" | "blocked";

export type BenchmarkResult = {
  status: BenchmarkStatus;
  latencyMs: number | null;
  blockers: string[];
  metrics: Record<string, number | string | boolean | null>;
};

export type LocalProviderBenchmarkReport = {
  generatedAt: string;
  policy: {
    cloudCallsAllowed: false;
    modelDownloadsAllowed: false;
    localRuntimeExecutionAllowed: false;
  };
  mockModel: BenchmarkResult;
  mockVoice: BenchmarkResult;
  localModel: BenchmarkResult;
  localVoice: BenchmarkResult;
  verdict: {
    deterministicMocksPassed: boolean;
    localModelReadyToBenchmark: boolean;
    localVoiceReadyToBenchmark: boolean;
    blockers: string[];
  };
};

const localModelCommands = ["ollama", "llama-cli", "llama-server", "mlx_lm"] as const;
const localVoiceCommands = ["vibevoice"] as const;
const localModelCommandSet = new Set<string>(localModelCommands);
const localVoiceCommandSet = new Set<string>(localVoiceCommands);
const localProviderEnvKeys = [
  "OPENCLINXR_LOCAL_MODEL_RUNTIME",
  "OPENCLINXR_LOCAL_MODEL_ID",
  "OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED",
  "OPENCLINXR_LOCAL_VOICE_RUNTIME",
  "OPENCLINXR_LOCAL_VOICE_ID",
  "OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED",
] as const;
type LocalProviderEnvKey = (typeof localProviderEnvKeys)[number];
const localProviderEnvKeySet = new Set<string>(localProviderEnvKeys);
const localModelCandidates = [
  {
    id: "Qwen/Qwen3-4B-GGUF",
    sourceRecordIds: ["src-qwen3-4b-gguf-2026"],
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    sourceRecordIds: ["src-deepseek-r1-distill-qwen-2025"],
  },
] as const;
const localVoiceCandidates = [
  {
    id: "microsoft/VibeVoice-Realtime-0.5B",
    sourceRecordIds: ["src-vibevoice-github-2026"],
  },
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.envFilePath) {
    await loadEnvFile(options.envFilePath);
  }
  const report = await buildReport();

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.verdict.deterministicMocksPassed) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--env-file") {
      options.envFilePath = requireValue(normalizedArgs, index, arg);
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

async function loadEnvFile(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const values = parseLocalProviderEnvFileContent(content);
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

export function parseLocalProviderEnvFileContent(content: string): Partial<Record<LocalProviderEnvKey, string>> {
  const values: Partial<Record<LocalProviderEnvKey, string>> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = assignment.slice(0, separator).trim();
    if (!localProviderEnvKeySet.has(key)) {
      continue;
    }
    values[key as LocalProviderEnvKey] = unquoteEnvValue(assignment.slice(separator + 1).trim());
  }
  return values;
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function buildReport(): Promise<LocalProviderBenchmarkReport> {
  const [mockModel, mockVoice, availableModelCommands, availableVoiceCommands] = await Promise.all([
    runMockModelBenchmark(),
    runMockVoiceBenchmark(),
    availableCommandsMatching(localModelCommands),
    availableCommandsMatching(localVoiceCommands),
  ]);
  return buildLocalProviderBenchmarkReport({
    mockModel,
    mockVoice,
    availableCommands: [...availableModelCommands, ...availableVoiceCommands],
    env: process.env,
  });
}

export function buildLocalProviderBenchmarkReport(input: {
  generatedAt?: string;
  availableCommands: readonly string[];
  env?: Record<string, string | undefined>;
  mockModel: BenchmarkResult;
  mockVoice: BenchmarkResult;
}): LocalProviderBenchmarkReport {
  const mockModel = input.mockModel;
  const mockVoice = input.mockVoice;
  const env = input.env ?? {};
  const localModel = inspectLocalModelBenchmarkReadiness(input.availableCommands, env);
  const localVoice = inspectLocalVoiceBenchmarkReadiness(input.availableCommands, env);
  const deterministicMocksPassed = mockModel.status === "passed" && mockVoice.status === "passed";
  const localModelReadyToBenchmark = localModel.status === "passed";
  const localVoiceReadyToBenchmark = localVoice.status === "passed";
  const blockers = [
    ...mockModel.blockers.map((blocker) => `mock_model:${blocker}`),
    ...mockVoice.blockers.map((blocker) => `mock_voice:${blocker}`),
    ...(localModelReadyToBenchmark ? [] : localModel.blockers.map((blocker) => `local_model:${blocker}`)),
    ...(localVoiceReadyToBenchmark ? [] : localVoice.blockers.map((blocker) => `local_voice:${blocker}`)),
  ];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    policy: {
      cloudCallsAllowed: false,
      modelDownloadsAllowed: false,
      localRuntimeExecutionAllowed: false,
    },
    mockModel,
    mockVoice,
    localModel,
    localVoice,
    verdict: {
      deterministicMocksPassed,
      localModelReadyToBenchmark,
      localVoiceReadyToBenchmark,
      blockers,
    },
  };
}

async function runMockModelBenchmark(): Promise<BenchmarkResult> {
  const started = performance.now();
  const visibleFacts = [
    "Crushing substernal chest pressure.",
    "Patient appears anxious and diaphoretic.",
  ];
  const learnerUtterance = "When did the chest pressure start?";
  const response = `Robert Hayes: ${visibleFacts[0]}`;
  const promptTokens = Math.ceil((visibleFacts.join(" ").length + learnerUtterance.length) / 5);
  const completionTokens = Math.ceil(response.length / 5);
  const latencyMs = elapsedMs(started);

  return {
    status: response.includes("Robert Hayes") ? "passed" : "blocked",
    latencyMs,
    blockers: response.includes("Robert Hayes") ? [] : ["mock_actor_response_missing_actor_name"],
    metrics: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      responseChars: response.length,
      costEstimateUsd: 0,
    },
  };
}

async function runMockVoiceBenchmark(): Promise<BenchmarkResult> {
  const started = performance.now();
  const transcriptEvents = ["When did", "When did the chest pressure start?"];
  const audioChunks = [{ durationMs: 1100, visemeCue: "neutral-pain" }];
  const latencyMs = elapsedMs(started);

  return {
    status: transcriptEvents.length === 2 && audioChunks.length === 1 ? "passed" : "blocked",
    latencyMs,
    blockers: transcriptEvents.length === 2 && audioChunks.length === 1 ? [] : ["mock_voice_stream_incomplete"],
    metrics: {
      transcriptEvents: transcriptEvents.length,
      audioChunks: audioChunks.length,
      totalAudioDurationMs: audioChunks.reduce((sum, chunk) => sum + chunk.durationMs, 0),
      firstVisemeCue: audioChunks[0]?.visemeCue ?? null,
      costEstimateUsd: 0,
    },
  };
}

function inspectLocalModelBenchmarkReadiness(availableCommands: readonly string[], env: Record<string, string | undefined>): BenchmarkResult {
  const availableModelCommands = availableCommands.filter((command) => localModelCommandSet.has(command));
  const configuredRuntime = env.OPENCLINXR_LOCAL_MODEL_RUNTIME ?? "";
  const configuredModel = env.OPENCLINXR_LOCAL_MODEL_ID ?? "";
  const candidate = localModelCandidates.find((modelCandidate) => modelCandidate.id === configuredModel);
  const downloadApproved = env.OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED === "true";
  const blockers = [
    availableModelCommands.length > 0 ? undefined : "no_ollama_llama_cpp_or_mlx_runtime_detected",
    configuredRuntime ? undefined : "OPENCLINXR_LOCAL_MODEL_RUNTIME_not_set",
    configuredModel ? undefined : "OPENCLINXR_LOCAL_MODEL_ID_not_set",
    configuredModel && !candidate ? "local_model_source_record_not_found" : undefined,
    configuredModel && !downloadApproved ? "OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED_not_true" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: blockers.length === 0 ? "passed" : "not_configured",
    latencyMs: null,
    blockers,
    metrics: {
      availableRuntimeCommands: availableModelCommands.join(",") || null,
      configuredRuntime: configuredRuntime || null,
      configuredModel: configuredModel || null,
      sourceRecordIds: candidate?.sourceRecordIds.join(",") ?? null,
      downloadApproved,
      executionAttempted: false,
    },
  };
}

function inspectLocalVoiceBenchmarkReadiness(availableCommands: readonly string[], env: Record<string, string | undefined>): BenchmarkResult {
  const availableVoiceCommands = availableCommands.filter((command) => localVoiceCommandSet.has(command));
  const configuredRuntime = env.OPENCLINXR_LOCAL_VOICE_RUNTIME ?? "";
  const configuredVoice = env.OPENCLINXR_LOCAL_VOICE_ID ?? "";
  const candidate = localVoiceCandidates.find((voiceCandidate) => voiceCandidate.id === configuredVoice);
  const safetyReviewApproved = env.OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED === "true";
  const blockers = [
    availableVoiceCommands.length > 0 ? undefined : "no_vibevoice_runtime_detected",
    configuredRuntime ? undefined : "OPENCLINXR_LOCAL_VOICE_RUNTIME_not_set",
    configuredVoice ? undefined : "OPENCLINXR_LOCAL_VOICE_ID_not_set",
    configuredVoice && !candidate ? "local_voice_source_record_not_found" : undefined,
    configuredVoice && !safetyReviewApproved ? "OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED_not_true" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: blockers.length === 0 ? "passed" : "not_configured",
    latencyMs: null,
    blockers,
    metrics: {
      availableRuntimeCommands: availableVoiceCommands.join(",") || null,
      configuredRuntime: configuredRuntime || null,
      configuredVoice: configuredVoice || null,
      sourceRecordIds: candidate?.sourceRecordIds.join(",") ?? null,
      safetyReviewApproved,
      executionAttempted: false,
    },
  };
}

async function availableCommandsMatching(commands: readonly string[]): Promise<string[]> {
  const probes = await Promise.all(commands.map(async (command) => ({ command, path: await runOptional("/usr/bin/which", [command]) })));
  return probes.filter((probe) => probe.path).map((probe) => probe.command);
}

async function runOptional(command: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: 5000,
    });
    return `${stdout}${stderr}`.trim();
  } catch {
    return "";
  }
}

function elapsedMs(started: number): number {
  return Number((performance.now() - started).toFixed(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
