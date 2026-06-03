import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SUPPORT_ARTIFACTS_SCHEMA_VERSION = "openclinxr.asset-production-support-artifacts.v1";
export const SUPPORT_ARTIFACTS_KIND = "asset_production_support_artifacts";

export const SUPPORT_ARTIFACT_PATHS = [
  ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/idle-pain.clip.json",
  ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/clutch-chest.clip.json",
  ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/retargeting-qa.json",
  ".openclinxr/asset-production/ed-chest-pain/optimization/lod-artifact-set.json",
  ".openclinxr/asset-production/ed-chest-pain/optimization/texture-budget.json",
  ".openclinxr/asset-production/ed-chest-pain/optimization/collider-simplification.json",
  ".openclinxr/asset-production/ed-chest-pain/quest-budget/station-bundle-manifest.json",
  ".openclinxr/asset-production/ed-chest-pain/quest-budget/multi-actor-budget.json",
  ".openclinxr/asset-production/ed-chest-pain/quest-budget/foreground-frame-pacing.json",
] as const;

export type AssetProductionSupportArtifactsReport = {
  schemaVersion: typeof SUPPORT_ARTIFACTS_SCHEMA_VERSION;
  kind: typeof SUPPORT_ARTIFACTS_KIND;
  generatedAt: string;
  tool: "tools/openclinxr/asset-production-support-artifacts.ts";
  policy: {
    localOnly: true;
    installsIntroduced: false;
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: false;
    generatedThirdPartyAssetsCommitted: false;
    productionAssetReadinessClaimed: false;
  };
  input: {
    stationSlug: "ed-chest-pain";
    generationMode: "repo_authored_support_evidence_fixtures";
  };
  artifacts: {
    requiredArtifactPaths: readonly string[];
    materializedArtifactPaths: string[];
    missingArtifactPaths: string[];
  };
  summary: {
    lanesCovered: Array<"animationRetargeting" | "lodTextureColliderBudget" | "multiActorQuestBudget">;
    caveats: string[];
  };
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
  };
};

type CliOptions = {
  reportPath: string;
  validatePath?: string;
  validateLatest: boolean;
  help: boolean;
};

export function defaultAssetProductionSupportArtifactsReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `asset-production-support-artifacts-${date.toISOString().slice(0, 10)}.json`);
}

export function buildAssetProductionSupportArtifactsReport(options?: {
  generatedAt?: string;
}): AssetProductionSupportArtifactsReport {
  const missingArtifactPaths = SUPPORT_ARTIFACT_PATHS.filter((artifactPath) => !existsSync(artifactPath));
  const materializedArtifactPaths = SUPPORT_ARTIFACT_PATHS.filter((artifactPath) => existsSync(artifactPath));
  const blockers = missingArtifactPaths.map((artifactPath) => `artifact_file_missing:${artifactPath}`);

  return {
    schemaVersion: SUPPORT_ARTIFACTS_SCHEMA_VERSION,
    kind: SUPPORT_ARTIFACTS_KIND,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    tool: "tools/openclinxr/asset-production-support-artifacts.ts",
    policy: {
      localOnly: true,
      installsIntroduced: false,
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      generatedThirdPartyAssetsCommitted: false,
      productionAssetReadinessClaimed: false,
    },
    input: {
      stationSlug: "ed-chest-pain",
      generationMode: "repo_authored_support_evidence_fixtures",
    },
    artifacts: {
      requiredArtifactPaths: SUPPORT_ARTIFACT_PATHS,
      materializedArtifactPaths,
      missingArtifactPaths,
    },
    summary: {
      lanesCovered: ["animationRetargeting", "lodTextureColliderBudget", "multiActorQuestBudget"],
      caveats: [
        "These JSON artifacts are local fixture evidence only; they do not prove production animation quality, Quest frame pacing, or headset readiness.",
        "Animation, LOD, collider, and station-bundle values are intentionally conservative placeholders for review workflow wiring.",
        "No external assets, cloud APIs, paid APIs, production deployment, or production-readiness claims are introduced.",
      ],
    },
    verdict: {
      passed: blockers.length === 0,
      readyForProductionAssets: false,
      blockers,
    },
  };
}

export async function writeAssetProductionSupportArtifacts(options?: {
  reportPath?: string;
  generatedAt?: string;
}): Promise<AssetProductionSupportArtifactsReport> {
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const artifacts = buildSupportArtifactPayloads(generatedAt);
  for (const [artifactPath, payload] of Object.entries(artifacts)) {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  const report = buildAssetProductionSupportArtifactsReport({ generatedAt });
  const reportPath = options?.reportPath ?? defaultAssetProductionSupportArtifactsReportPath();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export function validateAssetProductionSupportArtifactsReport(report: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(report)) return { ok: false, errors: ["/ must be an object"] };
  if (report.schemaVersion !== SUPPORT_ARTIFACTS_SCHEMA_VERSION) {
    errors.push(`/schemaVersion must be ${SUPPORT_ARTIFACTS_SCHEMA_VERSION}`);
  }
  if (report.kind !== SUPPORT_ARTIFACTS_KIND) {
    errors.push(`/kind must be ${SUPPORT_ARTIFACTS_KIND}`);
  }
  const policy = isRecord(report.policy) ? report.policy : {};
  for (const key of [
    "installsIntroduced",
    "cloudApisUsed",
    "paidApisUsed",
    "externalAssetsUsed",
    "generatedThirdPartyAssetsCommitted",
    "productionAssetReadinessClaimed",
  ] as const) {
    if (policy[key] !== false) errors.push(`/policy/${key} must be false`);
  }
  const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
  const missingArtifactPaths = asStringArray(artifacts.missingArtifactPaths);
  const materializedArtifactPaths = asStringArray(artifacts.materializedArtifactPaths);
  const requiredArtifactPaths = asStringArray(artifacts.requiredArtifactPaths);
  for (const artifactPath of SUPPORT_ARTIFACT_PATHS) {
    if (!requiredArtifactPaths.includes(artifactPath)) {
      errors.push(`/artifacts/requiredArtifactPaths must include ${artifactPath}`);
    }
  }
  const expectedBlockers = missingArtifactPaths.map((artifactPath) => `artifact_file_missing:${artifactPath}`);
  const verdict = isRecord(report.verdict) ? report.verdict : {};
  const verdictBlockers = asStringArray(verdict.blockers);
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.includes(blocker)) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }
  if (materializedArtifactPaths.some((artifactPath) => missingArtifactPaths.includes(artifactPath))) {
    errors.push("/artifacts/materializedArtifactPaths must not overlap missingArtifactPaths");
  }
  if (verdict.passed !== (expectedBlockers.length === 0)) {
    errors.push(`/verdict/passed must be ${expectedBlockers.length === 0}`);
  }
  if (verdict.readyForProductionAssets !== false) {
    errors.push("/verdict/readyForProductionAssets must be false");
  }
  return { ok: errors.length === 0, errors };
}

export async function runAssetProductionSupportArtifactsCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(`${supportArtifactsHelp()}\n`);
    return;
  }
  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validateLatest
      ? defaultAssetProductionSupportArtifactsReportPath()
      : options.validatePath;
    if (!validatePath) {
      process.stderr.write("Missing asset production support-artifacts report path.\n");
      process.exitCode = 1;
      return;
    }
    await validateReportFile(validatePath, { validateArtifacts: options.validateLatest });
    return;
  }
  const report = await writeAssetProductionSupportArtifacts({ reportPath: options.reportPath });
  const validation = validateAssetProductionSupportArtifactsReport(report);
  if (!validation.ok) {
    process.stderr.write(`Asset production support-artifacts report failed validation:\n${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Generated asset production support artifacts: ${report.artifacts.materializedArtifactPaths.length} files\n`);
}

async function validateReportFile(reportPath: string, options: { validateArtifacts: boolean }): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  const validation = validateAssetProductionSupportArtifactsReport(report);
  const errors = [...validation.errors];
  if (options.validateArtifacts && isRecord(report)) {
    const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
    for (const artifactPath of asStringArray(artifacts.requiredArtifactPaths)) {
      if (!existsSync(artifactPath)) {
        errors.push(`/artifacts/requiredArtifactPaths must point at an existing file for --validate-latest: ${artifactPath}`);
      }
    }
  }
  if (errors.length > 0) {
    process.stderr.write(`Asset production support-artifacts report validation failed:\n${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

function buildSupportArtifactPayloads(generatedAt: string): Record<string, unknown> {
  return {
    ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/idle-pain.clip.json": {
      schemaVersion: "openclinxr.animation-clip-fixture.v1",
      kind: "animation_clip_fixture",
      generatedAt,
      clipId: "idle-pain",
      source: "repo_authored_keyframe_placeholder",
      targetSkeleton: "openclinxr_canonical_humanoid_skeleton",
      productionAssetReadinessClaimed: false,
      keyframes: [
        { atSecond: 0, pose: "standing_guarded", painCue: "mild_chest_pressure" },
        { atSecond: 4, pose: "subtle_weight_shift", painCue: "guarded_breath" },
      ],
    },
    ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/clutch-chest.clip.json": {
      schemaVersion: "openclinxr.animation-clip-fixture.v1",
      kind: "animation_clip_fixture",
      generatedAt,
      clipId: "clutch-chest",
      source: "repo_authored_keyframe_placeholder",
      targetSkeleton: "openclinxr_canonical_humanoid_skeleton",
      productionAssetReadinessClaimed: false,
      keyframes: [
        { atSecond: 0, pose: "hand_neutral", painCue: "baseline" },
        { atSecond: 1.2, pose: "right_hand_to_sternum", painCue: "acute_pressure" },
        { atSecond: 2.4, pose: "guarded_chest_hold", painCue: "worse_with_exertion" },
      ],
    },
    ".openclinxr/asset-production/ed-chest-pain/animation-retargeting/retargeting-qa.json": {
      schemaVersion: "openclinxr.retargeting-qa.v1",
      kind: "retargeting_qa",
      generatedAt,
      status: "fixture_only",
      requiredReviews: ["body animation retargeting QA", "facial or viseme mapping review", "clinical gesture realism review"],
      productionAssetReadinessClaimed: false,
    },
    ".openclinxr/asset-production/ed-chest-pain/optimization/lod-artifact-set.json": {
      schemaVersion: "openclinxr.lod-artifact-set.v1",
      kind: "lod_artifact_set",
      generatedAt,
      status: "fixture_budget",
      tiers: [
        { tier: "near", targetTrianglesPerActor: 4500 },
        { tier: "mid", targetTrianglesPerActor: 2200 },
        { tier: "far", targetTrianglesPerActor: 900 },
      ],
      productionAssetReadinessClaimed: false,
    },
    ".openclinxr/asset-production/ed-chest-pain/optimization/texture-budget.json": {
      schemaVersion: "openclinxr.texture-budget.v1",
      kind: "texture_budget",
      generatedAt,
      targetRuntime: "Quest/WebXR",
      maxTextureSize: 1024,
      preferredFormats: ["ktx2_basisu", "webp_fallback"],
      productionAssetReadinessClaimed: false,
    },
    ".openclinxr/asset-production/ed-chest-pain/optimization/collider-simplification.json": {
      schemaVersion: "openclinxr.collider-simplification.v1",
      kind: "collider_simplification",
      generatedAt,
      strategy: "primitive_colliders_for_props_and_actor_interaction_zones",
      targetColliderCount: { examBay: 24, perActor: 6, perEquipmentProp: 4 },
      productionAssetReadinessClaimed: false,
    },
    ".openclinxr/asset-production/ed-chest-pain/quest-budget/station-bundle-manifest.json": {
      schemaVersion: "openclinxr.station-bundle-manifest.v1",
      kind: "station_bundle_manifest",
      generatedAt,
      stationSlug: "ed-chest-pain",
      includedFixtureArtifacts: [
        "neutral-generated-human.glb",
        "ecg-cart-12-lead.glb",
        "iv-pole-with-pump.glb",
      ],
      productionAssetReadinessClaimed: false,
    },
    ".openclinxr/asset-production/ed-chest-pain/quest-budget/multi-actor-budget.json": {
      schemaVersion: "openclinxr.multi-actor-budget.v1",
      kind: "multi_actor_budget",
      generatedAt,
      targetRuntime: "Quest 3 WebXR fixture",
      actorBudget: { concurrentActors: 3, targetTrianglesTotal: 13500, targetMaterialsTotal: 16 },
      productionAssetReadinessClaimed: false,
    },
    ".openclinxr/asset-production/ed-chest-pain/quest-budget/foreground-frame-pacing.json": {
      schemaVersion: "openclinxr.foreground-frame-pacing.v1",
      kind: "foreground_frame_pacing",
      generatedAt,
      status: "requires_worn_headset_capture",
      target: { frameRateHz: 72, maxLongFrameRatePercent: 1 },
      productionAssetReadinessClaimed: false,
    },
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    reportPath: defaultAssetProductionSupportArtifactsReportPath(),
    validateLatest: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--report" || arg === "--output") options.reportPath = nextValue();
    else if (arg === "--validate") options.validatePath = nextValue();
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown asset production support-artifacts option: ${arg}`);
  }
  return options;
}

function supportArtifactsHelp(): string {
  return [
    "Usage: tsx tools/openclinxr/asset-production-support-artifacts.ts [options]",
    "",
    "Options:",
    "  --report <path>        Summary report path.",
    "  --validate <path>      Validate one summary report.",
    "  --validate-latest      Validate today's default summary report and artifact paths.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  runAssetProductionSupportArtifactsCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
