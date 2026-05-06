import { readdir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  venvPath?: string;
  packageVersionsPath?: string;
  importResultsPath?: string;
  entrypointsPath?: string;
  commandHelpPath?: string;
  modelCacheEvidencePath?: string;
  generatedAt?: string;
  outputPath?: string;
};

type ImportResult = {
  ok: boolean;
  error?: string;
};

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
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
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
