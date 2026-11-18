/** Capture CLI model: preset/lever resolution and camera records (station render-parity). */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

const STATION_REL = "packages/openclinxr/stations/render-parity";
const PRESETS_DIR = path.join(repoRoot(), STATION_REL, "src/presets");

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

export async function resolveLevers(spec: string): Promise<{ name: string; levers: Record<string, unknown> }> {
  const inline = spec.trim().startsWith("{") ? spec : null;
  if (inline) return { name: "inline", levers: JSON.parse(inline) as Record<string, unknown> };
  const direct = path.isAbsolute(spec) ? spec : path.join(PRESETS_DIR, `${spec}.json`);
  try {
    const raw = await readFile(direct, "utf8");
    return { name: path.basename(direct, ".json"), levers: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    const raw = await readFile(path.resolve(spec), "utf8");
    return { name: path.basename(spec, ".json"), levers: JSON.parse(raw) as Record<string, unknown> };
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
