import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SKIN_CLOTHING_SCHEMA_VERSION = "openclinxr.skin-clothing-provenance-artifacts.v1";
export const SKIN_CLOTHING_KIND = "skin_clothing_provenance_artifacts";
export const SKIN_CLOTHING_OUTPUT_DIR =
  ".openclinxr/asset-production/ed-chest-pain/skin-clothing-provenance";
export const SKIN_TEXTURE_PROVENANCE_NAME = "skin-texture-provenance.json";
export const CLOTHING_MESH_PROVENANCE_NAME = "clothing-mesh-provenance.json";
export const RUNTIME_SAFE_MATERIALS_NAME = "runtime-safe-materials.json";

export type SkinClothingProvenanceReport = {
  schemaVersion: typeof SKIN_CLOTHING_SCHEMA_VERSION;
  kind: typeof SKIN_CLOTHING_KIND;
  generatedAt: string;
  tool: "tools/openclinxr/skin-clothing-provenance-artifacts.ts";
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
    laneId: "skinClothingProvenance";
    stationSlug: "ed-chest-pain";
    sourceRigArtifactPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb";
    generationMode: "repo_authored_procedural_material_and_scrub_fixture";
  };
  artifacts: {
    skinTextureProvenancePath: string;
    clothingMeshProvenancePath: string;
    runtimeSafeMaterialsPath: string;
  };
  summary: {
    artifactFilesMaterialized: boolean;
    missingArtifactPaths: string[];
    provenanceRecords: string[];
    caveats: string[];
  };
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
  };
};

type CliOptions = {
  outputRoot: string;
  reportPath: string;
  validatePath?: string;
  validateLatest: boolean;
  help: boolean;
};

export function defaultSkinClothingProvenanceReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `skin-clothing-provenance-artifacts-${date.toISOString().slice(0, 10)}.json`);
}

export function buildSkinClothingProvenanceReport(options?: {
  generatedAt?: string;
  outputRoot?: string;
}): SkinClothingProvenanceReport {
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const artifactPaths = skinClothingArtifactPaths(options?.outputRoot ?? SKIN_CLOTHING_OUTPUT_DIR);
  const artifactPathValues = [
    artifactPaths.skinTextureProvenance,
    artifactPaths.clothingMeshProvenance,
    artifactPaths.runtimeSafeMaterials,
  ];
  const missingArtifactPaths = artifactPathValues
    .map(toRepoRelativePath)
    .filter((artifactPath) => !existsSync(artifactPath));
  const blockers = missingArtifactPaths.length > 0
    ? missingArtifactPaths.map((artifactPath) => `artifact_file_missing:${artifactPath}`)
    : [];

  return {
    schemaVersion: SKIN_CLOTHING_SCHEMA_VERSION,
    kind: SKIN_CLOTHING_KIND,
    generatedAt,
    tool: "tools/openclinxr/skin-clothing-provenance-artifacts.ts",
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
      laneId: "skinClothingProvenance",
      stationSlug: "ed-chest-pain",
      sourceRigArtifactPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
      generationMode: "repo_authored_procedural_material_and_scrub_fixture",
    },
    artifacts: {
      skinTextureProvenancePath: toRepoRelativePath(artifactPaths.skinTextureProvenance),
      clothingMeshProvenancePath: toRepoRelativePath(artifactPaths.clothingMeshProvenance),
      runtimeSafeMaterialsPath: toRepoRelativePath(artifactPaths.runtimeSafeMaterials),
    },
    summary: {
      artifactFilesMaterialized: missingArtifactPaths.length === 0,
      missingArtifactPaths,
      provenanceRecords: [
        "procedural skin material parameters authored in repo",
        "procedural scrub blockout material authored in repo",
        "runtime-safe material policy documented without texture downloads",
      ],
      caveats: [
        "This fixture records local provenance and runtime material posture only.",
        "It does not claim final skin realism, clothing simulation quality, or production avatar readiness.",
        "No external texture, clothing mesh, cloud API, paid API, or third-party generated asset is introduced.",
      ],
    },
    verdict: {
      passed: blockers.length === 0,
      readyForProductionAssets: false,
      blockers,
    },
  };
}

export async function writeSkinClothingProvenanceArtifacts(options?: {
  outputRoot?: string;
  reportPath?: string;
  generatedAt?: string;
}): Promise<SkinClothingProvenanceReport> {
  const outputRoot = options?.outputRoot ?? SKIN_CLOTHING_OUTPUT_DIR;
  const artifactPaths = skinClothingArtifactPaths(outputRoot);
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  await mkdir(artifactPaths.outputRoot, { recursive: true });

  await writeFile(
    artifactPaths.skinTextureProvenance,
    `${JSON.stringify(buildSkinTextureProvenance(generatedAt), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    artifactPaths.clothingMeshProvenance,
    `${JSON.stringify(buildClothingMeshProvenance(generatedAt), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    artifactPaths.runtimeSafeMaterials,
    `${JSON.stringify(buildRuntimeSafeMaterials(generatedAt), null, 2)}\n`,
    "utf8",
  );

  const report = buildSkinClothingProvenanceReport({ generatedAt, outputRoot });
  await mkdir(path.dirname(path.resolve(options?.reportPath ?? defaultSkinClothingProvenanceReportPath())), {
    recursive: true,
  });
  await writeFile(options?.reportPath ?? defaultSkinClothingProvenanceReportPath(), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export function validateSkinClothingProvenanceReport(report: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(report)) {
    return { ok: false, errors: ["/ must be an object"] };
  }
  if (report.schemaVersion !== SKIN_CLOTHING_SCHEMA_VERSION) {
    errors.push(`/schemaVersion must be ${SKIN_CLOTHING_SCHEMA_VERSION}`);
  }
  if (report.kind !== SKIN_CLOTHING_KIND) {
    errors.push(`/kind must be ${SKIN_CLOTHING_KIND}`);
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
    if (policy[key] !== false) {
      errors.push(`/policy/${key} must be false`);
    }
  }

  const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
  for (const key of ["skinTextureProvenancePath", "clothingMeshProvenancePath", "runtimeSafeMaterialsPath"] as const) {
    if (typeof artifacts[key] !== "string" || artifacts[key].length === 0) {
      errors.push(`/artifacts/${key} must be a non-empty string`);
    }
  }

  const summary = isRecord(report.summary) ? report.summary : {};
  const missingArtifactPaths = asStringArray(summary.missingArtifactPaths);
  const expectedBlockers = missingArtifactPaths.map((artifactPath) => `artifact_file_missing:${artifactPath}`);
  const verdict = isRecord(report.verdict) ? report.verdict : {};
  const verdictBlockers = asStringArray(verdict.blockers);
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.includes(blocker)) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }
  if (summary.artifactFilesMaterialized !== (missingArtifactPaths.length === 0)) {
    errors.push("/summary/artifactFilesMaterialized must match missing artifact paths");
  }
  if (verdict.passed !== (expectedBlockers.length === 0)) {
    errors.push(`/verdict/passed must be ${expectedBlockers.length === 0}`);
  }
  if (verdict.readyForProductionAssets !== false) {
    errors.push("/verdict/readyForProductionAssets must be false");
  }

  return { ok: errors.length === 0, errors };
}

export async function runSkinClothingProvenanceCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);

  if (options.help) {
    process.stdout.write(`${skinClothingHelp()}\n`);
    return;
  }

  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validateLatest ? defaultSkinClothingProvenanceReportPath() : options.validatePath;
    if (!validatePath) {
      process.stderr.write("Missing skin/clothing provenance report path.\n");
      process.exitCode = 1;
      return;
    }
    await validateReportFile(validatePath, { validateArtifacts: options.validateLatest });
    return;
  }

  const report = await writeSkinClothingProvenanceArtifacts({
    outputRoot: options.outputRoot,
    reportPath: options.reportPath,
  });
  const validation = validateSkinClothingProvenanceReport(report);
  if (!validation.ok) {
    process.stderr.write(`Skin/clothing provenance report failed validation:\n${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Generated skin/clothing provenance artifacts: ${report.artifacts.skinTextureProvenancePath}, ${report.artifacts.clothingMeshProvenancePath}, ${report.artifacts.runtimeSafeMaterialsPath}\n`,
  );
}

async function validateReportFile(reportPath: string, options: { validateArtifacts: boolean }): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  const validation = validateSkinClothingProvenanceReport(report);
  const errors = [...validation.errors];

  if (options.validateArtifacts && isRecord(report)) {
    const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
    for (const key of ["skinTextureProvenancePath", "clothingMeshProvenancePath", "runtimeSafeMaterialsPath"] as const) {
      const artifactPath = artifacts[key];
      if (typeof artifactPath !== "string" || !existsSync(path.resolve(artifactPath))) {
        errors.push(`/artifacts/${key} must point at an existing file for --validate-latest`);
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`Skin/clothing provenance report validation failed:\n${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

function buildSkinTextureProvenance(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.skin-texture-provenance.v1",
    kind: "skin_texture_provenance",
    generatedAt,
    source: "repo_authored_procedural_material_parameters",
    externalAssetsUsed: false,
    productionAssetReadinessClaimed: false,
    materialParameters: {
      baseColor: "#b88463",
      roughness: 0.78,
      metallic: 0,
      textureFiles: [],
    },
    caveats: [
      "Procedural material parameters support local fixture review only.",
      "Clinical realism and demographic representativeness require separate review before production use.",
    ],
  };
}

function buildClothingMeshProvenance(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.clothing-mesh-provenance.v1",
    kind: "clothing_mesh_provenance",
    generatedAt,
    source: "repo_authored_procedural_scrub_blockout",
    sourceRigArtifactPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
    externalAssetsUsed: false,
    productionAssetReadinessClaimed: false,
    clothingItems: [
      {
        itemId: "fixture_scrub_top",
        materialName: "reviewed_local_fixture_scrubs",
        meshStrategy: "blockout_geometry_embedded_in_neutral_generated_human_glb",
      },
      {
        itemId: "fixture_scrub_pants",
        materialName: "reviewed_local_fixture_scrubs",
        meshStrategy: "blockout_geometry_embedded_in_neutral_generated_human_glb",
      },
      {
        itemId: "fixture_clinical_shoes",
        materialName: "reviewed_local_fixture_shoes",
        meshStrategy: "blockout_geometry_embedded_in_neutral_generated_human_glb",
      },
    ],
  };
}

function buildRuntimeSafeMaterials(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.runtime-safe-materials.v1",
    kind: "runtime_safe_materials",
    generatedAt,
    targetRuntime: "Quest/WebXR local fixture",
    externalAssetsUsed: false,
    productionAssetReadinessClaimed: false,
    checks: {
      textureDownloadsRequired: false,
      transparentMaterialsUsed: false,
      shaderGraphDependencies: [],
      materialCountBudget: {
        observed: 3,
        targetMaximum: 8,
      },
    },
    caveats: [
      "This is a static inventory budget for the local fixture, not headset frame-pacing proof.",
      "Quest visual readiness still requires worn-headset capture and adversarial review.",
    ],
  };
}

function skinClothingArtifactPaths(outputRoot: string) {
  const absoluteOutputRoot = path.resolve(outputRoot);
  return {
    outputRoot: absoluteOutputRoot,
    skinTextureProvenance: path.join(absoluteOutputRoot, SKIN_TEXTURE_PROVENANCE_NAME),
    clothingMeshProvenance: path.join(absoluteOutputRoot, CLOTHING_MESH_PROVENANCE_NAME),
    runtimeSafeMaterials: path.join(absoluteOutputRoot, RUNTIME_SAFE_MATERIALS_NAME),
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    outputRoot: SKIN_CLOTHING_OUTPUT_DIR,
    reportPath: defaultSkinClothingProvenanceReportPath(),
    validateLatest: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--output-root") options.outputRoot = nextValue();
    else if (arg === "--report" || arg === "--output") options.reportPath = nextValue();
    else if (arg === "--validate") options.validatePath = nextValue();
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown skin/clothing provenance option: ${arg}`);
  }

  return options;
}

function skinClothingHelp(): string {
  return [
    "Usage: tsx tools/openclinxr/skin-clothing-provenance-artifacts.ts [options]",
    "",
    "Options:",
    "  --output-root <path>   Directory for skin/clothing provenance artifacts.",
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

function toRepoRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  runSkinClothingProvenanceCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
