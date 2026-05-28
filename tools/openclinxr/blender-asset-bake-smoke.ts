import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { globFiles } from "../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

export const BLENDER_COMMAND_TIMEOUT_MS = 60_000;

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
  fixture: BlenderBakeFixture;
};

export type BlenderBakeFixture = "ed_chest_pain_clinical_asset_pack";

type BlenderBakeFixtureMetadata = {
  fixture: BlenderBakeFixture;
  sourceLicensePosture: "reviewed_local_clinical_asset_fixture";
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  await runBlenderBakeSmokeCli(process.argv.slice(2));
}

export async function runBlenderBakeSmokeCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/blender-asset-bake-smoke-*.json");
    if (!validatePath) {
      throw new Error("Missing Blender asset bake smoke report to validate.");
    }
    const validation = validateBlenderBakeSmokeReport(JSON.parse(await readFile(validatePath, "utf8")));
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
    validateLatest: false,
    fixture: "ed_chest_pain_clinical_asset_pack",
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

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  return files.sort().at(-1);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseFixture(value: string): BlenderBakeFixture {
  if (value === "ed_chest_pain_clinical_asset_pack") {
    return value;
  }
  throw new Error(`Unsupported Blender bake fixture: ${value}`);
}

export async function runBlenderBakeSmoke(input: {
  fixture?: BlenderBakeFixture;
} = {}): Promise<BlenderBakeSmokeReport> {
  const started = performance.now();
  const fixture = input.fixture ?? "ed_chest_pain_clinical_asset_pack";
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
  const fixtureMetadata = blenderBakeFixtureMetadata(input.fixture ?? "ed_chest_pain_clinical_asset_pack");
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

export function validateBlenderBakeSmokeReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireRecord(value.tool, "/tool", errors);
  if (isRecord(value.tool)) {
    requireLiteral(value.tool.command, "blender", "/tool/command", errors);
    requireLiteral(value.tool.package, "Blender", "/tool/package", errors);
    requireString(value.tool.version, "/tool/version", errors);
    requireLiteral(value.tool.license, "GPL-3.0-or-later-tooling", "/tool/license", errors);
  }
  requireRecord(value.input, "/input", errors);
  if (isRecord(value.input)) {
    requireOneOf(value.input.fixture, ["ed_chest_pain_clinical_asset_pack"], "/input/fixture", errors);
    requireLiteral(value.input.externalAssetsUsed, false, "/input/externalAssetsUsed", errors);
    requireOneOf(
      value.input.sourceLicensePosture,
      ["reviewed_local_clinical_asset_fixture"],
      "/input/sourceLicensePosture",
      errors,
    );
    requireNumber(value.input.expectedObjectCount, "/input/expectedObjectCount", errors);
  }
  requireRecord(value.output, "/output", errors);
  if (isRecord(value.output)) {
    requireNumber(value.output.glbBytes, "/output/glbBytes", errors);
    requireLiteral(value.output.magic, "glTF", "/output/magic", errors);
    requireLiteral(value.output.version, 2, "/output/version", errors);
    requireNumber(value.output.declaredLength, "/output/declaredLength", errors);
    requireNumber(value.output.elapsedMs, "/output/elapsedMs", errors);
    if (value.output.semanticInventory !== null) {
      validateSemanticInventory(value.output.semanticInventory, "/output/semanticInventory", errors);
    }
  }
  requireRecord(value.verdict, "/verdict", errors);
  if (isRecord(value.verdict)) {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
  }
  validateReportConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateSemanticInventory(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireNumber(value.sceneCount, `${pathName}/sceneCount`, errors);
  requireNumber(value.nodeCount, `${pathName}/nodeCount`, errors);
  requireNumber(value.meshCount, `${pathName}/meshCount`, errors);
  requireNumber(value.materialCount, `${pathName}/materialCount`, errors);
  requireStringArray(value.observedObjectNames, `${pathName}/observedObjectNames`, errors);
  requireStringArray(value.requiredObjectNames, `${pathName}/requiredObjectNames`, errors);
  requireStringArray(value.missingRequiredObjectNames, `${pathName}/missingRequiredObjectNames`, errors);
}

function validateReportConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.output) || !isRecord(value.verdict)) {
    return;
  }
  const expectedBlockers = expectedReportBlockers(value.output);
  if (!Array.isArray(value.verdict.blockers)) {
    return;
  }

  const verdictBlockers = new Set(value.verdict.blockers);
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.has(blocker)) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }
}

function expectedReportBlockers(output: Record<string, unknown>): string[] {
  const semanticInventory = isRecord(output.semanticInventory) ? output.semanticInventory : null;
  return [
    output.magic === "glTF" ? undefined : "glb_magic_missing",
    output.version === 2 ? undefined : "glb_version_not_2",
    typeof output.glbBytes === "number" && output.declaredLength === output.glbBytes ? undefined : "glb_declared_length_mismatch",
    typeof output.glbBytes === "number" && output.glbBytes > 20 ? undefined : "glb_output_too_small",
    semanticInventory ? undefined : "glb_json_chunk_missing",
    semanticInventory ? undefined : "glb_node_count_below_expected_object_count",
    ...stringArray(semanticInventory?.missingRequiredObjectNames).map((name) => `glb_required_object_missing:${name}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function blenderBakeFixtureMetadata(fixture: BlenderBakeFixture): BlenderBakeFixtureMetadata {
  return {
    fixture,
    sourceLicensePosture: "reviewed_local_clinical_asset_fixture",
    expectedObjectCount: clinicalAssetPackRequiredObjectNames.length,
    requiredObjectNames: clinicalAssetPackRequiredObjectNames,
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

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
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
  fixture: BlenderBakeFixture = "ed_chest_pain_clinical_asset_pack",
): string {
  if (fixture === "ed_chest_pain_clinical_asset_pack") {
    return createClinicalAssetPackBlenderScript(outputPath);
  }

  throw new Error(`Unsupported Blender bake fixture: ${fixture}`);
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
