import { stat } from "node:fs/promises";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import type { EncounterGuardedRuntimeSelectionIntent } from "./encounter-guarded-runtime-selection-intent.js";

type CliOptions = {
  selectionIntentPath?: string;
  publicationPayloadsPath?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterRuntimeSelectionReviewPacket = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1";
  source: "encounter_guarded_runtime_selection_intent";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  reviewPacketMode: "read_only_guarded_runtime_handoff";
  handoffArtifactsInternallyPaired: boolean;
  runtimeCandidates: {
    model: EncounterGuardedRuntimeSelectionIntent["modelRuntimeCandidate"];
    voice: EncounterGuardedRuntimeSelectionIntent["voiceRuntimeCandidate"];
  };
  guardedRuntimeSelectorDecision: EncounterGuardedRuntimeSelectionIntent["guardedRuntimeSelectorDecision"];
  publicationPayloadLinkage: {
    source: "encounter_publication_payloads";
    status: string;
    blockers: string[];
    localMaterializationHandoff: {
      requestId: string;
      scenarioId: string;
      rootPath: string;
      plannedOutputCount: number;
      materializedOutputCount: number;
      allOutputsPlannedMetadataOnly: boolean;
    };
    assetNeedsReadiness: {
      readyForDeterministicGeneration: boolean;
      missingRequiredAssetNeedIds: string[];
      blockers: string[];
      requiredHumanoidRoles: string[];
      animationRequirementCount: number;
      emotionRequirementCount: number;
      gazeRequirementCount: number;
      lipSyncRequirementCount: number;
      sharedAssetLibrarySemanticKeyCount: number;
    };
    realismEvidenceRefs: {
      claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence" | "unavailable";
      refIds: string[];
      refs: Array<{
        refId: string;
        evidenceRef: string;
        requiredBefore: "guarded_runtime_wiring";
        status: "required_not_attached";
        notEvidenceFor: string[];
      }>;
      requiredBefore: "guarded_runtime_wiring" | "unavailable";
      runtimeExecutionAllowed: false;
      providerExecutionPerformed: false;
      questReadinessClaimed: false;
    };
  };
  operatorReviewReadiness: {
    status: "ready_for_operator_review" | "not_ready_for_operator_review";
    reviewedArtifactCount: number;
    blockingArtifactCount: number;
    blockerIds: string[];
    requiredOperatorActions: string[];
    materializationRequiredBeforeRuntime: boolean;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "operator_review_readiness_metadata_only";
  };
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  providerExecutionPerformed: false;
  uiLaunchPerformed: false;
  questEvidenceRefreshed: false;
  broadVerificationPerformed: false;
  reviewerChecklist: Array<{
    checkId:
      | "confirm_selector_guard_remains_disabled"
      | "confirm_provider_execution_disabled"
      | "confirm_learner_launch_blocked"
      | "confirm_no_readiness_claims";
    status: "required_before_runtime_wiring";
    blockerIds: string[];
  }>;
  blockers: string[];
  nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring";
  claimBoundary: "runtime_selection_review_packet_not_runtime_execution";
  notEvidenceFor: Array<"provider_availability" | "runtime_readiness" | "production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity" | "learner_launch_readiness">;
};

const defaultOutputPath = `docs/openclinxr/encounter-runtime-selection-review-packet-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterRuntimeSelectionReviewPacketCli(process.argv.slice(2));
}

export async function runEncounterRuntimeSelectionReviewPacketCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-runtime-selection-review-packet-*.json");
    if (!validatePath) throw new Error("Missing encounter runtime selection review packet to validate.");
    const validation = validateEncounterRuntimeSelectionReviewPacket(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  const selectionIntentPath = options.selectionIntentPath ?? await latestPath("docs/openclinxr/encounter-guarded-runtime-selection-intent-*.json");
  if (!selectionIntentPath) throw new Error("Missing guarded runtime selection intent report.");
  const publicationPayloadsPath = options.publicationPayloadsPath ?? await latestPath("docs/openclinxr/encounter-publication-payloads-*.json");
  const publicationPayloads = publicationPayloadsPath ? await readJson<unknown>(publicationPayloadsPath) : undefined;
  const packet = buildEncounterRuntimeSelectionReviewPacket(
    await readJson<EncounterGuardedRuntimeSelectionIntent>(selectionIntentPath),
    new Date().toISOString(),
    publicationPayloads,
  );
  await writeJson(options.outputPath ?? defaultOutputPath, packet);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export function buildEncounterRuntimeSelectionReviewPacket(
  selectionIntent: EncounterGuardedRuntimeSelectionIntent,
  generatedAt = new Date().toISOString(),
  publicationPayloads?: unknown,
): EncounterRuntimeSelectionReviewPacket {
  const publicationPayloadLinkage = buildPublicationPayloadLinkage(publicationPayloads);
  const blockers = uniqueStrings([
    ...selectionIntent.blockers,
    ...selectionIntent.guardedRuntimeSelectorDecision.blockers,
    ...publicationPayloadLinkage.blockers,
    ...(publicationPayloadLinkage.localMaterializationHandoff.materializedOutputCount
      < publicationPayloadLinkage.localMaterializationHandoff.plannedOutputCount
      ? ["publication_payload_not_materialized"]
      : []),
    ...publicationPayloadLinkage.assetNeedsReadiness.blockers,
    ...publicationPayloadLinkage.assetNeedsReadiness.missingRequiredAssetNeedIds.map((assetNeedId) => `missing_required_asset_need:${assetNeedId}`),
  ]);
  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
    source: "encounter_guarded_runtime_selection_intent",
    selectedScenarioId: selectionIntent.selectedScenarioId,
    selectedEncounterId: selectionIntent.selectedEncounterId,
    selectedStationId: selectionIntent.selectedStationId,
    selectedRuntimeAssetBundleId: selectionIntent.selectedRuntimeAssetBundleId,
    reviewPacketMode: "read_only_guarded_runtime_handoff",
    handoffArtifactsInternallyPaired: selectionIntent.handoffArtifactsInternallyPaired,
    runtimeCandidates: {
      model: selectionIntent.modelRuntimeCandidate,
      voice: selectionIntent.voiceRuntimeCandidate,
    },
    guardedRuntimeSelectorDecision: selectionIntent.guardedRuntimeSelectorDecision,
    publicationPayloadLinkage,
    operatorReviewReadiness: buildOperatorReviewReadiness(publicationPayloadLinkage, blockers),
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    broadVerificationPerformed: false,
    reviewerChecklist: [
      checklist("confirm_selector_guard_remains_disabled", ["runtime_selector_disabled_guard_not_wired"]),
      checklist("confirm_provider_execution_disabled", ["provider_execution_disabled_by_policy"]),
      checklist("confirm_learner_launch_blocked", [
        "learner_launch_disabled_until_evidence_gates_clear",
        "publication_payload_not_materialized",
      ]),
      checklist("confirm_no_readiness_claims", []),
    ],
    blockers,
    nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
    claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}

export function validateEncounterRuntimeSelectionReviewPacket(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-runtime-selection-review-packet.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_guarded_runtime_selection_intent", "/source", errors);
  requireLiteral(value.reviewPacketMode, "read_only_guarded_runtime_handoff", "/reviewPacketMode", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/runtimeExecutionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/learnerLaunchAllowed", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/providerExecutionPerformed", errors);
  requireLiteral(value.uiLaunchPerformed, false, "/uiLaunchPerformed", errors);
  requireLiteral(value.questEvidenceRefreshed, false, "/questEvidenceRefreshed", errors);
  requireLiteral(value.broadVerificationPerformed, false, "/broadVerificationPerformed", errors);
  if (value.nextAllowedStep !== "review_disabled_runtime_selector_before_guarded_wiring") {
    requireLiteral(value.nextAllowedStep, "review_publication_materialization_blockers_before_guarded_wiring", "/nextAllowedStep", errors);
  }
  requireLiteral(value.claimBoundary, "runtime_selection_review_packet_not_runtime_execution", "/claimBoundary", errors);
  requireRecord(value.runtimeCandidates, "/runtimeCandidates", errors);
  requireRecord(value.guardedRuntimeSelectorDecision, "/guardedRuntimeSelectorDecision", errors);
  validatePublicationPayloadLinkage(value.publicationPayloadLinkage, errors);
  validateOperatorReviewReadiness(value.operatorReviewReadiness, errors);
  requireArray(value.reviewerChecklist, "/reviewerChecklist", errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  if (isRecord(value.guardedRuntimeSelectorDecision)) {
    requireLiteral(value.guardedRuntimeSelectorDecision.claimBoundary, "guarded_runtime_selector_seam_not_runtime_execution", "/guardedRuntimeSelectorDecision/claimBoundary", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.runtimeExecutionAllowed, false, "/guardedRuntimeSelectorDecision/runtimeExecutionAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.learnerLaunchAllowed, false, "/guardedRuntimeSelectorDecision/learnerLaunchAllowed", errors);
  }
  if (Array.isArray(value.notEvidenceFor)) {
    for (const claim of ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"]) {
      if (!value.notEvidenceFor.includes(claim)) errors.push(`/notEvidenceFor must include ${claim}`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function buildOperatorReviewReadiness(
  publicationPayloadLinkage: EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"],
  blockers: string[],
): EncounterRuntimeSelectionReviewPacket["operatorReviewReadiness"] {
  const materializationRequiredBeforeRuntime = publicationPayloadLinkage.localMaterializationHandoff.materializedOutputCount
    < publicationPayloadLinkage.localMaterializationHandoff.plannedOutputCount;
  return {
    status: blockers.length === 0 ? "ready_for_operator_review" : "not_ready_for_operator_review",
    reviewedArtifactCount: 4,
    blockingArtifactCount: blockers.length,
    blockerIds: blockers,
    requiredOperatorActions: uniqueStrings([
      ...(materializationRequiredBeforeRuntime ? ["materialize_or_attach_generated_assets_before_guarded_runtime_wiring"] : []),
      ...(publicationPayloadLinkage.realismEvidenceRefs.refs.length > 0 ? ["attach_humanoid_runtime_visual_qa_evidence_refs"] : []),
      "confirm_provider_execution_remains_disabled_until_explicit_approval",
      "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
    ]),
    materializationRequiredBeforeRuntime,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "operator_review_readiness_metadata_only",
  };
}

function validateOperatorReviewReadiness(value: unknown, errors: string[]): void {
  requireRecord(value, "/operatorReviewReadiness", errors);
  if (!isRecord(value)) return;
  requireOneOf(value.status, ["ready_for_operator_review", "not_ready_for_operator_review"], "/operatorReviewReadiness/status", errors);
  requireNumber(value.reviewedArtifactCount, "/operatorReviewReadiness/reviewedArtifactCount", errors);
  requireNumber(value.blockingArtifactCount, "/operatorReviewReadiness/blockingArtifactCount", errors);
  requireArray(value.blockerIds, "/operatorReviewReadiness/blockerIds", errors);
  requireArray(value.requiredOperatorActions, "/operatorReviewReadiness/requiredOperatorActions", errors);
  requireLiteral(value.providerExecutionAllowed, false, "/operatorReviewReadiness/providerExecutionAllowed", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/operatorReviewReadiness/runtimeExecutionAllowed", errors);
  requireLiteral(value.questEvidenceRefreshAllowed, false, "/operatorReviewReadiness/questEvidenceRefreshAllowed", errors);
  requireLiteral(value.claimBoundary, "operator_review_readiness_metadata_only", "/operatorReviewReadiness/claimBoundary", errors);
}

function checklist(
  checkId: EncounterRuntimeSelectionReviewPacket["reviewerChecklist"][number]["checkId"],
  blockerIds: string[],
): EncounterRuntimeSelectionReviewPacket["reviewerChecklist"][number] {
  return { checkId, status: "required_before_runtime_wiring", blockerIds };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--selection-intent") {
      options.selectionIntentPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--publication-payloads") {
      options.publicationPayloadsPath = requireValue(normalizedArgs, index, arg);
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

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${path} must be string`);
}

function requireNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be number`);
}

function requireLiteral<T>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireOneOf<T>(value: unknown, expected: readonly T[], path: string, errors: string[]): void {
  if (!expected.includes(value as T)) errors.push(`${path} must be one of ${expected.map((item) => JSON.stringify(item)).join(", ")}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildPublicationPayloadLinkage(publicationPayloads: unknown): EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"] {
  const value = isRecord(publicationPayloads) ? publicationPayloads : {};
  const handoff = isRecord(value.localMaterializationHandoffManifest) ? value.localMaterializationHandoffManifest : {};
  const outputs = Array.isArray(handoff.outputs) ? handoff.outputs.filter(isRecord) : [];
  const readiness = isRecord(value.encounterAssetNeedsReadinessManifest) ? value.encounterAssetNeedsReadinessManifest : {};
  const requiredHumanoids = Array.isArray(readiness.requiredHumanoids) ? readiness.requiredHumanoids.filter(isRecord) : [];
  return {
    source: "encounter_publication_payloads",
    status: typeof value.status === "string" ? value.status : "unavailable",
    blockers: Array.isArray(value.blockers) ? value.blockers.filter((blocker): blocker is string => typeof blocker === "string") : ["publication_payload_unavailable"],
    localMaterializationHandoff: {
      requestId: typeof handoff.requestId === "string" ? handoff.requestId : "unavailable",
      scenarioId: typeof handoff.scenarioId === "string" ? handoff.scenarioId : "unavailable",
      rootPath: typeof handoff.rootPath === "string" ? handoff.rootPath : "unavailable",
      plannedOutputCount: outputs.length,
      materializedOutputCount: outputs.filter((output) => output.generatedAssetsMaterialized === true).length,
      allOutputsPlannedMetadataOnly: outputs.length > 0 && outputs.every((output) => output.claimBoundary === "planned_metadata_only"),
    },
    assetNeedsReadiness: {
      readyForDeterministicGeneration: readiness.readyForDeterministicGeneration === true,
      missingRequiredAssetNeedIds: stringArray(readiness.missingRequiredAssetNeedIds),
      blockers: stringArray(readiness.blockers),
      requiredHumanoidRoles: requiredHumanoids
        .map((humanoid) => humanoid.actorRole)
        .filter((actorRole): actorRole is string => typeof actorRole === "string"),
      animationRequirementCount: arrayLength(readiness.animationRequirements),
      emotionRequirementCount: arrayLength(readiness.emotionRequirements),
      gazeRequirementCount: arrayLength(readiness.gazeRequirements),
      lipSyncRequirementCount: arrayLength(readiness.lipSyncRequirements),
      sharedAssetLibrarySemanticKeyCount: arrayLength(readiness.sharedAssetLibrarySemanticKeys),
    },
    realismEvidenceRefs: buildRealismEvidenceRefsSummary(value.realismEvidenceRefs),
  };
}

function validatePublicationPayloadLinkage(value: unknown, errors: string[]): void {
  requireRecord(value, "/publicationPayloadLinkage", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.source, "encounter_publication_payloads", "/publicationPayloadLinkage/source", errors);
  requireString(value.status, "/publicationPayloadLinkage/status", errors);
  requireArray(value.blockers, "/publicationPayloadLinkage/blockers", errors);
  requireRecord(value.localMaterializationHandoff, "/publicationPayloadLinkage/localMaterializationHandoff", errors);
  if (isRecord(value.localMaterializationHandoff)) {
    requireString(value.localMaterializationHandoff.requestId, "/publicationPayloadLinkage/localMaterializationHandoff/requestId", errors);
    requireString(value.localMaterializationHandoff.scenarioId, "/publicationPayloadLinkage/localMaterializationHandoff/scenarioId", errors);
    requireString(value.localMaterializationHandoff.rootPath, "/publicationPayloadLinkage/localMaterializationHandoff/rootPath", errors);
    requireNumber(value.localMaterializationHandoff.plannedOutputCount, "/publicationPayloadLinkage/localMaterializationHandoff/plannedOutputCount", errors);
    requireNumber(value.localMaterializationHandoff.materializedOutputCount, "/publicationPayloadLinkage/localMaterializationHandoff/materializedOutputCount", errors);
    requireLiteral(value.localMaterializationHandoff.allOutputsPlannedMetadataOnly, true, "/publicationPayloadLinkage/localMaterializationHandoff/allOutputsPlannedMetadataOnly", errors);
  }
  requireRecord(value.assetNeedsReadiness, "/publicationPayloadLinkage/assetNeedsReadiness", errors);
  if (isRecord(value.assetNeedsReadiness)) {
    requireLiteral(value.assetNeedsReadiness.readyForDeterministicGeneration, true, "/publicationPayloadLinkage/assetNeedsReadiness/readyForDeterministicGeneration", errors);
    requireArray(value.assetNeedsReadiness.missingRequiredAssetNeedIds, "/publicationPayloadLinkage/assetNeedsReadiness/missingRequiredAssetNeedIds", errors);
    requireArray(value.assetNeedsReadiness.blockers, "/publicationPayloadLinkage/assetNeedsReadiness/blockers", errors);
    requireArray(value.assetNeedsReadiness.requiredHumanoidRoles, "/publicationPayloadLinkage/assetNeedsReadiness/requiredHumanoidRoles", errors);
    requireNumber(value.assetNeedsReadiness.animationRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/animationRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.emotionRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/emotionRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.gazeRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/gazeRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.lipSyncRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/lipSyncRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.sharedAssetLibrarySemanticKeyCount, "/publicationPayloadLinkage/assetNeedsReadiness/sharedAssetLibrarySemanticKeyCount", errors);
  }
  requireRecord(value.realismEvidenceRefs, "/publicationPayloadLinkage/realismEvidenceRefs", errors);
  if (isRecord(value.realismEvidenceRefs)) {
    requireOneOf(value.realismEvidenceRefs.claimBoundary, ["metadata_only_not_runtime_or_visual_quality_evidence", "unavailable"], "/publicationPayloadLinkage/realismEvidenceRefs/claimBoundary", errors);
    requireArray(value.realismEvidenceRefs.refIds, "/publicationPayloadLinkage/realismEvidenceRefs/refIds", errors);
    requireOneOf(value.realismEvidenceRefs.requiredBefore, ["guarded_runtime_wiring", "unavailable"], "/publicationPayloadLinkage/realismEvidenceRefs/requiredBefore", errors);
    requireLiteral(value.realismEvidenceRefs.runtimeExecutionAllowed, false, "/publicationPayloadLinkage/realismEvidenceRefs/runtimeExecutionAllowed", errors);
    requireLiteral(value.realismEvidenceRefs.providerExecutionPerformed, false, "/publicationPayloadLinkage/realismEvidenceRefs/providerExecutionPerformed", errors);
    requireLiteral(value.realismEvidenceRefs.questReadinessClaimed, false, "/publicationPayloadLinkage/realismEvidenceRefs/questReadinessClaimed", errors);
    if (Array.isArray(value.realismEvidenceRefs.refIds)) {
      for (const requiredRefId of ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"]) {
        if (!value.realismEvidenceRefs.refIds.includes(requiredRefId)) {
          errors.push(`/publicationPayloadLinkage/realismEvidenceRefs/refIds must include ${requiredRefId}`);
        }
      }
    }
    requireArray(value.realismEvidenceRefs.refs, "/publicationPayloadLinkage/realismEvidenceRefs/refs", errors);
    if (Array.isArray(value.realismEvidenceRefs.refs)) {
      value.realismEvidenceRefs.refs.forEach((ref, index) => {
        if (!isRecord(ref)) {
          errors.push(`/publicationPayloadLinkage/realismEvidenceRefs/refs/${index} must be object`);
          return;
        }
        requireString(ref.refId, `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/refId`, errors);
        requireString(ref.evidenceRef, `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/evidenceRef`, errors);
        requireLiteral(ref.requiredBefore, "guarded_runtime_wiring", `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/requiredBefore`, errors);
        requireLiteral(ref.status, "required_not_attached", `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/status`, errors);
        requireArray(ref.notEvidenceFor, `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/notEvidenceFor`, errors);
      });
    }
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildRealismEvidenceRefsSummary(value: unknown): EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"]["realismEvidenceRefs"] {
  const refsRecord = isRecord(value) ? value : {};
  const refs = Array.isArray(refsRecord.refs) ? refsRecord.refs.filter(isRecord) : [];
  const requiredBefore = refs
    .map((ref) => ref.requiredBefore)
    .find((candidate): candidate is "guarded_runtime_wiring" => candidate === "guarded_runtime_wiring") ?? "unavailable";
  return {
    claimBoundary: refsRecord.claimBoundary === "metadata_only_not_runtime_or_visual_quality_evidence"
      ? "metadata_only_not_runtime_or_visual_quality_evidence"
      : "unavailable",
    refIds: refs.map((ref) => ref.refId).filter((refId): refId is string => typeof refId === "string"),
    refs: refs.map((ref) => ({
      refId: typeof ref.refId === "string" ? ref.refId : "unknown-ref",
      evidenceRef: typeof ref.evidenceRef === "string" ? ref.evidenceRef : "unavailable",
      requiredBefore: "guarded_runtime_wiring",
      status: "required_not_attached",
      notEvidenceFor: stringArray(ref.notEvidenceFor),
    })),
    requiredBefore,
    runtimeExecutionAllowed: false,
    providerExecutionPerformed: false,
    questReadinessClaimed: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
