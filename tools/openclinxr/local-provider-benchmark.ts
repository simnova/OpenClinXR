import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
};

type BenchmarkStatus = "passed" | "not_configured" | "blocked";

type BenchmarkResult = {
  status: BenchmarkStatus;
  latencyMs: number | null;
  blockers: string[];
  metrics: Record<string, number | string | boolean | null>;
};

type LocalProviderBenchmarkReport = {
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
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

async function buildReport(): Promise<LocalProviderBenchmarkReport> {
  const [mockModel, mockVoice, localModel, localVoice] = await Promise.all([
    runMockModelBenchmark(),
    runMockVoiceBenchmark(),
    inspectLocalModelBenchmarkReadiness(),
    inspectLocalVoiceBenchmarkReadiness(),
  ]);
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
    generatedAt: new Date().toISOString(),
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

async function inspectLocalModelBenchmarkReadiness(): Promise<BenchmarkResult> {
  const availableCommands = await availableCommandsMatching(localModelCommands);
  const configuredRuntime = process.env.OPENCLINXR_LOCAL_MODEL_RUNTIME ?? "";
  const configuredModel = process.env.OPENCLINXR_LOCAL_MODEL_ID ?? "";
  const blockers = [
    availableCommands.length > 0 ? undefined : "no_ollama_llama_cpp_or_mlx_runtime_detected",
    configuredRuntime ? undefined : "OPENCLINXR_LOCAL_MODEL_RUNTIME_not_set",
    configuredModel ? undefined : "OPENCLINXR_LOCAL_MODEL_ID_not_set",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: blockers.length === 0 ? "passed" : "not_configured",
    latencyMs: null,
    blockers,
    metrics: {
      availableRuntimeCommands: availableCommands.join(",") || null,
      configuredRuntime: configuredRuntime || null,
      configuredModel: configuredModel || null,
      executionAttempted: false,
    },
  };
}

async function inspectLocalVoiceBenchmarkReadiness(): Promise<BenchmarkResult> {
  const availableCommands = await availableCommandsMatching(localVoiceCommands);
  const configuredRuntime = process.env.OPENCLINXR_LOCAL_VOICE_RUNTIME ?? "";
  const configuredVoice = process.env.OPENCLINXR_LOCAL_VOICE_ID ?? "";
  const blockers = [
    availableCommands.length > 0 ? undefined : "no_vibevoice_runtime_detected",
    configuredRuntime ? undefined : "OPENCLINXR_LOCAL_VOICE_RUNTIME_not_set",
    configuredVoice ? undefined : "OPENCLINXR_LOCAL_VOICE_ID_not_set",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: blockers.length === 0 ? "passed" : "not_configured",
    latencyMs: null,
    blockers,
    metrics: {
      availableRuntimeCommands: availableCommands.join(",") || null,
      configuredRuntime: configuredRuntime || null,
      configuredVoice: configuredVoice || null,
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

await main();
