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
    fixture: "low_poly_clinical_humanoid";
    externalAssetsUsed: false;
    sourceLicensePosture: "repo_generated_placeholder";
    expectedObjectCount: number;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number | null;
    declaredLength: number | null;
    elapsedMs: number;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBlenderBakeSmoke();

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
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
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

export async function runBlenderBakeSmoke(): Promise<BlenderBakeSmokeReport> {
  const started = performance.now();
  const blenderVersion = await getBlenderVersion();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-blender-bake-"));
  const scriptPath = path.join(tempDir, "bake.py");
  const outputPath = path.join(tempDir, "low-poly-clinical-humanoid.glb");

  try {
    await writeFile(scriptPath, createBlenderBakePythonScript(outputPath), "utf8");
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
}): BlenderBakeSmokeReport {
  const magic = input.glb.subarray(0, 4).toString("utf8");
  const parsedVersion = input.glb.length >= 8 ? input.glb.readUInt32LE(4) : null;
  const declaredLength = input.glb.length >= 12 ? input.glb.readUInt32LE(8) : null;
  const blockers = [
    magic === "glTF" ? undefined : "glb_magic_missing",
    parsedVersion === 2 ? undefined : "glb_version_not_2",
    declaredLength === input.glb.length ? undefined : "glb_declared_length_mismatch",
    input.glb.length > 20 ? undefined : "glb_output_too_small",
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
      fixture: "low_poly_clinical_humanoid",
      externalAssetsUsed: false,
      sourceLicensePosture: "repo_generated_placeholder",
      expectedObjectCount: 7,
    },
    output: {
      glbBytes: input.glb.length,
      magic,
      version: parsedVersion,
      declaredLength,
      elapsedMs: input.elapsedMs,
    },
    verdict: {
      passed: blockers.length === 0,
      blockers,
    },
  };
}

export function createBlenderBakePythonScript(outputPath: string): string {
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
