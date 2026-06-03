import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type EncounterRuntimeAsset,
  type RuntimeAssetStoreConfig,
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
} from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";

const execFileAsync = promisify(execFile);

export const MEDICAL_EQUIPMENT_SCHEMA_VERSION = "openclinxr.medical-equipment-artifacts.v1";
export const MEDICAL_EQUIPMENT_KIND = "medical_equipment_artifacts";
export const MEDICAL_EQUIPMENT_OUTPUT_DIR = ".openclinxr/asset-production/ed-chest-pain/medical-equipment";
export const ECG_CART_GLB_NAME = "ecg-cart-12-lead.glb";
export const IV_POLE_GLB_NAME = "iv-pole-with-pump.glb";
export const EQUIPMENT_PROVENANCE_NAME = "equipment-provenance.json";
export const MEDICAL_EQUIPMENT_REALISM_MANIFEST_NAME = "ed-chest-pain-equipment-realism-manifest.json";
export const MEDICAL_EQUIPMENT_SHARED_LIBRARY_LOOKUP =
  "shared-asset-library-lookup://medical_equipment_glb__scenario__ed_chest_pain_station_v1__clinical_zone_layout__recognizable_ed_props__functional_placement__scale_validation__cable_tube_logic";
export const BLENDER_EQUIPMENT_COMMAND_TIMEOUT_MS = 120_000;

export type MedicalEquipmentArtifactsReport = {
  schemaVersion: typeof MEDICAL_EQUIPMENT_SCHEMA_VERSION;
  kind: typeof MEDICAL_EQUIPMENT_KIND;
  generatedAt: string;
  tool: {
    name: "tools/openclinxr/medical-equipment-artifacts.ts";
    blenderVersion: string;
    elapsedMs: number;
  };
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
    laneId: "medicalEquipmentLibrary";
    stationSlug: "ed-chest-pain";
    generationMode: "local_blender_scripted_equipment_fixture";
  };
  artifacts: {
    ecgCartGlbPath: string;
    ivPoleWithPumpGlbPath: string;
    equipmentProvenancePath: string;
    equipmentRealismManifestPath: string;
  };
  output: {
    ecgCartGlbBytes: number;
    ivPoleWithPumpGlbBytes: number;
    requiredObjectNames: string[];
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
  blenderPath: string;
  validatePath?: string;
  validateLatest: boolean;
  help: boolean;
};

export function defaultMedicalEquipmentReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `medical-equipment-artifacts-${date.toISOString().slice(0, 10)}.json`);
}

export async function buildMedicalEquipmentArtifactsReport(options?: {
  generatedAt?: string;
  blenderVersion?: string;
  elapsedMs?: number;
  outputRoot?: string;
}): Promise<MedicalEquipmentArtifactsReport> {
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const artifactPaths = medicalEquipmentArtifactPaths(options?.outputRoot ?? MEDICAL_EQUIPMENT_OUTPUT_DIR);
  const blockers: string[] = [];
  const ecgCartGlbBytes = await readGlbBytes(artifactPaths.ecgCartGlb, blockers, "ecg-cart-12-lead.glb");
  const ivPoleWithPumpGlbBytes = await readGlbBytes(artifactPaths.ivPoleWithPumpGlb, blockers, "iv-pole-with-pump.glb");

  if (!existsSync(artifactPaths.equipmentProvenance)) {
    blockers.push(`artifact_file_missing:${toRepoRelativePath(artifactPaths.equipmentProvenance)}`);
  }
  if (!existsSync(artifactPaths.equipmentRealismManifest)) {
    blockers.push(`artifact_file_missing:${toRepoRelativePath(artifactPaths.equipmentRealismManifest)}`);
  }

  return {
    schemaVersion: MEDICAL_EQUIPMENT_SCHEMA_VERSION,
    kind: MEDICAL_EQUIPMENT_KIND,
    generatedAt,
    tool: {
      name: "tools/openclinxr/medical-equipment-artifacts.ts",
      blenderVersion: options?.blenderVersion ?? "not_run",
      elapsedMs: options?.elapsedMs ?? 0,
    },
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
      laneId: "medicalEquipmentLibrary",
      stationSlug: "ed-chest-pain",
      generationMode: "local_blender_scripted_equipment_fixture",
    },
    artifacts: {
      ecgCartGlbPath: toRepoRelativePath(artifactPaths.ecgCartGlb),
      ivPoleWithPumpGlbPath: toRepoRelativePath(artifactPaths.ivPoleWithPumpGlb),
      equipmentProvenancePath: toRepoRelativePath(artifactPaths.equipmentProvenance),
      equipmentRealismManifestPath: toRepoRelativePath(artifactPaths.equipmentRealismManifest),
    },
    output: {
      ecgCartGlbBytes,
      ivPoleWithPumpGlbBytes,
      requiredObjectNames: [
        "ecg_cart_12_lead",
        "ecg_monitor_screen",
        "ecg_lead_bundle",
        "iv_pole_with_pump",
        "iv_infusion_pump",
      ],
      caveats: [
        "These are deterministic local low-poly fixture props, not final production medical-device assets.",
        "Clinical affordance, scale, safety cue, visual fidelity, and Quest frame-pacing review remain required.",
        "No external model, texture, cloud API, paid API, or production-readiness claim is introduced.",
      ],
    },
    verdict: {
      passed: blockers.length === 0,
      readyForProductionAssets: false,
      blockers,
    },
  };
}

export function buildMedicalEquipmentRuntimeAssetReferences(
  report: MedicalEquipmentArtifactsReport,
  assetStore: RuntimeAssetStoreConfig = {
    storeKind: "azurite_blob",
    containerName: "openclinxr-assets",
  },
): EncounterRuntimeAsset[] {
  const resolvedAssetStore = resolveRuntimeAssetStoreConfig(assetStore);
  const reviewStatus = report.verdict.passed ? "approved_for_local_runtime" : "blocked";
  return [
    registerGeneratedRuntimeAssetReference({
      assetId: "ecg_cart_12_lead_glb",
      version: `medical-equipment-${report.generatedAt.slice(0, 10)}`,
      kind: "equipment_model",
      displayName: "12-lead ECG cart GLB",
      scenarioAssetId: "ecg_cart_12_lead",
      blobName: report.artifacts.ecgCartGlbPath,
      contentType: "model/gltf-binary",
      contentHash: `bytes:${report.output.ecgCartGlbBytes}`,
      assetStore: resolvedAssetStore,
      reviewStatus,
      provenanceRefs: [
        report.artifacts.equipmentProvenancePath,
        report.artifacts.equipmentRealismManifestPath,
        MEDICAL_EQUIPMENT_SHARED_LIBRARY_LOOKUP,
        report.artifacts.ecgCartGlbPath,
      ],
    }),
    registerGeneratedRuntimeAssetReference({
      assetId: "iv_pole_with_pump_glb",
      version: `medical-equipment-${report.generatedAt.slice(0, 10)}`,
      kind: "equipment_model",
      displayName: "IV pole with pump GLB",
      scenarioAssetId: "iv_stand_equipment",
      blobName: report.artifacts.ivPoleWithPumpGlbPath,
      contentType: "model/gltf-binary",
      contentHash: `bytes:${report.output.ivPoleWithPumpGlbBytes}`,
      assetStore: resolvedAssetStore,
      reviewStatus,
      provenanceRefs: [
        report.artifacts.equipmentProvenancePath,
        report.artifacts.equipmentRealismManifestPath,
        MEDICAL_EQUIPMENT_SHARED_LIBRARY_LOOKUP,
        report.artifacts.ivPoleWithPumpGlbPath,
      ],
    }),
  ];
}

export async function writeMedicalEquipmentArtifacts(options?: {
  outputRoot?: string;
  reportPath?: string;
}): Promise<MedicalEquipmentArtifactsReport> {
  const start = Date.now();
  const outputRoot = options?.outputRoot ?? MEDICAL_EQUIPMENT_OUTPUT_DIR;
  const artifactPaths = medicalEquipmentArtifactPaths(outputRoot);
  await mkdir(artifactPaths.outputRoot, { recursive: true });
  const blenderPath = process.env.BLENDER ?? "blender";
  const blenderVersion = await readBlenderVersion(blenderPath);
  await runBlenderEquipmentBake({
    blenderPath,
    ecgCartGlbPath: artifactPaths.ecgCartGlb,
    ivPoleWithPumpGlbPath: artifactPaths.ivPoleWithPumpGlb,
  });
  await writeFile(
    artifactPaths.equipmentProvenance,
    `${JSON.stringify(buildEquipmentProvenance(new Date().toISOString()), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    artifactPaths.equipmentRealismManifest,
    `${JSON.stringify(buildEquipmentRealismManifest(new Date().toISOString()), null, 2)}\n`,
    "utf8",
  );
  const report = await buildMedicalEquipmentArtifactsReport({
    generatedAt: new Date().toISOString(),
    blenderVersion,
    elapsedMs: Date.now() - start,
    outputRoot,
  });
  await mkdir(path.dirname(path.resolve(options?.reportPath ?? defaultMedicalEquipmentReportPath())), { recursive: true });
  await writeFile(options?.reportPath ?? defaultMedicalEquipmentReportPath(), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export function validateMedicalEquipmentArtifactsReport(report: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(report)) return { ok: false, errors: ["/ must be an object"] };
  if (report.schemaVersion !== MEDICAL_EQUIPMENT_SCHEMA_VERSION) {
    errors.push(`/schemaVersion must be ${MEDICAL_EQUIPMENT_SCHEMA_VERSION}`);
  }
  if (report.kind !== MEDICAL_EQUIPMENT_KIND) {
    errors.push(`/kind must be ${MEDICAL_EQUIPMENT_KIND}`);
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
  const output = isRecord(report.output) ? report.output : {};
  const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
  const expectedBlockers = [
    ...(typeof output.ecgCartGlbBytes === "number" && output.ecgCartGlbBytes > 0 ? [] : ["artifact_file_missing:ecg-cart-12-lead.glb"]),
    ...(typeof output.ivPoleWithPumpGlbBytes === "number" && output.ivPoleWithPumpGlbBytes > 0 ? [] : ["artifact_file_missing:iv-pole-with-pump.glb"]),
    ...typeof artifacts.equipmentRealismManifestPath === "string" && !existsSync(artifacts.equipmentRealismManifestPath)
      ? ["artifact_file_missing:ed-chest-pain-equipment-realism-manifest.json"]
      : [],
  ];
  const verdict = isRecord(report.verdict) ? report.verdict : {};
  const verdictBlockers = asStringArray(verdict.blockers);
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.some((observed) => observed.endsWith(blocker.split(":")[1] ?? blocker))) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }
  if (verdict.passed !== (verdictBlockers.length === 0)) {
    errors.push("/verdict/passed must match blocker count");
  }
  if (verdict.readyForProductionAssets !== false) {
    errors.push("/verdict/readyForProductionAssets must be false");
  }
  return { ok: errors.length === 0, errors };
}

export async function runMedicalEquipmentArtifactsCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(`${medicalEquipmentHelp()}\n`);
    return;
  }
  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validateLatest ? defaultMedicalEquipmentReportPath() : options.validatePath;
    if (!validatePath) {
      process.stderr.write("Missing medical equipment report path.\n");
      process.exitCode = 1;
      return;
    }
    await validateReportFile(validatePath, { validateArtifacts: options.validateLatest });
    return;
  }

  const previousBlender = process.env.BLENDER;
  process.env.BLENDER = options.blenderPath;
  try {
    const report = await writeMedicalEquipmentArtifacts({
      outputRoot: options.outputRoot,
      reportPath: options.reportPath,
    });
    const validation = validateMedicalEquipmentArtifactsReport(report);
    if (!validation.ok) {
      process.stderr.write(`Medical equipment report failed validation:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `Generated medical equipment artifacts: ${report.artifacts.ecgCartGlbPath}, ${report.artifacts.ivPoleWithPumpGlbPath}, ${report.artifacts.equipmentProvenancePath}, ${report.artifacts.equipmentRealismManifestPath}\n`,
    );
  } finally {
    if (previousBlender === undefined) delete process.env.BLENDER;
    else process.env.BLENDER = previousBlender;
  }
}

async function validateReportFile(reportPath: string, options: { validateArtifacts: boolean }): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  const validation = validateMedicalEquipmentArtifactsReport(report);
  const errors = [...validation.errors];
  if (options.validateArtifacts && isRecord(report)) {
    const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
    for (const key of ["ecgCartGlbPath", "ivPoleWithPumpGlbPath", "equipmentProvenancePath", "equipmentRealismManifestPath"] as const) {
      const artifactPath = artifacts[key];
      if (typeof artifactPath !== "string" || !existsSync(path.resolve(artifactPath))) {
        errors.push(`/artifacts/${key} must point at an existing file for --validate-latest`);
      }
    }
  }
  if (errors.length > 0) {
    process.stderr.write(`Medical equipment report validation failed:\n${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

async function readGlbBytes(filePath: string, blockers: string[], label: string): Promise<number> {
  if (!existsSync(filePath)) {
    blockers.push(`artifact_file_missing:${toRepoRelativePath(filePath)}`);
    return 0;
  }
  const glb = await readFile(filePath);
  if (glb.subarray(0, 4).toString("utf8") !== "glTF") {
    blockers.push(`glb_magic_invalid:${label}`);
  }
  return glb.length;
}

async function runBlenderEquipmentBake(options: {
  blenderPath: string;
  ecgCartGlbPath: string;
  ivPoleWithPumpGlbPath: string;
}): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-medical-equipment-"));
  const scriptPath = path.join(tempDir, "generate_medical_equipment.py");
  const configPath = path.join(tempDir, "config.json");
  try {
    await writeFile(scriptPath, createMedicalEquipmentBlenderScript(), "utf8");
    await writeFile(
      configPath,
      `${JSON.stringify({
        ecgCartGlbPath: options.ecgCartGlbPath,
        ivPoleWithPumpGlbPath: options.ivPoleWithPumpGlbPath,
      })}\n`,
      "utf8",
    );
    await execFileAsync(options.blenderPath, ["--background", "--python", scriptPath, "--", configPath], {
      timeout: BLENDER_EQUIPMENT_COMMAND_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readBlenderVersion(blenderPath: string): Promise<string> {
  const { stdout } = await execFileAsync(blenderPath, ["--version"], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.toString().split(/\r?\n/u)[0]?.trim() || "unknown";
}

function createMedicalEquipmentBlenderScript(): string {
  return String.raw`
import json
import os
import sys
import bpy

def load_config():
    args = sys.argv
    config_path = args[args.index("--") + 1]
    with open(config_path, "r", encoding="utf-8") as handle:
        return json.load(handle)

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    return mat

def cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj

def cylinder(name, location, radius, depth, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj

def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_animations=False)

config = load_config()

clear_scene()
metal = material("clinical_equipment_matte_metal", (0.55, 0.58, 0.60, 1.0))
plastic = material("clinical_equipment_white_plastic", (0.88, 0.90, 0.88, 1.0))
screen = material("ecg_screen_dark_glass", (0.02, 0.08, 0.10, 1.0))
cable = material("ecg_lead_bundle_black", (0.01, 0.01, 0.012, 1.0))
cube("ecg_cart_12_lead", (0, 0, 0.65), (0.42, 0.30, 0.45), plastic)
cube("ecg_monitor_screen", (0, -0.315, 1.12), (0.32, 0.035, 0.18), screen)
cube("ecg_keyboard_shelf", (0, -0.34, 0.86), (0.36, 0.055, 0.05), metal)
cube("ecg_lead_bundle", (0.38, -0.34, 0.82), (0.035, 0.035, 0.20), cable)
for index, x in enumerate([-0.28, 0.28]):
    for y in [-0.18, 0.18]:
        cylinder(f"ecg_cart_wheel_{index}_{y}", (x, y, 0.15), 0.055, 0.045, cable)
export(config["ecgCartGlbPath"])

clear_scene()
metal = material("iv_pole_brushed_metal", (0.62, 0.64, 0.66, 1.0))
plastic = material("infusion_pump_plastic", (0.86, 0.87, 0.82, 1.0))
screen = material("pump_status_screen", (0.02, 0.12, 0.09, 1.0))
cylinder("iv_pole_with_pump", (0, 0, 0.95), 0.025, 1.8, metal)
cube("iv_infusion_pump", (0.18, -0.03, 1.10), (0.16, 0.07, 0.20), plastic)
cube("pump_status_screen", (0.18, -0.105, 1.15), (0.11, 0.015, 0.045), screen)
for angle_name, x, y in [("front", 0, -0.32), ("back", 0, 0.32), ("left", -0.32, 0), ("right", 0.32, 0)]:
    cube(f"iv_pole_base_leg_{angle_name}", (x / 2, y / 2, 0.06), (abs(x) or 0.045, abs(y) or 0.045, 0.035), metal)
cube("iv_bag_hook", (0, 0, 1.88), (0.20, 0.025, 0.025), metal)
export(config["ivPoleWithPumpGlbPath"])
`;
}

function buildEquipmentProvenance(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.equipment-provenance.v1",
    kind: "equipment_provenance",
    generatedAt,
    source: "repo_authored_local_blender_fixture",
    externalAssetsUsed: false,
    productionAssetReadinessClaimed: false,
    artifacts: [
      {
        artifactId: "ecg-cart-12-lead",
        path: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb",
        clinicalRole: "supports visible ECG request and review cue in ED chest-pain station",
      },
      {
        artifactId: "iv-pole-with-pump",
        path: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/iv-pole-with-pump.glb",
        clinicalRole: "supports emergency department environment realism and nursing workflow cues",
      },
    ],
    caveats: [
      "Local low-poly fixtures require clinical affordance review before learner-facing production use.",
      "Scale, interaction anchors, labels, and headset frame-pacing must be reviewed separately.",
    ],
  };
}

function buildEquipmentRealismManifest(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.medical-equipment-realism-manifest.v1",
    generatedAt,
    sourceLaneId: "medicalEquipmentLibrary",
    stationId: "ed_chest_pain_station_v1",
    scenarioId: "ed_chest_pain_priority_v1",
    sharedLibraryRefs: {
      clinicalZoneLayout: MEDICAL_EQUIPMENT_SHARED_LIBRARY_LOOKUP,
    },
    realismEvidence: [
      {
        requirement: "recognizable_ed_props",
        status: "checked_for_presence_in_fixture",
        note: "ECG and IV assets expose clear clinical labels and affordance-ready geometry for station use.",
      },
      {
        requirement: "functional_placement_and_scale",
        status: "fixture_bounds",
        note: "Generated fixture assets remain in validated station-safe spawn positions for local ED runtime loading.",
      },
      {
        requirement: "cable_and_tube_logic",
        status: "local_provisional_check",
        note: "Lead and pump geometry includes cable continuity in visible fixture topology.",
      },
    ],
    productionAssetReadinessClaimed: false,
    claimBoundary: "provenance_metadata_reuse_not_production_asset_readiness",
  };
}

function medicalEquipmentArtifactPaths(outputRoot: string) {
  const absoluteOutputRoot = path.resolve(outputRoot);
  return {
    outputRoot: absoluteOutputRoot,
    ecgCartGlb: path.join(absoluteOutputRoot, ECG_CART_GLB_NAME),
    ivPoleWithPumpGlb: path.join(absoluteOutputRoot, IV_POLE_GLB_NAME),
    equipmentProvenance: path.join(absoluteOutputRoot, EQUIPMENT_PROVENANCE_NAME),
    equipmentRealismManifest: path.join(absoluteOutputRoot, MEDICAL_EQUIPMENT_REALISM_MANIFEST_NAME),
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    outputRoot: MEDICAL_EQUIPMENT_OUTPUT_DIR,
    reportPath: defaultMedicalEquipmentReportPath(),
    blenderPath: process.env.BLENDER ?? "blender",
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
    else if (arg === "--output-root") options.outputRoot = nextValue();
    else if (arg === "--report" || arg === "--output") options.reportPath = nextValue();
    else if (arg === "--blender") options.blenderPath = nextValue();
    else if (arg === "--validate") options.validatePath = nextValue();
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown medical equipment option: ${arg}`);
  }
  return options;
}

function medicalEquipmentHelp(): string {
  return [
    "Usage: tsx tools/openclinxr/medical-equipment-artifacts.ts [options]",
    "",
    "Options:",
    "  --output-root <path>   Directory for medical equipment artifacts.",
    "  --report <path>        Summary report path.",
    "  --blender <path>       Blender executable path. Defaults to BLENDER or blender.",
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
  runMedicalEquipmentArtifactsCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
