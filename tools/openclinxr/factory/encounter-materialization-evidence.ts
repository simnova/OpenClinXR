import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

export type EncounterMaterializationEvidenceReport = {
  schemaVersion: "openclinxr.encounter-materialization-evidence.v1";
  generatedAt: string;
  source: "generated_station_runtime_bundle_materialization_contracts";
  scenarioId: string | null;
  status: "blocked_missing_actor_or_equipment_specific_evidence" | "attachable";
  attachableToRuntimeSelection: boolean;
  actorEvidence: Array<{
    actorId: string;
    actorRole: string;
    variantSemanticKey: string;
    sourceBlobName: string;
    requiredEvidenceRefs: string[];
    blockers: string[];
  }>;
  equipmentEvidence: Array<{
    equipmentId: string;
    variantSemanticKey: string;
    sourceBlobName: string;
    requiredEvidenceRefs: string[];
    blockers: string[];
  }>;
  blockers: string[];
  recommendedNextActions: string[];
  claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness";
  notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"];
};

const NOT_EVIDENCE_FOR = ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;

export function buildEncounterMaterializationEvidenceReport(input: {
  bundleReport: GeneratedEdStationRuntimeBundleReport;
  generatedAt?: string;
}): EncounterMaterializationEvidenceReport {
  const actorContract = input.bundleReport.actorHumanoidMaterializationContract;
  const equipmentContract = input.bundleReport.equipmentMaterializationContract;
  const actorEvidence = (actorContract?.actorVariants ?? []).map((variant) => {
    const blockers = [
      ...(actorContract?.sharedNeutralMeshReuseActorIds.includes(variant.actorId) ? ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"] : []),
      ...variant.requiredMaterializationCueIds.map((cueId) => `actor_materialization_evidence_missing:${variant.actorId}:${cueId}`),
    ];
    return {
      actorId: variant.actorId,
      actorRole: variant.actorRole,
      variantSemanticKey: variant.variantSemanticKey,
      sourceBlobName: variant.sourceBlobName,
      requiredEvidenceRefs: variant.requiredMaterializationCueIds.map((cueId) => `actor-materialization-evidence://${variant.variantSemanticKey}/${cueId}`),
      blockers,
    };
  });
  const equipmentEvidence = (equipmentContract?.equipmentVariants ?? []).map((variant) => {
    const blockers = [
      ...(equipmentContract?.genericEquipmentReuseDetected ? ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"] : []),
      ...variant.requiredEvidenceRefs.map((refId) => `equipment_materialization_evidence_missing:${variant.equipmentId}:${refId}`),
    ];
    return {
      equipmentId: variant.equipmentId,
      variantSemanticKey: variant.variantSemanticKey,
      sourceBlobName: variant.sourceBlobName,
      requiredEvidenceRefs: variant.requiredEvidenceRefs.map((refId) => `equipment-materialization-evidence://${variant.variantSemanticKey}/${refId}`),
      blockers,
    };
  });
  const blockers = uniqueStrings([
    ...(actorContract ? [] : ["actor_humanoid_materialization_contract_not_attached"]),
    ...(equipmentContract ? [] : ["equipment_materialization_contract_not_attached"]),
    ...(actorContract?.materializationBlockers ?? []),
    ...(equipmentContract?.materializationBlockers ?? []),
    ...actorEvidence.flatMap((entry) => entry.blockers),
    ...equipmentEvidence.flatMap((entry) => entry.blockers),
  ]);
  return {
    schemaVersion: "openclinxr.encounter-materialization-evidence.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "generated_station_runtime_bundle_materialization_contracts",
    scenarioId: actorContract?.scenarioId ?? equipmentContract?.scenarioId ?? input.bundleReport.learnerBundle?.scenarioId ?? null,
    status: blockers.length === 0 ? "attachable" : "blocked_missing_actor_or_equipment_specific_evidence",
    attachableToRuntimeSelection: blockers.length === 0,
    actorEvidence,
    equipmentEvidence,
    blockers,
    recommendedNextActions: uniqueStrings([
      actorContract?.recommendedNextAction,
      equipmentContract?.recommendedNextAction,
      "attach this report to publication/local-launch/runtime-selection only after every actor and equipment evidence ref resolves",
    ].filter((action): action is string => Boolean(action))),
    claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateEncounterMaterializationEvidenceReport(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be an object"] };
  }
  if (value.schemaVersion !== "openclinxr.encounter-materialization-evidence.v1") errors.push("/schemaVersion invalid");
  if (value.source !== "generated_station_runtime_bundle_materialization_contracts") errors.push("/source invalid");
  if (value.claimBoundary !== "materialization_evidence_attachment_contract_not_runtime_readiness") errors.push("/claimBoundary invalid");
  if (typeof value.attachableToRuntimeSelection !== "boolean") errors.push("/attachableToRuntimeSelection must be boolean");
  if (!Array.isArray(value.actorEvidence)) errors.push("/actorEvidence must be an array");
  if (!Array.isArray(value.equipmentEvidence)) errors.push("/equipmentEvidence must be an array");
  if (!Array.isArray(value.blockers)) errors.push("/blockers must be an array");
  if (value.status === "attachable" && value.attachableToRuntimeSelection !== true) errors.push("/attachable status requires attachableToRuntimeSelection true");
  if (value.status === "blocked_missing_actor_or_equipment_specific_evidence" && value.attachableToRuntimeSelection !== false) errors.push("/blocked status requires attachableToRuntimeSelection false");
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const report = JSON.parse(await readFile(options.validatePath, "utf8")) as unknown;
    const validation = validateEncounterMaterializationEvidenceReport(report);
    if (!validation.ok) {
      process.stderr.write(`Encounter materialization evidence validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const bundleReport = JSON.parse(await readFile(options.bundleReportPath, "utf8")) as GeneratedEdStationRuntimeBundleReport;
  const report = buildEncounterMaterializationEvidenceReport({ bundleReport });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function parseCliOptions(args: string[]): { bundleReportPath: string; outputPath: string; validatePath: string | null } {
  let bundleReportPath = "docs/openclinxr/generated-ed-station-runtime-bundle-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", `encounter-materialization-evidence-${new Date().toISOString().slice(0, 10)}.json`);
  let validatePath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--bundle-report" && next) {
      bundleReportPath = next;
      index += 1;
    } else if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    } else if (arg === "--validate" && next) {
      validatePath = next;
      index += 1;
    }
  }
  return { bundleReportPath, outputPath, validatePath };
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
