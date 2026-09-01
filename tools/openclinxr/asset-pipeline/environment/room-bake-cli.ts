/**
 * Room albedo+AO bake CLI (issue-345, MADR 0056 item 1).
 *
 * Runs the deterministic Cycles bake in tools/openclinxr/asset-pipeline/environment/
 * room-albedo-ao-bake.py over a shipped environment GLB and writes a bake-measure
 * report. The report re-measures the OUTPUT GLB with the same instrument as the
 * contract test (a-room-is-lit-and-textured.test.ts): NodeIO over the shipped GLBs.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/environment/room-bake-cli.ts \
 *     --input apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb \
 *     [--output <path>] [--resolution 1024] [--report <path>] [--inspect]
 *
 * `--inspect` only measures a GLB and prints the JSON (no Blender run) — used to
 * produce the pre-fix artifact before any bake.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ROOM_ALBEDO_REL, runRoomGenerate } from "@openclinxr/factory-stations";

export const ROOM_BAKE_SCHEMA_VERSION = "openclinxr.room-bake.v1";
export const ROOM_BAKE_EVIDENCE_DIR = ".openclinxr/evidence/room-bake";
export const ROOM_BAKE_SCRIPT = ROOM_ALBEDO_REL;
export const BLENDER_BAKE_TIMEOUT_MS = 600_000;

type GlbMeasure = {
  tris: number;
  meshes: number;
  materials: number;
  texturedMaterials: number;
  distinctColours: number;
  textureBytes: number;
  materialNames: string[];
};

type BakeReport = {
  schemaVersion: typeof ROOM_BAKE_SCHEMA_VERSION;
  issue: 345;
  generatedAt: string;
  measuredAgainstCommit: string;
  input: string;
  output: string;
  bake: {
    script: string;
    resolution: number;
    engine: "CYCLES";
    samples: number;
    bakeType: "DIFFUSE";
    passFilter: ["DIRECT", "INDIRECT", "COLOR"];
    worldAmbientStrength: number;
  };
  inputMeasure: GlbMeasure;
  outputMeasure: GlbMeasure;
  wallClockMs: number;
  verdict: { passed: boolean; blockers: string[] };
};

const io = new NodeIO();

async function measureGlb(relPath: string): Promise<GlbMeasure> {
  const doc = await io.read(relPath);
  const root = doc.getRoot();

  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  }

  const materials = root.listMaterials();
  const textured = materials.filter((m) => m.getBaseColorTexture() !== null);

  let distinct = 1;
  let textureBytes = 0;
  for (const tex of root.listTextures()) textureBytes += tex.getImage()?.byteLength ?? 0;
  const first = textured[0]?.getBaseColorTexture()?.getImage();
  if (first && first.byteLength > 0) {
    const seen = new Set<string>();
    const stride = Math.max(3, Math.floor(first.byteLength / 4096) * 3);
    for (let i = 0; i + 2 < first.byteLength; i += stride) {
      seen.add(`${first[i]! >> 4},${first[i + 1]! >> 4},${first[i + 2]! >> 4}`);
      if (seen.size > 64) break;
    }
    distinct = seen.size;
  }

  return {
    tris,
    meshes: root.listMeshes().length,
    materials: materials.length,
    texturedMaterials: textured.length,
    distinctColours: distinct,
    textureBytes,
    materialNames: materials.map((m) => m.getName()),
  };
}

function commitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export async function runRoomBake(options: {
  input: string;
  output?: string;
  resolution?: number;
  report?: string;
  meansLog?: string;
  lightRig?: "legacy" | "distributed";
}): Promise<BakeReport> {
  const input = options.input;
  const output = options.output ?? input;
  const resolution = options.resolution ?? 1024;
  const generatedAt = new Date().toISOString();

  const inputMeasure = await measureGlb(input);
  const started = Date.now();

  const meansLog = options.meansLog ?? "tools/openclinxr/evidence/room-bake-means.json";
  await runRoomGenerate(
    {
      environmentId: "ed_bay_v1",
      infinigenPrompt: "exam bay",
      seed: 1,
      layoutVariant: "default",
    },
    {
      blender: "blender",
      workGlb: output,
      bakeAlbedo: true,
      bakeOcclusion: false,
      timeoutMs: BLENDER_BAKE_TIMEOUT_MS,
      albedoExtraArgs: [
        "--input",
        input,
        "--output",
        output,
        "--resolution",
        String(resolution),
        "--means-log",
        meansLog,
        "--room-name",
        path.basename(output),
        "--light-rig",
        options.lightRig ?? "distributed",
      ],
    },
  );

  const wallClockMs = Date.now() - started;
  const outputMeasure = await measureGlb(output);

  const blockers: string[] = [];
  if (outputMeasure.texturedMaterials === 0) blockers.push("output has zero textured materials");
  if (outputMeasure.distinctColours < 2) blockers.push("texture is a single-colour fill");
  if (outputMeasure.tris > 250_000) blockers.push("triangle count inflated beyond the contract net");

  const report: BakeReport = {
    schemaVersion: ROOM_BAKE_SCHEMA_VERSION,
    issue: 345,
    generatedAt,
    measuredAgainstCommit: commitSha(),
    input,
    output,
    bake: {
      script: ROOM_BAKE_SCRIPT,
      resolution,
      engine: "CYCLES",
      samples: 32,
      bakeType: "DIFFUSE",
      passFilter: ["DIRECT", "INDIRECT", "COLOR"],
      worldAmbientStrength: 0.12,
    },
    inputMeasure,
    outputMeasure,
    wallClockMs,
    verdict: { passed: blockers.length === 0, blockers },
  };

  const reportPath = options.report ?? defaultReportPath(output);
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `[room-bake] ${path.basename(output)}: tris ${inputMeasure.tris}->${outputMeasure.tris}, ` +
    `textured ${inputMeasure.texturedMaterials}->${outputMeasure.texturedMaterials}, ` +
    `distinctColours ${inputMeasure.distinctColours}->${outputMeasure.distinctColours}, ` +
    `textureBytes ${outputMeasure.textureBytes}, wallClock ${(wallClockMs / 1000).toFixed(1)}s\n`,
  );
  if (blockers.length > 0) {
    process.stderr.write(`[room-bake] VERDICT BLOCKED: ${blockers.join("; ")}\n`);
    process.exitCode = 1;
  }
  return report;
}

function defaultReportPath(output: string): string {
  const base = path.basename(output).replace(/\.glb$/, "");
  return path.join(ROOM_BAKE_EVIDENCE_DIR, `bake-measure-${base}.json`);
}

export async function runRoomBakeCli(args = process.argv.slice(2)): Promise<void> {
  const options: {
    input?: string;
    output?: string;
    resolution?: number;
    report?: string;
    inspect?: boolean;
    help?: boolean;
  } = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = () => {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--input") options.input = next();
    else if (arg === "--output") options.output = next();
    else if (arg === "--resolution") options.resolution = Number(next());
    else if (arg === "--report") options.report = next();
    else if (arg === "--inspect") options.inspect = true;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown room-bake option: ${arg}`);
  }

  if (options.help) {
    process.stdout.write([
      "Usage: tsx tools/openclinxr/asset-pipeline/environment/room-bake-cli.ts [options]",
      "  --input <glb>       Environment GLB to bake (required)",
      "  --output <glb>      Output path (default: in-place)",
      "  --resolution <px>   Bake resolution (default 1024)",
      "  --report <path>     Bake-measure report path",
      "  --inspect           Measure a GLB and print JSON without baking",
    ].join("\n") + "\n");
    return;
  }

  if (!options.input) throw new Error("--input is required");
  if (!existsSync(options.input)) throw new Error(`input GLB not found: ${options.input}`);

  if (options.inspect) {
    const measure = await measureGlb(options.input);
    process.stdout.write(`${JSON.stringify({ path: options.input, ...measure }, null, 2)}\n`);
    return;
  }

  await runRoomBake({
    input: options.input,
    output: options.output,
    resolution: options.resolution,
    report: options.report,
  });
}

const isMain =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/")) ||
    import.meta.url.includes("room-bake-cli"));

if (isMain) {
  runRoomBakeCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// Re-export for tests / consumers.
export async function readReport(reportPath: string): Promise<BakeReport> {
  return JSON.parse(await readFile(reportPath, "utf8")) as BakeReport;
}

export { pathToFileURL };
