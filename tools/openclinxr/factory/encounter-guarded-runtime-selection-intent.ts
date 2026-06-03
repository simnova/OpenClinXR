import { stat } from "node:fs/promises";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import type { EncounterLocalFactoryHandoffPreflightReport } from "./encounter-local-factory-handoff-preflight.js";

type CliOptions = {
  handoffPreflightPath?: string;
  providerBenchmarkPath?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type ProviderBenchmark = {
  localModel?: { status?: string; metrics?: { executionAttempted?: boolean } };
  localVoice?: { status?: string; metrics?: { executionAttempted?: boolean } };
};

export type EncounterGuardedRuntimeSelectionIntent = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-guarded-runtime-selection-intent.v1";
  source: "encounter_local_factory_handoff_preflight";
  selectionMode: "guarded_runtime_selection_intent_only";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  handoffArtifactsInternallyPaired: boolean;
  guardedRuntimeSelectorDecision: EncounterLocalFactoryHandoffPreflightReport["guardedRuntimeSelectorDecision"];
  modelRuntimeCandidate: "mock" | "local_configured_not_executed";
  voiceRuntimeCandidate: "mock" | "local_configured_not_executed";
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  providerExecutionPerformed: false;
  uiLaunchPerformed: false;
  questEvidenceRefreshed: false;
  broadVerificationPerformed: false;
  blockers: string[];
  nextAllowedStep: "wire_runtime_selector_behind_disabled_guard";
  claimBoundary: "guarded_runtime_selection_intent_not_runtime_execution";
};

const defaultOutputPath = `docs/openclinxr/encounter-guarded-runtime-selection-intent-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterGuardedRuntimeSelectionIntentCli(process.argv.slice(2));
}

export async function runEncounterGuardedRuntimeSelectionIntentCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-guarded-runtime-selection-intent-*.json");
    if (!validatePath) throw new Error("Missing guarded runtime selection intent to validate.");
    const validation = validateEncounterGuardedRuntimeSelectionIntent(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  const handoffPreflightPath = options.handoffPreflightPath ?? await latestPath("docs/openclinxr/encounter-local-factory-handoff-preflight-*.json");
  const providerBenchmarkPath = options.providerBenchmarkPath ?? await latestPath("docs/openclinxr/local-provider-benchmark-*.json");
  if (!handoffPreflightPath) throw new Error("Missing local factory handoff preflight report.");
  if (!providerBenchmarkPath) throw new Error("Missing local provider benchmark report.");
  const report = buildEncounterGuardedRuntimeSelectionIntent(
    await readJson<EncounterLocalFactoryHandoffPreflightReport>(handoffPreflightPath),
    await readJson<ProviderBenchmark>(providerBenchmarkPath),
  );
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export function buildEncounterGuardedRuntimeSelectionIntent(
  handoffPreflight: EncounterLocalFactoryHandoffPreflightReport,
  providerBenchmark: ProviderBenchmark,
  generatedAt = new Date().toISOString(),
): EncounterGuardedRuntimeSelectionIntent {
  const modelRuntimeCandidate = providerBenchmark.localModel?.status === "passed"
    && providerBenchmark.localModel.metrics?.executionAttempted === false
    ? "local_configured_not_executed"
    : "mock";
  const voiceRuntimeCandidate = providerBenchmark.localVoice?.status === "passed"
    && providerBenchmark.localVoice.metrics?.executionAttempted === false
    ? "local_configured_not_executed"
    : "mock";
  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-guarded-runtime-selection-intent.v1",
    source: "encounter_local_factory_handoff_preflight",
    selectionMode: "guarded_runtime_selection_intent_only",
    selectedScenarioId: handoffPreflight.selectedScenarioId,
    selectedEncounterId: handoffPreflight.selectedEncounterId,
    selectedStationId: handoffPreflight.selectedStationId,
    selectedRuntimeAssetBundleId: `${handoffPreflight.selectedEncounterId}:runtime-selection-intent`,
    handoffArtifactsInternallyPaired: handoffPreflight.internallyPaired,
    guardedRuntimeSelectorDecision: handoffPreflight.guardedRuntimeSelectorDecision,
    modelRuntimeCandidate,
    voiceRuntimeCandidate,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    broadVerificationPerformed: false,
    blockers: uniqueStrings([
      ...handoffPreflight.blockers,
      "runtime_selector_disabled_guard_not_wired",
      "provider_execution_disabled_by_policy",
      "learner_launch_disabled_until_evidence_gates_clear",
    ]),
    nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
    claimBoundary: "guarded_runtime_selection_intent_not_runtime_execution",
  };
}

export function validateEncounterGuardedRuntimeSelectionIntent(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-guarded-runtime-selection-intent.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_local_factory_handoff_preflight", "/source", errors);
  requireLiteral(value.selectionMode, "guarded_runtime_selection_intent_only", "/selectionMode", errors);
  requireOneOf(value.modelRuntimeCandidate, ["mock", "local_configured_not_executed"], "/modelRuntimeCandidate", errors);
  requireOneOf(value.voiceRuntimeCandidate, ["mock", "local_configured_not_executed"], "/voiceRuntimeCandidate", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/runtimeExecutionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/learnerLaunchAllowed", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/providerExecutionPerformed", errors);
  requireLiteral(value.uiLaunchPerformed, false, "/uiLaunchPerformed", errors);
  requireLiteral(value.questEvidenceRefreshed, false, "/questEvidenceRefreshed", errors);
  requireLiteral(value.broadVerificationPerformed, false, "/broadVerificationPerformed", errors);
  requireLiteral(value.nextAllowedStep, "wire_runtime_selector_behind_disabled_guard", "/nextAllowedStep", errors);
  requireLiteral(value.claimBoundary, "guarded_runtime_selection_intent_not_runtime_execution", "/claimBoundary", errors);
  requireRecord(value.guardedRuntimeSelectorDecision, "/guardedRuntimeSelectorDecision", errors);
  requireArray(value.blockers, "/blockers", errors);
  if (Array.isArray(value.blockers)) {
    for (const required of ["runtime_selector_disabled_guard_not_wired", "provider_execution_disabled_by_policy", "learner_launch_disabled_until_evidence_gates_clear"]) {
      if (!value.blockers.includes(required)) errors.push(`/blockers must include ${required}`);
    }
  }
  if (isRecord(value.guardedRuntimeSelectorDecision)) {
    requireLiteral(value.guardedRuntimeSelectorDecision.claimBoundary, "guarded_runtime_selector_seam_not_runtime_execution", "/guardedRuntimeSelectorDecision/claimBoundary", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.runtimeExecutionAllowed, false, "/guardedRuntimeSelectorDecision/runtimeExecutionAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.learnerLaunchAllowed, false, "/guardedRuntimeSelectorDecision/learnerLaunchAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.providerExecutionPerformed, false, "/guardedRuntimeSelectorDecision/providerExecutionPerformed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.uiLaunchPerformed, false, "/guardedRuntimeSelectorDecision/uiLaunchPerformed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.questEvidenceRefreshed, false, "/guardedRuntimeSelectorDecision/questEvidenceRefreshed", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--handoff-preflight") {
      options.handoffPreflightPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--provider-benchmark") {
      options.providerBenchmarkPath = requireValue(normalizedArgs, index, arg);
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
  const filesWithStats = await Promise.all(files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath)).at(-1)?.filePath;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${path} must be array`);
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireLiteral<T>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireOneOf(value: unknown, expected: readonly unknown[], path: string, errors: string[]): void {
  if (!expected.includes(value)) errors.push(`${path} must be one of ${expected.map((item) => JSON.stringify(item)).join(", ")}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
