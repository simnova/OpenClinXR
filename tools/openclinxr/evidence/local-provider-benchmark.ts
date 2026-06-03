import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { globFiles, readJson } from "../../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
  envFilePath?: string;
  validatePath?: string;
  validateLatest: boolean;
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

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
  "OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED",
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
  await runLocalProviderBenchmarkCli(process.argv.slice(2));
}

export async function runLocalProviderBenchmarkCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestLocalProviderBenchmarkPath();
    if (!validatePath) {
      throw new Error("Missing local provider benchmark report to validate.");
    }
    const validation = validateLocalProviderBenchmarkReport(await readJson<unknown>(validatePath));
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
  const options: CliOptions = {
    validateLatest: false,
  };

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
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function latestLocalProviderBenchmarkPath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/local-provider-benchmark-*.json");
  return files.sort().at(-1);
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
  const installApproved = env.OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED === "true";
  const safetyReviewApproved = env.OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED === "true";
  const blockers = [
    availableVoiceCommands.length > 0 ? undefined : "no_vibevoice_runtime_detected",
    configuredRuntime ? undefined : "OPENCLINXR_LOCAL_VOICE_RUNTIME_not_set",
    configuredVoice ? undefined : "OPENCLINXR_LOCAL_VOICE_ID_not_set",
    configuredVoice && !candidate ? "local_voice_source_record_not_found" : undefined,
    configuredVoice && !installApproved ? "OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED_not_true" : undefined,
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
      installApproved,
      safetyReviewApproved,
      executionAttempted: false,
    },
  };
}

async function availableCommandsMatching(commands: readonly string[]): Promise<string[]> {
  const probes = await Promise.all(commands.map(async (command) => ({ command, path: await resolveCommandPath(command) })));
  return probes.filter((probe) => probe.path).map((probe) => probe.command);
}

async function resolveCommandPath(command: string): Promise<string> {
  const commandPath = await runOptional("/usr/bin/which", [command]);
  if (commandPath) {
    return commandPath;
  }

  for (const userLocalPath of buildUserLocalCommandCandidatePaths(homedir(), command)) {
    if (await isExecutableFile(userLocalPath)) {
      return userLocalPath;
    }
  }
  return "";
}

export function buildUserLocalCommandCandidatePath(homeDirectory: string, command: string): string {
  return path.join(homeDirectory, ".local/bin", command);
}

export function buildUserLocalCommandCandidatePaths(homeDirectory: string, command: string): string[] {
  return [
    buildUserLocalCommandCandidatePath(homeDirectory, command),
    path.join(homeDirectory, "Library/pnpm", command),
  ];
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
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

export function validateLocalProviderBenchmarkReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  validatePolicy(value.policy, errors);
  validateBenchmarkResult(value.mockModel, "/mockModel", errors);
  validateBenchmarkResult(value.mockVoice, "/mockVoice", errors);
  validateBenchmarkResult(value.localModel, "/localModel", errors);
  validateBenchmarkResult(value.localVoice, "/localVoice", errors);
  validateVerdict(value.verdict, errors);
  validateReportConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePolicy(value: unknown, errors: string[]): void {
  requireRecord(value, "/policy", errors);
  if (!isRecord(value)) {
    return;
  }
  requireLiteral(value.cloudCallsAllowed, false, "/policy/cloudCallsAllowed", errors);
  requireLiteral(value.modelDownloadsAllowed, false, "/policy/modelDownloadsAllowed", errors);
  requireLiteral(value.localRuntimeExecutionAllowed, false, "/policy/localRuntimeExecutionAllowed", errors);
}

function validateBenchmarkResult(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }
  requireOneOf(value.status, ["passed", "not_configured", "blocked"], `${pathName}/status`, errors);
  requireNullableNumber(value.latencyMs, `${pathName}/latencyMs`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
  requireRecord(value.metrics, `${pathName}/metrics`, errors);
  if (isRecord(value.metrics) && value.metrics.executionAttempted !== undefined) {
    requireLiteral(value.metrics.executionAttempted, false, `${pathName}/metrics/executionAttempted`, errors);
  }
}

function validateVerdict(value: unknown, errors: string[]): void {
  requireRecord(value, "/verdict", errors);
  if (!isRecord(value)) {
    return;
  }
  requireBoolean(value.deterministicMocksPassed, "/verdict/deterministicMocksPassed", errors);
  requireBoolean(value.localModelReadyToBenchmark, "/verdict/localModelReadyToBenchmark", errors);
  requireBoolean(value.localVoiceReadyToBenchmark, "/verdict/localVoiceReadyToBenchmark", errors);
  requireStringArray(value.blockers, "/verdict/blockers", errors);
}

function validateReportConsistency(value: Record<string, unknown>, errors: string[]): void {
  const mockModel = value.mockModel;
  const mockVoice = value.mockVoice;
  const localModel = value.localModel;
  const localVoice = value.localVoice;
  const verdict = value.verdict;
  if (!isRecord(mockModel) || !isRecord(mockVoice) || !isRecord(localModel) || !isRecord(localVoice) || !isRecord(verdict)) {
    return;
  }
  if (
    typeof verdict.deterministicMocksPassed === "boolean"
    && verdict.deterministicMocksPassed !== (mockModel.status === "passed" && mockVoice.status === "passed")
  ) {
    errors.push("/verdict/deterministicMocksPassed must match mock model and mock voice passed status");
  }
  if (
    typeof verdict.localModelReadyToBenchmark === "boolean"
    && verdict.localModelReadyToBenchmark !== (localModel.status === "passed")
  ) {
    errors.push("/verdict/localModelReadyToBenchmark must match /localModel/status");
  }
  if (
    typeof verdict.localVoiceReadyToBenchmark === "boolean"
    && verdict.localVoiceReadyToBenchmark !== (localVoice.status === "passed")
  ) {
    errors.push("/verdict/localVoiceReadyToBenchmark must match /localVoice/status");
  }
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
