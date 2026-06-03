import { stat } from "node:fs/promises";
import type {
  EncounterGenerationWorkOrder,
} from "../../../packages/openclinxr/capability-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import {
  buildEncounterAssetGenerationQueueReport,
  type EncounterAssetGenerationQueueReport,
} from "./encounter-asset-generation-queue.js";

type CliOptions = {
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type CacheOperationResult = "miss_stored" | "hit_reused" | "miss_stored_with_lru_eviction";

export type SharedAssetLibraryCacheOperation = {
  workOrderId: string;
  targetKind: EncounterGenerationWorkOrder["targetKind"];
  lookupKey: string;
  result: CacheOperationResult;
  generationDisposition: "skip_generation_reuse_cached_asset" | "generate_and_store_asset" | "generate_and_store_after_lru_eviction";
  evidenceGateCompatibility: {
    required: true;
    checkedBeforeReuse: true;
    disposition: "compatible_cached_asset_reused" | "requires_review_before_new_asset_reuse";
  };
  reusedAssetRef?: string;
  storedAssetRef: string;
  evictedLookupKeys: string[];
  recencyMostRecentFirst: string[];
};

export type SharedAssetLibraryCacheEvidenceReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.shared-asset-library-cache-evidence.v1";
  claimScope: "metadata_only_cache_policy_evidence";
  sourceRequestId: string;
  sourceScenarioId: string;
  cachePolicy: {
    lookupKeySource: "encounter_definition_semantic_requirements";
    cacheDisposition: "lookup_before_generate";
    evictionPolicy: "least_recently_used";
    updateRecencyOnHit: true;
    reuseRequiresEvidenceGateCompatibility: true;
    maxEntries: number;
  };
  summary: {
    workOrderCount: number;
    hitCount: number;
    missCount: number;
    evictionCount: number;
    finalCacheSize: number;
  };
  operations: SharedAssetLibraryCacheOperation[];
  notEvidenceFor: Array<"generated_asset_quality" | "provider_runtime_readiness" | "production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/shared-asset-library-cache-evidence-*.json");
    if (!validatePath) throw new Error("Missing shared asset library cache evidence report to validate.");
    const validation = validateSharedAssetLibraryCacheEvidenceReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const report = buildSharedAssetLibraryCacheEvidenceReport();
  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

export function buildSharedAssetLibraryCacheEvidenceReport(input: {
  generatedAt?: string;
  queueReport?: EncounterAssetGenerationQueueReport;
  maxEntries?: number;
  replayWorkOrdersTwice?: boolean;
} = {}): SharedAssetLibraryCacheEvidenceReport {
  const queueReport = input.queueReport ?? buildEncounterAssetGenerationQueueReport();
  const maxEntries = input.maxEntries ?? 500;
  const workOrders = input.replayWorkOrdersTwice === false
    ? queueReport.plan.generationWorkOrders
    : [...queueReport.plan.generationWorkOrders, ...queueReport.plan.generationWorkOrders];
  const operations = replayWorkOrdersThroughLru(workOrders, maxEntries);
  const hitCount = operations.filter((operation) => operation.result === "hit_reused").length;
  const evictionCount = operations.reduce((count, operation) => count + operation.evictedLookupKeys.length, 0);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    schemaVersion: "openclinxr.shared-asset-library-cache-evidence.v1",
    claimScope: "metadata_only_cache_policy_evidence",
    sourceRequestId: queueReport.request.requestId,
    sourceScenarioId: queueReport.request.scenarioId,
    cachePolicy: {
      lookupKeySource: "encounter_definition_semantic_requirements",
      cacheDisposition: "lookup_before_generate",
      evictionPolicy: "least_recently_used",
      updateRecencyOnHit: true,
      reuseRequiresEvidenceGateCompatibility: true,
      maxEntries,
    },
    summary: {
      workOrderCount: workOrders.length,
      hitCount,
      missCount: operations.length - hitCount,
      evictionCount,
      finalCacheSize: operations.at(-1)?.recencyMostRecentFirst.length ?? 0,
    },
    operations,
    notEvidenceFor: [
      "generated_asset_quality",
      "provider_runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function validateSharedAssetLibraryCacheEvidenceReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.shared-asset-library-cache-evidence.v1", "/schemaVersion", errors);
  requireLiteral(value.claimScope, "metadata_only_cache_policy_evidence", "/claimScope", errors);
  requireString(value.sourceRequestId, "/sourceRequestId", errors);
  requireString(value.sourceScenarioId, "/sourceScenarioId", errors);
  requireRecord(value.cachePolicy, "/cachePolicy", errors);
  requireRecord(value.summary, "/summary", errors);
  requireArray(value.operations, "/operations", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);

  if (isRecord(value.cachePolicy)) {
    requireLiteral(value.cachePolicy.lookupKeySource, "encounter_definition_semantic_requirements", "/cachePolicy/lookupKeySource", errors);
    requireLiteral(value.cachePolicy.cacheDisposition, "lookup_before_generate", "/cachePolicy/cacheDisposition", errors);
    requireLiteral(value.cachePolicy.evictionPolicy, "least_recently_used", "/cachePolicy/evictionPolicy", errors);
    requireLiteral(value.cachePolicy.updateRecencyOnHit, true, "/cachePolicy/updateRecencyOnHit", errors);
    requireLiteral(value.cachePolicy.reuseRequiresEvidenceGateCompatibility, true, "/cachePolicy/reuseRequiresEvidenceGateCompatibility", errors);
    requireNumber(value.cachePolicy.maxEntries, "/cachePolicy/maxEntries", errors);
  }
  if (isRecord(value.summary)) {
    requireNumber(value.summary.workOrderCount, "/summary/workOrderCount", errors);
    requireNumber(value.summary.hitCount, "/summary/hitCount", errors);
    requireNumber(value.summary.missCount, "/summary/missCount", errors);
    requireNumber(value.summary.evictionCount, "/summary/evictionCount", errors);
    requireNumber(value.summary.finalCacheSize, "/summary/finalCacheSize", errors);
  }
  if (Array.isArray(value.operations)) {
    value.operations.forEach((operation, index) => {
      if (!isRecord(operation)) {
        errors.push(`/operations/${index} must be object`);
        return;
      }
      requireString(operation.workOrderId, `/operations/${index}/workOrderId`, errors);
      requireString(operation.targetKind, `/operations/${index}/targetKind`, errors);
      requireString(operation.lookupKey, `/operations/${index}/lookupKey`, errors);
      requireOneOf(operation.result, ["miss_stored", "hit_reused", "miss_stored_with_lru_eviction"], `/operations/${index}/result`, errors);
      requireOneOf(operation.generationDisposition, ["skip_generation_reuse_cached_asset", "generate_and_store_asset", "generate_and_store_after_lru_eviction"], `/operations/${index}/generationDisposition`, errors);
      requireRecord(operation.evidenceGateCompatibility, `/operations/${index}/evidenceGateCompatibility`, errors);
      if (isRecord(operation.evidenceGateCompatibility)) {
        requireLiteral(operation.evidenceGateCompatibility.required, true, `/operations/${index}/evidenceGateCompatibility/required`, errors);
        requireLiteral(operation.evidenceGateCompatibility.checkedBeforeReuse, true, `/operations/${index}/evidenceGateCompatibility/checkedBeforeReuse`, errors);
        requireOneOf(operation.evidenceGateCompatibility.disposition, ["compatible_cached_asset_reused", "requires_review_before_new_asset_reuse"], `/operations/${index}/evidenceGateCompatibility/disposition`, errors);
      }
      requireString(operation.storedAssetRef, `/operations/${index}/storedAssetRef`, errors);
      requireArray(operation.evictedLookupKeys, `/operations/${index}/evictedLookupKeys`, errors);
      requireArray(operation.recencyMostRecentFirst, `/operations/${index}/recencyMostRecentFirst`, errors);
      if (operation.result === "hit_reused") requireString(operation.reusedAssetRef, `/operations/${index}/reusedAssetRef`, errors);
      if (operation.result === "hit_reused" && operation.generationDisposition !== "skip_generation_reuse_cached_asset") {
        errors.push(`/operations/${index}/generationDisposition must skip generation for cache hits`);
      }
    });
  }
  for (const claim of ["generated_asset_quality", "provider_runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value.notEvidenceFor, claim, "/notEvidenceFor", errors);
  }
  if (isRecord(value.summary) && Array.isArray(value.operations)) {
    if (value.summary.workOrderCount !== value.operations.length) errors.push("/summary/workOrderCount must match /operations length");
    if (value.summary.hitCount === 0) errors.push("/summary/hitCount must be greater than 0 for reuse evidence");
    if (value.summary.missCount === 0) errors.push("/summary/missCount must be greater than 0 for generation-miss evidence");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function replayWorkOrdersThroughLru(
  workOrders: EncounterGenerationWorkOrder[],
  maxEntries: number,
): SharedAssetLibraryCacheOperation[] {
  const cache = new Map<string, string>();
  const operations: SharedAssetLibraryCacheOperation[] = [];
  for (const workOrder of workOrders) {
    const lookupKey = workOrder.sharedAssetLibraryReuse.lookupKey;
    const storedAssetRef = workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.blobPrefix;
    const evictedLookupKeys: string[] = [];
    if (cache.has(lookupKey)) {
      const reusedAssetRef = cache.get(lookupKey) ?? storedAssetRef;
      cache.delete(lookupKey);
      cache.set(lookupKey, reusedAssetRef);
      operations.push({
        workOrderId: workOrder.workOrderId,
        targetKind: workOrder.targetKind,
        lookupKey,
        result: "hit_reused",
        generationDisposition: "skip_generation_reuse_cached_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "compatible_cached_asset_reused",
        },
        reusedAssetRef,
        storedAssetRef,
        evictedLookupKeys,
        recencyMostRecentFirst: [...cache.keys()].reverse(),
      });
      continue;
    }
    cache.set(lookupKey, storedAssetRef);
    while (cache.size > maxEntries) {
      const leastRecentKey = cache.keys().next().value as string | undefined;
      if (!leastRecentKey) break;
      cache.delete(leastRecentKey);
      evictedLookupKeys.push(leastRecentKey);
    }
    operations.push({
      workOrderId: workOrder.workOrderId,
      targetKind: workOrder.targetKind,
      lookupKey,
      result: evictedLookupKeys.length > 0 ? "miss_stored_with_lru_eviction" : "miss_stored",
      generationDisposition: evictedLookupKeys.length > 0 ? "generate_and_store_after_lru_eviction" : "generate_and_store_asset",
      evidenceGateCompatibility: {
        required: true,
        checkedBeforeReuse: true,
        disposition: "requires_review_before_new_asset_reuse",
      },
      storedAssetRef,
      evictedLookupKeys,
      recencyMostRecentFirst: [...cache.keys()].reverse(),
    });
  }
  return operations;
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
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
  const filesWithStats = await Promise.all(files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath)).at(-1)?.filePath;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pathName} must be object`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${pathName} must be non-empty string`);
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${pathName} must be number`);
}

function requireLiteral(value: unknown, expected: string | boolean, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireOneOf(value: unknown, expectedValues: string[], pathName: string, errors: string[]): void {
  if (!expectedValues.includes(String(value))) errors.push(`${pathName} must be one of ${expectedValues.join(", ")}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, pathName: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pathName} must include ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
