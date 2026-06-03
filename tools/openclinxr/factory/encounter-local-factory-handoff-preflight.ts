import { readFile, stat } from "node:fs/promises";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import type { EncounterLocalFactoryOperationManifest } from "./encounter-local-factory-operation-manifest.js";

type CliOptions = {
  operationManifestPath?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterLocalFactoryHandoffPreflightReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-local-factory-handoff-preflight.v1";
  source: "encounter_local_factory_operation_manifest";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  handoffMode: "local_filesystem_preflight_only";
  localArtifactChecks: Array<{
    artifactKind: "scene_manifest" | "learner_runtime_bundle" | "ui_xr_public_scene_manifest" | "ui_xr_public_learner_runtime_bundle";
    path: string;
    present: boolean;
    scenarioIdMatches: boolean;
  }>;
  internallyPaired: boolean;
  guardedRuntimeSelectorDecision: EncounterLocalFactoryOperationManifest["guardedRuntimeSelectorDecision"];
  runtimeBridgeAllowed: false;
  learnerLaunchAllowed: false;
  caseDefinedActorRealismLaunchBadges: Array<{
    actorId: string | null;
    actorRole: string;
    baselineMood: string[];
    requiredCueIds: string[];
    requiredDimensions: string[];
    status: "realismBlocked";
    blockers: string[];
    claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only";
  }>;
  blockers: string[];
  evidenceBoundaries: {
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
  claimBoundary: "local_factory_handoff_preflight_not_runtime_execution";
};

const defaultOutputPath = `docs/openclinxr/encounter-local-factory-handoff-preflight-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterLocalFactoryHandoffPreflightCli(process.argv.slice(2));
}

export async function runEncounterLocalFactoryHandoffPreflightCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-local-factory-handoff-preflight-*.json");
    if (!validatePath) throw new Error("Missing encounter local factory handoff preflight report to validate.");
    const validation = validateEncounterLocalFactoryHandoffPreflightReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  const manifestPath = options.operationManifestPath ?? await latestPath("docs/openclinxr/encounter-local-factory-operation-manifest-*.json");
  if (!manifestPath) throw new Error("Missing encounter local factory operation manifest.");
  const report = await buildEncounterLocalFactoryHandoffPreflightReport(await readJson<EncounterLocalFactoryOperationManifest>(manifestPath));
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export async function buildEncounterLocalFactoryHandoffPreflightReport(
  manifest: EncounterLocalFactoryOperationManifest,
  generatedAt = new Date().toISOString(),
): Promise<EncounterLocalFactoryHandoffPreflightReport> {
  const checks = await Promise.all([
    artifactCheck("scene_manifest", manifest.localFilesystemPaths.sceneManifestPath, manifest.selectedScenarioId),
    artifactCheck("learner_runtime_bundle", manifest.localFilesystemPaths.learnerRuntimeBundlePath, manifest.selectedScenarioId),
    artifactCheck("ui_xr_public_scene_manifest", manifest.localFilesystemPaths.uiXrPublicSceneManifestPath, manifest.selectedScenarioId),
    artifactCheck("ui_xr_public_learner_runtime_bundle", manifest.localFilesystemPaths.uiXrPublicLearnerRuntimeBundlePath, manifest.selectedScenarioId),
  ]);
  const internallyPaired = checks.every((check) => check.present && check.scenarioIdMatches);
  const blockers = [
    ...manifest.blockers,
    ...(internallyPaired ? [] : ["local_factory_handoff_artifacts_missing_or_mismatched"]),
  ];
  const uniqueBlockers = uniqueStrings(blockers);
  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-local-factory-handoff-preflight.v1",
    source: "encounter_local_factory_operation_manifest",
    selectedScenarioId: manifest.selectedScenarioId,
    selectedEncounterId: manifest.selectedEncounterId,
    selectedStationId: manifest.selectedStationId,
    handoffMode: "local_filesystem_preflight_only",
    localArtifactChecks: checks,
    internallyPaired,
    guardedRuntimeSelectorDecision: manifest.guardedRuntimeSelectorDecision,
    runtimeBridgeAllowed: false,
    learnerLaunchAllowed: false,
    caseDefinedActorRealismLaunchBadges: actorRealismRequirementsForManifest(manifest).map((requirement) => ({
      actorId: requirement.actorId,
      actorRole: requirement.role,
      baselineMood: [...requirement.baselineMood],
      requiredCueIds: [...requirement.requiredCueIds],
      requiredDimensions: requiredActorRealismDimensions(requirement),
      status: "realismBlocked",
      blockers: uniqueStrings([
        "actor_specific_humanoid_realism_gate_not_attached",
        ...uniqueBlockers.filter((blocker) =>
          blocker.includes("runtime_realism")
          || blocker.includes("humanoid_visual")
          || blocker.includes("quest")
        ),
      ]),
      claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
    })),
    blockers: uniqueBlockers,
    evidenceBoundaries: {
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
    claimBoundary: "local_factory_handoff_preflight_not_runtime_execution",
  };
}

export function validateEncounterLocalFactoryHandoffPreflightReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-local-factory-handoff-preflight.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_local_factory_operation_manifest", "/source", errors);
  requireLiteral(value.handoffMode, "local_filesystem_preflight_only", "/handoffMode", errors);
  requireLiteral(value.runtimeBridgeAllowed, false, "/runtimeBridgeAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/learnerLaunchAllowed", errors);
  requireLiteral(value.claimBoundary, "local_factory_handoff_preflight_not_runtime_execution", "/claimBoundary", errors);
  requireArray(value.localArtifactChecks, "/localArtifactChecks", errors);
  requireArray(value.caseDefinedActorRealismLaunchBadges, "/caseDefinedActorRealismLaunchBadges", errors);
  requireArray(value.blockers, "/blockers", errors);
  if (Array.isArray(value.caseDefinedActorRealismLaunchBadges) && value.caseDefinedActorRealismLaunchBadges.length === 0) {
    errors.push("/caseDefinedActorRealismLaunchBadges must include at least one actor badge");
  }
  requireRecord(value.guardedRuntimeSelectorDecision, "/guardedRuntimeSelectorDecision", errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);
  if (Array.isArray(value.localArtifactChecks)) {
    for (const [index, check] of value.localArtifactChecks.entries()) {
      const checkPath = `/localArtifactChecks/${index}`;
      if (!isRecord(check)) {
        errors.push(`${checkPath} must be object`);
        continue;
      }
      requireLiteral(check.present, true, `${checkPath}/present`, errors);
      requireLiteral(check.scenarioIdMatches, true, `${checkPath}/scenarioIdMatches`, errors);
    }
  }
  if (Array.isArray(value.caseDefinedActorRealismLaunchBadges)) {
    for (const [index, badge] of value.caseDefinedActorRealismLaunchBadges.entries()) {
      const badgePath = `/caseDefinedActorRealismLaunchBadges/${index}`;
      if (!isRecord(badge)) {
        errors.push(`${badgePath} must be object`);
        continue;
      }
      if (!(typeof badge.actorId === "string" || badge.actorId === null)) errors.push(`${badgePath}/actorId must be string or null`);
      if (typeof badge.actorRole !== "string" || badge.actorRole.length === 0) errors.push(`${badgePath}/actorRole required`);
      requireArray(badge.baselineMood, `${badgePath}/baselineMood`, errors);
      requireArray(badge.requiredCueIds, `${badgePath}/requiredCueIds`, errors);
      requireArray(badge.requiredDimensions, `${badgePath}/requiredDimensions`, errors);
      requireLiteral(badge.status, "realismBlocked", `${badgePath}/status`, errors);
      requireLiteral(badge.claimBoundary, "case_defined_actor_realism_launch_badge_metadata_only", `${badgePath}/claimBoundary`, errors);
      requireArray(badge.blockers, `${badgePath}/blockers`, errors);
      if (Array.isArray(badge.blockers) && !badge.blockers.includes("actor_specific_humanoid_realism_gate_not_attached")) {
        errors.push(`${badgePath}/blockers must include actor_specific_humanoid_realism_gate_not_attached`);
      }
    }
    const actorKeys = value.caseDefinedActorRealismLaunchBadges.map((badge) =>
      isRecord(badge) ? `${String(badge.actorRole)}:${String(badge.actorId)}` : ""
    );
    if (new Set(actorKeys).size !== actorKeys.length) {
      errors.push("/caseDefinedActorRealismLaunchBadges actorRole:actorId entries must be unique");
    }
  }
  if (isRecord(value.evidenceBoundaries)) {
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
    requireLiteral(value.guardedRuntimeSelectorDecision.claimBoundary, "guarded_runtime_selector_seam_not_runtime_execution", "/guardedRuntimeSelectorDecision/claimBoundary", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.runtimeExecutionAllowed, false, "/guardedRuntimeSelectorDecision/runtimeExecutionAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.learnerLaunchAllowed, false, "/guardedRuntimeSelectorDecision/learnerLaunchAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.providerExecutionPerformed, false, "/guardedRuntimeSelectorDecision/providerExecutionPerformed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.uiLaunchPerformed, false, "/guardedRuntimeSelectorDecision/uiLaunchPerformed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.questEvidenceRefreshed, false, "/guardedRuntimeSelectorDecision/questEvidenceRefreshed", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function actorRealismRequirementsForManifest(
  manifest: EncounterLocalFactoryOperationManifest,
): Array<{
  actorId: string | null;
  role: string;
  baselineMood: string[];
  locomotionRequired: boolean;
  expressionRequired: boolean;
  gazeRequired: boolean;
  lipSyncRequired: boolean;
  interactionRequired: boolean;
  requiredCueIds: string[];
}> {
  return manifest.actorRuntimeRealismRequirements.length > 0
    ? manifest.actorRuntimeRealismRequirements
    : uniqueStrings(manifest.actorRoles).map((role) => ({
        actorId: null,
        role,
        baselineMood: [],
        locomotionRequired: false,
        expressionRequired: false,
        gazeRequired: false,
        lipSyncRequired: false,
        interactionRequired: false,
        requiredCueIds: [],
      }));
}

function requiredActorRealismDimensions(
  requirement: ReturnType<typeof actorRealismRequirementsForManifest>[number],
): string[] {
  return [
    requirement.locomotionRequired ? "locomotion" : "",
    requirement.expressionRequired ? "expression" : "",
    requirement.gazeRequired ? "gaze" : "",
    requirement.lipSyncRequired ? "lip_sync" : "",
    requirement.interactionRequired ? "interaction" : "",
  ].filter(Boolean);
}

async function artifactCheck(
  artifactKind: EncounterLocalFactoryHandoffPreflightReport["localArtifactChecks"][number]["artifactKind"],
  path: string,
  scenarioId: string,
): Promise<EncounterLocalFactoryHandoffPreflightReport["localArtifactChecks"][number]> {
  const present = await stat(path).then((entry) => entry.isFile(), () => false);
  const content = present ? await readFile(path, "utf8").catch(() => "") : "";
  return {
    artifactKind,
    path,
    present,
    scenarioIdMatches: content.includes(scenarioId),
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--operation-manifest") {
      options.operationManifestPath = requireValue(normalizedArgs, index, arg);
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
