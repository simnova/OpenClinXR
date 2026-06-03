import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
};

type ProductionAssetLaneId =
  | "generatedHumanRigging"
  | "skinClothingProvenance"
  | "medicalEquipmentLibrary"
  | "environmentShell"
  | "animationRetargeting"
  | "lodTextureColliderBudget"
  | "multiActorQuestBudget";

type ArtifactEvidenceTier =
  | "repo_generated_placeholder"
  | "reviewed_local_clinical_asset_fixture"
  | "reviewed_generated_production_source";

type AssetProductionArtifactEvidenceRecord = {
  laneId: ProductionAssetLaneId;
  title: string;
  evidenceTier: ArtifactEvidenceTier;
  artifactBacked: boolean;
  requiredArtifactPaths: string[];
  materializedArtifactPaths: string[];
  missingArtifactPaths: string[];
  requiredReviewReports: string[];
  blockers: string[];
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type AssetProductionArtifactEvidenceReport = {
  schemaVersion: "openclinxr.asset-production-artifact-evidence.v1";
  kind: "asset_production_artifact_evidence";
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    installsIntroduced: false;
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: false;
    generatedThirdPartyAssetsCommitted: false;
    productionAssetReadinessClaimed: false;
  };
  summary: {
    requiredLaneIds: ProductionAssetLaneId[];
    observedLaneIds: ProductionAssetLaneId[];
    artifactBackedLaneIds: ProductionAssetLaneId[];
    placeholderOrFixtureLaneIds: ProductionAssetLaneId[];
    missingLaneIds: ProductionAssetLaneId[];
    allRequiredLanesObserved: boolean;
    allArtifactFilesMaterialized: boolean;
    artifactBackedProductionEvidenceObserved: boolean;
  };
  records: AssetProductionArtifactEvidenceRecord[];
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
    caveats: string[];
  };
};

const productionAssetLaneIds: ProductionAssetLaneId[] = [
  "generatedHumanRigging",
  "skinClothingProvenance",
  "medicalEquipmentLibrary",
  "environmentShell",
  "animationRetargeting",
  "lodTextureColliderBudget",
  "multiActorQuestBudget",
];

const artifactEvidenceTiers: ArtifactEvidenceTier[] = [
  "repo_generated_placeholder",
  "reviewed_local_clinical_asset_fixture",
  "reviewed_generated_production_source",
];

const defaultEvidenceTier: ArtifactEvidenceTier = "reviewed_local_clinical_asset_fixture";

const laneDefinitions: Array<{
  laneId: ProductionAssetLaneId;
  title: string;
  requiredArtifactPaths: string[];
  requiredReviewReports: string[];
}> = [
  {
    laneId: "generatedHumanRigging",
    title: "Generated human rigging",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
      ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/canonical-skeleton-binding.json",
      ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/skin-weight-quality.json",
      ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human-realism-manifest.json",
    ],
    requiredReviewReports: [
      "canonical skeleton hierarchy review",
      "skin-weight deformation QA",
      "clinical actor realism review",
    ],
  },
  {
    laneId: "skinClothingProvenance",
    title: "Skin and clothing provenance",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/skin-clothing-provenance/skin-texture-provenance.json",
      ".openclinxr/asset-production/ed-chest-pain/skin-clothing-provenance/clothing-mesh-provenance.json",
      ".openclinxr/asset-production/ed-chest-pain/skin-clothing-provenance/runtime-safe-materials.json",
    ],
    requiredReviewReports: [
      "skin tone and texture provenance review",
      "clothing mesh provenance review",
      "runtime material safety review",
    ],
  },
  {
    laneId: "medicalEquipmentLibrary",
    title: "Medical equipment library",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb",
      ".openclinxr/asset-production/ed-chest-pain/medical-equipment/iv-pole-with-pump.glb",
      ".openclinxr/asset-production/ed-chest-pain/medical-equipment/equipment-provenance.json",
      ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ed-chest-pain-equipment-realism-manifest.json",
    ],
    requiredReviewReports: [
      "clinical equipment affordance review",
      "equipment license provenance review",
      "scale and interaction anchor review",
    ],
  },
  {
    laneId: "environmentShell",
    title: "ED bay environment shell",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/environment/ed-exam-bay-shell.glb",
      ".openclinxr/asset-production/ed-chest-pain/environment/ed-exam-bay-layout.json",
      ".openclinxr/asset-production/ed-chest-pain/environment/equipment-placement-manifest.json",
      ".openclinxr/asset-production/ed-chest-pain/environment/quest-environment-budget.json",
    ],
    requiredReviewReports: [
      "environment spatial layout review",
      "equipment placement manifest review",
      "Quest environment budget review",
      "clinical visual environment critique",
    ],
  },
  {
    laneId: "animationRetargeting",
    title: "Animation retargeting",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/idle-pain.clip.json",
      ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/clutch-chest.clip.json",
      ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/retargeting-qa.json",
    ],
    requiredReviewReports: [
      "body animation retargeting QA",
      "facial or viseme target mapping review",
      "clinical gesture realism review",
    ],
  },
  {
    laneId: "lodTextureColliderBudget",
    title: "LOD, texture, and collider budget",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/optimization/lod-artifact-set.json",
      ".openclinxr/asset-production/ed-chest-pain/optimization/texture-budget.json",
      ".openclinxr/asset-production/ed-chest-pain/optimization/collider-simplification.json",
    ],
    requiredReviewReports: [
      "LOD tier review",
      "texture compression budget review",
      "collider simplification review",
    ],
  },
  {
    laneId: "multiActorQuestBudget",
    title: "Multi-actor Quest 3 station budget",
    requiredArtifactPaths: [
      ".openclinxr/asset-production/ed-chest-pain/quest-budget/station-bundle-manifest.json",
      ".openclinxr/asset-production/ed-chest-pain/quest-budget/multi-actor-budget.json",
      ".openclinxr/asset-production/ed-chest-pain/quest-budget/foreground-frame-pacing.json",
    ],
    requiredReviewReports: [
      "multi-actor draw-call and texture-memory budget review",
      "Quest foreground frame-pacing review",
      "station bundle artifact manifest review",
    ],
  },
];

async function main(): Promise<void> {
  await runAssetProductionArtifactEvidenceCli(process.argv.slice(2));
}

export async function runAssetProductionArtifactEvidenceCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/asset-production-artifact-evidence-*.json");
    if (!validatePath) {
      throw new Error("Missing asset production artifact evidence report to validate.");
    }
    const validation = validateAssetProductionArtifactEvidenceReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const report = buildAssetProductionArtifactEvidenceReport();
  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    validateLatest: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
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

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  return files.sort().at(-1);
}

export function buildAssetProductionArtifactEvidenceReport(input: {
  generatedAt?: string;
  evidenceTier?: ArtifactEvidenceTier;
} = {}): AssetProductionArtifactEvidenceReport {
  const evidenceTier = input.evidenceTier ?? defaultEvidenceTier;
  const records = laneDefinitions.map((definition) => buildRecord(definition, evidenceTier));
  const observedLaneIds = records.map((record) => record.laneId);
  const artifactBackedLaneIds = records
    .filter((record) => record.artifactBacked)
    .map((record) => record.laneId);
  const placeholderOrFixtureLaneIds = records
    .filter((record) => !record.artifactBacked)
    .map((record) => record.laneId);
  const missingLaneIds = productionAssetLaneIds.filter((laneId) => !observedLaneIds.includes(laneId));
  const allRequiredLanesObserved = missingLaneIds.length === 0;
  const allArtifactFilesMaterialized = records.every((record) => record.missingArtifactPaths.length === 0);
  const artifactBackedProductionEvidenceObserved = allRequiredLanesObserved
    && allArtifactFilesMaterialized
    && artifactBackedLaneIds.length === productionAssetLaneIds.length;
  const blockers = [
    artifactBackedProductionEvidenceObserved ? undefined : "artifact_backed_production_asset_evidence_missing",
    ...missingLaneIds.map((laneId) => `${laneId}:lane_missing`),
    ...records.flatMap((record) => record.blockers.map((blocker) => `${record.laneId}:${blocker}`)),
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const passed = blockers.length === 0;

  return {
    schemaVersion: "openclinxr.asset-production-artifact-evidence.v1",
    kind: "asset_production_artifact_evidence",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    policy: {
      installsIntroduced: false,
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      generatedThirdPartyAssetsCommitted: false,
      productionAssetReadinessClaimed: false,
    },
    summary: {
      requiredLaneIds: [...productionAssetLaneIds],
      observedLaneIds,
      artifactBackedLaneIds,
      placeholderOrFixtureLaneIds,
      missingLaneIds,
      allRequiredLanesObserved,
      allArtifactFilesMaterialized,
      artifactBackedProductionEvidenceObserved,
    },
    records,
    verdict: {
      passed,
      readyForProductionAssets: false,
      blockers,
      caveats: [
        "This report defines artifact-backed production asset evidence slots only; it does not generate or download assets.",
        "Fixture and placeholder tiers are useful for validator shape, but cannot satisfy production asset readiness.",
        "Production asset readiness still requires reviewed generated production-source artifacts, visual QA, provenance, and Quest budget evidence.",
      ],
    },
  };
}

function buildRecord(
  definition: (typeof laneDefinitions)[number],
  evidenceTier: ArtifactEvidenceTier,
): AssetProductionArtifactEvidenceRecord {
  const materializedArtifactPaths = definition.requiredArtifactPaths.filter((artifactPath) => existsSync(artifactPath));
  const missingArtifactPaths = definition.requiredArtifactPaths.filter((artifactPath) => !existsSync(artifactPath));
  const artifactBacked = evidenceTier === "reviewed_generated_production_source" && missingArtifactPaths.length === 0;
  const artifactFilesMissing = missingArtifactPaths.length > 0;
  const blockers = [
    evidenceTier === "reviewed_generated_production_source"
      ? undefined
      : "evidence_tier_not_reviewed_generated_production_source",
    artifactFilesMissing ? "artifact_files_missing" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    laneId: definition.laneId,
    title: definition.title,
    evidenceTier,
    artifactBacked,
    requiredArtifactPaths: [...definition.requiredArtifactPaths],
    materializedArtifactPaths,
    missingArtifactPaths,
    requiredReviewReports: [...definition.requiredReviewReports],
    blockers,
  };
}

export function validateAssetProductionArtifactEvidenceReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.schemaVersion, "openclinxr.asset-production-artifact-evidence.v1", "/schemaVersion", errors);
  requireLiteral(value.kind, "asset_production_artifact_evidence", "/kind", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  validatePolicy(value.policy, errors);
  validateSummary(value.summary, errors);
  requireArray(value.records, "/records", errors);
  if (Array.isArray(value.records)) {
    value.records.forEach((record, index) => {
      validateRecord(record, `/records/${index}`, errors);
    });
  }
  validateVerdict(value.verdict, errors);
  validateConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePolicy(value: unknown, errors: string[]): void {
  requireRecord(value, "/policy", errors);
  if (!isRecord(value)) {
    return;
  }
  requireLiteral(value.installsIntroduced, false, "/policy/installsIntroduced", errors);
  requireLiteral(value.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
  requireLiteral(value.paidApisUsed, false, "/policy/paidApisUsed", errors);
  requireLiteral(value.externalAssetsUsed, false, "/policy/externalAssetsUsed", errors);
  requireLiteral(value.generatedThirdPartyAssetsCommitted, false, "/policy/generatedThirdPartyAssetsCommitted", errors);
  requireLiteral(value.productionAssetReadinessClaimed, false, "/policy/productionAssetReadinessClaimed", errors);
}

function validateSummary(value: unknown, errors: string[]): void {
  requireRecord(value, "/summary", errors);
  if (!isRecord(value)) {
    return;
  }
  requireLaneIdArray(value.requiredLaneIds, "/summary/requiredLaneIds", errors);
  requireLaneIdArray(value.observedLaneIds, "/summary/observedLaneIds", errors);
  requireLaneIdArray(value.artifactBackedLaneIds, "/summary/artifactBackedLaneIds", errors);
  requireLaneIdArray(value.placeholderOrFixtureLaneIds, "/summary/placeholderOrFixtureLaneIds", errors);
  requireLaneIdArray(value.missingLaneIds, "/summary/missingLaneIds", errors);
  requireBoolean(value.allRequiredLanesObserved, "/summary/allRequiredLanesObserved", errors);
  requireBoolean(value.allArtifactFilesMaterialized, "/summary/allArtifactFilesMaterialized", errors);
  requireBoolean(
    value.artifactBackedProductionEvidenceObserved,
    "/summary/artifactBackedProductionEvidenceObserved",
    errors,
  );
}

function validateRecord(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.laneId, productionAssetLaneIds, `${pathName}/laneId`, errors);
  requireString(value.title, `${pathName}/title`, errors);
  requireOneOf(value.evidenceTier, artifactEvidenceTiers, `${pathName}/evidenceTier`, errors);
  requireBoolean(value.artifactBacked, `${pathName}/artifactBacked`, errors);
  requireStringArray(value.requiredArtifactPaths, `${pathName}/requiredArtifactPaths`, errors);
  requireStringArray(value.materializedArtifactPaths, `${pathName}/materializedArtifactPaths`, errors);
  requireStringArray(value.missingArtifactPaths, `${pathName}/missingArtifactPaths`, errors);
  requireStringArray(value.requiredReviewReports, `${pathName}/requiredReviewReports`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function validateVerdict(value: unknown, errors: string[]): void {
  requireRecord(value, "/verdict", errors);
  if (!isRecord(value)) {
    return;
  }
  requireBoolean(value.passed, "/verdict/passed", errors);
  requireLiteral(value.readyForProductionAssets, false, "/verdict/readyForProductionAssets", errors);
  requireStringArray(value.blockers, "/verdict/blockers", errors);
  requireStringArray(value.caveats, "/verdict/caveats", errors);
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.summary) || !Array.isArray(value.records) || !isRecord(value.verdict)) {
    return;
  }

  const records = value.records.filter(isRecord);
  const summary = value.summary;
  const verdict = value.verdict;
  const recordLaneIds = records
    .map((record) => record.laneId)
    .filter((laneId): laneId is ProductionAssetLaneId => typeof laneId === "string" && productionAssetLaneIds.includes(laneId as ProductionAssetLaneId));
  const recordLaneIdSet = new Set<ProductionAssetLaneId>();

  for (const laneId of recordLaneIds) {
    if (recordLaneIdSet.has(laneId)) {
      errors.push(`/records must not repeat canonical lane id ${laneId}`);
      continue;
    }
    recordLaneIdSet.add(laneId);
  }
  for (const laneId of productionAssetLaneIds) {
    if (!recordLaneIdSet.has(laneId)) {
      errors.push(`/records must include canonical lane id ${laneId}`);
    }
  }

  const missingLaneIds = productionAssetLaneIds.filter((laneId) => !recordLaneIdSet.has(laneId));
  const artifactBackedLaneIds = records
    .filter((record) => record.artifactBacked === true && typeof record.laneId === "string")
    .map((record) => record.laneId as ProductionAssetLaneId);
  const placeholderOrFixtureLaneIds = records
    .filter((record) => record.artifactBacked === false && typeof record.laneId === "string")
    .map((record) => record.laneId as ProductionAssetLaneId);

  compareLaneArray(summary.requiredLaneIds, productionAssetLaneIds, "/summary/requiredLaneIds", errors);
  compareLaneArray(summary.observedLaneIds, recordLaneIds, "/summary/observedLaneIds", errors);
  compareLaneArray(summary.artifactBackedLaneIds, artifactBackedLaneIds, "/summary/artifactBackedLaneIds", errors);
  compareLaneArray(
    summary.placeholderOrFixtureLaneIds,
    placeholderOrFixtureLaneIds,
    "/summary/placeholderOrFixtureLaneIds",
    errors,
  );
  compareLaneArray(summary.missingLaneIds, missingLaneIds, "/summary/missingLaneIds", errors);

  const allRequiredLanesObserved = missingLaneIds.length === 0;
  const allArtifactFilesMaterialized = records.every((record) =>
    Array.isArray(record.missingArtifactPaths) && record.missingArtifactPaths.length === 0
  );
  const artifactBackedProductionEvidenceObserved = allRequiredLanesObserved
    && allArtifactFilesMaterialized
    && artifactBackedLaneIds.length === productionAssetLaneIds.length;

  if (summary.allRequiredLanesObserved !== allRequiredLanesObserved) {
    errors.push("/summary/allRequiredLanesObserved must match missing lane count");
  }
  if (summary.allArtifactFilesMaterialized !== allArtifactFilesMaterialized) {
    errors.push("/summary/allArtifactFilesMaterialized must match record missing artifact paths");
  }
  if (summary.artifactBackedProductionEvidenceObserved !== artifactBackedProductionEvidenceObserved) {
    errors.push("/summary/artifactBackedProductionEvidenceObserved must match artifact-backed lane evidence");
  }

  validateRecordFileClaims(records, errors);

  if (!Array.isArray(verdict.blockers)) {
    return;
  }
  const expectedBlockers = expectedVerdictBlockers(records, missingLaneIds, artifactBackedProductionEvidenceObserved);
  compareStringArray(verdict.blockers, expectedBlockers, "/verdict/blockers", errors);
  if (verdict.passed !== (expectedBlockers.length === 0)) {
    errors.push("/verdict/passed must match blocker-free artifact evidence");
  }
  if (value.status !== (expectedBlockers.length === 0 ? "passed" : "blocked")) {
    errors.push("/status must match blocker-free artifact evidence");
  }
}

function validateRecordFileClaims(records: Array<Record<string, unknown>>, errors: string[]): void {
  records.forEach((record, index) => {
    if (!Array.isArray(record.requiredArtifactPaths)) {
      return;
    }
    const materializedArtifactPaths = Array.isArray(record.materializedArtifactPaths)
      ? record.materializedArtifactPaths.filter((entry): entry is string => typeof entry === "string")
      : [];
    const missingArtifactPaths = Array.isArray(record.missingArtifactPaths)
      ? record.missingArtifactPaths.filter((entry): entry is string => typeof entry === "string")
      : [];

    for (const artifactPath of record.requiredArtifactPaths) {
      if (typeof artifactPath !== "string") {
        continue;
      }
      const exists = existsSync(artifactPath);
      if (exists && !materializedArtifactPaths.includes(artifactPath)) {
        errors.push(`/records/${index}/materializedArtifactPaths must include materialized artifact path ${artifactPath}`);
      }
      if (!exists && !missingArtifactPaths.includes(artifactPath)) {
        errors.push(`/records/${index}/missingArtifactPaths must include missing artifact path ${artifactPath}`);
      }
      if (!exists && record.artifactBacked === true) {
        errors.push(`/records/${index}/artifactBacked cannot be true while artifact path is missing: ${artifactPath}`);
      }
    }
    if (record.artifactBacked === true && record.evidenceTier !== "reviewed_generated_production_source") {
      errors.push(`/records/${index}/artifactBacked requires reviewed_generated_production_source evidence tier`);
    }
  });
}

function expectedVerdictBlockers(
  records: Array<Record<string, unknown>>,
  missingLaneIds: ProductionAssetLaneId[],
  artifactBackedProductionEvidenceObserved: boolean,
): string[] {
  return [
    artifactBackedProductionEvidenceObserved ? undefined : "artifact_backed_production_asset_evidence_missing",
    ...missingLaneIds.map((laneId) => `${laneId}:lane_missing`),
    ...records.flatMap((record) => {
      if (typeof record.laneId !== "string" || !Array.isArray(record.blockers)) {
        return [];
      }
      return record.blockers
        .filter((blocker): blocker is string => typeof blocker === "string")
        .map((blocker) => `${record.laneId}:${blocker}`);
    }),
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function requireLaneIdArray(value: unknown, pathName: string, errors: string[]): void {
  requireArray(value, pathName, errors);
  if (!Array.isArray(value)) {
    return;
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !productionAssetLaneIds.includes(entry as ProductionAssetLaneId)) {
      errors.push(`${pathName} must contain only canonical asset lane ids`);
      continue;
    }
    if (seen.has(entry)) {
      errors.push(`${pathName} must not repeat lane id ${entry}`);
    }
    seen.add(entry);
  }
}

function compareLaneArray(
  actual: unknown,
  expected: ProductionAssetLaneId[],
  pathName: string,
  errors: string[],
): void {
  if (!Array.isArray(actual)) {
    return;
  }
  compareStringArray(
    actual.filter((entry): entry is string => typeof entry === "string"),
    expected,
    pathName,
    errors,
  );
}

function compareStringArray(actual: unknown, expected: string[], pathName: string, errors: string[]): void {
  if (!Array.isArray(actual)) {
    return;
  }
  const actualStrings = actual.filter((entry): entry is string => typeof entry === "string");
  for (const entry of expected) {
    if (!actualStrings.includes(entry)) {
      errors.push(`${pathName} must include ${entry}`);
    }
  }
  for (const entry of actualStrings) {
    if (!expected.includes(entry)) {
      errors.push(`${pathName} must not include ${entry}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  requireArray(value, pathName, errors);
  if (!Array.isArray(value)) {
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireLiteral<T extends string | boolean | number>(
  value: unknown,
  literal: T,
  pathName: string,
  errors: string[],
): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
