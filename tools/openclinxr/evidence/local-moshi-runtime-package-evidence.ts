import { readdir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

type CliOptions = {
  venvPath?: string;
  packageVersionsPath?: string;
  importResultsPath?: string;
  entrypointsPath?: string;
  commandHelpPath?: string;
  modelCacheEvidencePath?: string;
  generatedAt?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ImportResult = {
  ok: boolean;
  error?: string;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type LocalMoshiRuntimePackageEvidenceReport = {
  kind: "local_moshi_runtime_package_evidence";
  claim_scope: "runtime_package_import_only";
  generatedAt: string;
  status: "passed_with_caveats" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    productionUseAllowed: false;
    generatedAudioCommitted: false;
    runtimeInferenceObserved: false;
    microphonePlaybackObserved: false;
    downloadAttemptedByThisTool: false;
    networkAccessObservedByThisTool: false;
  };
  runtime: {
    modelId: "kyutai/moshiko-mlx-q4";
    modelLicense: "CC-BY-4.0";
    sourceRecordIds: ["src-moshiko-mlx-q4-2026"];
    venvPath: string;
    venvBytes: number | null;
    packageVersions: Record<string, string>;
    importResults: Record<string, ImportResult>;
    entrypoints: string[];
    commandHelp: string | null;
  };
  modelCache: {
    evidenceFile: string | null;
  };
  verdict: {
    passed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestMoshiPackageEvidencePath();
    const report = await readJson<unknown>(validatePath);
    const validation = validateLocalMoshiRuntimePackageEvidenceReport(report);
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

  if (!options.venvPath || !options.packageVersionsPath || !options.importResultsPath || !options.entrypointsPath) {
    throw new Error("Missing --venv, --packages, --imports, or --entrypoints.");
  }

  const [packageVersionsContent, importResultsContent, entrypointsContent, commandHelp] = await Promise.all([
    readFile(options.packageVersionsPath, "utf8"),
    readFile(options.importResultsPath, "utf8"),
    readFile(options.entrypointsPath, "utf8"),
    options.commandHelpPath ? readFile(options.commandHelpPath, "utf8") : Promise.resolve(null),
  ]);
  const venvBytes = await directoryBytes(options.venvPath);
  const report = buildLocalMoshiRuntimePackageEvidenceReport({
    generatedAt: options.generatedAt,
    venvPath: options.venvPath,
    venvBytes,
    packageVersions: JSON.parse(packageVersionsContent) as Record<string, string>,
    importResults: JSON.parse(importResultsContent) as Record<string, ImportResult>,
    entrypoints: entrypointsContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    commandHelp,
    modelCacheEvidencePath: options.modelCacheEvidencePath,
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

export function buildLocalMoshiRuntimePackageEvidenceReport(input: {
  generatedAt?: string;
  venvPath: string;
  venvBytes?: number | null;
  packageVersions: Record<string, string>;
  importResults: Record<string, ImportResult>;
  entrypoints: string[];
  commandHelp?: string | null;
  modelCacheEvidencePath?: string;
}): LocalMoshiRuntimePackageEvidenceReport {
  const blockers = [
    input.packageVersions.moshi_mlx ? undefined : "package:moshi_mlx:missing",
    input.packageVersions.mlx ? undefined : "package:mlx:missing",
    input.entrypoints.includes("moshi-local") ? undefined : "entrypoint:moshi-local:missing",
    ...Object.entries(input.importResults).flatMap(([moduleName, result]) =>
      result.ok ? [] : [`import:${moduleName}:${result.error ?? "failed"}`],
    ),
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const passed = blockers.length === 0;

  return {
    kind: "local_moshi_runtime_package_evidence",
    claim_scope: "runtime_package_import_only",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed_with_caveats" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      productionUseAllowed: false,
      generatedAudioCommitted: false,
      runtimeInferenceObserved: false,
      microphonePlaybackObserved: false,
      downloadAttemptedByThisTool: false,
      networkAccessObservedByThisTool: false,
    },
    runtime: {
      modelId: "kyutai/moshiko-mlx-q4",
      modelLicense: "CC-BY-4.0",
      sourceRecordIds: ["src-moshiko-mlx-q4-2026"],
      venvPath: input.venvPath,
      venvBytes: input.venvBytes ?? null,
      packageVersions: input.packageVersions,
      importResults: input.importResults,
      entrypoints: input.entrypoints,
      commandHelp: input.commandHelp ?? null,
    },
    modelCache: {
      evidenceFile: input.modelCacheEvidencePath ?? null,
    },
    verdict: {
      passed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "Moshi package imports and CLI entrypoints are evidence of isolated runtime availability only; no model inference, microphone capture, or playback loop ran.",
        "Moshi remains research-only under the approved local realtime voice model proposal and is not clinical, Quest, or production readiness evidence.",
      ],
    },
  };
}

export function validateLocalMoshiRuntimePackageEvidenceReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  const report = requireRecord(value, "", errors);
  if (!report) {
    return { ok: false, errors };
  }

  requireLiteral(report, "kind", "local_moshi_runtime_package_evidence", "/kind", errors);
  requireLiteral(report, "claim_scope", "runtime_package_import_only", "/claim_scope", errors);
  requireString(report, "generatedAt", "/generatedAt", errors);
  requireOneOf(report, "status", ["passed_with_caveats", "blocked"], "/status", errors);

  const policy = requireRecord(report.policy, "/policy", errors);
  if (policy) {
    requireLiteral(policy, "cloudApisUsed", false, "/policy/cloudApisUsed", errors);
    requireLiteral(policy, "paidApisUsed", false, "/policy/paidApisUsed", errors);
    requireLiteral(policy, "productionUseAllowed", false, "/policy/productionUseAllowed", errors);
    requireLiteral(policy, "generatedAudioCommitted", false, "/policy/generatedAudioCommitted", errors);
    requireLiteral(policy, "runtimeInferenceObserved", false, "/policy/runtimeInferenceObserved", errors);
    requireLiteral(policy, "microphonePlaybackObserved", false, "/policy/microphonePlaybackObserved", errors);
    requireLiteral(policy, "downloadAttemptedByThisTool", false, "/policy/downloadAttemptedByThisTool", errors);
    requireLiteral(policy, "networkAccessObservedByThisTool", false, "/policy/networkAccessObservedByThisTool", errors);
  }

  const runtime = validateRuntime(report.runtime, errors);
  validateModelCache(report.modelCache, errors);
  const verdict = validateVerdict(report.verdict, errors);
  validateConsistency(report, runtime, verdict, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateRuntime(value: unknown, errors: string[]): Record<string, unknown> | undefined {
  const runtime = requireRecord(value, "/runtime", errors);
  if (!runtime) {
    return undefined;
  }

  requireLiteral(runtime, "modelId", "kyutai/moshiko-mlx-q4", "/runtime/modelId", errors);
  requireLiteral(runtime, "modelLicense", "CC-BY-4.0", "/runtime/modelLicense", errors);
  const sourceRecordIds = requireStringArray(runtime, "sourceRecordIds", "/runtime/sourceRecordIds", errors);
  if (sourceRecordIds && sourceRecordIds.join("\n") !== "src-moshiko-mlx-q4-2026") {
    errors.push("/runtime/sourceRecordIds must exactly match src-moshiko-mlx-q4-2026");
  }
  requireString(runtime, "venvPath", "/runtime/venvPath", errors);
  requireNullableNumber(runtime, "venvBytes", "/runtime/venvBytes", errors);
  const packageVersions = requireRecord(runtime.packageVersions, "/runtime/packageVersions", errors);
  if (packageVersions) {
    for (const [packageName, version] of Object.entries(packageVersions)) {
      if (typeof version !== "string" || version.length === 0) {
        errors.push(`/runtime/packageVersions/${packageName} must be a non-empty string`);
      }
    }
  }

  const importResults = requireRecord(runtime.importResults, "/runtime/importResults", errors);
  if (importResults) {
    for (const [moduleName, result] of Object.entries(importResults)) {
      const importResult = requireRecord(result, `/runtime/importResults/${moduleName}`, errors);
      if (!importResult) {
        continue;
      }
      requireBoolean(importResult, "ok", `/runtime/importResults/${moduleName}/ok`, errors);
      if ("error" in importResult) {
        requireString(importResult, "error", `/runtime/importResults/${moduleName}/error`, errors);
      }
    }
  }

  requireStringArray(runtime, "entrypoints", "/runtime/entrypoints", errors);
  requireNullableString(runtime, "commandHelp", "/runtime/commandHelp", errors);

  return runtime;
}

function validateModelCache(value: unknown, errors: string[]): void {
  const modelCache = requireRecord(value, "/modelCache", errors);
  if (!modelCache) {
    return;
  }
  requireNullableString(modelCache, "evidenceFile", "/modelCache/evidenceFile", errors);
}

function validateVerdict(value: unknown, errors: string[]): Record<string, unknown> | undefined {
  const verdict = requireRecord(value, "/verdict", errors);
  if (!verdict) {
    return undefined;
  }

  requireBoolean(verdict, "passed", "/verdict/passed", errors);
  requireLiteral(verdict, "readyForLiveDialog", false, "/verdict/readyForLiveDialog", errors);
  requireStringArray(verdict, "blockers", "/verdict/blockers", errors);
  requireStringArray(verdict, "caveats", "/verdict/caveats", errors);
  return verdict;
}

function validateConsistency(
  report: Record<string, unknown>,
  runtime: Record<string, unknown> | undefined,
  verdict: Record<string, unknown> | undefined,
  errors: string[],
): void {
  if (!runtime || !verdict) {
    return;
  }

  const expectedBlockers = expectedBlockersFor(runtime);
  const actualBlockers = stringArray(verdict.blockers) ?? [];
  const hasBlockers = expectedBlockers.length > 0;

  if (report.status === "passed_with_caveats" && hasBlockers) {
    errors.push("/status must be blocked when blockers are present");
  }
  if (report.status === "blocked" && !hasBlockers) {
    errors.push("/status must be passed_with_caveats when no blockers are present");
  }
  if (verdict.passed !== !hasBlockers) {
    errors.push(`/verdict/passed must be ${String(!hasBlockers)} when blockers are ${hasBlockers ? "present" : "absent"}`);
  }

  for (const blocker of expectedBlockers) {
    if (!actualBlockers.includes(blocker)) {
      errors.push(`/verdict/blockers missing expected blocker ${blocker}`);
    }
  }
}

function expectedBlockersFor(runtime: Record<string, unknown>): string[] {
  const packageVersions = isRecord(runtime.packageVersions) ? runtime.packageVersions : {};
  const importResults = isRecord(runtime.importResults) ? runtime.importResults : {};
  const entrypoints = stringArray(runtime.entrypoints) ?? [];

  const blockers = [
    typeof packageVersions.moshi_mlx === "string" && packageVersions.moshi_mlx.length > 0
      ? undefined
      : "package:moshi_mlx:missing",
    typeof packageVersions.mlx === "string" && packageVersions.mlx.length > 0
      ? undefined
      : "package:mlx:missing",
    entrypoints.includes("moshi-local") ? undefined : "entrypoint:moshi-local:missing",
    ...Object.entries(importResults).flatMap(([moduleName, result]) => {
      if (!isRecord(result)) {
        return [];
      }
      return result.ok === true ? [] : [`import:${moduleName}:${typeof result.error === "string" ? result.error : "failed"}`];
    }),
  ];

  return blockers.filter((blocker): blocker is string => typeof blocker === "string");
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
  }
}

async function directoryBytes(filePath: string): Promise<number | null> {
  const stats = await safeStat(filePath);
  if (!stats) {
    return null;
  }
  if (stats.isFile()) {
    return stats.size;
  }
  if (!stats.isDirectory()) {
    return null;
  }
  const entries = await readdir(filePath, { withFileTypes: true });
  let totalBytes = 0;
  for (const entry of entries) {
    const childBytes = await directoryBytes(`${filePath}/${entry.name}`);
    totalBytes += childBytes ?? 0;
  }
  return totalBytes;
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };

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
    if (arg === "--venv") {
      options.venvPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--packages") {
      options.packageVersionsPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--imports") {
      options.importResultsPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--entrypoints") {
      options.entrypointsPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--help") {
      options.commandHelpPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model-cache-evidence") {
      options.modelCacheEvidencePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      options.generatedAt = requireValue(normalizedArgs, index, arg);
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

async function latestMoshiPackageEvidencePath(): Promise<string> {
  const files = await globFiles("docs/openclinxr/local-moshi-runtime-package-evidence-*.json");
  const latest = files.sort().at(-1);
  if (!latest) {
    throw new Error("No local Moshi runtime package evidence report found.");
  }
  return latest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    errors.push(`${path || "/"} must be an object`);
    return undefined;
  }
  return value;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string | undefined {
  if (typeof record[key] !== "string" || record[key].length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return record[key];
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string | null | undefined {
  if (record[key] === null) {
    return null;
  }
  return requireString(record, key, path, errors);
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    errors.push(`${path} must be an array of non-empty strings`);
    return undefined;
  }
  return value as string[];
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): boolean | undefined {
  if (typeof record[key] !== "boolean") {
    errors.push(`${path} must be a boolean`);
    return undefined;
  }
  return record[key];
}

function requireNullableNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): number | null | undefined {
  if (record[key] === null) {
    return null;
  }
  if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
    errors.push(`${path} must be a finite number or null`);
    return undefined;
  }
  return record[key];
}

function requireLiteral<T extends string | boolean>(
  record: Record<string, unknown>,
  key: string,
  expected: T,
  path: string,
  errors: string[],
): T | undefined {
  if (record[key] !== expected) {
    errors.push(`${path} must be ${String(expected)}`);
    return undefined;
  }
  return expected;
}

function requireOneOf<T extends string>(
  record: Record<string, unknown>,
  key: string,
  expected: T[],
  path: string,
  errors: string[],
): T | undefined {
  if (!expected.includes(record[key] as T)) {
    errors.push(`${path} must be one of ${expected.join(", ")}`);
    return undefined;
  }
  return record[key] as T;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
