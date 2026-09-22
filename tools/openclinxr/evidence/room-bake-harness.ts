/**
 * Score one Infinigen room, control GLB against treatment GLB.
 *
 * --measure-only decodes packed openclinxr_room_bake_* PNGs and writes wall,
 * floor, and ceiling mean luminance. It does not start Blender and does not
 * score triangle counts or texture byte size.
 *
 * --bake-treatment copies the control under .openclinxr/evidence/room-bake-harness/
 * and runs the single-room baker room-bake-cli.ts with --light-rig.
 * The shipped primary-care GLB is refused before any write.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { decodePng } from "./decode-png.js";

export const SHIPPED_PRIMARY_CARE_GLB =
  "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb";

export const ROOM_BAKE_HARNESS_DIR = ".openclinxr/evidence/room-bake-harness";

export const DEFAULT_HARNESS_REPORT = path.join(ROOM_BAKE_HARNESS_DIR, "report.json");

/** Single-room baker. This harness does not run the fleet bake. */
export const ROOM_BAKE_CLI = "tools/openclinxr/asset-pipeline/environment/room-bake-cli.ts";

export const LIGHT_RIGS = ["legacy", "distributed", "rig"] as const;
export type LightRig = (typeof LIGHT_RIGS)[number];

export type SurfaceMeans = {
  path: string;
  wall: number;
  floor: number;
  ceiling: number;
};

export type RoomBakeHarnessReport = {
  schemaVersion: "openclinxr.room-bake-harness.v1";
  mode: "measure-only";
  reportPath: string;
  control: SurfaceMeans;
  treatment: SurfaceMeans;
};

export type BakeTreatmentResult = {
  mode: "bake-treatment";
  controlPath: string;
  treatmentPath: string;
  lightRig: LightRig;
  bakerArgv: string[];
};

export type RoomBakeHarnessSpawn = (argv: readonly string[]) => void;

type Surface = "wall" | "floor" | "ceiling";

const io = new NodeIO();

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function resolveRepoPath(p: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(repoRoot(), p);
}

export function isShippedPrimaryCareGlb(candidate: string): boolean {
  return resolveRepoPath(candidate) === resolveRepoPath(SHIPPED_PRIMARY_CARE_GLB);
}

/**
 * Wall tile, floor tile, ceiling plaster — the split in
 * the-room-bake-reports-what-it-baked.test.ts (hexagon tile, square tile,
 * shader_plaster) and classify_surface() order in room-albedo-ao-bake.py.
 * square_tile is tested before marble so the floor tile is not labelled a wall.
 */
export function surfaceForBakeName(name: string): Surface | null {
  const n = name.toLowerCase();
  if (n.length === 0 || n.includes("openclinxr_room_ao_")) return null;
  if (n.includes("plaster") || n.includes("ceiling")) return "ceiling";
  if (n.includes("square_tile") || n.includes("floor")) return "floor";
  if (
    n.includes("hexagon")
    || n.includes("wall")
    || n.includes("marble")
    || n.includes("ceramic")
  ) {
    return "wall";
  }
  return null;
}

function meanLuminance255(png: Uint8Array): number {
  const decoded = decodePng(png);
  if (!decoded || decoded.lum.length === 0) {
    throw new Error("packed bake image is not a decodable 8-bit PNG");
  }
  let sum = 0;
  for (let i = 0; i < decoded.lum.length; i += 1) {
    const sample = decoded.lum[i];
    if (sample !== undefined) sum += sample;
  }
  return sum / decoded.lum.length;
}

export async function measureSurfaceMeans(glbPath: string): Promise<SurfaceMeans> {
  const abs = resolveRepoPath(glbPath);
  const doc = await io.read(abs);
  const found: Partial<Record<Surface, number>> = {};
  for (const material of doc.getRoot().listMaterials()) {
    const tex = material.getBaseColorTexture();
    if (!tex) continue;
    const surface = surfaceForBakeName(tex.getName() ?? "")
      ?? surfaceForBakeName(material.getName() ?? "");
    if (!surface || found[surface] !== undefined) continue;
    const image = tex.getImage();
    if (!image) continue;
    found[surface] = meanLuminance255(image);
  }
  const means: SurfaceMeans = {
    path: abs,
    wall: found.wall ?? Number.NaN,
    floor: found.floor ?? Number.NaN,
    ceiling: found.ceiling ?? Number.NaN,
  };
  for (const surface of ["wall", "floor", "ceiling"] as const) {
    if (!Number.isFinite(means[surface])) {
      throw new Error(`missing finite ${surface} mean luminance in ${abs}`);
    }
  }
  return means;
}

export function treatmentGlbPath(control: string, lightRig: LightRig): string {
  const stem = path.basename(control).replace(/\.glb$/i, "");
  return path.join(ROOM_BAKE_HARNESS_DIR, `${stem}-${lightRig}.glb`);
}

export function roomBakeCliArgv(input: string, output: string, lightRig: LightRig): string[] {
  return [
    ROOM_BAKE_CLI,
    "--input",
    input,
    "--output",
    output,
    "--light-rig",
    lightRig,
  ];
}

function defaultSpawn(argv: readonly string[]): void {
  execFileSync("pnpm", ["exec", "tsx", ...argv], {
    cwd: repoRoot(),
    stdio: "inherit",
    env: process.env,
  });
}

type Parsed = {
  measureOnly: boolean;
  bakeTreatment: boolean;
  help: boolean;
  control: string;
  treatment?: string;
  output?: string;
  report: string;
  lightRig?: LightRig;
};

function parseArgs(args: readonly string[]): Parsed {
  const parsed: Parsed = {
    measureOnly: false,
    bakeTreatment: false,
    help: false,
    control: SHIPPED_PRIMARY_CARE_GLB,
    report: DEFAULT_HARNESS_REPORT,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    const next = () => {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--measure-only") parsed.measureOnly = true;
    else if (arg === "--bake-treatment") parsed.bakeTreatment = true;
    else if (arg === "--help") parsed.help = true;
    else if (arg === "--control") parsed.control = next();
    else if (arg === "--treatment") parsed.treatment = next();
    else if (arg === "--output") parsed.output = next();
    else if (arg === "--report") parsed.report = next();
    else if (arg === "--light-rig") {
      const value = next();
      if (!LIGHT_RIGS.includes(value as LightRig)) {
        throw new Error(`--light-rig must be one of ${LIGHT_RIGS.join("|")}`);
      }
      parsed.lightRig = value as LightRig;
    } else {
      throw new Error(`Unknown room-bake-harness option: ${arg}`);
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "Usage: tsx tools/openclinxr/evidence/room-bake-harness.ts [options]",
    "  --measure-only          Decode packed bake images; do not start Blender",
    "  --control <glb>         Control GLB (default: shipped primary-care clinic)",
    "  --treatment <glb>       Treatment GLB (required with --measure-only)",
    "  --bake-treatment        Copy control and bake that copy with room-bake-cli.ts",
    "  --light-rig <name>      legacy | distributed | rig (required with --bake-treatment)",
    "  --output <glb>          Treatment GLB path (default: .openclinxr/evidence/room-bake-harness/)",
    "  --report <path>         Mean-luminance JSON (default: .openclinxr/evidence/room-bake-harness/report.json)",
  ].join("\n");
}

function refuseShippedWrite(candidate: string | undefined): void {
  if (candidate && isShippedPrimaryCareGlb(candidate)) {
    throw new Error(`refusing to write ${SHIPPED_PRIMARY_CARE_GLB}`);
  }
}

export async function runRoomBakeHarness(
  args: readonly string[] = process.argv.slice(2),
  deps: { spawn?: RoomBakeHarnessSpawn } = {},
): Promise<RoomBakeHarnessReport | BakeTreatmentResult | undefined> {
  const parsed = parseArgs(args);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed.measureOnly === parsed.bakeTreatment) {
    throw new Error("Pass exactly one of --measure-only or --bake-treatment");
  }

  // Refuse the shipped GLB before mkdir, copy, report write, or the baker.
  refuseShippedWrite(parsed.output);
  refuseShippedWrite(parsed.report);
  if (parsed.bakeTreatment) {
    if (!parsed.lightRig) throw new Error("--light-rig is required with --bake-treatment");
    const output = parsed.output ?? treatmentGlbPath(parsed.control, parsed.lightRig);
    refuseShippedWrite(output);
    const outputAbs = resolveRepoPath(output);
    refuseShippedWrite(outputAbs);
    const controlAbs = resolveRepoPath(parsed.control);
    const spawnArgv = roomBakeCliArgv(controlAbs, outputAbs, parsed.lightRig);
    await mkdir(path.dirname(outputAbs), { recursive: true });
    await copyFile(controlAbs, outputAbs);
    (deps.spawn ?? defaultSpawn)(spawnArgv);
    return {
      mode: "bake-treatment",
      controlPath: controlAbs,
      treatmentPath: outputAbs,
      lightRig: parsed.lightRig,
      bakerArgv: spawnArgv,
    };
  }

  if (!parsed.treatment) throw new Error("--treatment is required with --measure-only");
  const control = await measureSurfaceMeans(parsed.control);
  const treatment = await measureSurfaceMeans(parsed.treatment);
  const reportPath = resolveRepoPath(parsed.report);
  const report: RoomBakeHarnessReport = {
    schemaVersion: "openclinxr.room-bake-harness.v1",
    mode: "measure-only",
    reportPath,
    control,
    treatment,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function invokedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  return path.resolve(entry) === here
    || entry.replaceAll("\\", "/").endsWith("/room-bake-harness.ts");
}

if (invokedAsCli()) {
  runRoomBakeHarness().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
