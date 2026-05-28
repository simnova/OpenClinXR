import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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

type ApprovedModelFile = {
  modelId: string;
  storageName: string;
  fileName: string;
  license: string;
  sourceId: string;
};

export type LocalModelCacheEvidenceReport = {
  kind: "local_model_evidence_check";
  claim_scope: "cache_inventory_only";
  generatedAt: string;
  cache_dir: string;
  approved_model_ids: string[];
  cache_exists: boolean;
  ready: boolean;
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    downloadAttemptedByThisTool: false;
    localRuntimeExecutionAttemptedByThisTool: false;
    productionUseAllowed: false;
  };
  models: Array<{
    model_id: string;
    path: string;
    source_type: "local_cache_snapshot";
    expected_storage_name: string;
    file_name: string;
    license: string;
    source_id: string;
    approved: true;
    has_evidence: boolean;
    ready: boolean;
    blockers: string[];
    local_revision: string | null;
    main_ref_revision: string | null;
    main_ref_matches_file_revision: boolean | null;
    size_bytes: number;
    sha256: string | null;
  }>;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const defaultCacheDir = "/Users/patrick/.cache/huggingface/hub";
const approvedModelFiles: ApprovedModelFile[] = [
  {
    modelId: "Qwen/Qwen3-4B-GGUF",
    storageName: "models--Qwen--Qwen3-4B-GGUF",
    fileName: "Qwen3-4B-Q4_K_M.gguf",
    license: "Apache-2.0",
    sourceId: "src-qwen3-4b-gguf-2026",
  },
];

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestModelCacheEvidencePath();
    if (!validatePath) {
      throw new Error("Missing local model cache evidence report to validate.");
    }
    const validation = validateLocalModelCacheEvidenceReport(await readJson<unknown>(validatePath));
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

  const report = await buildLocalModelCacheEvidence({
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

export async function buildLocalModelCacheEvidence(input: {
  cacheDir?: string;
  generatedAt?: string;
} = {}): Promise<LocalModelCacheEvidenceReport> {
  const cacheDir = input.cacheDir ?? defaultCacheDir;
  const cacheStats = await safeStat(cacheDir);
  const cacheExists = Boolean(cacheStats?.isDirectory());
  const models = cacheExists ? await collectApprovedModelFiles(cacheDir) : [];
  const ready = models.some((model) => model.ready);

  return {
    kind: "local_model_evidence_check",
    claim_scope: "cache_inventory_only",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    cache_dir: cacheDir,
    approved_model_ids: approvedModelFiles.map((model) => model.modelId),
    cache_exists: cacheExists,
    ready,
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      downloadAttemptedByThisTool: false,
      localRuntimeExecutionAttemptedByThisTool: false,
      productionUseAllowed: false,
    },
    models,
  };
}

export function validateLocalModelCacheEvidenceReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "local_model_evidence_check", "/kind", errors);
  requireLiteral(value.claim_scope, "cache_inventory_only", "/claim_scope", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireString(value.cache_dir, "/cache_dir", errors);
  requireStringArray(value.approved_model_ids, "/approved_model_ids", errors);
  requireBoolean(value.cache_exists, "/cache_exists", errors);
  requireBoolean(value.ready, "/ready", errors);
  requireObject(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireLiteral(value.policy.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
    requireLiteral(value.policy.paidApisUsed, false, "/policy/paidApisUsed", errors);
    requireLiteral(value.policy.downloadAttemptedByThisTool, false, "/policy/downloadAttemptedByThisTool", errors);
    requireLiteral(value.policy.localRuntimeExecutionAttemptedByThisTool, false, "/policy/localRuntimeExecutionAttemptedByThisTool", errors);
    requireLiteral(value.policy.productionUseAllowed, false, "/policy/productionUseAllowed", errors);
  }
  requireArray(value.models, "/models", errors);
  if (Array.isArray(value.models)) {
    value.models.forEach((model, index) => {
      validateModel(model, `/models/${index}`, errors);
    });
  }
  validateReadinessConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function collectApprovedModelFiles(cacheDir: string): Promise<LocalModelCacheEvidenceReport["models"]> {
  const models = [];
  for (const approvedModel of approvedModelFiles) {
    const modelRoot = path.join(cacheDir, approvedModel.storageName);
    const modelRootStats = await safeStat(modelRoot);
    if (!modelRootStats?.isDirectory()) {
      continue;
    }

    const mainRefRevision = await readMainRefRevision(modelRoot);
    const candidate = await resolveApprovedModelFile(modelRoot, approvedModel.fileName, mainRefRevision);
    const blockers: string[] = [];
    if (!candidate.filePath) {
      blockers.push("approved_model_file_missing");
    }
    if (!candidate.localRevision) {
      blockers.push("local_revision_missing");
    }
    if (!mainRefRevision) {
      blockers.push("main_ref_revision_missing");
    }
    if (candidate.filePath && mainRefRevision && candidate.localRevision !== mainRefRevision) {
      blockers.push("main_ref_file_missing");
    }
    const fileStats = candidate.filePath ? await safeStat(candidate.filePath) : undefined;
    if (fileStats && fileStats.size <= 0) {
      blockers.push("approved_model_file_empty");
    }
    const hasEvidence = Boolean(candidate.filePath && fileStats?.isFile() && fileStats.size > 0);

    models.push({
      model_id: approvedModel.modelId,
      path: candidate.filePath ?? path.join(modelRoot, "snapshots", mainRefRevision ?? "unknown", approvedModel.fileName),
      source_type: "local_cache_snapshot" as const,
      expected_storage_name: approvedModel.storageName,
      file_name: approvedModel.fileName,
      license: approvedModel.license,
      source_id: approvedModel.sourceId,
      approved: true as const,
      has_evidence: hasEvidence,
      ready: blockers.length === 0 && hasEvidence,
      blockers,
      local_revision: candidate.localRevision,
      main_ref_revision: mainRefRevision,
      main_ref_matches_file_revision: mainRefRevision && candidate.localRevision
        ? mainRefRevision === candidate.localRevision
        : null,
      size_bytes: fileStats?.size ?? 0,
      sha256: hasEvidence && candidate.filePath ? await sha256File(candidate.filePath) : null,
    });
  }
  return models;
}

async function resolveApprovedModelFile(
  modelRoot: string,
  fileName: string,
  mainRefRevision: string | null,
): Promise<{ filePath: string | null; localRevision: string | null }> {
  if (mainRefRevision) {
    const mainFilePath = path.join(modelRoot, "snapshots", mainRefRevision, fileName);
    const mainFileStats = await safeStat(mainFilePath);
    if (mainFileStats?.isFile()) {
      return { filePath: mainFilePath, localRevision: mainRefRevision };
    }
  }

  const snapshotsDir = path.join(modelRoot, "snapshots");
  const snapshotEntries = await safeReaddir(snapshotsDir);
  for (const entry of snapshotEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidatePath = path.join(snapshotsDir, entry.name, fileName);
    const candidateStats = await safeStat(candidatePath);
    if (candidateStats?.isFile()) {
      return { filePath: candidatePath, localRevision: entry.name };
    }
  }

  return { filePath: null, localRevision: mainRefRevision };
}

async function readMainRefRevision(modelRoot: string): Promise<string | null> {
  try {
    const ref = (await readFile(path.join(modelRoot, "refs", "main"), "utf8")).trim();
    return ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
  }
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function validateModel(value: unknown, pathName: string, errors: string[]): void {
  requireObject(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireString(value.model_id, `${pathName}/model_id`, errors);
  requireString(value.path, `${pathName}/path`, errors);
  requireLiteral(value.source_type, "local_cache_snapshot", `${pathName}/source_type`, errors);
  requireString(value.expected_storage_name, `${pathName}/expected_storage_name`, errors);
  requireString(value.file_name, `${pathName}/file_name`, errors);
  requireString(value.license, `${pathName}/license`, errors);
  requireString(value.source_id, `${pathName}/source_id`, errors);
  requireLiteral(value.approved, true, `${pathName}/approved`, errors);
  requireBoolean(value.has_evidence, `${pathName}/has_evidence`, errors);
  requireBoolean(value.ready, `${pathName}/ready`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
  requireNullableString(value.local_revision, `${pathName}/local_revision`, errors);
  requireNullableString(value.main_ref_revision, `${pathName}/main_ref_revision`, errors);
  requireNullableBoolean(value.main_ref_matches_file_revision, `${pathName}/main_ref_matches_file_revision`, errors);
  requireNumber(value.size_bytes, `${pathName}/size_bytes`, errors);
  requireNullableSha256(value.sha256, `${pathName}/sha256`, errors);
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
    && model.has_evidence === true
    && typeof model.sha256 === "string"
    && typeof model.size_bytes === "number"
    && model.size_bytes > 0,
  );

  if (value.ready === true && readyApprovedModels.length === 0) {
    errors.push("/ready cannot be true without at least one ready approved model file");
  }
  for (const [index, model] of models.entries()) {
    if (model.ready === true && Array.isArray(model.blockers) && model.blockers.length > 0) {
      errors.push(`/models/${index}/ready cannot be true when blockers are present`);
    }
    if (model.ready === true && model.has_evidence !== true) {
      errors.push(`/models/${index}/ready cannot be true without weight evidence`);
    }
    if (model.ready === true && typeof model.sha256 !== "string") {
      errors.push(`/models/${index}/ready cannot be true without sha256 evidence`);
    }
    if (model.ready === true && model.main_ref_matches_file_revision !== true) {
      errors.push(`/models/${index}/ready cannot be true without matching refs/main revision evidence`);
    }
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
  const files = await globFiles("docs/openclinxr/local-model-cache-evidence-*.json");
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

function requireObject(value: unknown, pathName: string, errors: string[]): void {
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

function requireNullableBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && typeof value !== "boolean") {
    errors.push(`${pathName} must be null or boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireNullableSha256(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) {
    errors.push(`${pathName} must be null or sha256 hex string`);
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
