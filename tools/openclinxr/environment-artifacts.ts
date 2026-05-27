import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
  type EncounterRuntimeAsset,
  type RuntimeAssetStoreConfig,
} from "../../packages/openclinxr/asset-registry/src/runtime-bundles.js";

const execFileAsync = promisify(execFile);

export const ENVIRONMENT_ARTIFACTS_SCHEMA_VERSION = "openclinxr.environment-artifacts.v1";
export const ENVIRONMENT_ARTIFACTS_KIND = "environment_artifacts";
export const ENVIRONMENT_ARTIFACTS_OUTPUT_DIR = ".openclinxr/asset-production/ed-chest-pain/environment";
export const ENVIRONMENT_LAYOUT_NAME = "ed-exam-bay-layout.json";
export const EQUIPMENT_PLACEMENT_NAME = "equipment-placement-manifest.json";
export const QUEST_BUDGET_NAME = "quest-environment-budget.json";
export const ED_EXAM_BAY_GLB_NAME = "ed-exam-bay-shell.glb";
export const BLENDER_ENVIRONMENT_COMMAND_TIMEOUT_MS = 120_000;

export type EnvironmentArtifactsReport = {
  schemaVersion: typeof ENVIRONMENT_ARTIFACTS_SCHEMA_VERSION;
  kind: typeof ENVIRONMENT_ARTIFACTS_KIND;
  generatedAt: string;
  tool: {
    name: "tools/openclinxr/environment-artifacts.ts";
  };
  policy: {
    localOnly: true;
    installsIntroduced: false;
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: false;
    generatedThirdPartyAssetsCommitted: false;
    productionAssetReadinessClaimed: false;
    questReadinessClaimed: false;
  };
  input: {
    laneId: "environmentShell";
    stationSlug: "ed-chest-pain";
    workOrderId: "environment_work_order:ed_chest_pain_priority_v1:ed_exam_bay_environment";
    generationMode: "repo_authored_environment_layout_evidence_bundle";
  };
  artifacts: {
    edExamBayShellGlbPath: string;
    layoutManifestPath: string;
    equipmentPlacementManifestPath: string;
    questBudgetPath: string;
  };
  output: {
    edExamBayShellGlbBytes: number;
    spatialZoneCount: number;
    equipmentPlacementCount: number;
    interactionAnchorCount: number;
    environmentRealismCueCount: number;
    caveats: string[];
  };
  verdict: {
    passed: boolean;
    readyForProductionEnvironment: false;
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

export function defaultEnvironmentArtifactsReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `environment-artifacts-${date.toISOString().slice(0, 10)}.json`);
}

export async function writeEnvironmentArtifacts(options?: {
  outputRoot?: string;
  reportPath?: string;
}): Promise<EnvironmentArtifactsReport> {
  const outputRoot = options?.outputRoot ?? ENVIRONMENT_ARTIFACTS_OUTPUT_DIR;
  const artifactPaths = environmentArtifactPaths(outputRoot);
  const generatedAt = new Date().toISOString();
  await mkdir(artifactPaths.outputRoot, { recursive: true });
  await runBlenderEnvironmentBake({
    blenderPath: process.env.BLENDER ?? "blender",
    edExamBayShellGlbPath: artifactPaths.edExamBayShellGlb,
  });
  await writeFile(artifactPaths.layoutManifest, `${JSON.stringify(buildEnvironmentLayoutManifest(generatedAt), null, 2)}\n`, "utf8");
  await writeFile(artifactPaths.equipmentPlacementManifest, `${JSON.stringify(buildEquipmentPlacementManifest(generatedAt), null, 2)}\n`, "utf8");
  await writeFile(artifactPaths.questBudget, `${JSON.stringify(buildQuestBudget(generatedAt), null, 2)}\n`, "utf8");
  const report = await buildEnvironmentArtifactsReport({ generatedAt, outputRoot });
  const reportPath = options?.reportPath ?? defaultEnvironmentArtifactsReportPath();
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function buildEnvironmentArtifactsReport(options?: {
  generatedAt?: string;
  outputRoot?: string;
}): Promise<EnvironmentArtifactsReport> {
  const artifactPaths = environmentArtifactPaths(options?.outputRoot ?? ENVIRONMENT_ARTIFACTS_OUTPUT_DIR);
  const blockers = [
    ...missingArtifactBlockers({
      layoutManifestPath: artifactPaths.layoutManifest,
      equipmentPlacementManifestPath: artifactPaths.equipmentPlacementManifest,
      questBudgetPath: artifactPaths.questBudget,
      edExamBayShellGlbPath: artifactPaths.edExamBayShellGlb,
    }),
  ];
  const layout = await readOptionalJson<Record<string, unknown>>(artifactPaths.layoutManifest);
  const placements = await readOptionalJson<Record<string, unknown>>(artifactPaths.equipmentPlacementManifest);
  const zones = Array.isArray(layout?.spatialZones) ? layout.spatialZones : [];
  const equipment = Array.isArray(placements?.equipmentPlacements) ? placements.equipmentPlacements : [];
  const anchors = zones.flatMap((zone) => isRecord(zone) && Array.isArray(zone.interactionAnchors) ? zone.interactionAnchors : []);
  const realismCueCount = equipment.length + anchors.length;

  return {
    schemaVersion: ENVIRONMENT_ARTIFACTS_SCHEMA_VERSION,
    kind: ENVIRONMENT_ARTIFACTS_KIND,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    tool: {
      name: "tools/openclinxr/environment-artifacts.ts",
    },
    policy: {
      localOnly: true,
      installsIntroduced: false,
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      generatedThirdPartyAssetsCommitted: false,
      productionAssetReadinessClaimed: false,
      questReadinessClaimed: false,
    },
    input: {
      laneId: "environmentShell",
      stationSlug: "ed-chest-pain",
      workOrderId: "environment_work_order:ed_chest_pain_priority_v1:ed_exam_bay_environment",
      generationMode: "repo_authored_environment_layout_evidence_bundle",
    },
    artifacts: {
      edExamBayShellGlbPath: toRepoRelativePath(artifactPaths.edExamBayShellGlb),
      layoutManifestPath: toRepoRelativePath(artifactPaths.layoutManifest),
      equipmentPlacementManifestPath: toRepoRelativePath(artifactPaths.equipmentPlacementManifest),
      questBudgetPath: toRepoRelativePath(artifactPaths.questBudget),
    },
    output: {
      edExamBayShellGlbBytes: await readGlbBytes(artifactPaths.edExamBayShellGlb, blockers, ED_EXAM_BAY_GLB_NAME),
      spatialZoneCount: zones.length,
      equipmentPlacementCount: equipment.length,
      interactionAnchorCount: anchors.length,
      environmentRealismCueCount: realismCueCount,
      caveats: [
        "This is a deterministic local environment evidence bundle, not a final generated room mesh.",
        "Clinical visual review, scale review, Quest worn-headset evidence, and GLB optimization remain required.",
        "No external asset, cloud API, paid API, production-readiness, or Quest-readiness claim is introduced.",
      ],
    },
    verdict: {
      passed: blockers.length === 0,
      readyForProductionEnvironment: false,
      blockers,
    },
  };
}

export function buildEnvironmentRuntimeAssetReference(
  report: EnvironmentArtifactsReport,
  assetStore: RuntimeAssetStoreConfig = {
    storeKind: "azurite_blob",
    containerName: "openclinxr-assets",
  },
): EncounterRuntimeAsset {
  const resolvedAssetStore = resolveRuntimeAssetStoreConfig(assetStore);
  return registerGeneratedRuntimeAssetReference({
    assetId: "ed_exam_bay_environment_shell_glb",
    version: `environment-${report.generatedAt.slice(0, 10)}`,
    kind: "environment_model",
    displayName: "ED exam bay environment shell GLB",
    scenarioAssetId: "ed_exam_bay_environment",
    blobName: report.artifacts.edExamBayShellGlbPath,
    contentType: "model/gltf-binary",
    contentHash: `bytes:${report.output.edExamBayShellGlbBytes}`,
    assetStore: resolvedAssetStore,
    reviewStatus: report.verdict.passed ? "approved_for_local_runtime" : "blocked",
    provenanceRefs: [
      report.artifacts.layoutManifestPath,
      report.artifacts.equipmentPlacementManifestPath,
      report.artifacts.questBudgetPath,
      report.artifacts.edExamBayShellGlbPath,
    ],
  });
}

export function validateEnvironmentArtifactsReport(report: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(report)) return { ok: false, errors: ["/ must be an object"] };
  if (report.schemaVersion !== ENVIRONMENT_ARTIFACTS_SCHEMA_VERSION) {
    errors.push(`/schemaVersion must be ${ENVIRONMENT_ARTIFACTS_SCHEMA_VERSION}`);
  }
  if (report.kind !== ENVIRONMENT_ARTIFACTS_KIND) {
    errors.push(`/kind must be ${ENVIRONMENT_ARTIFACTS_KIND}`);
  }
  const policy = isRecord(report.policy) ? report.policy : {};
  for (const key of [
    "installsIntroduced",
    "cloudApisUsed",
    "paidApisUsed",
    "externalAssetsUsed",
    "generatedThirdPartyAssetsCommitted",
    "productionAssetReadinessClaimed",
    "questReadinessClaimed",
  ] as const) {
    if (policy[key] !== false) errors.push(`/policy/${key} must be false`);
  }
  const output = isRecord(report.output) ? report.output : {};
  if (!isPositiveInteger(output.edExamBayShellGlbBytes)) errors.push("/output/edExamBayShellGlbBytes must be a positive integer");
  if (!isPositiveInteger(output.spatialZoneCount)) errors.push("/output/spatialZoneCount must be a positive integer");
  if (!isPositiveInteger(output.equipmentPlacementCount)) errors.push("/output/equipmentPlacementCount must be a positive integer");
  if (!isPositiveInteger(output.interactionAnchorCount)) errors.push("/output/interactionAnchorCount must be a positive integer");
  if (!isPositiveInteger(output.environmentRealismCueCount)) errors.push("/output/environmentRealismCueCount must be a positive integer");
  const verdict = isRecord(report.verdict) ? report.verdict : {};
  const blockers = asStringArray(verdict.blockers);
  if (verdict.passed !== (blockers.length === 0)) errors.push("/verdict/passed must match blocker count");
  if (verdict.readyForProductionEnvironment !== false) errors.push("/verdict/readyForProductionEnvironment must be false");
  return { ok: errors.length === 0, errors };
}

export async function runEnvironmentArtifactsCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(`${environmentArtifactsHelp()}\n`);
    return;
  }
  if (options.validateLatest || options.validatePath) {
    await validateReportFile(options.validateLatest ? defaultEnvironmentArtifactsReportPath() : options.validatePath);
    return;
  }
  const report = await writeEnvironmentArtifacts({ outputRoot: options.outputRoot, reportPath: options.reportPath });
  const validation = validateEnvironmentArtifactsReport(report);
  if (!validation.ok) {
    process.stderr.write(`Environment artifacts report failed validation:\n${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Generated environment artifacts: ${report.artifacts.edExamBayShellGlbPath}, ${report.artifacts.layoutManifestPath}, ${report.artifacts.equipmentPlacementManifestPath}, ${report.artifacts.questBudgetPath}\n`);
}

async function validateReportFile(reportPath: string | undefined): Promise<void> {
  if (!reportPath) {
    process.stderr.write("Missing environment artifacts report path.\n");
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  const validation = validateEnvironmentArtifactsReport(report);
  const errors = [...validation.errors];
  if (isRecord(report)) {
    const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
    for (const key of ["edExamBayShellGlbPath", "layoutManifestPath", "equipmentPlacementManifestPath", "questBudgetPath"] as const) {
      const artifactPath = artifacts[key];
      if (typeof artifactPath !== "string" || !existsSync(path.resolve(artifactPath))) {
        errors.push(`/artifacts/${key} must point at an existing file`);
      }
    }
  }
  if (errors.length > 0) {
    process.stderr.write(`Environment artifacts report validation failed:\n${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

function buildEnvironmentLayoutManifest(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.environment-layout.v1",
    generatedAt,
    scenarioId: "ed_chest_pain_priority_v1",
    environmentAssetId: "ed_exam_bay_environment",
    units: "meters",
    spatialZones: [
      zone("doorway_threshold", "Learner entry point with station orientation sightline.", { x: 0, y: 0, z: 2.8 }, ["entry_prompt", "timer_glance"]),
      zone("patient_bedside", "Primary interaction zone at Robert Hayes's stretcher.", { x: 0, y: 0, z: 0 }, ["patient_dialogue", "pain_assessment", "focused_exam"]),
      zone("nurse_workflow", "Nurse workflow lane for ECG request and escalation.", { x: -1.4, y: 0, z: -0.2 }, ["nurse_interrupt", "ecg_handoff"]),
      zone("family_side_chair", "Spouse position for concern escalation and collateral history.", { x: 1.45, y: 0, z: 0.45 }, ["family_interruption", "shared_decision"]),
      zone("equipment_wall", "Monitor, ECG cart, IV pump, and safety equipment cluster.", { x: -1.8, y: 0, z: -1.1 }, ["monitor_read", "equipment_request"]),
      zone("clinical_supplies", "Supply and disposal zone with gloves, drawers, trash, sharps, and hand hygiene cues.", { x: -2.05, y: 0, z: 1.05 }, ["glove_selection", "hand_hygiene", "sharps_safety"]),
      zone("ambient_safety", "Environmental stress cue zone for alarms, curtain sightline, lighting, and room signage.", { x: 1.95, y: 0, z: -0.55 }, ["alarm_awareness", "privacy_curtain", "room_identification"]),
      zone("environmental_texture", "Low-cost visual realism cues for floor wear, infection control signage, handoff board, supply labels, and privacy tape.", { x: -0.45, y: 0, z: 0.95 }, ["floor_traffic_wear", "infection_control_signage", "handoff_board_review", "privacy_zone_boundary", "supply_label_scan"]),
    ],
    claimBoundary: "layout_manifest_not_generated_mesh_or_quest_readiness",
  };
}

function buildEquipmentPlacementManifest(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.equipment-placement.v1",
    generatedAt,
    scenarioId: "ed_chest_pain_priority_v1",
    equipmentPlacements: [
      placement("stretcher-bed", "ed_stretcher_bed_equipment", { x: 0, y: 0, z: 0 }, 0, "patient_bedside"),
      placement("bedside-monitor", "bedside_monitor_equipment", { x: -0.85, y: 1.15, z: -0.75 }, 0.25, "equipment_wall"),
      placement("ecg-cart-12-lead", "ecg_cart_equipment", { x: -1.45, y: 0, z: 0.65 }, 0.3, "nurse_workflow"),
      placement("iv-pole-with-pump", "iv_stand_equipment", { x: 0.82, y: 0, z: -0.62 }, -0.15, "patient_bedside"),
      placement("family-side-chair", "family_chair_context", { x: 1.45, y: 0, z: 0.45 }, -0.45, "family_side_chair"),
      placement("oxygen-flowmeter-panel", "oxygen_panel_context", { x: 1.85, y: 1.35, z: -1.46 }, 0, "equipment_wall"),
      placement("wall-glove-boxes", "glove_box_context", { x: -2.15, y: 1.38, z: 0.55 }, 1.57, "clinical_supplies"),
      placement("biohazard-trash-bin", "biohazard_bin_context", { x: -2.08, y: 0, z: 0.72 }, 0, "clinical_supplies"),
      placement("privacy-curtain-track", "privacy_curtain_context", { x: 2.18, y: 1.12, z: 0.25 }, 0, "ambient_safety"),
      placement("ceiling-exam-light", "ceiling_exam_light_context", { x: 0.45, y: 2.05, z: -0.35 }, 0, "ambient_safety"),
      placement("floor-scuff-path", "floor_wear_context", { x: -0.18, y: 0, z: 0.62 }, 0.05, "environmental_texture"),
      placement("infection-control-sign", "infection_control_sign_context", { x: -2.18, y: 1.55, z: 1.28 }, 1.57, "environmental_texture"),
      placement("patient-handoff-whiteboard", "handoff_whiteboard_context", { x: -1.15, y: 1.52, z: -1.42 }, 0, "environmental_texture"),
      placement("supply-drawer-labels", "supply_label_context", { x: -1.78, y: 0.82, z: 1.24 }, 0, "environmental_texture"),
      placement("privacy-zone-floor-tape", "privacy_zone_floor_tape_context", { x: 0.82, y: 0, z: 1.08 }, 0, "environmental_texture"),
      placement("monitor-vitals-badge", "monitor_escalation_status_badge_context", { x: -0.5, y: 1.36, z: -0.82 }, 0, "equipment_wall"),
      placement("ecg-paper-strip", "ecg_paper_strip_context", { x: 1.35, y: 0.86, z: 0.28 }, 0, "nurse_workflow"),
      placement("nurse-task-tray", "nurse_task_tray_context", { x: 1.08, y: 0.9, z: 0.72 }, 0, "nurse_workflow"),
      placement("doorway-escalation-badge", "doorway_escalation_badge_context", { x: -0.62, y: 1.9, z: 1.86 }, 0, "ambient_safety"),
      placement("monitor-lead-cable", "monitor_lead_cable_context", { x: -0.52, y: 0.76, z: -0.42 }, 0, "equipment_wall"),
      placement("bed-wheel-locks", "bed_wheel_lock_context", { x: -0.82, y: 0.2, z: 0.82 }, 0, "patient_bedside"),
      placement("curtain-track-rings", "curtain_track_ring_context", { x: 2.12, y: 1.98, z: 0.25 }, 0, "ambient_safety"),
      placement("trash-liner-fold", "biohazard_trash_liner_context", { x: -2.04, y: 0.56, z: 0.85 }, 0, "clinical_supplies"),
      placement("iv-tubing-line", "iv_tubing_line_context", { x: 0.75, y: 1.05, z: 0.54 }, 0, "patient_bedside"),
    ],
    clinicalCueCoverage: [
      "ECG request is spatially supported by visible ECG cart near nurse workflow lane.",
      "IV pump and monitor remain visible from learner bedside stance.",
      "Spouse location supports interruption pressure without blocking patient access.",
    ],
    claimBoundary: "equipment_placement_manifest_not_collision_or_scale_certification",
  };
}

function buildQuestBudget(generatedAt: string) {
  return {
    schemaVersion: "openclinxr.quest-environment-budget.v1",
    generatedAt,
    targetRuntime: "quest3_webxr",
    budgetClass: "local_fixture_budget_not_measured_on_headset",
    limits: {
      maxEnvironmentTriangles: 20_000,
      maxStaticTextureMegabytes: 24,
      maxDynamicLights: 1,
      preferBakedLighting: true,
      colliderStrategy: "primitive_zone_colliders",
    },
    currentBundleEstimate: {
      environmentTriangles: 680,
      staticTextureMegabytes: 0,
      dynamicLights: 1,
      generatedMeshPresent: true,
    },
    blockedClaims: [
      "quest_frame_pacing",
      "production_environment_readiness",
      "clinical_visual_validity",
    ],
  };
}

async function runBlenderEnvironmentBake(options: {
  blenderPath: string;
  edExamBayShellGlbPath: string;
}): Promise<void> {
  const script = createEnvironmentBlenderScript(options.edExamBayShellGlbPath);
  const scriptPath = path.join(ENVIRONMENT_ARTIFACTS_OUTPUT_DIR, "generate-ed-exam-bay-shell.py");
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, script, "utf8");
  await execFileAsync(options.blenderPath, ["--background", "--python", scriptPath], {
    timeout: BLENDER_ENVIRONMENT_COMMAND_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function createEnvironmentBlenderScript(outputPath: string): string {
  return String.raw`
import os
import bpy

output_path = ${JSON.stringify(path.resolve(outputPath))}

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

clear_scene()
floor_mat = material("ed_bay_warm_gray_floor", (0.45, 0.47, 0.48, 1.0))
wall_mat = material("ed_bay_soft_blue_wall", (0.70, 0.78, 0.84, 1.0))
rail_mat = material("clinical_wall_rail", (0.88, 0.88, 0.82, 1.0))
equipment_mat = material("clinical_equipment_context", (0.82, 0.86, 0.88, 1.0))
accent_red_mat = material("safety_red_cues", (0.86, 0.18, 0.13, 1.0))
linen_mat = material("privacy_curtain_blue_linen", (0.34, 0.62, 0.74, 0.9))
light_mat = material("warm_exam_light_panel", (1.0, 0.92, 0.66, 1.0))
mattress_mat = material("stretcher_mattress_blue_gray", (0.66, 0.76, 0.84, 1.0))
metal_mat = material("brushed_clinical_metal", (0.72, 0.74, 0.72, 1.0))
screen_mat = material("monitor_dark_screen_with_waveform", (0.02, 0.06, 0.08, 1.0))
paper_mat = material("case_note_paper", (0.96, 0.90, 0.72, 1.0))
sign_mat = material("infection_control_and_handoff_signage", (0.92, 0.98, 0.96, 1.0))
scuff_mat = material("subtle_floor_scuff_wear", (0.30, 0.32, 0.33, 0.32))
tape_mat = material("privacy_zone_floor_tape_yellow", (0.92, 0.74, 0.22, 0.55))
zone_mat = material("subtle_interaction_zone_markers", (0.25, 0.55, 0.70, 0.35))
cube("ed_exam_bay_floor", (0, -0.03, 0), (2.4, 0.03, 1.8), floor_mat)
cube("ed_exam_bay_back_wall", (0, 1.05, -1.8), (2.4, 1.05, 0.04), wall_mat)
cube("ed_exam_bay_left_wall", (-2.4, 1.05, 0), (0.04, 1.05, 1.8), wall_mat)
cube("ed_exam_bay_headwall_rail", (-0.25, 1.05, -1.72), (1.5, 0.035, 0.035), rail_mat)
cube("ed_exam_bay_doorway_threshold", (0, 0.01, 1.75), (0.75, 0.012, 0.035), zone_mat)
cube("ed_exam_bay_patient_zone_marker", (0, 0.012, 0), (0.85, 0.012, 0.55), zone_mat)
cube("ed_exam_bay_nurse_zone_marker", (-1.35, 0.014, -0.2), (0.38, 0.012, 0.55), zone_mat)
cube("ed_exam_bay_family_zone_marker", (1.35, 0.014, 0.45), (0.38, 0.012, 0.38), zone_mat)
cube("ed_exam_bay_equipment_wall_marker", (-1.75, 0.016, -1.08), (0.38, 0.012, 0.42), zone_mat)
cube("ed_exam_bay_oxygen_flowmeter_panel", (1.72, 1.22, -1.71), (0.24, 0.18, 0.035), equipment_mat)
cube("ed_exam_bay_suction_canister", (1.26, 1.02, -1.69), (0.09, 0.16, 0.055), equipment_mat)
cube("ed_exam_bay_glove_box_stack", (-2.33, 1.34, 0.62), (0.035, 0.24, 0.32), equipment_mat)
cube("ed_exam_bay_biohazard_bin", (-2.18, 0.34, 0.88), (0.18, 0.28, 0.20), accent_red_mat)
cube("ed_exam_bay_sharps_wall_box", (-2.31, 0.82, -0.95), (0.035, 0.18, 0.16), accent_red_mat)
cube("ed_exam_bay_privacy_curtain_panel", (2.22, 1.12, 0.18), (0.025, 0.88, 1.18), linen_mat)
cube("ed_exam_bay_ceiling_exam_light", (0.45, 2.08, -0.36), (0.48, 0.025, 0.22), light_mat)
cube("ed_exam_bay_wall_clock", (0.92, 1.58, -1.74), (0.16, 0.16, 0.025), equipment_mat)
cube("ed_exam_bay_stretcher_base", (0, 0.28, 0), (0.78, 0.08, 1.02), metal_mat)
cube("ed_exam_bay_stretcher_mattress", (0, 0.48, 0), (0.72, 0.12, 0.95), mattress_mat)
cube("ed_exam_bay_stretcher_left_rail", (-0.78, 0.72, 0), (0.035, 0.18, 0.88), metal_mat)
cube("ed_exam_bay_stretcher_right_rail", (0.78, 0.72, 0), (0.035, 0.18, 0.88), metal_mat)
cube("ed_exam_bay_bed_pillow", (0, 0.62, -0.68), (0.42, 0.08, 0.2), paper_mat)
cube("ed_exam_bay_bed_blanket_fold", (0.16, 0.64, 0.18), (0.48, 0.035, 0.48), mattress_mat)
cube("ed_exam_bay_monitor_screen", (-0.88, 1.34, -0.86), (0.28, 0.16, 0.025), screen_mat)
cube("ed_exam_bay_monitor_waveform_line", (-0.88, 1.36, -0.825), (0.22, 0.012, 0.01), light_mat)
cube("ed_exam_bay_case_notes_clipboard", (1.12, 0.84, 1.04), (0.22, 0.025, 0.32), paper_mat)
cube("ed_exam_bay_monitor_vitals_badge", (-0.5, 1.36, -0.825), (0.12, 0.07, 0.018), light_mat)
cube("ed_exam_bay_ecg_paper_strip", (1.35, 0.86, 0.28), (0.36, 0.018, 0.08), paper_mat)
cube("ed_exam_bay_nurse_task_tray", (1.08, 0.9, 0.72), (0.32, 0.035, 0.2), equipment_mat)
cube("ed_exam_bay_doorway_orientation_sign", (-1.02, 1.92, 1.74), (0.34, 0.09, 0.025), tape_mat)
cube("ed_exam_bay_doorway_escalation_badge", (-0.62, 1.9, 1.74), (0.09, 0.075, 0.025), accent_red_mat)
cube("ed_exam_bay_monitor_lead_cable", (-0.52, 0.76, -0.42), (0.04, 0.025, 0.62), screen_mat)
cube("ed_exam_bay_bed_wheel_locks", (-0.82, 0.2, 0.82), (0.1, 0.055, 0.1), accent_red_mat)
cube("ed_exam_bay_curtain_track_rings", (2.12, 1.98, 0.25), (0.035, 0.035, 0.62), metal_mat)
cube("ed_exam_bay_trash_liner_fold", (-2.04, 0.56, 0.85), (0.2, 0.035, 0.18), equipment_mat)
cube("ed_exam_bay_iv_tubing_line", (0.75, 1.05, 0.54), (0.025, 0.42, 0.025), light_mat)
cube("ed_exam_bay_floor_scuff_path", (-0.18, 0.006, 0.62), (1.22, 0.006, 0.045), scuff_mat)
cube("ed_exam_bay_infection_control_sign", (-2.36, 1.55, 1.28), (0.025, 0.2, 0.28), sign_mat)
cube("ed_exam_bay_handoff_whiteboard", (-1.15, 1.52, -1.74), (0.58, 0.25, 0.025), sign_mat)
cube("ed_exam_bay_supply_drawer_labels", (-1.78, 0.82, 1.48), (0.3, 0.14, 0.025), paper_mat)
cube("ed_exam_bay_privacy_zone_floor_tape", (0.82, 0.008, 1.08), (0.68, 0.008, 0.035), tape_mat)
os.makedirs(os.path.dirname(output_path), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB", export_animations=False)
`;
}

function zone(zoneId: string, description: string, center: { x: number; y: number; z: number }, interactionAnchors: string[]) {
  return { zoneId, description, center, interactionAnchors };
}

function placement(
  placementId: string,
  assetId: string,
  position: { x: number; y: number; z: number },
  yawRadians: number,
  zoneId: string,
) {
  return { placementId, assetId, position, yawRadians, zoneId };
}

function missingArtifactBlockers(paths: Record<string, string>): string[] {
  return Object.entries(paths)
    .filter(([, filePath]) => !existsSync(filePath))
    .map(([key, filePath]) => `${key}_missing:${toRepoRelativePath(filePath)}`);
}

async function readGlbBytes(filePath: string, blockers: string[], label: string): Promise<number> {
  if (!existsSync(filePath)) return 0;
  const glb = await readFile(filePath);
  if (glb.subarray(0, 4).toString("utf8") !== "glTF") {
    blockers.push(`glb_magic_invalid:${label}`);
  }
  return glb.length;
}

async function readOptionalJson<TValue>(filePath: string): Promise<TValue | undefined> {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

function environmentArtifactPaths(outputRoot: string) {
  const absoluteOutputRoot = path.resolve(outputRoot);
  return {
    outputRoot: absoluteOutputRoot,
    edExamBayShellGlb: path.join(absoluteOutputRoot, ED_EXAM_BAY_GLB_NAME),
    layoutManifest: path.join(absoluteOutputRoot, ENVIRONMENT_LAYOUT_NAME),
    equipmentPlacementManifest: path.join(absoluteOutputRoot, EQUIPMENT_PLACEMENT_NAME),
    questBudget: path.join(absoluteOutputRoot, QUEST_BUDGET_NAME),
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    outputRoot: ENVIRONMENT_ARTIFACTS_OUTPUT_DIR,
    reportPath: defaultEnvironmentArtifactsReportPath(),
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
    else if (arg === "--validate") options.validatePath = nextValue();
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown environment artifacts option: ${arg}`);
  }
  return options;
}

function environmentArtifactsHelp(): string {
  return [
    "Usage: tsx tools/openclinxr/environment-artifacts.ts [options]",
    "",
    "Options:",
    "  --output-root <path>   Directory for environment artifacts.",
    "  --report <path>        Summary report path.",
    "  --validate <path>      Validate an existing report and artifact files.",
    "  --validate-latest      Validate today's default report and artifact files.",
  ].join("\n");
}

function toRepoRelativePath(filePath: string): string {
  return path.relative(process.cwd(), path.resolve(filePath)).replaceAll(path.sep, "/");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runEnvironmentArtifactsCli();
}
