import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJson } from "../agent-factory/lib.js";

type CliOptions = {
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
  }>;
  support_directories: Array<{
    path: string;
    name: string;
    reason: "runtime_support_venv_not_model_weights";
    file_count: number;
    total_bytes: number;
  }>;
};

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

async function collectApprovedModels(cacheDir: string): Promise<LocalRealtimeVoiceModelCacheEvidenceReport["models"]> {
  const models = [];
  for (const approvedModel of approvedModels) {
    const modelPath = path.join(cacheDir, approvedModel.storageName);
    const modelStats = await safeStat(modelPath);
    if (!modelStats?.isDirectory()) {
      continue;
    }

    const inventory = await inventoryDirectory(modelPath);
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
    });
  }
  return models;
}

async function collectSupportDirectories(cacheDir: string): Promise<LocalRealtimeVoiceModelCacheEvidenceReport["support_directories"]> {
  const entries = await readdir(cacheDir, { withFileTypes: true });
  const supportDirectories = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name !== "api-python-backend-venv") {
      continue;
    }
    const supportPath = path.join(cacheDir, entry.name);
    const inventory = await inventoryDirectory(supportPath);
    supportDirectories.push({
      path: supportPath,
      name: entry.name,
      reason: "runtime_support_venv_not_model_weights" as const,
      file_count: inventory.fileCount,
      total_bytes: inventory.totalBytes,
    });
  }
  return supportDirectories;
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

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
  }
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
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
