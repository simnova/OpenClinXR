import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";
import { runInfinigenGenerate, type InfinigenGenerateReport } from "./generate.js";
import { simplifyRoomAfterBake, type RoomSimplifyReport } from "./simplify.js";

export const ROOM_ALBEDO_REL =
  "packages/openclinxr/factory-stations/src/room_generate/room-albedo-ao-bake.py";
export const ROOM_OCCLUSION_REL =
  "packages/openclinxr/factory-stations/src/room_generate/room-occlusion-bake.py";

export function planRoomGenerate(input: unknown): StationPlanResult {
  const root = repoRoot();
  const planned = planFromCatalog("room_generate", input, (value) => ({
    environmentId: value["environmentId"],
    infinigenPrompt: value["infinigenPrompt"],
    seed: value["seed"],
    layoutVariant: value["layoutVariant"],
    bakerId: "room_environment",
    albedoScriptRel: ROOM_ALBEDO_REL,
    occlusionScriptRel: ROOM_OCCLUSION_REL,
    albedoScript: path.join(root, ROOM_ALBEDO_REL),
    occlusionScript: path.join(root, ROOM_OCCLUSION_REL),
    processIsolation: "fresh_subprocess",
  }));
  if (planned.issues !== undefined) return planned;
  // Nested validation for the opt-in GENERATE payload. The catalog "object"
  // type only checks "is an object"; the internal shape is enforced here so
  // a bad doorWall fails at plan time, not deep in generation.
  const nested = validateRoomGenerateOptions(planned.value);
  if (nested.length > 0) return { issues: nested };
  const plan: Record<string, unknown> = { ...planned.plan };
  if ("footprintMeters" in planned.value) plan["footprintMeters"] = planned.value["footprintMeters"];
  if ("door" in planned.value) plan["door"] = planned.value["door"];
  return { value: planned.value, plan: { mode: "dry-run", stationId: "room_generate", ...plan } };
}

/** Closed door-wall enum for the fixed-footprint generate step. */
export const ROOM_GENERATE_DOOR_WALLS = ["+x", "-x", "+y", "-y"] as const;

/** Closed door-style enum; pins the Infinigen door factory. Absent = random draw. */
export const ROOM_GENERATE_DOOR_STYLES = ["panel", "glass_panel", "louver", "lite"] as const;

/** Closed door-handle enum; pins BaseDoorFactory.handle_type. Absent = random draw. */
export const ROOM_GENERATE_DOOR_HANDLES = ["knob", "lever", "pull"] as const;

export type RoomGenerateDoorWall = (typeof ROOM_GENERATE_DOOR_WALLS)[number];

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Internal-shape validation for footprintMeters + door. Returns issues;
 * empty means the legacy shape (both absent) or a valid opt-in payload.
 */
export function validateRoomGenerateOptions(value: Record<string, unknown>): { message: string; path?: readonly (string | number)[] }[] {
  const issues: { message: string; path?: readonly (string | number)[] }[] = [];
  if ("footprintMeters" in value && value["footprintMeters"] !== undefined) {
    const fp = value["footprintMeters"] as Record<string, unknown>;
    for (const dim of ["width", "depth", "ceilingHeight"] as const) {
      if (!isPositiveNumber(fp[dim])) {
        issues.push({ message: `footprintMeters.${dim} expected positive number`, path: ["footprintMeters", dim] });
      }
    }
  }
  if ("door" in value && value["door"] !== undefined) {
    const door = value["door"] as Record<string, unknown>;
    const wall = door["doorWall"];
    if (typeof wall !== "string" || !(ROOM_GENERATE_DOOR_WALLS as readonly string[]).includes(wall)) {
      issues.push({
        message: `door.doorWall must be one of "+x", "-x", "+y", "-y" (got ${JSON.stringify(wall) ?? "missing"})`,
        path: ["door", "doorWall"],
      });
    }
    if ("wallOffsetM" in door && door["wallOffsetM"] !== undefined) {
      if (typeof door["wallOffsetM"] !== "number" || !Number.isFinite(door["wallOffsetM"])) {
        issues.push({ message: "door.wallOffsetM expected number", path: ["door", "wallOffsetM"] });
      }
    }
    if ("hingeSide" in door && door["hingeSide"] !== undefined) {
      const hinge = door["hingeSide"];
      if (typeof hinge !== "string" || !(ROOM_GENERATE_DOOR_WALLS as readonly string[]).includes(hinge)) {
        issues.push({ message: `door.hingeSide must be one of "+x", "-x", "+y", "-y"`, path: ["door", "hingeSide"] });
      } else if (
        typeof wall === "string" &&
        (ROOM_GENERATE_DOOR_WALLS as readonly string[]).includes(wall)
      ) {
        // The leaf swings in the wall's own extent from a jamb-mounted
        // hinge, so the hinge axis must be perpendicular to the wall normal.
        const wallAxis = wall.includes("x") ? "x" : "y";
        const hingeAxis = (hinge as string).includes("x") ? "x" : "y";
        if (wallAxis === hingeAxis) {
          issues.push({
            message: `door.hingeSide ${JSON.stringify(hinge)} must be on the perpendicular axis to doorWall ${JSON.stringify(wall)} (a ${wall} wall hinges on ${wallAxis === "x" ? '"+y" or "-y"' : '"+x" or "-x"'})`,
            path: ["door", "hingeSide"],
          });
        }
      }
    }
    if ("style" in door && door["style"] !== undefined) {
      const style = door["style"];
      if (
        typeof style !== "string" ||
        !(ROOM_GENERATE_DOOR_STYLES as readonly string[]).includes(style)
      ) {
        issues.push({
          message: `door.style must be one of "panel", "glass_panel", "louver", "lite" (got ${JSON.stringify(style) ?? "missing"})`,
          path: ["door", "style"],
        });
      }
    }
    if ("handle" in door && door["handle"] !== undefined) {
      const handle = door["handle"];
      if (
        typeof handle !== "string" ||
        !(ROOM_GENERATE_DOOR_HANDLES as readonly string[]).includes(handle)
      ) {
        issues.push({
          message: `door.handle must be one of "knob", "lever", "pull" (got ${JSON.stringify(handle) ?? "missing"})`,
          path: ["door", "handle"],
        });
      }
    }
    if ("liteRect" in door && door["liteRect"] !== undefined) {
      const rect = door["liteRect"];
      const ok =
        Array.isArray(rect) &&
        rect.length === 4 &&
        rect.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) &&
        (rect[0] as number) < (rect[1] as number) &&
        (rect[2] as number) < (rect[3] as number);
      if (!ok) {
        issues.push({
          message: "door.liteRect must be [xmin, xmax, ymin, ymax] leaf fractions in [0, 1] with xmin<xmax and ymin<ymax",
          path: ["door", "liteRect"],
        });
      }
    }
    for (const dim of ["bevelMm", "casingMarginM", "panelMarginM"] as const) {
      if (dim in door && door[dim] !== undefined && !isPositiveNumber(door[dim])) {
        issues.push({ message: `door.${dim} expected positive number`, path: ["door", dim] });
      }
    }
    for (const dim of ["widthM", "heightM"] as const) {
      if (dim in door && door[dim] !== undefined && !isPositiveNumber(door[dim])) {
        issues.push({ message: `door.${dim} expected positive number`, path: ["door", dim] });
      }
    }
  }
  return issues;
}

export type RoomGenerateRunOptions = {
  blender: string;
  workGlb: string;
  bakeAlbedo: boolean;
  bakeOcclusion?: boolean;
  albedoExtraArgs?: string[];
  occlusionExtraArgs?: string[];
  /** Post-bake trim-locked simplify; defaults on. UV bake needs the full mesh first. */
  simplifyAfterBake?: boolean;
  cwd?: string;
  timeoutMs?: number;
  /** Per-spawn budget for the opt-in Infinigen GENERATE step. */
  generateTimeoutMs?: number;
  infinigenSource?: string;
  venvPython?: string;
};

/**
 * Sibling log paths for a crashed bake pass, next to the work GLB. The
 * chain's own per-stage persistence only runs after a successful return,
 * so the failure site must persist the full streams itself.
 */
function roomBakeFailureLogPaths(
  workGlb: string,
  pass: "albedo" | "occlusion",
): { stdoutLog: string; stderrLog: string } {
  const dir = workGlb ? path.dirname(workGlb) : ".";
  const base = workGlb ? path.basename(workGlb, ".glb") : "room-generate";
  return {
    stdoutLog: path.join(dir, `${base}.${pass}.stdout.log`),
    stderrLog: path.join(dir, `${base}.${pass}.stderr.log`),
  };
}

function persistBakeFailureLogs(
  stdoutLog: string,
  stderrLog: string,
  stdout: string,
  stderr: string,
): void {
  mkdirSync(path.dirname(stdoutLog), { recursive: true });
  writeFileSync(stdoutLog, stdout, "utf8");
  writeFileSync(stderrLog, stderr, "utf8");
}

/** Unique spawn of room albedo/occlusion bake scripts. Tests must call plan(), not run(). */
export async function runRoomGenerate(input: unknown, options: RoomGenerateRunOptions): Promise<Record<string, unknown>> {
  const planned = planRoomGenerate(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const seed = Number(planned.value["seed"]);
  const environmentId = String(planned.value["environmentId"]);
  // Measured 2026-09-27: every Blender subprocess below is spawned with
  // cwd=repoCwd (repoRoot() by default), so a relative workGlb resolves
  // there for Blender's own --input/--output. But simplifyRoomAfterBake
  // below is pure Node I/O with no spawn involved -- it resolves the same
  // relative workGlb against process.cwd(), which is the PACKAGE directory
  // under `pnpm --filter <pkg> exec` (the real chain CLI's own invocation
  // shape), not repoRoot(). 5-of-5 reproduction: relative workGlb + Blender
  // bake succeeds + simplify ENOENTs, every time process.cwd() != repoRoot(),
  // confirmed present at the repoRoot()-relative path and absent at the
  // process.cwd()-relative path via statSync. Absolutize once, up front
  // (same fix generate.ts already applies to its own workGlb use), so every
  // stage -- Blender spawns and Node's own reads -- agrees on one file.
  const repoCwd = options.cwd ?? repoRoot();
  const workGlb = path.resolve(repoCwd, options.workGlb);
  options = { ...options, workGlb, cwd: repoCwd };
  // Opt-in GENERATE step: only when footprintMeters is present. Legacy call
  // shape (absent) keeps existing behavior -- workGlb already exists.
  let generate: InfinigenGenerateReport | null = null;
  if ("footprintMeters" in planned.value && planned.value["footprintMeters"] !== undefined) {
    const footprint = planned.value["footprintMeters"] as {
      width: number;
      depth: number;
      ceilingHeight: number;
    };
    const door = ("door" in planned.value && planned.value["door"] !== undefined
      ? (planned.value["door"] as Record<string, unknown>)
      : undefined) as
      | { doorWall?: string; wallOffsetM?: number; hingeSide?: string; widthM?: number; heightM?: number; style?: string }
      | undefined;
    generate = await runInfinigenGenerate(
      {
        environmentId,
        footprintMeters: { ...footprint },
        ...(door === undefined ? {} : { door }),
        seed,
      },
      {
        blender: options.blender,
        workGlb: options.workGlb,
        cwd: options.cwd,
        timeoutMs: options.generateTimeoutMs,
        infinigenSource: options.infinigenSource,
        venvPython: options.venvPython,
      },
    );
  }
  const albedoScript = String(planned.plan["albedoScript"]);
  const occlusionScript = String(planned.plan["occlusionScript"]);
  const cwd = options.cwd ?? repoRoot();
  const timeoutMs = options.timeoutMs ?? 600_000;
  const bakeOcclusion = options.bakeOcclusion !== false;
  let albedoExit: number | null = null;
  let occlusionExit: number | null = null;
  let albedoStdout = "";
  let albedoStderr = "";
  let occlusionStdout = "";
  let occlusionStderr = "";
  if (options.bakeAlbedo) {
    if (!existsSync(albedoScript)) throw new Error(`room albedo script missing: ${albedoScript}`);
    const albedoArgs = options.albedoExtraArgs ?? [
      "--input",
      options.workGlb,
      "--output",
      options.workGlb,
      "--resolution",
      "1024",
    ];
    const albedo = await spawnBlenderProcess(
      options.blender,
      ["--background", "--python", albedoScript, "--", ...albedoArgs],
      { cwd, timeoutMs },
    );
    albedoExit = albedo.code;
    albedoStdout = albedo.stdout;
    albedoStderr = albedo.stderr;
    // Fail closed: a crashed albedo pass must stop the chain here, before
    // the occlusion pass overwrites the evidence (S1: Blender used to exit
    // 0 on the link-failure RuntimeError and the occlusion output replaced
    // albedo's stdout/stderr, so the chain never noticed).
    if (albedoExit !== 0) {
      const { stdoutLog, stderrLog } = roomBakeFailureLogPaths(options.workGlb, "albedo");
      persistBakeFailureLogs(stdoutLog, stderrLog, albedoStdout, albedoStderr);
      if (albedo.timedOut) {
        throw new Error(
          `room albedo bake timed out after ${timeoutMs / 1000} s (signal ${albedo.signal ?? "unknown"}):\n${albedoStderr.slice(-2000)}\n(full stdout: ${stdoutLog}; full stderr: ${stderrLog})`,
        );
      }
      throw new Error(
        `room albedo bake failed with exit ${albedoExit}:\n${albedoStderr.slice(-2000)}\n(full stdout: ${stdoutLog}; full stderr: ${stderrLog})`,
      );
    }
  }
  if (bakeOcclusion) {
    if (!existsSync(occlusionScript)) {
      throw new Error(`room occlusion script missing: ${occlusionScript}`);
    }
    const occlusionArgs = options.occlusionExtraArgs ?? [
      "--input",
      options.workGlb,
      "--output",
      options.workGlb,
      "--resolution",
      "512",
      // Metal GPU backend: adopted 2026-09-29 after the Cycles AO
      // bake-off (docs/openclinxr/room-realism/
      // room-chain-metal-measure/ao-cycles-report.md) showed a wall-time
      // win with byte-identical baked pixels run-to-run on Metal and
      // 0.0/255 CPU-vs-Metal mean difference on the seed-205 ward. The
      // script fails closed when no Metal device exists.
      "--device",
      "metal",
    ];
    const occlusion = await spawnBlenderProcess(
      options.blender,
      ["--background", "--python", occlusionScript, "--", ...occlusionArgs],
      { cwd, timeoutMs },
    );
    occlusionExit = occlusion.code;
    occlusionStdout = occlusion.stdout;
    occlusionStderr = occlusion.stderr;
    if (occlusionExit !== 0) {
      const { stdoutLog, stderrLog } = roomBakeFailureLogPaths(options.workGlb, "occlusion");
      persistBakeFailureLogs(stdoutLog, stderrLog, occlusionStdout, occlusionStderr);
      if (occlusion.timedOut) {
        throw new Error(
          `room occlusion bake timed out after ${timeoutMs / 1000} s (signal ${occlusion.signal ?? "unknown"}):\n${occlusionStderr.slice(-2000)}\n(full stdout: ${stdoutLog}; full stderr: ${stderrLog})`,
        );
      }
      throw new Error(
        `room occlusion bake failed with exit ${occlusionExit}:\n${occlusionStderr.slice(-2000)}\n(full stdout: ${stdoutLog}; full stderr: ${stderrLog})`,
      );
    }
  }
  let simplify: RoomSimplifyReport | null = null;
  if (options.simplifyAfterBake !== false && options.workGlb !== "") {
    simplify = await simplifyRoomAfterBake(options.workGlb);
  }
  return {
    stationId: "room_generate",
    seed,
    environmentId,
    albedoExit,
    occlusionExit,
    blenderExit: occlusionExit ?? albedoExit,
    albedoStdout,
    albedoStderr,
    occlusionStdout,
    occlusionStderr,
    // Legacy combined view: albedo first so a passing occlusion run can no
    // longer hide a crashed albedo pass. Prefer the per-pass fields above.
    stdout: `${albedoStdout}${occlusionStdout}`,
    stderr: `${albedoStderr}${occlusionStderr}`,
    simplify,
    generate,
  };
}

export const roomGenerateRunner: StationRunner = {
  stationId: "room_generate",
  validate: (value) => factoryStationSchemas.room_generate["~standard"].validate(value),
  plan: planRoomGenerate,
  run: (value) => runRoomGenerate(value, { blender: "blender", workGlb: "", bakeAlbedo: false }),
};
