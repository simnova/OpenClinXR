/** Capture CLI model: preset/lever resolution and camera records (station render-parity). */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Package root: walk up from this module to the dir holding package.json, so
 * the same code resolves presets from src (vitest) and from dist (built).
 */
function packageRootDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("package root not found above render-parity module — refusing");
    dir = parent;
  }
}

const PRESETS_DIR = path.join(packageRootDir(), "src/presets");

/** Drivers dir (python scorers) resolved from the shipped package location. */
export function driversDir(): string {
  return path.join(packageRootDir(), "src/drivers");
}

/** URL of this entrypoint module (lets the pack test prove it imported the extract, not repo src). */
export const captureArgsModuleUrl: string = import.meta.url;

/** Resolve a CLI-relative path under the capture cwd (absolute paths pass through). */
export function resolveUnderCwd(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

export type Vec3 = [number, number, number];

export type CameraRec = {
  name: string;
  resolution: [number, number];
  vfov_deg: number;
  near: number;
  far: number;
  three: { position: Vec3; target: Vec3; up: Vec3; quaternion: [number, number, number, number] };
};

/** Parsed capture CLI: every flag the thin CLI forwards, with parsed --only/--rotations lists. */
export type CaptureCli = {
  cameras: string;
  out: string;
  levers: string;
  masks: boolean;
  calib: boolean;
  normalPass: boolean;
  dumpState: boolean;
  calibSweep: string;
  rotations: number[];
  refine: number;
  window: number;
  exposures: number[];
  only: string[];
  nohair: boolean;
  eyeShading: boolean;
  cwd: string;
};

/** Parse the capture argv into a CaptureCli, refusing unknown flags and missing required ones. */
export function parseCaptureArgs(argv: string[]): CaptureCli {
  const cli: CaptureCli = {
    cameras: "",
    out: "",
    levers: "",
    masks: false,
    calib: false,
    normalPass: false,
    dumpState: false,
    calibSweep: "",
    rotations: [0, 90, 180, 270],
    refine: 5,
    window: 20,
    exposures: [],
    only: [],
    nohair: false,
    eyeShading: false,
    cwd: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--cameras") cli.cameras = take();
    else if (arg === "--out") cli.out = take();
    else if (arg === "--levers") cli.levers = take();
    else if (arg === "--masks") cli.masks = true;
    else if (arg === "--calib") cli.calib = true;
    else if (arg === "--normal-pass") cli.normalPass = true;
    else if (arg === "--dump-state") cli.dumpState = true;
    else if (arg === "--calib-sweep") cli.calibSweep = take();
    else if (arg === "--rotations") cli.rotations = take().split(",").map(Number);
    else if (arg === "--refine") cli.refine = Number(take());
    else if (arg === "--window") cli.window = Number(take());
    else if (arg === "--exposures") cli.exposures = take().split(",").map(Number);
    else if (arg === "--only") cli.only = take().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--nohair") cli.nohair = true;
    else if (arg === "--eye-shading") cli.eyeShading = true;
    else if (arg === "--cwd") cli.cwd = take();
    else throw new Error(`unknown arg ${arg}`);
  }
  if (!cli.cameras) throw new Error("--cameras <p1a cameras.json> is required");
  if (!cli.out && !cli.calibSweep) throw new Error("--out <dir> is required (unless --calib-sweep writes its own path)");
  if (!cli.levers && !cli.masks) throw new Error("--levers <preset|json|path> is required (beauty/calib modes)");
  if (cli.masks && cli.calib) throw new Error("--masks and --calib are mutually exclusive");
  if (cli.normalPass && (cli.masks || cli.calib)) {
    throw new Error("--normal-pass is mutually exclusive with --masks/--calib");
  }
  if (cli.dumpState && (cli.masks || cli.calib || cli.normalPass)) {
    throw new Error("--dump-state is mutually exclusive with --masks/--calib/--normal-pass");
  }
  return cli;
}

/** I7: refuse a preset whose physical.eyeShade carries non-finite or out-of-range values. */
function validateEyeShade(levers: Record<string, unknown>, source: string): void {
  const physical = levers["physical"];
  if (physical === undefined || physical === null) return;
  if (typeof physical !== "object") throw new Error(`preset ${source}: physical must be an object — refusing`);
  const eye = (physical as Record<string, unknown>)["eyeShade"];
  if (eye === undefined || eye === null) return;
  if (typeof eye !== "object") throw new Error(`preset ${source}: physical.eyeShade must be an object — refusing`);
  const rec = eye as Record<string, unknown>;
  const num = (k: string): number => {
    const v = rec[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`preset ${source}: physical.eyeShade.${k} must be a finite number — refusing`);
    }
    return v;
  };
  const atten = num("scleraAtten");
  const band = num("lidBandM");
  const darken = num("lidDarken");
  if (atten < 0 || atten > 1) throw new Error(`preset ${source}: eyeShade.scleraAtten ${atten} outside 0..1 — refusing`);
  if (!(band > 0)) throw new Error(`preset ${source}: eyeShade.lidBandM ${band} must be > 0 — refusing`);
  if (darken < 0 || darken > 1) throw new Error(`preset ${source}: eyeShade.lidDarken ${darken} outside 0..1 — refusing`);
}

/** Resolve a lever spec to its preset name and parsed levers: inline JSON, a preset name, or a cwd-relative path. */
export async function resolveLevers(spec: string, cwd: string = process.cwd()): Promise<{ name: string; levers: Record<string, unknown> }> {
  const inline = spec.trim().startsWith("{") ? spec : null;
  if (inline) {
    const levers = JSON.parse(inline) as Record<string, unknown>;
    validateEyeShade(levers, "inline");
    return { name: "inline", levers };
  }
  const direct = path.isAbsolute(spec) ? spec : path.join(PRESETS_DIR, `${spec}.json`);
  try {
    const raw = await readFile(direct, "utf8");
    const levers = JSON.parse(raw) as Record<string, unknown>;
    validateEyeShade(levers, path.basename(direct, ".json"));
    return { name: path.basename(direct, ".json"), levers };
  } catch (err) {
    if (err instanceof Error && err.message.includes("eyeShade")) throw err;
    const raw = await readFile(resolveUnderCwd(cwd, spec), "utf8");
    const levers = JSON.parse(raw) as Record<string, unknown>;
    validateEyeShade(levers, path.basename(spec, ".json"));
    return { name: path.basename(spec, ".json"), levers };
  }
}

export function loadCameras(camerasJson: string): CameraRec[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = JSON.parse(camerasJson) as {
    cameras: Array<{
      name: string;
      resolution: [number, number];
      vfov_deg: number;
      near: number;
      far: number;
      three: CameraRec["three"];
    }>;
  };
  return raw.cameras.map((c) => ({
    name: c.name,
    resolution: c.resolution,
    vfov_deg: c.vfov_deg,
    near: c.near,
    far: c.far,
    three: c.three,
  }));
}
