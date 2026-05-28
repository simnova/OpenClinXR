import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  cacheDir?: string;
  generatedAt?: string;
  outputPath?: string;
};

type ApprovedModel = {
  modelId: string;
  storageName: string;
  license: string;
  sourceId: string;
};

export type LocalRealtimeVoiceModelCacheEvidenceReport = {
  kind: "local_voice_evidence_check";
  claim_scope: "cache_inventory_only";
  generatedAt: string;
  cache_dir: string;
  approved_model_ids: string[];
  cache_exists: boolean;
  ready: boolean;
  models: Array<{
    model_id: string;
    path: string;
    source_type: "local_cache_snapshot";
    expected_storage_name: string;
    license: string;
    source_id: string;
    approved: true;
    has_evidence: boolean;
    ready: boolean;
    blockers: string[];
    file_count: number;
    total_bytes: number;
    local_revision: string | null;
    metadata_revision_file_count: number;
    metadata_revision_consistent: boolean;
  }>;
  support_directories: Array<{
    path: string;
    name: string;
    reason: "runtime_support_venv_not_model_weights" | "runtime_generated_output_not_model_weights";
    file_count: number;
    total_bytes: number;
  }>;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const defaultCacheDir = "/Users/patrick/.cache/openclinxr/realtime-voice";
const approvedModels: ApprovedModel[] = [
  {
    modelId: "kyutai/moshiko-mlx-q4",
    storageName: "kyutai__moshiko-mlx-q4",
    license: "CC-BY-4.0",
    sourceId: "src-moshiko-mlx-q4-2026",
  },
  {
    modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    storageName: "mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit",
    license: "Apache-2.0",
    sourceId: "src-qwen3-tts-mlx-4bit-2026",
  },
];

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestModelCacheEvidencePath();
    if (!validatePath) {
      throw new Error("Missing local realtime voice model cache evidence report to validate.");
    }
    const validation = validateLocalRealtimeVoiceModelCacheEvidenceReport(await readJson<unknown>(validatePath));
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

  const report = await buildLocalRealtimeVoiceModelCacheEvidence({
    cacheDir: options.cacheDir,
    generatedAt: options.generatedAt,
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

export async function buildLocalRealtimeVoiceModelCacheEvidence(input: {
  cacheDir?: string;
  generatedAt?: string;
} = {}): Promise<LocalRealtimeVoiceModelCacheEvidenceReport> {
  const cacheDir = input.cacheDir ?? defaultCacheDir;
  const cacheStats = await safeStat(cacheDir);
  const cacheExists = Boolean(cacheStats?.isDirectory());
  const models = cacheExists ? await collectApprovedModels(cacheDir) : [];
  const supportDirectories = cacheExists ? await collectSupportDirectories(cacheDir) : [];
  const ready = models.some((model) => model.ready);

  return {
    kind: "local_voice_evidence_check",
    claim_scope: "cache_inventory_only",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    cache_dir: cacheDir,
    approved_model_ids: approvedModels.map((model) => model.modelId),
    cache_exists: cacheExists,
    ready,
    models,
    support_directories: supportDirectories,
  };
}

export function validateLocalRealtimeVoiceModelCacheEvidenceReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "local_voice_evidence_check", "/kind", errors);
  requireLiteral(value.claim_scope, "cache_inventory_only", "/claim_scope", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireString(value.cache_dir, "/cache_dir", errors);
  requireStringArray(value.approved_model_ids, "/approved_model_ids", errors);
  requireBoolean(value.cache_exists, "/cache_exists", errors);
  requireBoolean(value.ready, "/ready", errors);
  requireArray(value.models, "/models", errors);
  if (Array.isArray(value.models)) {
    value.models.forEach((model, index) => {
      validateModel(model, `/models/${index}`, errors);
    });
  }
  requireArray(value.support_directories, "/support_directories", errors);
  if (Array.isArray(value.support_directories)) {
    value.support_directories.forEach((entry, index) => {
      validateSupportDirectory(entry, `/support_directories/${index}`, errors);
    });
  }
  validateReadinessConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateModel(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireString(value.model_id, `${pathName}/model_id`, errors);
  requireString(value.path, `${pathName}/path`, errors);
  requireLiteral(value.source_type, "local_cache_snapshot", `${pathName}/source_type`, errors);
  requireString(value.expected_storage_name, `${pathName}/expected_storage_name`, errors);
  requireString(value.license, `${pathName}/license`, errors);
  requireString(value.source_id, `${pathName}/source_id`, errors);
  requireLiteral(value.approved, true, `${pathName}/approved`, errors);
  requireBoolean(value.has_evidence, `${pathName}/has_evidence`, errors);
  requireBoolean(value.ready, `${pathName}/ready`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
  requireNumber(value.file_count, `${pathName}/file_count`, errors);
  requireNumber(value.total_bytes, `${pathName}/total_bytes`, errors);
  requireNullableString(value.local_revision, `${pathName}/local_revision`, errors);
  requireNumber(value.metadata_revision_file_count, `${pathName}/metadata_revision_file_count`, errors);
  requireBoolean(value.metadata_revision_consistent, `${pathName}/metadata_revision_consistent`, errors);
}

function validateSupportDirectory(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireString(value.path, `${pathName}/path`, errors);
  requireString(value.name, `${pathName}/name`, errors);
  requireOneOf(value.reason, ["runtime_support_venv_not_model_weights", "runtime_generated_output_not_model_weights"], `${pathName}/reason`, errors);
  requireNumber(value.file_count, `${pathName}/file_count`, errors);
  requireNumber(value.total_bytes, `${pathName}/total_bytes`, errors);
}

function validateReadinessConsistency(value: Record<string, unknown>, errors: string[]): void {
  const approvedModelIds = new Set(stringArray(value.approved_model_ids));
  const models = Array.isArray(value.models) ? value.models.filter(isRecord) : [];
  const readyApprovedModels = models.filter((model) =>
    model.ready === true
    && model.approved === true
    && typeof model.model_id === "string"
    && approvedModelIds.has(model.model_id)
    && Array.isArray(model.blockers)
    && model.blockers.length === 0
    && model.has_evidence === true,
  );

  if (value.ready === true && readyApprovedModels.length === 0) {
    errors.push("/ready cannot be true without at least one ready approved model");
  }
  for (const [index, model] of models.entries()) {
    if (model.ready === true && Array.isArray(model.blockers) && model.blockers.length > 0) {
      errors.push(`/models/${index}/ready cannot be true when blockers are present`);
    }
    if (model.ready === true && model.has_evidence !== true) {
      errors.push(`/models/${index}/ready cannot be true without weight evidence`);
    }
  }
}

async function collectApprovedModels(cacheDir: string): Promise<LocalRealtimeVoiceModelCacheEvidenceReport["models"]> {
  const models = [];
  for (const approvedModel of approvedModels) {
    const modelPath = path.join(cacheDir, approvedModel.storageName);
    const modelStats = await safeStat(modelPath);
    if (!modelStats?.isDirectory()) {
      continue;
    }

    const inventory = await inventoryDirectory(modelPath);
    const metadataRevision = await collectHuggingFaceMetadataRevision(modelPath);
    const hasEvidence = inventory.weightFileCount > 0;
    const blockers = hasEvidence ? [] : ["model_weight_file_missing"];
    models.push({
      model_id: approvedModel.modelId,
      path: modelPath,
      source_type: "local_cache_snapshot" as const,
      expected_storage_name: approvedModel.storageName,
      license: approvedModel.license,
      source_id: approvedModel.sourceId,
      approved: true as const,
      has_evidence: hasEvidence,
      ready: blockers.length === 0,
      blockers,
      file_count: inventory.fileCount,
      total_bytes: inventory.totalBytes,
      local_revision: metadataRevision.localRevision,
      metadata_revision_file_count: metadataRevision.fileCount,
      metadata_revision_consistent: metadataRevision.consistent,
    });
  }
  return models;
}

async function collectSupportDirectories(cacheDir: string): Promise<LocalRealtimeVoiceModelCacheEvidenceReport["support_directories"]> {
  const entries = await readdir(cacheDir, { withFileTypes: true });
  const supportDirectories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const reason = supportDirectoryReason(entry.name);
    if (!reason) {
      continue;
    }
    const supportPath = path.join(cacheDir, entry.name);
    const inventory = await inventoryDirectory(supportPath);
    supportDirectories.push({
      path: supportPath,
      name: entry.name,
      reason,
      file_count: inventory.fileCount,
      total_bytes: inventory.totalBytes,
    });
  }
  return supportDirectories;
}

function supportDirectoryReason(
  name: string,
): LocalRealtimeVoiceModelCacheEvidenceReport["support_directories"][number]["reason"] | undefined {
  if (name === "api-python-backend-venv") {
    return "runtime_support_venv_not_model_weights";
  }
  if (/^qwen-tts-smoke-\d{4}-\d{2}-\d{2}(?:-.+)?$/.test(name)) {
    return "runtime_generated_output_not_model_weights";
  }
  return undefined;
}

async function inventoryDirectory(dir: string): Promise<{
  fileCount: number;
  totalBytes: number;
  weightFileCount: number;
}> {
  let fileCount = 0;
  let totalBytes = 0;
  let weightFileCount = 0;
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = await inventoryDirectory(entryPath);
      fileCount += child.fileCount;
      totalBytes += child.totalBytes;
      weightFileCount += child.weightFileCount;
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const entryStats = await stat(entryPath);
    fileCount += 1;
    totalBytes += entryStats.size;
    if (isWeightFile(entry.name)) {
      weightFileCount += 1;
    }
  }

  return { fileCount, totalBytes, weightFileCount };
}

function isWeightFile(fileName: string): boolean {
  return /\.(?:safetensors|bin|gguf|npz)$/i.test(fileName);
}

async function collectHuggingFaceMetadataRevision(modelPath: string): Promise<{
  localRevision: string | null;
  fileCount: number;
  consistent: boolean;
}> {
  const metadataDir = path.join(modelPath, ".cache/huggingface/download");
  const metadataStats = await safeStat(metadataDir);
  if (!metadataStats?.isDirectory()) {
    return { localRevision: null, fileCount: 0, consistent: false };
  }

  const revisions = await collectMetadataFileRevisions(metadataDir);
  const uniqueRevisions = [...new Set(revisions)].sort();
  return {
    localRevision: uniqueRevisions.length === 1 ? uniqueRevisions[0] ?? null : null,
    fileCount: revisions.length,
    consistent: uniqueRevisions.length === 1,
  };
}

async function collectMetadataFileRevisions(dir: string): Promise<string[]> {
  const revisions: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      revisions.push(...await collectMetadataFileRevisions(entryPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".metadata")) {
      continue;
    }

    const firstLine = (await readFile(entryPath, "utf8")).split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (/^[0-9a-f]{40}$/i.test(firstLine)) {
      revisions.push(firstLine);
    }
  }

  return revisions;
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
  }
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
    if (arg === "--cache-dir") {
      options.cacheDir = requireValue(normalizedArgs, index, arg);
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

async function latestModelCacheEvidencePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/local-realtime-voice-model-cache-evidence-*.json");
  return files.sort().at(-1);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
