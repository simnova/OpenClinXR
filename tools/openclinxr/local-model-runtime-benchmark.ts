import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  parseLogPath?: string;
  outputPath?: string;
  grammarFailureExcerptPath?: string;
  executeApprovedLocalRun: boolean;
  modelFilePath?: string;
  llamaExecutable?: string;
  rawLogPath?: string;
  timeoutMs: number;
};

export type LocalModelRuntimeBenchmarkReport = {
  generatedAt: string;
  status: "passed_with_caveats" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadApproved: true;
    localRuntimeExecutionApproved: boolean;
    localRuntimeExecutionAttemptedByThisTool: boolean;
    productionUseAllowed: false;
    downloadAttemptedByThisTool: false;
    networkAccessObservedByThisTool: false;
  };
  runtime: {
    command: "llama-completion";
    fallbackCommandUsed: "llama-cli";
    backend: string;
    modelId: "Qwen/Qwen3-4B-GGUF";
    modelFile: "Qwen3-4B-Q4_K_M.gguf";
    modelCacheLabel: "Qwen/Qwen3-4B-GGUF:Q4_K_M";
    sourceRecordIds: string[];
    device: string | null;
    ctxSize: number | null;
    predictTokensRequested: number | null;
    temperature: number | null;
    topP: number | null;
  };
  prompt: {
    purpose: string;
    scenario: string;
    requiredKeys: string[];
  };
  output: {
    parsedJson?: Record<string, unknown>;
    structuredOutputCaveats: string[];
    rawLogPath: string;
    rawLogSha256: string;
    grammarFailureExcerptPath?: string;
  };
  metrics: Record<string, number | null>;
  verdict: {
    passed: boolean;
    blockers: string[];
    caveats: string[];
  };
};

const execFileAsync = promisify(execFile);

export type ParsedLlamaRuntimeLog = {
  generatedAt: string | null;
  runtime: {
    backend: string;
    device: string | null;
    ctxSize: number | null;
    predictTokensRequested: number | null;
    temperature: number | null;
    topP: number | null;
    metalModelBufferMiB: number | null;
    metalKvBufferMiB: number | null;
    metalComputeBufferMiB: number | null;
  };
  output: {
    parsedJson?: Record<string, unknown>;
    structuredOutputCaveats: string[];
  };
  metrics: Record<string, number | null>;
  blockers: string[];
};

const requiredStructuredKeys = ["candidate", "triage_priority", "rationale", "safety_flags"];
const allowedGuardrailLabels = new Set([
  "fictional_or_unverified",
  "hidden_truth_boundary",
  "needs_human_review",
  "out_of_role",
  "prompt_injection",
  "unsafe_clinical_advice",
]);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let report: LocalModelRuntimeBenchmarkReport;

  if (options.executeApprovedLocalRun) {
    if (!options.modelFilePath || !options.llamaExecutable || !options.rawLogPath) {
      throw new Error("--execute-approved-local-run requires --model-file, --llama-executable, and --raw-log.");
    }
    report = await runApprovedLocalModelBenchmark({
      modelFilePath: options.modelFilePath,
      llamaExecutable: options.llamaExecutable,
      rawLogPath: options.rawLogPath,
      grammarFailureExcerptPath: options.grammarFailureExcerptPath,
      timeoutMs: options.timeoutMs,
    });
  } else {
    if (!options.parseLogPath) {
      throw new Error("Missing --parse-log. Use --execute-approved-local-run only for the approved local Qwen/llama.cpp benchmark path.");
    }

    const logContent = await readFile(options.parseLogPath, "utf8");
    report = await buildLocalModelRuntimeBenchmarkReportFromLog({
      logPath: options.parseLogPath,
      logContent,
      logSha256: sha256(logContent),
      grammarFailureExcerptPath: options.grammarFailureExcerptPath,
    });
  }

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
    executeApprovedLocalRun: false,
    timeoutMs: 60_000,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--execute-approved-local-run") {
      options.executeApprovedLocalRun = true;
      continue;
    }
    if (arg === "--parse-log") {
      options.parseLogPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--grammar-failure-excerpt") {
      options.grammarFailureExcerptPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model-file") {
      options.modelFilePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--llama-executable") {
      options.llamaExecutable = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--raw-log") {
      options.rawLogPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parseIntegerValue(requireValue(normalizedArgs, index, arg), arg);
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

function parseIntegerValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export async function runApprovedLocalModelBenchmark(input: {
  modelFilePath: string;
  llamaExecutable: string;
  rawLogPath: string;
  grammarFailureExcerptPath?: string;
  timeoutMs?: number;
}): Promise<LocalModelRuntimeBenchmarkReport> {
  if (!existsSync(input.modelFilePath)) {
    throw new Error(`Model file does not exist: ${input.modelFilePath}`);
  }
  if (!input.modelFilePath.endsWith("Qwen3-4B-Q4_K_M.gguf")) {
    throw new Error("Only the approved Qwen3-4B-Q4_K_M.gguf benchmark file is allowed by this runner.");
  }
  if (!existsSync(input.llamaExecutable)) {
    throw new Error(`llama executable does not exist: ${input.llamaExecutable}`);
  }

  const startedAt = new Date().toISOString();
  const args = buildApprovedLlamaArgs(input.modelFilePath);
  let stdout = "";
  let stderr = "";
  let exitStatus = 0;

  try {
    const result = await execFileAsync(input.llamaExecutable, args, {
      encoding: "utf8",
      timeout: input.timeoutMs ?? 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        LLAMA_ARG_HF_OFFLINE: "1",
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    if (isExecError(error)) {
      stdout = typeof error.stdout === "string" ? error.stdout : "";
      stderr = typeof error.stderr === "string" ? error.stderr : "";
      exitStatus = typeof error.code === "number" ? error.code : 1;
    } else {
      throw error;
    }
  }

  const endedAt = new Date().toISOString();
  const rawLog = [
    `started_at_utc=${startedAt}`,
    stdout.trimEnd(),
    stderr.trimEnd(),
    `ended_at_utc=${endedAt}`,
    `exit_status=${exitStatus}`,
    "",
  ].filter((line) => line.length > 0).join("\n");
  await writeFile(input.rawLogPath, rawLog, "utf8");

  return buildLocalModelRuntimeBenchmarkReportFromLog({
    generatedAt: endedAt,
    logPath: input.rawLogPath,
    logContent: rawLog,
    logSha256: sha256(rawLog),
    grammarFailureExcerptPath: input.grammarFailureExcerptPath,
    localRuntimeExecutionApproved: true,
    localRuntimeExecutionAttemptedByThisTool: true,
  });
}

function buildApprovedLlamaArgs(modelFilePath: string): string[] {
  return [
    "--offline",
    "--model",
    modelFilePath,
    "--ctx-size",
    "2048",
    "--predict",
    "256",
    "--temp",
    "0",
    "--top-p",
    "1",
    "--single-turn",
    "--no-warmup",
    "--json-schema",
    JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: requiredStructuredKeys,
      properties: {
        candidate: { const: "Qwen/Qwen3-4B-GGUF" },
        triage_priority: { enum: ["high", "medium", "low"] },
        rationale: { type: "string", maxLength: 280 },
        safety_flags: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { enum: [...allowedGuardrailLabels] },
        },
      },
    }),
    "--prompt",
    [
      "Return one JSON object only for this local OpenClinXR smoke.",
      'Set candidate to "Qwen/Qwen3-4B-GGUF".',
      'Set triage_priority to "high".',
      "Use safety_flags only from the provided schema; prefer needs_human_review.",
      "Scenario: 54-year-old adult with crushing substernal chest pressure, diaphoresis, nausea, hypotension, and anxious spouse.",
    ].join(" "),
  ];
}

function isExecError(error: unknown): error is { code?: unknown; stdout?: unknown; stderr?: unknown } {
  return typeof error === "object" && error !== null && ("stdout" in error || "stderr" in error || "code" in error);
}

export function parseLlamaRuntimeLog(content: string): ParsedLlamaRuntimeLog {
  const generatedText = extractGeneratedText(content);
  const generatedTextJsonCandidate = extractBalancedJsonCandidate(generatedText);
  const jsonCandidate = generatedTextJsonCandidate ?? extractBalancedJsonCandidate(content);
  const parsedJson = parseJsonCandidate(jsonCandidate);
  const structuredOutputCaveats = classifyStructuredOutputCaveats({
    generatedText: generatedTextJsonCandidate ? generatedText : content,
    parsedJson,
    jsonCandidate,
  });
  const metrics = parsePerfMetrics(content);
  const metalModelBufferMiB = parseNumberMatch(content, /MTL0_Mapped model buffer size\s*=\s*([\d.]+)\s*MiB/);
  const metalKvBufferMiB = parseNumberMatch(content, /MTL0 KV buffer size\s*=\s*([\d.]+)\s*MiB/);
  const metalComputeBufferMiB = parseNumberMatch(content, /MTL0 compute buffer size\s*=\s*([\d.]+)\s*MiB/);
  const exitStatus = parseNumberMatch(content, /exit_status=(\d+)/);
  const blockers = [
    exitStatus !== null && exitStatus !== 0 ? `llama_runtime_exit_status_${exitStatus}` : undefined,
    parsedJson ? undefined : "structured_json_not_parsed",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    generatedAt: stringMatch(content, /ended_at_utc=([^\s]+)/),
    runtime: {
      backend: parseBackend(content),
      device: stringMatch(content, /GPU name:\s+(.+)/),
      ctxSize: parseNumberMatch(content, /llama_context:\s*n_ctx\s*=\s*(\d+)/),
      predictTokensRequested: parseNumberMatch(content, /n_predict\s*=\s*(\d+)/),
      temperature: parseNumberMatch(content, /\btemp\s*=\s*([\d.]+)/),
      topP: parseNumberMatch(content, /\btop_p\s*=\s*([\d.]+)/),
      metalModelBufferMiB,
      metalKvBufferMiB,
      metalComputeBufferMiB,
    },
    output: {
      ...(parsedJson ? { parsedJson } : {}),
      structuredOutputCaveats,
    },
    metrics: {
      ...metrics,
      metalModelBufferMiB,
      metalKvBufferMiB,
      metalComputeBufferMiB,
    },
    blockers,
  };
}

export async function buildLocalModelRuntimeBenchmarkReportFromLog(input: {
  generatedAt?: string;
  logPath: string;
  logContent: string;
  logSha256?: string;
  grammarFailureExcerptPath?: string;
  localRuntimeExecutionApproved?: boolean;
  localRuntimeExecutionAttemptedByThisTool?: boolean;
}): Promise<LocalModelRuntimeBenchmarkReport> {
  const parsed = parseLlamaRuntimeLog(input.logContent);
  const blockers = [...parsed.blockers];
  const passed = blockers.length === 0;

  return {
    generatedAt: input.generatedAt ?? parsed.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed_with_caveats" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadApproved: true,
      localRuntimeExecutionApproved: input.localRuntimeExecutionApproved ?? false,
      localRuntimeExecutionAttemptedByThisTool: input.localRuntimeExecutionAttemptedByThisTool ?? false,
      productionUseAllowed: false,
      downloadAttemptedByThisTool: false,
      networkAccessObservedByThisTool: false,
    },
    runtime: {
      command: "llama-completion",
      fallbackCommandUsed: "llama-cli",
      backend: parsed.runtime.backend,
      modelId: "Qwen/Qwen3-4B-GGUF",
      modelFile: "Qwen3-4B-Q4_K_M.gguf",
      modelCacheLabel: "Qwen/Qwen3-4B-GGUF:Q4_K_M",
      sourceRecordIds: [
        "src-qwen3-4b-gguf-2026",
        "src-qwen-local-docs-2026",
        "src-llama-cpp-homebrew-2026",
      ],
      device: parsed.runtime.device,
      ctxSize: parsed.runtime.ctxSize,
      predictTokensRequested: parsed.runtime.predictTokensRequested,
      temperature: parsed.runtime.temperature,
      topP: parsed.runtime.topP,
    },
    prompt: {
      purpose: "OpenClinXR local-model smoke for ED chest-pain triage reasoning and structured-output behavior.",
      scenario: "54-year-old adult with crushing substernal chest pressure, diaphoresis, nausea, hypotension, and anxious spouse.",
      requiredKeys: [...requiredStructuredKeys],
    },
    output: {
      ...(parsed.output.parsedJson ? { parsedJson: parsed.output.parsedJson } : {}),
      structuredOutputCaveats: parsed.output.structuredOutputCaveats,
      rawLogPath: normalizePathForReport(input.logPath),
      rawLogSha256: input.logSha256 ?? sha256(input.logContent),
      ...(input.grammarFailureExcerptPath ? { grammarFailureExcerptPath: input.grammarFailureExcerptPath } : {}),
    },
    metrics: parsed.metrics,
    verdict: {
      passed,
      blockers,
      caveats: [
        "Good enough for a local adapter latency smoke; not good enough for clinical actor quality or validated scoring.",
        "Structured-output enforcement needs a follow-up grammar/schema spike before any autonomous planning or scoring dependency.",
        "Hardware result is for this Apple M1 Max machine, not the target M4 Pro or M4 Max claim.",
        input.localRuntimeExecutionAttemptedByThisTool
          ? "This report was produced by the repo-managed local execution mode after explicit operator approval."
          : "This report was harvested from an existing local log; this repo-managed tool did not execute model inference.",
      ],
    },
  };
}

function parseBackend(content: string): string {
  const version = stringMatch(content, /^version:\s*([^\n]+)$/m);
  return version ? `llama.cpp ${version}` : "llama.cpp version_not_recorded";
}

function extractGeneratedText(content: string): string {
  const generateIndex = content.indexOf("generate:");
  const perfIndex = content.indexOf("common_perf_print:", generateIndex);
  if (generateIndex < 0 || perfIndex < 0) {
    return content;
  }
  return content.slice(generateIndex, perfIndex);
}

export function extractBalancedJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

function parseJsonCandidate(candidate: string | null): Record<string, unknown> | undefined {
  if (!candidate) {
    return undefined;
  }
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function classifyStructuredOutputCaveats(input: {
  generatedText: string;
  parsedJson?: Record<string, unknown>;
  jsonCandidate: string | null;
}): string[] {
  const caveats: string[] = [];
  if (/<think>/i.test(input.generatedText)) {
    caveats.push("The model emitted a leading <think> marker before the JSON object even with reasoning disabled.");
  }
  if (!input.parsedJson) {
    caveats.push("The model output did not include a parsable JSON object.");
    return caveats;
  }
  const missingKeys = requiredStructuredKeys.filter((key) => !(key in input.parsedJson!));
  if (missingKeys.length > 0) {
    caveats.push(`The JSON object was parsable, but missing required keys: ${missingKeys.join(", ")}.`);
  }
  const safetyFlags = Array.isArray(input.parsedJson.safety_flags)
    ? input.parsedJson.safety_flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  if (safetyFlags.some((flag) => !allowedGuardrailLabels.has(flag))) {
    caveats.push("The JSON object was parsable, but safety_flags were clinical features rather than the requested guardrail labels.");
  }
  if (input.jsonCandidate && !input.generatedText.trim().startsWith(input.jsonCandidate)) {
    caveats.push("The JSON object was extracted from surrounding model text instead of being the whole response.");
  }
  return caveats;
}

function parsePerfMetrics(content: string): Record<string, number | null> {
  const loadTimeMs = parseNumberMatch(content, /load time\s*=\s*([\d.]+)\s*ms/);
  const promptEval = matchNumbers(content, /prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d.]+)\s*tokens per second/);
  const evalTime = matchNumbers(content, /eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*runs.*?([\d.]+)\s*tokens per second/);
  const totalRuntimeMs = parseNumberMatch(content, /total time\s*=\s*([\d.]+)\s*ms/);
  const wallClockMs = parseNumberMatch(content, /^real\s+([\d.]+)$/m);
  const evalMsPerToken = evalTime[0] && evalTime[1] ? evalTime[0] / evalTime[1] : null;
  const approxTimeToFirstGeneratedTokenMs = loadTimeMs !== null && promptEval[0] !== null && evalMsPerToken !== null
    ? roundMetric(loadTimeMs + promptEval[0] + evalMsPerToken)
    : null;

  return {
    loadTimeMs,
    promptEvalTimeMs: promptEval[0],
    promptEvalTokens: promptEval[1],
    promptEvalTokensPerSecond: promptEval[2],
    evalTimeMs: evalTime[0],
    generatedRuns: evalTime[1],
    generationTokensPerSecond: evalTime[2],
    totalRuntimeMs,
    wallClockMs: wallClockMs === null ? null : Math.round(wallClockMs * 1000),
    approxTimeToFirstGeneratedTokenMs,
    maxResidentSetBytes: parseNumberMatch(content, /(\d+)\s+maximum resident set size/),
    peakMemoryFootprintBytes: parseNumberMatch(content, /(\d+)\s+peak memory footprint/),
  };
}

function matchNumbers(content: string, regex: RegExp): [number | null, number | null, number | null] {
  const match = content.match(regex);
  return [
    numberValue(match?.[1]),
    numberValue(match?.[2]),
    numberValue(match?.[3]),
  ];
}

function parseNumberMatch(content: string, regex: RegExp): number | null {
  return numberValue(content.match(regex)?.[1]);
}

function numberValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringMatch(content: string, regex: RegExp): string | null {
  return content.match(regex)?.[1]?.trim() ?? null;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizePathForReport(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.normalize(filePath);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
