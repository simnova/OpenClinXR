import { stat } from "node:fs/promises";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import type { EncounterPublicationPayloadReport } from "./encounter-publication-payloads.js";

type CliOptions = {
  publicationReportPath?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterLocalLaunchSelectionReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-local-launch-selection.v1";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  selectionSource: "materialized_publication_payload";
  launchMode: "local_static_public_assets";
  sceneManifestUrl: string;
  learnerRuntimeBundleUrl: string;
  localFilesystemPaths: EncounterPublicationPayloadReport["localArtifacts"];
  dynamicBehaviorTags: string[];
  actorRoles: string[];
  selectedAssetCounts: {
    actors: number;
    humanoidRuntimeRequirements: number;
    equipment: number;
    roomProps: number;
    uiSurfaces: number;
  };
  launchContract: EncounterLocalLaunchContract;
  realismEvidenceRefs: {
    claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence" | "unavailable";
    refIds: string[];
    requiredBefore: "guarded_runtime_wiring" | "unavailable";
    runtimeExecutionAllowed: false;
    providerExecutionPerformed: false;
    questReadinessClaimed: false;
  };
  learnerLaunchAllowed: false;
  blockers: string[];
  evidenceBoundaries: {
    localStaticAssetSelectionOnly: true;
    cloudOperationPerformed: false;
    providerExecutionPerformed: false;
    generatedAssetsMaterialized: false;
    learnerLaunchEnabled: false;
    questReadinessClaimed: false;
    productionReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
  claimBoundary: "local_launch_selection_not_runtime_readiness";
};

export type EncounterLocalLaunchContract = {
  schemaVersion: "openclinxr.case-definition-driven-webxr-launch-contract.v1";
  contractId: string;
  status: "blocked_pending_evidence" | "blocked_pending_publication_or_case_alignment";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  runtimeAssetBundleId: string;
  actorRoster: Array<{
    actorId: string;
    actorRole: string;
    modelAssetId: string;
    source: "learner_runtime_bundle_humanoid_requirement";
  }>;
  caseDefinedActorRealismRequirements: Array<{
    actorId: string;
    actorRole: string;
    sourceWorkOrderIds: string[];
    requiredSignalIds: string[];
    locomotionRequired: boolean;
    expressionRequired: boolean;
    gazeRequired: boolean;
    lipSyncRequired: boolean;
    interactiveRequired: boolean;
    claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only";
  }>;
  actorRealismLaunchBadges: Array<{
    actorId: string;
    actorRole: string;
    status: "realismBlocked";
    blockers: string[];
    claimBoundary: "actor_specific_humanoid_gate_required_before_runtime_launch";
  }>;
  caseDefinitionCoverage: {
    actorRolesCovered: boolean;
    traceTagsCovered: boolean;
    equipmentPlacementsPresent: boolean;
    assetNeedsCarriedByWorkOrders: boolean;
    blockers: string[];
  };
  launchBlockingReasons: string[];
  notEvidenceFor: Array<"runtime_readiness" | "quest_readiness" | "production_readiness" | "clinical_validity" | "scoring_validity">;
};

const defaultOutputPath = `docs/openclinxr/encounter-local-launch-selection-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterLocalLaunchSelectionCli(process.argv.slice(2));
}

export async function runEncounterLocalLaunchSelectionCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-local-launch-selection-*.json");
    if (!validatePath) throw new Error("Missing encounter local launch selection report to validate.");
    const validation = validateEncounterLocalLaunchSelectionReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const publicationReportPath = options.publicationReportPath ?? await latestPath("docs/openclinxr/encounter-publication-payloads-*.json");
  if (!publicationReportPath) throw new Error("Missing encounter publication payload report.");
  const report = buildEncounterLocalLaunchSelectionReport(await readJson<EncounterPublicationPayloadReport>(publicationReportPath));
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export function buildEncounterLocalLaunchSelectionReport(
  publicationReport: EncounterPublicationPayloadReport,
  generatedAt = new Date().toISOString(),
): EncounterLocalLaunchSelectionReport {
  const scenarioId = publicationReport.scenarioId;
  const blockers = uniqueStrings([
    ...publicationReport.blockers,
    ...(publicationReport.status === "materialized" ? [] : ["publication_payload_not_materialized"]),
    ...gateBlockers(publicationReport, "runtime_realism_evidence"),
    ...gateBlockers(publicationReport, "visual_qa_evidence"),
    ...(gateBlockers(publicationReport, "quest_runtime_evidence").length > 0
      ? gateBlockers(publicationReport, "quest_runtime_evidence")
      : ["quest_webxr_evidence_not_attached"]),
  ]);
  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-local-launch-selection.v1",
    selectedScenarioId: scenarioId,
    selectedEncounterId: publicationReport.requestId,
    selectedStationId: publicationReport.stationId,
    selectedRuntimeAssetBundleId: publicationReport.publicationTargets.learnerRuntimeBundleId,
    selectionSource: "materialized_publication_payload",
    launchMode: "local_static_public_assets",
    sceneManifestUrl: `/xr-assets/generated/${scenarioId}/scene-manifest.v1.json`,
    learnerRuntimeBundleUrl: `/xr-assets/generated/${scenarioId}/learner-runtime-bundle.v1.json`,
    localFilesystemPaths: publicationReport.localArtifacts,
    dynamicBehaviorTags: uniqueStrings([
      ...publicationReport.dynamicEncounterBehaviorCoverage.dialogueTurnCoverage.actorRolesWithDialogueTurns.map((role) => `dialogue:${role}`),
      ...publicationReport.dynamicEncounterBehaviorCoverage.gazeTargetCoverage.actorRolesWithGazeTargets.map((role) => `gaze:${role}`),
      ...publicationReport.dynamicEncounterBehaviorCoverage.affectTimelineCoverage.actorRolesWithAffectTimelines.map((role) => `affect:${role}`),
    ]),
    actorRoles: [...publicationReport.encounterFactoryDryRunPlan.actorRoles],
    selectedAssetCounts: {
      actors: publicationReport.payloadSummary.actorCount,
      humanoidRuntimeRequirements: publicationReport.payloadSummary.humanoidRuntimeRequirementActorCount,
      equipment: publicationReport.payloadSummary.equipmentCount,
      roomProps: publicationReport.payloadSummary.roomPropCount,
      uiSurfaces: publicationReport.payloadSummary.uiSurfaceCount,
    },
    launchContract: buildEncounterLocalLaunchContract(publicationReport, blockers),
    realismEvidenceRefs: summarizeRealismEvidenceRefs(publicationReport),
    learnerLaunchAllowed: false,
    blockers,
    evidenceBoundaries: {
      localStaticAssetSelectionOnly: true,
      cloudOperationPerformed: false,
      providerExecutionPerformed: false,
      generatedAssetsMaterialized: false,
      learnerLaunchEnabled: false,
      questReadinessClaimed: false,
      productionReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
    claimBoundary: "local_launch_selection_not_runtime_readiness",
  };
}

export function validateEncounterLocalLaunchSelectionReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-local-launch-selection.v1", "/schemaVersion", errors);
  requireLiteral(value.selectionSource, "materialized_publication_payload", "/selectionSource", errors);
  requireLiteral(value.launchMode, "local_static_public_assets", "/launchMode", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/learnerLaunchAllowed", errors);
  requireLiteral(value.claimBoundary, "local_launch_selection_not_runtime_readiness", "/claimBoundary", errors);
  requireRecord(value.localFilesystemPaths, "/localFilesystemPaths", errors);
  requireRecord(value.selectedAssetCounts, "/selectedAssetCounts", errors);
  validateLaunchContract(value.launchContract, errors);
  validateRealismEvidenceRefs(value.realismEvidenceRefs, errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);
  requireArray(value.dynamicBehaviorTags, "/dynamicBehaviorTags", errors);
  requireArray(value.actorRoles, "/actorRoles", errors);
  requireArray(value.blockers, "/blockers", errors);
  for (const [key, path] of [
    [value.sceneManifestUrl, "/sceneManifestUrl"],
    [value.learnerRuntimeBundleUrl, "/learnerRuntimeBundleUrl"],
  ] as const) {
    if (typeof key !== "string" || !key.startsWith("/xr-assets/generated/")) errors.push(`${path} must be a local generated public asset URL`);
  }
  if (Array.isArray(value.blockers)) {
    for (const requiredBlocker of ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached", "quest_webxr_evidence_not_attached"]) {
      if (!value.blockers.includes(requiredBlocker)) errors.push(`/blockers must include ${requiredBlocker}`);
    }
  }
  if (isRecord(value.launchContract)) {
    compareStringFields(value.launchContract.selectedScenarioId, value.selectedScenarioId, "/launchContract/selectedScenarioId", "/selectedScenarioId", errors);
    compareStringFields(value.launchContract.selectedEncounterId, value.selectedEncounterId, "/launchContract/selectedEncounterId", "/selectedEncounterId", errors);
    compareStringFields(value.launchContract.selectedStationId, value.selectedStationId, "/launchContract/selectedStationId", "/selectedStationId", errors);
    compareStringFields(value.launchContract.runtimeAssetBundleId, value.selectedRuntimeAssetBundleId, "/launchContract/runtimeAssetBundleId", "/selectedRuntimeAssetBundleId", errors);
  }
  if (typeof value.selectedScenarioId === "string") {
    if (typeof value.sceneManifestUrl === "string" && !value.sceneManifestUrl.includes(`/xr-assets/generated/${value.selectedScenarioId}/`)) {
      errors.push("/sceneManifestUrl must include selectedScenarioId");
    }
    if (typeof value.learnerRuntimeBundleUrl === "string" && !value.learnerRuntimeBundleUrl.includes(`/xr-assets/generated/${value.selectedScenarioId}/`)) {
      errors.push("/learnerRuntimeBundleUrl must include selectedScenarioId");
    }
  }
  if (isRecord(value.evidenceBoundaries)) {
    requireLiteral(value.evidenceBoundaries.localStaticAssetSelectionOnly, true, "/evidenceBoundaries/localStaticAssetSelectionOnly", errors);
    requireLiteral(value.evidenceBoundaries.cloudOperationPerformed, false, "/evidenceBoundaries/cloudOperationPerformed", errors);
    requireLiteral(value.evidenceBoundaries.providerExecutionPerformed, false, "/evidenceBoundaries/providerExecutionPerformed", errors);
    requireLiteral(value.evidenceBoundaries.generatedAssetsMaterialized, false, "/evidenceBoundaries/generatedAssetsMaterialized", errors);
    requireLiteral(value.evidenceBoundaries.learnerLaunchEnabled, false, "/evidenceBoundaries/learnerLaunchEnabled", errors);
    requireLiteral(value.evidenceBoundaries.questReadinessClaimed, false, "/evidenceBoundaries/questReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.productionReadinessClaimed, false, "/evidenceBoundaries/productionReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.clinicalValidityClaimed, false, "/evidenceBoundaries/clinicalValidityClaimed", errors);
    requireLiteral(value.evidenceBoundaries.scoringValidityClaimed, false, "/evidenceBoundaries/scoringValidityClaimed", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function compareStringFields(left: unknown, right: unknown, leftPath: string, rightPath: string, errors: string[]): void {
  if (typeof left !== "string" || typeof right !== "string") return;
  if (left !== right) errors.push(`${leftPath} must match ${rightPath}`);
}

function buildEncounterLocalLaunchContract(
  publicationReport: EncounterPublicationPayloadReport,
  blockers: string[],
): EncounterLocalLaunchContract {
  const humanoidRuntimeRequirements = publicationReport.humanoidRuntimeRequirements ?? [];
  const caseDefinedHumanoidRuntimeHandoff = publicationReport.caseDefinedHumanoidRuntimeHandoff ?? [];
  const coverage = publicationReport.caseDefinitionDrivenFactoryCoverage?.coverage;
  const coverageBlockers = publicationReport.caseDefinitionDrivenFactoryCoverage?.blockers ?? ["case_definition_coverage_not_attached"];
  const actorRoster = humanoidRuntimeRequirements.map((requirement) => ({
    actorId: requirement.actorId,
    actorRole: requirement.actorRole,
    modelAssetId: requirement.modelAssetId,
    source: "learner_runtime_bundle_humanoid_requirement" as const,
  }));
  const handoffByRole = new Map(caseDefinedHumanoidRuntimeHandoff.map((handoff) => [handoff.actorRole, handoff]));
  const caseDefinedActorRealismRequirements = actorRoster
    .map((actor) => {
      const handoff = handoffByRole.get(actor.actorRole);
      if (!handoff) return undefined;
      return {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        sourceWorkOrderIds: [...handoff.workOrderIds],
        requiredSignalIds: [...handoff.requiredSignalIds],
        locomotionRequired: handoff.locomotionRequired,
        expressionRequired: handoff.expressionRequired,
        gazeRequired: handoff.gazeRequired,
        lipSyncRequired: handoff.lipSyncRequired,
        interactiveRequired: handoff.interactiveRequired,
        claimBoundary: handoff.claimBoundary,
      };
    })
    .filter((requirement): requirement is EncounterLocalLaunchContract["caseDefinedActorRealismRequirements"][number] => Boolean(requirement));
  const caseDefinitionCoverage = {
    actorRolesCovered: coverage?.actorRolesCovered ?? false,
    traceTagsCovered: coverage?.traceTagsCovered ?? false,
    equipmentPlacementsPresent: coverage?.equipmentPlacementsPresent ?? false,
    assetNeedsCarriedByWorkOrders: coverage?.assetNeedsCarriedByWorkOrders ?? false,
    blockers: [...coverageBlockers],
  };
  const actorRealismLaunchBadges = caseDefinedActorRealismRequirements.map((requirement) => ({
    actorId: requirement.actorId,
    actorRole: requirement.actorRole,
    status: "realismBlocked" as const,
    blockers: uniqueStrings([
      "actor_specific_humanoid_realism_gate_not_attached",
      "runtime_realism_evidence_not_attached",
      "humanoid_visual_qa_evidence_not_attached",
      ...(publicationReport.status === "materialized" ? [] : ["publication_payload_not_materialized"]),
      ...caseDefinitionCoverage.blockers,
    ]),
    claimBoundary: "actor_specific_humanoid_gate_required_before_runtime_launch" as const,
  }));
  const launchBlockingReasons = uniqueStrings([
    ...blockers,
    ...caseDefinitionCoverage.blockers,
    ...actorRealismLaunchBadges.flatMap((badge) => badge.blockers),
    ...(actorRoster.length === 0 ? ["actor_roster_empty"] : []),
    ...(caseDefinedActorRealismRequirements.length === actorRoster.length ? [] : ["case_defined_actor_realism_requirements_incomplete"]),
  ]);
  return {
    schemaVersion: "openclinxr.case-definition-driven-webxr-launch-contract.v1",
    contractId: `${publicationReport.requestId}:webxr-launch-contract:v1`,
    status: publicationReport.status === "materialized" && caseDefinitionCoverage.blockers.length === 0
      ? "blocked_pending_evidence"
      : "blocked_pending_publication_or_case_alignment",
    selectedScenarioId: publicationReport.scenarioId,
    selectedEncounterId: publicationReport.requestId,
    selectedStationId: publicationReport.stationId,
    runtimeAssetBundleId: publicationReport.publicationTargets.learnerRuntimeBundleId,
    actorRoster,
    caseDefinedActorRealismRequirements,
    actorRealismLaunchBadges,
    caseDefinitionCoverage,
    launchBlockingReasons,
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_readiness", "clinical_validity", "scoring_validity"],
  };
}

function validateLaunchContract(value: unknown, errors: string[]): void {
  requireRecord(value, "/launchContract", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.schemaVersion, "openclinxr.case-definition-driven-webxr-launch-contract.v1", "/launchContract/schemaVersion", errors);
  requireArray(value.actorRoster, "/launchContract/actorRoster", errors);
  requireArray(value.caseDefinedActorRealismRequirements, "/launchContract/caseDefinedActorRealismRequirements", errors);
  requireArray(value.actorRealismLaunchBadges, "/launchContract/actorRealismLaunchBadges", errors);
  requireRecord(value.caseDefinitionCoverage, "/launchContract/caseDefinitionCoverage", errors);
  requireArray(value.launchBlockingReasons, "/launchContract/launchBlockingReasons", errors);
  requireArray(value.notEvidenceFor, "/launchContract/notEvidenceFor", errors);
  if (Array.isArray(value.launchBlockingReasons)) {
    for (const requiredBlocker of ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached", "quest_webxr_evidence_not_attached"]) {
      if (!value.launchBlockingReasons.includes(requiredBlocker)) errors.push(`/launchContract/launchBlockingReasons must include ${requiredBlocker}`);
    }
  }
  if (Array.isArray(value.actorRoster) && value.actorRoster.length === 0 && Array.isArray(value.launchBlockingReasons)) {
    if (!value.launchBlockingReasons.includes("actor_roster_empty")) {
      errors.push("/launchContract/launchBlockingReasons must include actor_roster_empty when actor roster is empty");
    }
  }
  if (Array.isArray(value.actorRealismLaunchBadges)) {
    if (
      Array.isArray(value.caseDefinedActorRealismRequirements)
      && value.caseDefinedActorRealismRequirements.length > 0
      && value.actorRealismLaunchBadges.length !== value.caseDefinedActorRealismRequirements.length
    ) {
      errors.push("/launchContract/actorRealismLaunchBadges must match caseDefinedActorRealismRequirements length");
    }
    for (const [index, badge] of value.actorRealismLaunchBadges.entries()) {
      if (!isRecord(badge)) {
        errors.push(`/launchContract/actorRealismLaunchBadges/${index} must be object`);
        continue;
      }
      requireLiteral(badge.status, "realismBlocked", `/launchContract/actorRealismLaunchBadges/${index}/status`, errors);
      requireLiteral(
        badge.claimBoundary,
        "actor_specific_humanoid_gate_required_before_runtime_launch",
        `/launchContract/actorRealismLaunchBadges/${index}/claimBoundary`,
        errors,
      );
      requireArray(badge.blockers, `/launchContract/actorRealismLaunchBadges/${index}/blockers`, errors);
      if (Array.isArray(badge.blockers) && !badge.blockers.includes("actor_specific_humanoid_realism_gate_not_attached")) {
        errors.push(`/launchContract/actorRealismLaunchBadges/${index}/blockers must include actor_specific_humanoid_realism_gate_not_attached`);
      }
    }
  }
  if (Array.isArray(value.caseDefinedActorRealismRequirements) && Array.isArray(value.actorRealismLaunchBadges)) {
    const badgeKeys = new Set(value.actorRealismLaunchBadges
      .filter(isRecord)
      .map((badge) => `${String(badge.actorRole ?? "")}:${String(badge.actorId ?? "")}`));
    value.caseDefinedActorRealismRequirements
      .filter(isRecord)
      .forEach((requirement, index) => {
        const key = `${String(requirement.actorRole ?? "")}:${String(requirement.actorId ?? "")}`;
        if (!badgeKeys.has(key)) {
          errors.push(`/launchContract/caseDefinedActorRealismRequirements/${index} must have matching actorRealismLaunchBadge`);
        }
      });
  }
}

function gateBlockers(report: EncounterPublicationPayloadReport, gateId: string): string[] {
  const gate = report.encounterFactoryDryRunPlan.generationWorkOrders
    .flatMap((workOrder) => workOrder.evidenceGateRefs)
    .includes(gateId as never);
  if (!gate) return [];
  if (gateId === "runtime_realism_evidence") return ["runtime_realism_evidence_not_attached"];
  if (gateId === "visual_qa_evidence") return ["humanoid_visual_qa_evidence_not_attached"];
  if (gateId === "quest_runtime_evidence") return ["quest_webxr_evidence_not_attached"];
  return [];
}

function summarizeRealismEvidenceRefs(report: EncounterPublicationPayloadReport): EncounterLocalLaunchSelectionReport["realismEvidenceRefs"] {
  const refsRecord = report.realismEvidenceRefs;
  return {
    claimBoundary: refsRecord?.claimBoundary ?? "unavailable",
    refIds: refsRecord?.refs.map((ref) => ref.refId) ?? [],
    requiredBefore: refsRecord?.refs.find((ref) => ref.requiredBefore === "guarded_runtime_wiring")?.requiredBefore ?? "unavailable",
    runtimeExecutionAllowed: false,
    providerExecutionPerformed: false,
    questReadinessClaimed: false,
  };
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

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--publication-report") {
      options.publicationReportPath = requireValue(normalizedArgs, index, arg);
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
