import path from "node:path";
import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import type { LocalModelCacheEvidenceReport } from "./local-model-cache-evidence.js";

type CliOptions = {
  metadataInput?: string;
  cacheEvidenceInput?: string;
  outputPath?: string;
  generatedAt?: string;
  validatePath?: string;
  validateLatest: boolean;
};

export type LocalModelSourceMetadataSnapshot = {
  kind: "huggingface_model_metadata_snapshot";
  capturedAt: string;
  modelId: string;
  sourceUrl: string;
  apiUrl: string;
  sha: string;
  license: string;
  lastModified: string;
  private: boolean;
  disabled: boolean;
  siblings: Array<{
    rfilename: string;
    size: number | null;
  }>;
};

export type LocalModelSourceCurrentnessReport = {
  kind: "local_model_source_currentness_check";
  generatedAt: string;
  ready: boolean;
  metadata_file: string;
  cache_evidence_file: string;
  model_id: string;
  source_revision: string | null;
  local_revision: string | null;
  license: {
    source: string | null;
    expected: "apache-2.0";
    accepted: boolean;
  };
  file: {
    expected: "Qwen3-4B-Q4_K_M.gguf";
    listed_by_source: boolean;
    cached: boolean;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const approvedModelId = "Qwen/Qwen3-4B-GGUF";
const approvedLicense = "apache-2.0";
const approvedFileName = "Qwen3-4B-Q4_K_M.gguf";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);

  if (options.validatePath) {
    const report = await readJson<unknown>(options.validatePath);
    const validation = validateLocalModelSourceCurrentnessReport(report);
    if (validation.ok) {
      console.log(`Validated ${options.validatePath}`);
      return;
    }
    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const metadataPath = options.metadataInput ?? await latestPath("docs/openclinxr/local-model-source-metadata-*.json");
  const cacheEvidencePath = options.cacheEvidenceInput ?? await latestPath("docs/openclinxr/local-model-cache-evidence-*.json");
  if (!metadataPath) {
    throw new Error("Missing --metadata-input or docs/openclinxr/local-model-source-metadata-*.json");
  }
  if (!cacheEvidencePath) {
    throw new Error("Missing --cache-evidence-input or docs/openclinxr/local-model-cache-evidence-*.json");
  }

  const report = buildLocalModelSourceCurrentnessReport({
    generatedAt: options.generatedAt,
    metadataFile: metadataPath,
    cacheEvidenceFile: cacheEvidencePath,
    metadata: await readJson<LocalModelSourceMetadataSnapshot>(metadataPath),
    cacheEvidence: await readJson<LocalModelCacheEvidenceReport>(cacheEvidencePath),
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
  } else if (options.validateLatest) {
    if (report.ready) {
      console.log(`Validated ${metadataPath} against ${cacheEvidencePath}`);
    } else {
      for (const blocker of report.verdict.blockers) {
        console.error(blocker);
      }
      process.exitCode = 1;
    }
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

export function buildLocalModelSourceCurrentnessReport(input: {
  generatedAt?: string;
  metadataFile: string;
  cacheEvidenceFile: string;
  metadata: LocalModelSourceMetadataSnapshot;
  cacheEvidence: LocalModelCacheEvidenceReport;
}): LocalModelSourceCurrentnessReport {
  const metadataValidation = validateLocalModelSourceMetadataSnapshot(input.metadata);
  const sourceLicense = typeof input.metadata.license === "string" ? input.metadata.license.toLowerCase() : null;
  const cacheModel = input.cacheEvidence.models.find((model) => model.model_id === approvedModelId && model.file_name === approvedFileName);
  const listedBySource = input.metadata.siblings.some((sibling) => sibling.rfilename === approvedFileName);
  const blockers = unique([
    ...(metadataValidation.ok ? [] : metadataValidation.errors.map((error) => `source_metadata_invalid:${error}`)),
    input.metadata.modelId === approvedModelId
      ? undefined
      : `source_model_id_mismatch:${input.metadata.modelId}`,
    input.metadata.private === false ? undefined : "source_model_private",
    input.metadata.disabled === false ? undefined : "source_model_disabled",
    sourceLicense === approvedLicense ? undefined : `source_license_not_apache_2:${sourceLicense ?? "missing"}`,
    listedBySource ? undefined : `source_file_missing:${approvedFileName}`,
    cacheModel ? undefined : `local_model_cache_file_missing:${approvedModelId}:${approvedFileName}`,
    cacheModel?.ready === true ? undefined : `local_model_cache_file_not_ready:${approvedModelId}:${approvedFileName}`,
    cacheModel?.local_revision === input.metadata.sha
      ? undefined
      : `local_model_cache_revision_not_current:${approvedModelId}:source_${input.metadata.sha}_local_${cacheModel?.local_revision ?? "missing"}`,
  ]);
  const ready = blockers.length === 0;

  return {
    kind: "local_model_source_currentness_check",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ready,
    metadata_file: input.metadataFile,
    cache_evidence_file: input.cacheEvidenceFile,
    model_id: approvedModelId,
    source_revision: input.metadata.sha,
    local_revision: cacheModel?.local_revision ?? null,
    license: {
      source: sourceLicense,
      expected: approvedLicense,
      accepted: sourceLicense === approvedLicense,
    },
    file: {
      expected: approvedFileName,
      listed_by_source: listedBySource,
      cached: Boolean(cacheModel),
    },
    verdict: {
      passed: ready,
      blockers,
    },
  };
}

export function validateLocalModelSourceMetadataSnapshot(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "huggingface_model_metadata_snapshot", "/kind", errors);
  requireString(value.capturedAt, "/capturedAt", errors);
  requireString(value.modelId, "/modelId", errors);
  requireString(value.sourceUrl, "/sourceUrl", errors);
  requireString(value.apiUrl, "/apiUrl", errors);
  requireString(value.sha, "/sha", errors);
  requireString(value.license, "/license", errors);
  requireString(value.lastModified, "/lastModified", errors);
  requireBoolean(value.private, "/private", errors);
  requireBoolean(value.disabled, "/disabled", errors);
  if (!Array.isArray(value.siblings)) {
    errors.push("/siblings must be array");
  } else {
    value.siblings.forEach((sibling, index) => {
      if (!isRecord(sibling)) {
        errors.push(`/siblings/${index} must be object`);
        return;
      }
      requireString(sibling.rfilename, `/siblings/${index}/rfilename`, errors);
      if (sibling.size !== null && (typeof sibling.size !== "number" || !Number.isFinite(sibling.size))) {
        errors.push(`/siblings/${index}/size must be null or finite number`);
      }
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateLocalModelSourceCurrentnessReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "local_model_source_currentness_check", "/kind", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireBoolean(value.ready, "/ready", errors);
  requireString(value.metadata_file, "/metadata_file", errors);
  requireString(value.cache_evidence_file, "/cache_evidence_file", errors);
  requireString(value.model_id, "/model_id", errors);
  requireNullableString(value.source_revision, "/source_revision", errors);
  requireNullableString(value.local_revision, "/local_revision", errors);
  if (!isRecord(value.verdict)) {
    errors.push("/verdict must be object");
  } else {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
  }
  if (value.ready === true && (!isRecord(value.verdict) || value.verdict.passed !== true)) {
    errors.push("/ready cannot be true unless verdict.passed is true");
  }
  if (value.ready !== true) {
    errors.push("/ready must be true for validation");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--metadata-input") {
      options.metadataInput = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--cache-evidence-input") {
      options.cacheEvidenceInput = requireValue(normalizedArgs, index, arg);
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

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
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

function requireLiteral<T extends string>(value: unknown, literal: T, pathName: string, errors: string[]): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
