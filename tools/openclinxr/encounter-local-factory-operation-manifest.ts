import { stat } from "node:fs/promises";
import {
  buildGuardedRuntimeSelectorDisabledDecision,
  type GuardedRuntimeSelectorDisabledDecision,
} from "../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { buildDynamicEncounterFactoryPlanningProjection } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import type { EncounterLocalLaunchSelectionReport } from "./encounter-local-launch-selection.js";
import type { CaseDefinedActorRealismRequirement } from "./humanoid-realism-gate.js";

type CliOptions = {
  launchSelectionPath?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterLocalFactoryOperation =
  | "read_local_publication_payload_refs"
  | "resolve_scene_manifest_and_runtime_bundle_paths"
  | "derive_actor_runtime_slots"
  | "derive_static_equipment_and_room_slots"
  | "derive_dynamic_behavior_trace_slots"
  | "prepare_review_blocked_runtime_handoff";

export type EncounterLocalFactoryOperationManifest = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-local-factory-operation-manifest.v1";
  source: "encounter_local_launch_selection";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  operationMode: "local_deterministic_factory_plan_only";
  factoryOperations: EncounterLocalFactoryOperation[];
  localFilesystemPaths: EncounterLocalLaunchSelectionReport["localFilesystemPaths"];
  localAssetUrls: {
    sceneManifestUrl: string;
    learnerRuntimeBundleUrl: string;
  };
  dynamicBehaviorTags: string[];
  actorRoles: string[];
  actorRuntimeRealismRequirements: CaseDefinedActorRealismRequirement[];
  realismEvidenceRefs: EncounterLocalLaunchSelectionReport["realismEvidenceRefs"];
  guardedRuntimeSelectorDecision: GuardedRuntimeSelectorDisabledDecision;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  blockers: string[];
  evidenceBoundaries: {
    localFactoryPlanningOnly: true;
    uiLaunchPerformed: false;
    cloudOperationPerformed: false;
    providerExecutionPerformed: false;
    questEvidenceRefreshed: false;
    broadVerificationPerformed: false;
    learnerLaunchEnabled: false;
    productionReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
  claimBoundary: "local_factory_operation_manifest_not_runtime_execution";
};

const defaultOutputPath = `docs/openclinxr/encounter-local-factory-operation-manifest-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterLocalFactoryOperationManifestCli(process.argv.slice(2));
}

export async function runEncounterLocalFactoryOperationManifestCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-local-factory-operation-manifest-*.json");
    if (!validatePath) throw new Error("Missing encounter local factory operation manifest to validate.");
    const validation = validateEncounterLocalFactoryOperationManifest(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  const launchSelectionPath = options.launchSelectionPath ?? await latestPath("docs/openclinxr/encounter-local-launch-selection-*.json");
  if (!launchSelectionPath) throw new Error("Missing encounter local launch selection report.");
  const report = buildEncounterLocalFactoryOperationManifest(await readJson<EncounterLocalLaunchSelectionReport>(launchSelectionPath));
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export function buildEncounterLocalFactoryOperationManifest(
  launchSelection: EncounterLocalLaunchSelectionReport,
  generatedAt = new Date().toISOString(),
): EncounterLocalFactoryOperationManifest {
  const factoryPlanningScenario = buildDynamicEncounterFactoryPlanningProjection().scenarios.find((scenario) =>
    scenario.scenarioId === launchSelection.selectedScenarioId
  );
  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-local-factory-operation-manifest.v1",
    source: "encounter_local_launch_selection",
    selectedScenarioId: launchSelection.selectedScenarioId,
    selectedEncounterId: launchSelection.selectedEncounterId,
    selectedStationId: launchSelection.selectedStationId,
    selectedRuntimeAssetBundleId: launchSelection.selectedRuntimeAssetBundleId,
    operationMode: "local_deterministic_factory_plan_only",
    factoryOperations: [
      "read_local_publication_payload_refs",
      "resolve_scene_manifest_and_runtime_bundle_paths",
      "derive_actor_runtime_slots",
      "derive_static_equipment_and_room_slots",
      "derive_dynamic_behavior_trace_slots",
      "prepare_review_blocked_runtime_handoff",
    ],
    localFilesystemPaths: launchSelection.localFilesystemPaths,
    localAssetUrls: {
      sceneManifestUrl: launchSelection.sceneManifestUrl,
      learnerRuntimeBundleUrl: launchSelection.learnerRuntimeBundleUrl,
    },
    dynamicBehaviorTags: [...launchSelection.dynamicBehaviorTags],
    actorRoles: [...launchSelection.actorRoles],
    actorRuntimeRealismRequirements: factoryPlanningScenario
      ? factoryPlanningScenario.humanoidPerformanceContract.actorRuntimeRealismRequirements.map((requirement) => ({
          actorId: requirement.actorId,
          role: requirement.role,
          baselineMood: [...requirement.baselineMood],
          locomotionRequired: requirement.locomotionRequired,
          expressionRequired: requirement.expressionRequired,
          gazeRequired: requirement.gazeRequired,
          lipSyncRequired: requirement.lipSyncRequired,
          interactionRequired: requirement.interactionRequired,
          requiredCueIds: [...requirement.requiredCueIds],
        }))
      : [],
    realismEvidenceRefs: { ...launchSelection.realismEvidenceRefs },
    guardedRuntimeSelectorDecision: buildGuardedRuntimeSelectorDisabledDecision({
      selectedRuntimeAssetBundleId: launchSelection.selectedRuntimeAssetBundleId,
      selectedScenarioId: launchSelection.selectedScenarioId,
      selectedStationId: launchSelection.selectedStationId,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      blockerIds: launchSelection.blockers,
    }),
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    blockers: [...launchSelection.blockers],
    evidenceBoundaries: {
      localFactoryPlanningOnly: true,
      uiLaunchPerformed: false,
      cloudOperationPerformed: false,
      providerExecutionPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      learnerLaunchEnabled: false,
      productionReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
    claimBoundary: "local_factory_operation_manifest_not_runtime_execution",
  };
}

export function validateEncounterLocalFactoryOperationManifest(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-local-factory-operation-manifest.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_local_launch_selection", "/source", errors);
  requireLiteral(value.operationMode, "local_deterministic_factory_plan_only", "/operationMode", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/runtimeExecutionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/learnerLaunchAllowed", errors);
  requireLiteral(value.claimBoundary, "local_factory_operation_manifest_not_runtime_execution", "/claimBoundary", errors);
  requireArray(value.factoryOperations, "/factoryOperations", errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.dynamicBehaviorTags, "/dynamicBehaviorTags", errors);
  requireArray(value.actorRoles, "/actorRoles", errors);
  requireArray(value.actorRuntimeRealismRequirements, "/actorRuntimeRealismRequirements", errors);
  validateRealismEvidenceRefs(value.realismEvidenceRefs, errors);
  requireRecord(value.guardedRuntimeSelectorDecision, "/guardedRuntimeSelectorDecision", errors);
  requireRecord(value.localFilesystemPaths, "/localFilesystemPaths", errors);
  requireRecord(value.localAssetUrls, "/localAssetUrls", errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);
  if (Array.isArray(value.factoryOperations)) {
    for (const operation of [
      "read_local_publication_payload_refs",
      "resolve_scene_manifest_and_runtime_bundle_paths",
      "derive_actor_runtime_slots",
      "derive_static_equipment_and_room_slots",
      "derive_dynamic_behavior_trace_slots",
      "prepare_review_blocked_runtime_handoff",
    ]) {
      if (!value.factoryOperations.includes(operation)) errors.push(`/factoryOperations must include ${operation}`);
    }
  }
  if (Array.isArray(value.actorRuntimeRealismRequirements)) {
    for (const [index, requirement] of value.actorRuntimeRealismRequirements.entries()) {
      const requirementPath = `/actorRuntimeRealismRequirements/${index}`;
      if (!isRecord(requirement)) {
        errors.push(`${requirementPath} must be object`);
        continue;
      }
      if (typeof requirement.actorId !== "string" || requirement.actorId.length === 0) errors.push(`${requirementPath}/actorId required`);
      if (typeof requirement.role !== "string" || requirement.role.length === 0) errors.push(`${requirementPath}/role required`);
      requireArray(requirement.baselineMood, `${requirementPath}/baselineMood`, errors);
      requireArray(requirement.requiredCueIds, `${requirementPath}/requiredCueIds`, errors);
      for (const key of ["locomotionRequired", "expressionRequired", "gazeRequired", "lipSyncRequired", "interactionRequired"]) {
        if (typeof requirement[key] !== "boolean") errors.push(`${requirementPath}/${key} must be boolean`);
      }
    }
  }
  if (isRecord(value.localAssetUrls)) {
    for (const [key, path] of [[value.localAssetUrls.sceneManifestUrl, "/localAssetUrls/sceneManifestUrl"], [value.localAssetUrls.learnerRuntimeBundleUrl, "/localAssetUrls/learnerRuntimeBundleUrl"]] as const) {
      if (typeof key !== "string" || !key.startsWith("/xr-assets/generated/")) errors.push(`${path} must be a local generated public asset URL`);
    }
  }
  if (isRecord(value.evidenceBoundaries)) {
    requireLiteral(value.evidenceBoundaries.localFactoryPlanningOnly, true, "/evidenceBoundaries/localFactoryPlanningOnly", errors);
    requireLiteral(value.evidenceBoundaries.uiLaunchPerformed, false, "/evidenceBoundaries/uiLaunchPerformed", errors);
    requireLiteral(value.evidenceBoundaries.cloudOperationPerformed, false, "/evidenceBoundaries/cloudOperationPerformed", errors);
    requireLiteral(value.evidenceBoundaries.providerExecutionPerformed, false, "/evidenceBoundaries/providerExecutionPerformed", errors);
    requireLiteral(value.evidenceBoundaries.questEvidenceRefreshed, false, "/evidenceBoundaries/questEvidenceRefreshed", errors);
    requireLiteral(value.evidenceBoundaries.broadVerificationPerformed, false, "/evidenceBoundaries/broadVerificationPerformed", errors);
    requireLiteral(value.evidenceBoundaries.learnerLaunchEnabled, false, "/evidenceBoundaries/learnerLaunchEnabled", errors);
    requireLiteral(value.evidenceBoundaries.productionReadinessClaimed, false, "/evidenceBoundaries/productionReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.clinicalValidityClaimed, false, "/evidenceBoundaries/clinicalValidityClaimed", errors);
    requireLiteral(value.evidenceBoundaries.scoringValidityClaimed, false, "/evidenceBoundaries/scoringValidityClaimed", errors);
  }
  if (isRecord(value.guardedRuntimeSelectorDecision)) {
    requireLiteral(value.guardedRuntimeSelectorDecision.schemaVersion, "openclinxr.guarded-runtime-selector-disabled-decision.v1", "/guardedRuntimeSelectorDecision/schemaVersion", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.claimBoundary, "guarded_runtime_selector_seam_not_runtime_execution", "/guardedRuntimeSelectorDecision/claimBoundary", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.runtimeExecutionAllowed, false, "/guardedRuntimeSelectorDecision/runtimeExecutionAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.learnerLaunchAllowed, false, "/guardedRuntimeSelectorDecision/learnerLaunchAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.providerExecutionPerformed, false, "/guardedRuntimeSelectorDecision/providerExecutionPerformed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.uiLaunchPerformed, false, "/guardedRuntimeSelectorDecision/uiLaunchPerformed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.questEvidenceRefreshed, false, "/guardedRuntimeSelectorDecision/questEvidenceRefreshed", errors);
    requireArray(value.guardedRuntimeSelectorDecision.blockers, "/guardedRuntimeSelectorDecision/blockers", errors);
    requireArray(value.guardedRuntimeSelectorDecision.notEvidenceFor, "/guardedRuntimeSelectorDecision/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--launch-selection") {
      options.launchSelectionPath = requireValue(normalizedArgs, index, arg);
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

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${path} must be array`);
}

function requireLiteral<T>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function validateRealismEvidenceRefs(value: unknown, errors: string[]): void {
  requireRecord(value, "/realismEvidenceRefs", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.runtimeExecutionAllowed, false, "/realismEvidenceRefs/runtimeExecutionAllowed", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/realismEvidenceRefs/providerExecutionPerformed", errors);
  requireLiteral(value.questReadinessClaimed, false, "/realismEvidenceRefs/questReadinessClaimed", errors);
  requireArray(value.refIds, "/realismEvidenceRefs/refIds", errors);
  if (Array.isArray(value.refIds)) {
    for (const requiredRefId of ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"]) {
      if (!value.refIds.includes(requiredRefId)) errors.push(`/realismEvidenceRefs/refIds must include ${requiredRefId}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
