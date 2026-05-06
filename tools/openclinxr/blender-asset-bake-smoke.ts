import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BLENDER_COMMAND_TIMEOUT_MS = 60_000;

type CliOptions = {
  outputPath?: string;
  fixture: BlenderBakeFixture;
};

export type BlenderBakeFixture = "low_poly_clinical_humanoid" | "ed_chest_pain_clinical_asset_pack";

type BlenderBakeFixtureMetadata = {
  fixture: BlenderBakeFixture;
  sourceLicensePosture: "repo_generated_placeholder" | "reviewed_local_clinical_asset_fixture";
  expectedObjectCount: number;
  requiredObjectNames: string[];
};

export type BlenderBakeSemanticInventory = {
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  observedObjectNames: string[];
  requiredObjectNames: string[];
  missingRequiredObjectNames: string[];
};

export type BlenderBakeSmokeReport = {
  generatedAt: string;
  tool: {
    command: "blender";
    package: "Blender";
    version: string;
    license: "GPL-3.0-or-later-tooling";
  };
  input: {
    fixture: BlenderBakeFixture;
    externalAssetsUsed: false;
    sourceLicensePosture: BlenderBakeFixtureMetadata["sourceLicensePosture"];
    expectedObjectCount: number;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number | null;
    declaredLength: number | null;
    elapsedMs: number;
    semanticInventory: BlenderBakeSemanticInventory | null;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBlenderBakeSmoke({ fixture: options.fixture });

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.verdict.passed) {
    console.error(`Blender asset bake smoke failed: ${report.verdict.blockers.join(", ")}`);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    fixture: "low_poly_clinical_humanoid",
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--fixture") {
      options.fixture = parseFixture(requireValue(normalizedArgs, index, arg));
      index += 1;
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

function parseFixture(value: string): BlenderBakeFixture {
  if (value === "low_poly_clinical_humanoid" || value === "ed_chest_pain_clinical_asset_pack") {
    return value;
  }
  throw new Error(`Unsupported Blender bake fixture: ${value}`);
}

export async function runBlenderBakeSmoke(input: {
  fixture?: BlenderBakeFixture;
} = {}): Promise<BlenderBakeSmokeReport> {
  const started = performance.now();
  const fixture = input.fixture ?? "low_poly_clinical_humanoid";
  const blenderVersion = await getBlenderVersion();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-blender-bake-"));
  const scriptPath = path.join(tempDir, "bake.py");
  const outputPath = path.join(tempDir, `${fixture}.glb`);

  try {
    await writeFile(scriptPath, createBlenderBakePythonScript(outputPath, fixture), "utf8");
    await execFileAsync("blender", ["--background", "--factory-startup", "--python", scriptPath], {
      encoding: "utf8",
      timeout: BLENDER_COMMAND_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const glb = await readFile(outputPath);

    return buildBlenderBakeSmokeReportFromGlb({
      generatedAt: new Date().toISOString(),
      blenderVersion,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      glb,
      fixture,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildBlenderBakeSmokeReportFromGlb(input: {
  generatedAt: string;
  blenderVersion: string;
  elapsedMs: number;
  glb: Buffer;
  fixture?: BlenderBakeFixture;
}): BlenderBakeSmokeReport {
  const fixtureMetadata = blenderBakeFixtureMetadata(input.fixture ?? "low_poly_clinical_humanoid");
  const magic = input.glb.subarray(0, 4).toString("utf8");
  const parsedVersion = input.glb.length >= 8 ? input.glb.readUInt32LE(4) : null;
  const declaredLength = input.glb.length >= 12 ? input.glb.readUInt32LE(8) : null;
  const semanticInventory = parseBlenderBakeSemanticInventory(input.glb, fixtureMetadata.requiredObjectNames);
  const blockers = [
    magic === "glTF" ? undefined : "glb_magic_missing",
    parsedVersion === 2 ? undefined : "glb_version_not_2",
    declaredLength === input.glb.length ? undefined : "glb_declared_length_mismatch",
    input.glb.length > 20 ? undefined : "glb_output_too_small",
    semanticInventory ? undefined : "glb_json_chunk_missing",
    semanticInventory && semanticInventory.nodeCount >= fixtureMetadata.expectedObjectCount
      ? undefined
      : "glb_node_count_below_expected_object_count",
    ...(semanticInventory
      ? semanticInventory.missingRequiredObjectNames
      : fixtureMetadata.requiredObjectNames
    ).map((name) => `glb_required_object_missing:${name}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    generatedAt: input.generatedAt,
    tool: {
      command: "blender",
      package: "Blender",
      version: input.blenderVersion,
      license: "GPL-3.0-or-later-tooling",
    },
    input: {
      fixture: fixtureMetadata.fixture,
      externalAssetsUsed: false,
      sourceLicensePosture: fixtureMetadata.sourceLicensePosture,
      expectedObjectCount: fixtureMetadata.expectedObjectCount,
    },
    output: {
      glbBytes: input.glb.length,
      magic,
      version: parsedVersion,
      declaredLength,
      elapsedMs: input.elapsedMs,
      semanticInventory,
    },
    verdict: {
      passed: blockers.length === 0,
      blockers,
    },
  };
}

function blenderBakeFixtureMetadata(fixture: BlenderBakeFixture): BlenderBakeFixtureMetadata {
  if (fixture === "ed_chest_pain_clinical_asset_pack") {
    return {
      fixture,
      sourceLicensePosture: "reviewed_local_clinical_asset_fixture",
      expectedObjectCount: clinicalAssetPackRequiredObjectNames.length,
      requiredObjectNames: clinicalAssetPackRequiredObjectNames,
    };
  }

  return {
    fixture,
    sourceLicensePosture: "repo_generated_placeholder",
    expectedObjectCount: 7,
    requiredObjectNames: [],
  };
}

function parseBlenderBakeSemanticInventory(
  glb: Buffer,
  requiredObjectNames: string[],
): BlenderBakeSemanticInventory | null {
  const jsonChunk = readGlbJsonChunk(glb);
  if (!jsonChunk) {
    return null;
  }

  const gltf = parseJsonRecord(jsonChunk);
  if (!gltf) {
    return null;
  }

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes.filter(isRecord) : [];
  const nodeNames = nodes
    .map((node) => typeof node.name === "string" ? node.name : undefined)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  const observedNames = new Set(nodeNames);

  return {
    sceneCount: Array.isArray(gltf.scenes) ? gltf.scenes.length : 0,
    nodeCount: nodes.length,
    meshCount: Array.isArray(gltf.meshes) ? gltf.meshes.length : 0,
    materialCount: Array.isArray(gltf.materials) ? gltf.materials.length : 0,
    observedObjectNames: nodeNames,
    requiredObjectNames,
    missingRequiredObjectNames: requiredObjectNames.filter((name) => !observedNames.has(name)),
  };
}

function readGlbJsonChunk(glb: Buffer): string | null {
  if (glb.length < 20 || glb.subarray(0, 4).toString("utf8") !== "glTF") {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    const chunkType = glb.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > glb.length) {
      return null;
    }
    if (chunkType === 0x4e4f534a) {
      return glb.subarray(chunkStart, chunkEnd).toString("utf8").trim();
    }
    offset = chunkEnd;
  }

  return null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const clinicalAssetPackRequiredObjectNames = [
  "ed_exam_bay_floor_panel",
  "ed_exam_bay_back_wall",
  "ed_exam_bay_privacy_curtain_rail",
  "stretcher_frame_with_side_rails",
  "stretcher_mattress_linen",
  "stretcher_left_side_rail",
  "stretcher_right_side_rail",
  "patient_robert_hayes_head",
  "patient_robert_hayes_torso_hospital_gown",
  "patient_robert_hayes_left_arm_diaphoretic_pose",
  "patient_robert_hayes_right_arm_chest_guarding_pose",
  "patient_robert_hayes_canonical_skeleton_anchor",
  "nurse_maria_alvarez_head",
  "nurse_maria_alvarez_torso_scrubs",
  "nurse_maria_alvarez_tablet",
  "nurse_maria_alvarez_canonical_skeleton_anchor",
  "ed_exam_bay_wall_monitor",
  "ecg_cart_12_lead",
  "iv_pole_with_pump",
  "oxygen_flowmeter_wall_unit",
  "asset_pack_scale_and_origin_marker",
];

export function createBlenderBakePythonScript(
  outputPath: string,
  fixture: BlenderBakeFixture = "low_poly_clinical_humanoid",
): string {
  if (fixture === "ed_chest_pain_clinical_asset_pack") {
    return createClinicalAssetPackBlenderScript(outputPath);
  }

  return createPlaceholderHumanoidBlenderScript(outputPath);
}

function createPlaceholderHumanoidBlenderScript(outputPath: string): string {
  const escapedOutputPath = JSON.stringify(outputPath);
  return `
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

skin = bpy.data.materials.new("clinical_placeholder_skin")
skin.diffuse_color = (0.78, 0.55, 0.43, 1.0)
scrubs = bpy.data.materials.new("clinical_placeholder_scrubs")
scrubs.diffuse_color = (0.08, 0.32, 0.42, 1.0)

def add_cube(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    return obj

bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.22, location=(0, 0, 1.72))
head = bpy.context.object
head.name = "patient_placeholder_head"
head.data.materials.append(skin)

add_cube("patient_placeholder_torso", (0, 0, 1.18), (0.28, 0.18, 0.42), scrubs)
add_cube("patient_placeholder_left_arm", (-0.36, 0, 1.17), (0.08, 0.08, 0.38), skin)
add_cube("patient_placeholder_right_arm", (0.36, 0, 1.17), (0.08, 0.08, 0.38), skin)
add_cube("patient_placeholder_left_leg", (-0.11, 0, 0.52), (0.09, 0.09, 0.5), scrubs)
add_cube("patient_placeholder_right_leg", (0.11, 0, 0.52), (0.09, 0.09, 0.5), scrubs)
add_cube("clinical_scale_marker", (0, -0.35, 0.05), (0.35, 0.02, 0.02), scrubs)

bpy.ops.export_scene.gltf(
    filepath=${escapedOutputPath},
    export_format="GLB",
    export_apply=True,
    export_materials="EXPORT",
)
`.trimStart();
}

function createClinicalAssetPackBlenderScript(outputPath: string): string {
  const escapedOutputPath = JSON.stringify(outputPath);
  return `
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

skin = bpy.data.materials.new("patient_skin_tone_reviewed_local")
skin.diffuse_color = (0.68, 0.46, 0.34, 1.0)
gown = bpy.data.materials.new("patient_hospital_gown_blue")
gown.diffuse_color = (0.15, 0.36, 0.58, 1.0)
scrubs = bpy.data.materials.new("nurse_scrubs_teal")
scrubs.diffuse_color = (0.05, 0.38, 0.34, 1.0)
metal = bpy.data.materials.new("clinical_equipment_matte_metal")
metal.diffuse_color = (0.42, 0.45, 0.48, 1.0)
dark = bpy.data.materials.new("monitor_dark_glass")
dark.diffuse_color = (0.02, 0.03, 0.035, 1.0)
floor = bpy.data.materials.new("ed_bay_washable_floor")
floor.diffuse_color = (0.62, 0.66, 0.65, 1.0)
linen = bpy.data.materials.new("stretcher_linen_white")
linen.diffuse_color = (0.91, 0.92, 0.9, 1.0)

def add_cube(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    return obj

def add_sphere(name, location, radius, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj

add_cube("ed_exam_bay_floor_panel", (0, 0, 0), (2.8, 2.2, 0.03), floor)
add_cube("ed_exam_bay_back_wall", (0, 1.05, 1.15), (2.8, 0.04, 1.15), floor)
add_cube("ed_exam_bay_privacy_curtain_rail", (-1.25, 0.2, 2.12), (0.04, 1.1, 0.03), metal)

add_cube("stretcher_frame_with_side_rails", (0, 0.18, 0.72), (0.82, 1.15, 0.16), metal)
add_cube("stretcher_mattress_linen", (0, 0.18, 0.91), (0.76, 1.05, 0.12), linen)
add_cube("stretcher_left_side_rail", (-0.83, 0.18, 1.08), (0.04, 1.0, 0.16), metal)
add_cube("stretcher_right_side_rail", (0.83, 0.18, 1.08), (0.04, 1.0, 0.16), metal)

add_sphere("patient_robert_hayes_head", (0, -0.28, 1.53), 0.18, skin)
add_cube("patient_robert_hayes_torso_hospital_gown", (0, 0.02, 1.2), (0.38, 0.28, 0.34), gown)
add_cube("patient_robert_hayes_left_arm_diaphoretic_pose", (-0.42, -0.02, 1.17), (0.08, 0.12, 0.32), skin)
add_cube("patient_robert_hayes_right_arm_chest_guarding_pose", (0.42, -0.02, 1.17), (0.08, 0.12, 0.32), skin)
add_cube("patient_robert_hayes_canonical_skeleton_anchor", (0, 0.02, 1.85), (0.04, 0.04, 0.1), metal)

add_sphere("nurse_maria_alvarez_head", (-1.12, -0.42, 1.58), 0.16, skin)
add_cube("nurse_maria_alvarez_torso_scrubs", (-1.12, -0.42, 1.19), (0.31, 0.2, 0.39), scrubs)
add_cube("nurse_maria_alvarez_tablet", (-0.78, -0.54, 1.26), (0.16, 0.02, 0.12), dark)
add_cube("nurse_maria_alvarez_canonical_skeleton_anchor", (-1.12, -0.42, 1.85), (0.04, 0.04, 0.1), metal)

add_cube("ed_exam_bay_wall_monitor", (0.86, 1.0, 1.55), (0.36, 0.03, 0.22), dark)
add_cube("ecg_cart_12_lead", (1.18, -0.54, 0.78), (0.28, 0.22, 0.34), metal)
add_cube("iv_pole_with_pump", (-0.96, 0.55, 1.18), (0.03, 0.03, 0.98), metal)
add_cube("oxygen_flowmeter_wall_unit", (-0.72, 1.0, 1.45), (0.18, 0.03, 0.12), metal)
add_cube("asset_pack_scale_and_origin_marker", (0, -1.05, 0.05), (0.35, 0.02, 0.02), metal)

bpy.ops.export_scene.gltf(
    filepath=${escapedOutputPath},
    export_format="GLB",
    export_apply=True,
    export_materials="EXPORT",
)
`.trimStart();
}

async function getBlenderVersion(): Promise<string> {
  const { stdout } = await execFileAsync("blender", ["--version"], {
    encoding: "utf8",
    timeout: BLENDER_COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return stdout.split("\n")[0]?.trim() ?? "unknown";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
