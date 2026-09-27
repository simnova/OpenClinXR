import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { repoRoot } from "../repo-root.js";

export const ROOM_GENERATE_MODULE_REL =
  "packages/openclinxr/factory-stations/src/room_generate/infinigen_generate";
export const ROOM_GENERATE_EXTRACT_REL =
  "tools/openclinxr/asset-pipeline/environment/infinigen-single-room-extract.py";

/**
 * Pinned wall thickness (metres). The pre-solidify polygon is grown by wt/2
 * per side, so the gin binding MUST match or the interior clear floor drifts
 * by the mismatch per axis. Matches PINNED_WALL_THICKNESS upstream.
 */
export const ROOM_GENERATE_WALL_THICKNESS_M = 0.22;

/** The fixed-footprint builder always makes one Bedroom; the extract/probe select it. */
const GENERATED_ROOM = "bedroom";

export type RoomGenerateFootprint = {
  width: number;
  depth: number;
  ceilingHeight: number;
};

export type RoomGenerateDoor = {
  doorWall?: string;
  wallOffsetM?: number;
  hingeSide?: string;
  widthM?: number;
  heightM?: number;
};

export type InfinigenGenerateInput = {
  environmentId: string;
  footprintMeters: RoomGenerateFootprint;
  door?: RoomGenerateDoor;
  seed: number;
};

export type InfinigenGenerateOptions = {
  blender: string;
  workGlb: string;
  cwd?: string | undefined;
  /** Per-spawn timeout; generation + 3 Blender passes each get this budget. */
  timeoutMs?: number | undefined;
  infinigenSource?: string | undefined;
  venvPython?: string | undefined;
};

export type InfinigenGenerateReport = {
  ran: true;
  seed: number;
  environmentId: string;
  footprintMeters: RoomGenerateFootprint;
  /** Effective door (explicit fields plus legacy-pin defaults). */
  door: Required<Pick<RoomGenerateDoor, "doorWall" | "wallOffsetM" | "hingeSide">> &
    Pick<RoomGenerateDoor, "widthM" | "heightM">;
  outputDir: string;
  sceneBlend: string;
  workBlend: string;
  workGlb: string;
  predicatePath: string;
  probePath: string;
  probe: Record<string, unknown>;
  extractSummary: Record<string, unknown>;
  predicatePass: boolean | null;
  durationsMs: Record<string, number>;
};

function spawnProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string | undefined> },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: Error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function lastLineJson(stdout: string): Record<string, unknown> {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]!) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  throw new Error(`no JSON summary line in process output:\n${stdout.slice(-2000)}`);
}

/**
 * GENERATE step: runs the fixed-footprint Infinigen driver, strips shell
 * placeholders, extracts the single room to workGlb, and probes door
 * placement. Opt-in: runRoomGenerate calls this only when footprintMeters
 * is present; legacy callers never reach here.
 */
export async function runInfinigenGenerate(
  input: InfinigenGenerateInput,
  options: InfinigenGenerateOptions,
): Promise<InfinigenGenerateReport> {
  const root = repoRoot();
  const moduleDir = path.join(root, ROOM_GENERATE_MODULE_REL);
  const extractScript = path.join(root, ROOM_GENERATE_EXTRACT_REL);
  if (!existsSync(path.join(moduleDir, "run_fixed_footprint.py"))) {
    throw new Error(`infinigen generate module missing: ${moduleDir}`);
  }
  if (!existsSync(extractScript)) {
    throw new Error(`room extract script missing: ${extractScript}`);
  }
  const infinigenSource =
    options.infinigenSource ?? path.join(homedir(), ".openclinxr-tools/infinigen/source");
  const venvPython =
    options.venvPython ?? path.join(homedir(), ".openclinxr-tools/infinigen/venv/bin/python");
  if (!existsSync(venvPython)) {
    throw new Error(`infinigen venv python missing: ${venvPython}`);
  }
  if (!existsSync(path.join(infinigenSource, "infinigen_examples/generate_indoors.py"))) {
    throw new Error(`infinigen source missing: ${infinigenSource}`);
  }
  // Fail closed on a fresh install without the Concrete patch: without it
  // any Concrete-walled draw dies deep in generation with a TypeError.
  const decorate = path.join(
    infinigenSource,
    "infinigen/core/constraints/example_solver/room/decorate.py",
  );
  const decorateSrc = existsSync(decorate) ? readFileSync(decorate, "utf8") : "";
  if (!decorateSrc.includes('"Concrete"')) {
    throw new Error(
      `infinigen source lacks the Concrete wall patch; apply it first: sh ${path.join(moduleDir, "apply-patches.sh")}`,
    );
  }

  const door: InfinigenGenerateReport["door"] = {
    doorWall: input.door?.doorWall ?? "+y",
    wallOffsetM: input.door?.wallOffsetM ?? 0.5,
    hingeSide: input.door?.hingeSide ?? "+x",
    ...(input.door?.widthM !== undefined ? { widthM: input.door.widthM } : {}),
    ...(input.door?.heightM !== undefined ? { heightM: input.door.heightM } : {}),
  };
  const seed = Math.trunc(input.seed);
  const timeoutMs = options.timeoutMs ?? 1_200_000;
  const durationsMs: Record<string, number> = {};

  mkdirSync(path.dirname(options.workGlb), { recursive: true });
  const outputDir = path.join(
    path.dirname(options.workGlb),
    `${path.basename(options.workGlb, ".glb")}-infinigen-s${seed}`,
  );
  mkdirSync(outputDir, { recursive: true });
  const sceneBlend = path.join(outputDir, "scene.blend");
  const workBlend = path.join(outputDir, "work.blend");
  const predicatePath = path.join(outputDir, "predicate.json");
  const probePath = path.join(outputDir, "probe.json");

  const driverArgs = [
    "-m",
    "run_fixed_footprint",
    "--output_folder",
    outputDir,
    "-s",
    String(seed),
    "-g",
    "singleroom",
    "disable/clinical_single_furnished",
    "--interior-width",
    String(input.footprintMeters.width),
    "--interior-depth",
    String(input.footprintMeters.depth),
    "--wall-thickness",
    String(ROOM_GENERATE_WALL_THICKNESS_M),
    // NOTE: equals form -- the "-x" wall token would parse as a flag otherwise.
    `--door-wall=${door.doorWall}`,
    "--door-offset",
    String(door.wallOffsetM),
    // Interior clear ceiling = wall_height - wall_thickness (measured
    // seed 203: floor-slab top at +wt/2, ceiling plane at wall_height -
    // wt/2, so the walkable height is wall_height - wt). Compensate so the
    // requested ceilingHeight lands as interior clear, not mesh height.
    "--wall-height",
    String(input.footprintMeters.ceilingHeight + ROOM_GENERATE_WALL_THICKNESS_M),
    ...(door.widthM !== undefined ? ["--door-width-m", String(door.widthM)] : []),
    ...(door.heightM !== undefined ? ["--door-height-m", String(door.heightM)] : []),
    "-p",
    "compose_indoors.terrain_enabled=False",
    "compose_indoors.room_windows_enabled=False",
    "compose_indoors.solve_large_enabled=False",
    "compose_indoors.solve_medium_enabled=False",
    "compose_indoors.solve_small_enabled=False",
    "populate_doors.n_doors=3",
    "-t",
    "coarse",
  ];
  let started = Date.now();
  const generated = await spawnProcess(venvPython, driverArgs, {
    cwd: infinigenSource,
    timeoutMs,
    env: { PYTHONPATH: moduleDir, CUDA_VISIBLE_DEVICES: "None" },
  });
  durationsMs["generateMs"] = Date.now() - started;
  if (generated.code !== 0 || !existsSync(sceneBlend)) {
    throw new Error(
      `infinigen generate failed (exit ${generated.code}):\n${generated.stderr.slice(-4000)}`,
    );
  }

  started = Date.now();
  const stripped = await spawnProcess(
    options.blender,
    [
      "--background",
      "--python",
      path.join(moduleDir, "strip_room_shell_placeholders.py"),
      "--",
      "--blend",
      sceneBlend,
      "--room",
      GENERATED_ROOM,
      "--segment",
      "0",
      "--output",
      workBlend,
    ],
    { cwd: options.cwd ?? root, timeoutMs },
  );
  durationsMs["stripMs"] = Date.now() - started;
  if (stripped.code !== 0 || !existsSync(workBlend)) {
    throw new Error(
      `room shell strip failed (exit ${stripped.code}):\n${stripped.stderr.slice(-2000)}`,
    );
  }

  started = Date.now();
  const extracted = await spawnProcess(
    options.blender,
    [
      "--background",
      "--python",
      extractScript,
      "--",
      "--blend",
      workBlend,
      "--room",
      GENERATED_ROOM,
      "--segment",
      "0",
      "--output",
      options.workGlb,
      "--allow-predicate-refuse",
      "--predicate-output",
      predicatePath,
    ],
    { cwd: options.cwd ?? root, timeoutMs },
  );
  durationsMs["extractMs"] = Date.now() - started;
  if (extracted.code !== 0 || !existsSync(options.workGlb)) {
    throw new Error(
      `room extract failed (exit ${extracted.code}):\n${extracted.stderr.slice(-2000)}`,
    );
  }
  const extractSummary = lastLineJson(extracted.stdout);
  let predicatePass: boolean | null = null;
  try {
    const predicate = JSON.parse(readFileSync(predicatePath, "utf8")) as { pass?: unknown };
    if (typeof predicate.pass === "boolean") predicatePass = predicate.pass;
  } catch {
    predicatePass = null;
  }

  started = Date.now();
  const probed = await spawnProcess(
    options.blender,
    [
      "--background",
      "--python",
      path.join(moduleDir, "probe_door.py"),
      "--",
      "--blend",
      sceneBlend,
      "--room",
      GENERATED_ROOM,
      "--segment",
      "0",
      "--output",
      probePath,
    ],
    { cwd: options.cwd ?? root, timeoutMs },
  );
  durationsMs["probeMs"] = Date.now() - started;
  if (probed.code !== 0 || !existsSync(probePath)) {
    throw new Error(`door probe failed (exit ${probed.code}):\n${probed.stderr.slice(-2000)}`);
  }
  const probe = JSON.parse(readFileSync(probePath, "utf8")) as Record<string, unknown>;

  return {
    ran: true,
    seed,
    environmentId: input.environmentId,
    footprintMeters: { ...input.footprintMeters },
    door,
    outputDir,
    sceneBlend,
    workBlend,
    workGlb: options.workGlb,
    predicatePath,
    probePath,
    probe,
    extractSummary,
    predicatePass,
    durationsMs,
  };
}
