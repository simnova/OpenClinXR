import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EncounterMaterializationEvidenceReport } from "./encounter-materialization-evidence.js";

export type EncounterMaterializationInputManifest = {
  schemaVersion: "openclinxr.encounter-materialization-input-manifest.v1";
  generatedAt: string;
  source: "encounter_materialization_evidence_report";
  scenarioId: string | null;
  status: "planned_metadata_only_blocked_until_provider_approval";
  actorWorkOrderInputs: Array<{
    workOrderInputId: string;
    actorId: string;
    actorRole: string;
    variantSemanticKey: string;
    sourceBlobName: string;
    requiredEvidenceRefs: string[];
    requiredCueIds: string[];
    blockerIds: string[];
    targetCapabilityIds: Array<"character-generation" | "animation-generation" | "asset-bake">;
    providerExecutionStatus: "metadata_only_not_executed";
    claimBoundary: "provider_neutral_materialization_input_not_asset_readiness";
  }>;
  equipmentWorkOrderInputs: Array<{
    workOrderInputId: string;
    equipmentId: string;
    variantSemanticKey: string;
    sourceBlobName: string;
    requiredEvidenceRefs: string[];
    requiredCueIds: string[];
    blockerIds: string[];
    targetCapabilityIds: Array<"medical-equipment-generation" | "asset-bake">;
    providerExecutionStatus: "metadata_only_not_executed";
    claimBoundary: "provider_neutral_materialization_input_not_asset_readiness";
  }>;
  providerBoundary: {
    providerExecutionPerformed: false;
    paidApisUsed: false;
    externalNetworkUsed: false;
    productionAssetReadinessClaimed: false;
    questReadinessClaimed: false;
    runtimeReadinessClaimed: false;
    claimBoundary: "provider_neutral_input_manifest_no_execution";
  };
  blockers: string[];
  recommendedNextActions: string[];
  notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"];
};

const NOT_EVIDENCE_FOR = ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;

export function buildEncounterMaterializationInputManifest(input: {
  evidenceReport: EncounterMaterializationEvidenceReport;
  generatedAt?: string;
}): EncounterMaterializationInputManifest {
  const actorWorkOrderInputs = input.evidenceReport.actorEvidence.map((entry) => ({
    workOrderInputId: `actor-materialization-input:${entry.actorId}`,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    variantSemanticKey: entry.variantSemanticKey,
    sourceBlobName: entry.sourceBlobName,
    requiredEvidenceRefs: [...entry.requiredEvidenceRefs],
    requiredCueIds: entry.requiredEvidenceRefs.map(lastPathSegment),
    blockerIds: [...entry.blockers],
    targetCapabilityIds: ["character-generation", "animation-generation", "asset-bake"] as const,
    providerExecutionStatus: "metadata_only_not_executed" as const,
    claimBoundary: "provider_neutral_materialization_input_not_asset_readiness" as const,
  }));
  const equipmentWorkOrderInputs = input.evidenceReport.equipmentEvidence.map((entry) => ({
    workOrderInputId: `equipment-materialization-input:${entry.equipmentId}`,
    equipmentId: entry.equipmentId,
    variantSemanticKey: entry.variantSemanticKey,
    sourceBlobName: entry.sourceBlobName,
    requiredEvidenceRefs: [...entry.requiredEvidenceRefs],
    requiredCueIds: entry.requiredEvidenceRefs.map(lastPathSegment),
    blockerIds: [...entry.blockers],
    targetCapabilityIds: ["medical-equipment-generation", "asset-bake"] as const,
    providerExecutionStatus: "metadata_only_not_executed" as const,
    claimBoundary: "provider_neutral_materialization_input_not_asset_readiness" as const,
  }));

  return {
    schemaVersion: "openclinxr.encounter-materialization-input-manifest.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "encounter_materialization_evidence_report",
    scenarioId: input.evidenceReport.scenarioId,
    status: "planned_metadata_only_blocked_until_provider_approval",
    actorWorkOrderInputs,
    equipmentWorkOrderInputs,
    providerBoundary: {
      providerExecutionPerformed: false,
      paidApisUsed: false,
      externalNetworkUsed: false,
      productionAssetReadinessClaimed: false,
      questReadinessClaimed: false,
      runtimeReadinessClaimed: false,
      claimBoundary: "provider_neutral_input_manifest_no_execution",
    },
    blockers: uniqueStrings(input.evidenceReport.blockers),
    recommendedNextActions: uniqueStrings([
      ...input.evidenceReport.recommendedNextActions,
      "review provider-neutral work-order inputs before approving any local or external materialization provider execution",
    ]),
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateEncounterMaterializationInputManifest(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-materialization-input-manifest.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_materialization_evidence_report", "/source", errors);
  requireLiteral(value.status, "planned_metadata_only_blocked_until_provider_approval", "/status", errors);
  requireArray(value.actorWorkOrderInputs, "/actorWorkOrderInputs", errors);
  requireArray(value.equipmentWorkOrderInputs, "/equipmentWorkOrderInputs", errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.recommendedNextActions, "/recommendedNextActions", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  validateProviderBoundary(value.providerBoundary, errors);
  validateWorkOrderInputs(value.actorWorkOrderInputs, "/actorWorkOrderInputs", errors, ["character-generation", "animation-generation", "asset-bake"]);
  validateWorkOrderInputs(value.equipmentWorkOrderInputs, "/equipmentWorkOrderInputs", errors, ["medical-equipment-generation", "asset-bake"]);
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const validation = validateEncounterMaterializationInputManifest(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`Encounter materialization input manifest validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const evidenceReport = JSON.parse(await readFile(options.evidenceReportPath, "utf8")) as EncounterMaterializationEvidenceReport;
  const manifest = buildEncounterMaterializationInputManifest({ evidenceReport });
  await writeFile(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function validateProviderBoundary(value: unknown, errors: string[]): void {
  requireRecord(value, "/providerBoundary", errors);
  if (!isRecord(value)) return;
  for (const key of ["providerExecutionPerformed", "paidApisUsed", "externalNetworkUsed", "productionAssetReadinessClaimed", "questReadinessClaimed", "runtimeReadinessClaimed"]) {
    requireLiteral(value[key], false, `/providerBoundary/${key}`, errors);
  }
  requireLiteral(value.claimBoundary, "provider_neutral_input_manifest_no_execution", "/providerBoundary/claimBoundary", errors);
}

function validateWorkOrderInputs(value: unknown, pathName: string, errors: string[], requiredCapabilityIds: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    const entryPath = `${pathName}/${index}`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath} must be object`);
      return;
    }
    requireString(entry.workOrderInputId, `${entryPath}/workOrderInputId`, errors);
    requireString(entry.variantSemanticKey, `${entryPath}/variantSemanticKey`, errors);
    requireString(entry.sourceBlobName, `${entryPath}/sourceBlobName`, errors);
    requireArray(entry.requiredEvidenceRefs, `${entryPath}/requiredEvidenceRefs`, errors);
    requireArray(entry.requiredCueIds, `${entryPath}/requiredCueIds`, errors);
    requireArray(entry.blockerIds, `${entryPath}/blockerIds`, errors);
    requireArray(entry.targetCapabilityIds, `${entryPath}/targetCapabilityIds`, errors);
    requireLiteral(entry.providerExecutionStatus, "metadata_only_not_executed", `${entryPath}/providerExecutionStatus`, errors);
    requireLiteral(entry.claimBoundary, "provider_neutral_materialization_input_not_asset_readiness", `${entryPath}/claimBoundary`, errors);
    if (Array.isArray(entry.targetCapabilityIds)) {
      for (const capabilityId of requiredCapabilityIds) {
        if (!entry.targetCapabilityIds.includes(capabilityId)) errors.push(`${entryPath}/targetCapabilityIds must include ${capabilityId}`);
      }
    }
  });
}

function parseCliOptions(args: string[]): { evidenceReportPath: string; outputPath: string; validatePath: string | null } {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let evidenceReportPath = "docs/openclinxr/encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", `encounter-materialization-input-manifest-${new Date().toISOString().slice(0, 10)}.json`);
  let validatePath: string | null = null;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--evidence-report" && next) {
      evidenceReportPath = next;
      index += 1;
    } else if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    } else if (arg === "--validate" && next) {
      validatePath = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  return { evidenceReportPath, outputPath, validatePath };
}

function requireLiteral<T>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pathName} must be object`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pathName} must be non-empty string`);
}

function lastPathSegment(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
