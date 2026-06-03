import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Accessor, Document, NodeIO, VERSION } from "@gltf-transform/core";
import { globFiles } from "../../agent-factory/lib.js";


type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
};

export type GltfTransformSmokeReport = {
  generatedAt: string;
  tool: {
    command: "gltf-transform-node-api";
    package: "@gltf-transform/core";
    version: string;
    license: "MIT";
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
  replacementAssessment: {
    candidateFor: "gltf-pipeline_root_dependency_reduction";
    paritySignals: string[];
    remainingGaps: string[];
    demoteGltfPipelineRecommended: boolean;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  await runGltfTransformSmokeCli(process.argv.slice(2));
}

export async function runGltfTransformSmokeCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/gltf-transform-smoke-*.json");
    if (!validatePath) {
      throw new Error("Missing GLTF Transform smoke report to validate.");
    }
    const validation = validateGltfTransformSmokeReport(JSON.parse(await readFile(validatePath, "utf8")));
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

  const report = await runSmoke();

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.verdict.passed) {
    console.error(`gltf-transform smoke failed: ${report.verdict.blockers.join(", ")}`);
    process.exitCode = 1;
  }
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

async function runSmoke(): Promise<GltfTransformSmokeReport> {
  const started = performance.now();
  const version = VERSION;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-gltf-transform-"));
  const inputPath = path.join(tempDir, "triangle.gltf");

  try {
    const gltf = createTriangleGltf();
    await writeFile(inputPath, JSON.stringify(gltf), "utf8");
    const gltfStat = await stat(inputPath);
    const glb = Buffer.from(await createTriangleGlb());
    const magic = glb.subarray(0, 4).toString("utf8");
    const parsedVersion = glb.length >= 8 ? glb.readUInt32LE(4) : null;
    const declaredLength = glb.length >= 12 ? glb.readUInt32LE(8) : null;
    const blockers = [
      magic === "glTF" ? undefined : "glb_magic_missing",
      parsedVersion === 2 ? undefined : "glb_version_not_2",
      declaredLength === glb.length ? undefined : "glb_declared_length_mismatch",
      glb.length > 20 ? undefined : "glb_output_too_small",
    ].filter((blocker): blocker is string => typeof blocker === "string");
    const paritySignals = [
      "node_api_available",
      magic === "glTF" ? "glb_magic_ok" : undefined,
      parsedVersion === 2 ? "glb_version_2" : undefined,
      declaredLength === glb.length ? "declared_length_matches" : undefined,
    ].filter((signal): signal is string => typeof signal === "string");

    return {
      generatedAt: new Date().toISOString(),
      tool: {
        command: "gltf-transform-node-api",
        package: "@gltf-transform/core",
        version,
        license: "MIT",
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
      replacementAssessment: {
        candidateFor: "gltf-pipeline_root_dependency_reduction",
        paritySignals,
        remainingGaps: [
          "security/license notes still identify gltf-pipeline as the approved local conversion CLI",
          "dependency-footprint evidence has not yet proven that removing or isolating gltf-pipeline improves e18e duplicate count or install size",
          "gltf-transform CLI is currently blocked by the repo brace-expansion security override, so replacement must use @gltf-transform/core or fix CLI dependency compatibility first",
        ],
        demoteGltfPipelineRecommended: false,
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

async function createTriangleGlb(): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer("openclinxr_smoke_buffer");
  const positionAccessor = document.createAccessor("POSITION")
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indexAccessor = document.createAccessor("indices")
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", positionAccessor)
    .setIndices(indexAccessor);
  const mesh = document.createMesh("openclinxr_smoke_triangle_mesh").addPrimitive(primitive);
  const node = document.createNode("openclinxr_smoke_triangle").setMesh(mesh);
  document.createScene("openclinxr_smoke_scene").addChild(node);
  return await new NodeIO().writeBinary(document);
}

function createTriangleGltf(): Record<string, unknown> {
  return {
    asset: {
      version: "2.0",
      generator: "OpenClinXR gltf-transform smoke",
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

export function validateGltfTransformSmokeReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireRecord(value.tool, "/tool", errors);
  if (isRecord(value.tool)) {
    requireLiteral(value.tool.command, "gltf-transform-node-api", "/tool/command", errors);
    requireLiteral(value.tool.package, "@gltf-transform/core", "/tool/package", errors);
    requireString(value.tool.version, "/tool/version", errors);
    requireLiteral(value.tool.license, "MIT", "/tool/license", errors);
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
  requireRecord(value.replacementAssessment, "/replacementAssessment", errors);
  if (isRecord(value.replacementAssessment)) {
    requireLiteral(value.replacementAssessment.candidateFor, "gltf-pipeline_root_dependency_reduction", "/replacementAssessment/candidateFor", errors);
    requireStringArray(value.replacementAssessment.paritySignals, "/replacementAssessment/paritySignals", errors);
    requireStringArray(value.replacementAssessment.remainingGaps, "/replacementAssessment/remainingGaps", errors);
    requireBoolean(value.replacementAssessment.demoteGltfPipelineRecommended, "/replacementAssessment/demoteGltfPipelineRecommended", errors);
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

function requireLiteral<T extends string | number | boolean>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) {
    errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
  }
}

function createTriangleBuffer(): Buffer {
  const buffer = Buffer.alloc(44);
  buffer.writeFloatLE(0, 0);
  buffer.writeFloatLE(0, 4);
  buffer.writeFloatLE(0, 8);
  buffer.writeFloatLE(1, 12);
  buffer.writeFloatLE(0, 16);
  buffer.writeFloatLE(0, 20);
  buffer.writeFloatLE(0, 24);
  buffer.writeFloatLE(1, 28);
  buffer.writeFloatLE(0, 32);
  buffer.writeUInt16LE(0, 36);
  buffer.writeUInt16LE(1, 38);
  buffer.writeUInt16LE(2, 40);
  buffer.writeUInt16LE(0, 42);
  return buffer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
