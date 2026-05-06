import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import type { LocalRealtimeVoiceModelCacheEvidenceReport } from "./local-realtime-voice-model-cache-evidence.js";

type CliOptions = {
  metadataInput?: string;
  cacheEvidenceInput?: string;
  outputPath?: string;
  generatedAt?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ApprovedVoiceModel = {
  modelId: string;
  expectedLicense: "cc-by-4.0" | "apache-2.0";
  requiredFiles: string[];
};

export type LocalRealtimeVoiceModelSourceMetadataSnapshot = {
  kind: "huggingface_realtime_voice_model_metadata_snapshot";
  capturedAt: string;
  models: Array<{
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
  }>;
};

export type LocalRealtimeVoiceModelSourceCurrentnessReport = {
  kind: "local_realtime_voice_model_source_currentness_check";
  generatedAt: string;
  ready: boolean;
  metadata_file: string;
  cache_evidence_file: string;
  models: Array<{
    model_id: string;
    source_revision: string | null;
    local_revision: string | null;
    license: {
      source: string | null;
      expected: "cc-by-4.0" | "apache-2.0";
      accepted: boolean;
    };
    files: {
      required: string[];
      listed_by_source: boolean;
    };
    cache: {
      cached: boolean;
      ready: boolean;
      metadata_revision_consistent: boolean;
    };
    verdict: {
      passed: boolean;
      blockers: string[];
    };
  }>;
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const approvedModels: ApprovedVoiceModel[] = [
  {
    modelId: "kyutai/moshiko-mlx-q4",
    expectedLicense: "cc-by-4.0",
    requiredFiles: ["model.q4.safetensors"],
  },
  {
    modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    expectedLicense: "apache-2.0",
    requiredFiles: ["model.safetensors", "speech_tokenizer/model.safetensors"],
  },
];

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);

  if (options.validatePath) {
    const report = await readJson<unknown>(options.validatePath);
    const validation = validateLocalRealtimeVoiceModelSourceCurrentnessReport(report);
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

  const metadataPath = options.metadataInput ?? await latestPath("docs/openclinxr/local-realtime-voice-model-source-metadata-*.json");
  const cacheEvidencePath = options.cacheEvidenceInput ?? await latestPath("docs/openclinxr/local-realtime-voice-model-cache-evidence-*.json");
  if (!metadataPath) {
    throw new Error("Missing --metadata-input or docs/openclinxr/local-realtime-voice-model-source-metadata-*.json");
  }
  if (!cacheEvidencePath) {
    throw new Error("Missing --cache-evidence-input or docs/openclinxr/local-realtime-voice-model-cache-evidence-*.json");
  }

  const report = buildLocalRealtimeVoiceModelSourceCurrentnessReport({
    generatedAt: options.generatedAt,
    metadataFile: metadataPath,
    cacheEvidenceFile: cacheEvidencePath,
    metadata: await readJson<LocalRealtimeVoiceModelSourceMetadataSnapshot>(metadataPath),
    cacheEvidence: await readJson<LocalRealtimeVoiceModelCacheEvidenceReport>(cacheEvidencePath),
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  if (options.validateLatest) {
    if (report.ready) {
      console.log(`Validated ${metadataPath} against ${cacheEvidencePath}`);
      return;
    }
    for (const blocker of report.verdict.blockers) {
      console.error(blocker);
    }
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

export function buildLocalRealtimeVoiceModelSourceCurrentnessReport(input: {
  generatedAt?: string;
  metadataFile: string;
  cacheEvidenceFile: string;
  metadata: LocalRealtimeVoiceModelSourceMetadataSnapshot;
  cacheEvidence: LocalRealtimeVoiceModelCacheEvidenceReport;
}): LocalRealtimeVoiceModelSourceCurrentnessReport {
  const metadataValidation = validateLocalRealtimeVoiceModelSourceMetadataSnapshot(input.metadata);
  const metadataModels = new Map(input.metadata.models.map((model) => [model.modelId, model]));
  const cacheModels = new Map(input.cacheEvidence.models.map((model) => [model.model_id, model]));
  const metadataErrors = metadataValidation.ok ? [] : metadataValidation.errors.map((error) => `source_metadata_invalid:${error}`);

  const models = approvedModels.map((approvedModel) => {
    const metadataModel = metadataModels.get(approvedModel.modelId);
    const cacheModel = cacheModels.get(approvedModel.modelId);
    const sourceLicense = typeof metadataModel?.license === "string" ? metadataModel.license.toLowerCase() : null;
    const listedBySource = approvedModel.requiredFiles.every((requiredFile) =>
      metadataModel?.siblings.some((sibling) => sibling.rfilename === requiredFile) === true,
    );
    const blockers = unique([
      ...metadataErrors,
      metadataModel ? undefined : `source_metadata_model_missing:${approvedModel.modelId}`,
      metadataModel?.private === false ? undefined : `source_model_private:${approvedModel.modelId}`,
      metadataModel?.disabled === false ? undefined : `source_model_disabled:${approvedModel.modelId}`,
      sourceLicense === approvedModel.expectedLicense
        ? undefined
        : `source_license_not_accepted:${approvedModel.modelId}:${sourceLicense ?? "missing"}`,
      listedBySource ? undefined : `source_required_files_missing:${approvedModel.modelId}`,
      cacheModel ? undefined : `local_voice_model_cache_missing:${approvedModel.modelId}`,
      cacheModel?.ready === true ? undefined : `local_voice_model_cache_not_ready:${approvedModel.modelId}`,
      cacheModel?.metadata_revision_consistent === true
        ? undefined
        : `local_voice_model_cache_revision_missing_or_ambiguous:${approvedModel.modelId}`,
      cacheModel?.local_revision === metadataModel?.sha
        ? undefined
        : `local_voice_model_cache_revision_not_current:${approvedModel.modelId}:source_${metadataModel?.sha ?? "missing"}_local_${cacheModel?.local_revision ?? "missing"}`,
    ]);
    const passed = blockers.length === 0;

    return {
      model_id: approvedModel.modelId,
      source_revision: metadataModel?.sha ?? null,
      local_revision: cacheModel?.local_revision ?? null,
      license: {
        source: sourceLicense,
        expected: approvedModel.expectedLicense,
        accepted: sourceLicense === approvedModel.expectedLicense,
      },
      files: {
        required: approvedModel.requiredFiles,
        listed_by_source: listedBySource,
      },
      cache: {
        cached: Boolean(cacheModel),
        ready: cacheModel?.ready === true,
        metadata_revision_consistent: cacheModel?.metadata_revision_consistent === true,
      },
      verdict: {
        passed,
        blockers,
      },
    };
  });
  const blockers = unique(models.flatMap((model) => model.verdict.blockers));
  const ready = blockers.length === 0;

  return {
    kind: "local_realtime_voice_model_source_currentness_check",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ready,
    metadata_file: input.metadataFile,
    cache_evidence_file: input.cacheEvidenceFile,
    models,
    verdict: {
      passed: ready,
      blockers,
    },
  };
}

export function validateLocalRealtimeVoiceModelSourceMetadataSnapshot(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "huggingface_realtime_voice_model_metadata_snapshot", "/kind", errors);
  requireString(value.capturedAt, "/capturedAt", errors);
  if (!Array.isArray(value.models)) {
    errors.push("/models must be array");
  } else {
    value.models.forEach((model, index) => validateSourceMetadataModel(model, `/models/${index}`, errors));
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateSourceMetadataModel(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
    return;
  }

  requireString(value.modelId, `${pathName}/modelId`, errors);
  requireString(value.sourceUrl, `${pathName}/sourceUrl`, errors);
  requireString(value.apiUrl, `${pathName}/apiUrl`, errors);
  requireString(value.sha, `${pathName}/sha`, errors);
  requireString(value.license, `${pathName}/license`, errors);
  requireString(value.lastModified, `${pathName}/lastModified`, errors);
  requireBoolean(value.private, `${pathName}/private`, errors);
  requireBoolean(value.disabled, `${pathName}/disabled`, errors);
  if (!Array.isArray(value.siblings)) {
    errors.push(`${pathName}/siblings must be array`);
  } else {
    value.siblings.forEach((sibling, index) => {
      if (!isRecord(sibling)) {
        errors.push(`${pathName}/siblings/${index} must be object`);
        return;
      }
      requireString(sibling.rfilename, `${pathName}/siblings/${index}/rfilename`, errors);
      if (sibling.size !== null && (typeof sibling.size !== "number" || !Number.isFinite(sibling.size))) {
        errors.push(`${pathName}/siblings/${index}/size must be null or finite number`);
      }
    });
  }
}

function validateLocalRealtimeVoiceModelSourceCurrentnessReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "local_realtime_voice_model_source_currentness_check", "/kind", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireBoolean(value.ready, "/ready", errors);
  requireString(value.metadata_file, "/metadata_file", errors);
  requireString(value.cache_evidence_file, "/cache_evidence_file", errors);
  if (!Array.isArray(value.models)) {
    errors.push("/models must be array");
  }
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

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function requireLiteral<T extends string>(value: unknown, literal: T, pathName: string, errors: string[]): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
