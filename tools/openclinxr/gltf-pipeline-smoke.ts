import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CliOptions = {
  validatePath?: string;
  outputPath?: string;
};

export type GltfPipelineSmokeReport = {
  generatedAt: string;
  tool: {
    command: "gltf-pipeline";
    package: "gltf-pipeline";
    version: string;
    license: "Apache-2.0";
  };
  input: {
    primitive: "single_triangle";
    vertices: number;
    triangles: number;
    gltfBytes: number;
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  await runGltfPipelineSmokeCli(process.argv.slice(2));
}

export async function runGltfPipelineSmokeCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath) {
    const validation = validateGltfPipelineSmokeReport(JSON.parse(await readFile(options.validatePath, "utf8")));
    if (validation.ok) {
      console.log(`Validated ${options.validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const report = await runSmoke();

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.verdict.passed) {
    console.error(`gltf-pipeline smoke failed: ${report.verdict.blockers.join(", ")}`);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
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

async function runSmoke(): Promise<GltfPipelineSmokeReport> {
  const started = performance.now();
  const version = await getGltfPipelineVersion();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-gltf-pipeline-"));
  const inputPath = path.join(tempDir, "triangle.gltf");
  const outputPath = path.join(tempDir, "triangle.glb");

  try {
    const gltf = createTriangleGltf();
    await writeFile(inputPath, JSON.stringify(gltf), "utf8");
    const gltfStat = await stat(inputPath);
    await execFileAsync("gltf-pipeline", ["-i", inputPath, "-o", outputPath, "-b"], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const glb = await readFile(outputPath);
    const magic = glb.subarray(0, 4).toString("utf8");
    const parsedVersion = glb.length >= 8 ? glb.readUInt32LE(4) : null;
    const declaredLength = glb.length >= 12 ? glb.readUInt32LE(8) : null;
    const blockers = [
      magic === "glTF" ? undefined : "glb_magic_missing",
      parsedVersion === 2 ? undefined : "glb_version_not_2",
      declaredLength === glb.length ? undefined : "glb_declared_length_mismatch",
      glb.length > 20 ? undefined : "glb_output_too_small",
    ].filter((blocker): blocker is string => typeof blocker === "string");

    return {
      generatedAt: new Date().toISOString(),
      tool: {
        command: "gltf-pipeline",
        package: "gltf-pipeline",
        version,
        license: "Apache-2.0",
      },
      input: {
        primitive: "single_triangle",
        vertices: 3,
        triangles: 1,
        gltfBytes: gltfStat.size,
      },
      output: {
        glbBytes: glb.length,
        magic,
        version: parsedVersion,
        declaredLength,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
      },
      verdict: {
        passed: blockers.length === 0,
        blockers,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function getGltfPipelineVersion(): Promise<string> {
  const { stdout } = await execFileAsync("gltf-pipeline", ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  return stdout.trim();
}

function createTriangleGltf(): Record<string, unknown> {
  return {
    asset: {
      version: "2.0",
      generator: "OpenClinXR gltf-pipeline smoke",
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "openclinxr_smoke_triangle", mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
        min: [0],
        max: [2],
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${createTriangleBuffer().toString("base64")}`,
        byteLength: 44,
      },
    ],
  };
}

export function validateGltfPipelineSmokeReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireRecord(value.tool, "/tool", errors);
  if (isRecord(value.tool)) {
    requireLiteral(value.tool.command, "gltf-pipeline", "/tool/command", errors);
    requireLiteral(value.tool.package, "gltf-pipeline", "/tool/package", errors);
    requireString(value.tool.version, "/tool/version", errors);
    requireLiteral(value.tool.license, "Apache-2.0", "/tool/license", errors);
  }
  requireRecord(value.input, "/input", errors);
  if (isRecord(value.input)) {
    requireLiteral(value.input.primitive, "single_triangle", "/input/primitive", errors);
    requireLiteral(value.input.vertices, 3, "/input/vertices", errors);
    requireLiteral(value.input.triangles, 1, "/input/triangles", errors);
    requireNumber(value.input.gltfBytes, "/input/gltfBytes", errors);
  }
  requireRecord(value.output, "/output", errors);
  if (isRecord(value.output)) {
    requireNumber(value.output.glbBytes, "/output/glbBytes", errors);
    requireLiteral(value.output.magic, "glTF", "/output/magic", errors);
    requireLiteral(value.output.version, 2, "/output/version", errors);
    requireNumber(value.output.declaredLength, "/output/declaredLength", errors);
    requireNumber(value.output.elapsedMs, "/output/elapsedMs", errors);
  }
  requireRecord(value.verdict, "/verdict", errors);
  if (isRecord(value.verdict)) {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
  }
  validateReportConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateReportConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.output) || !isRecord(value.verdict) || !Array.isArray(value.verdict.blockers)) {
    return;
  }

  const verdictBlockers = new Set(value.verdict.blockers);
  for (const blocker of expectedReportBlockers(value.output)) {
    if (!verdictBlockers.has(blocker)) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }
}

function expectedReportBlockers(output: Record<string, unknown>): string[] {
  return [
    output.magic === "glTF" ? undefined : "glb_magic_missing",
    output.version === 2 ? undefined : "glb_version_not_2",
    typeof output.glbBytes === "number" && output.declaredLength === output.glbBytes ? undefined : "glb_declared_length_mismatch",
    typeof output.glbBytes === "number" && output.glbBytes > 20 ? undefined : "glb_output_too_small",
  ].filter((blocker): blocker is string => typeof blocker === "string");
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

function createTriangleBuffer(): Buffer {
  const buffer = Buffer.alloc(44);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  [0, 1, 2].forEach((value, index) => buffer.writeUInt16LE(value, 36 + index * 2));
  return buffer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
