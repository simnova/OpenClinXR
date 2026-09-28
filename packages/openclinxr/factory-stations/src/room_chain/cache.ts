/**
 * Room-chain stage cache (ward-finish-chain slice).
 *
 * Caches each stage's output under `.openclinxr/cache/room-chain/<stage>/<key>/`
 * (gitignored via the existing `.openclinxr/` entry). The key is a hash of every
 * input that can change the stage's output:
 *
 * - stage params, taken verbatim from the input object run.ts hands the stage
 * - relevant env (OPENCLINXR_ROOM_REALISM)
 * - content hash of every station script/python file the stage actually runs.
 *   The file list is derived programmatically from the same plan functions and
 *   module constants the runners use (planRoomGenerate / planRoomClinicFinish /
 *   planLightingDesign plus directory globs over the stage folders), so a new
 *   script file is picked up without a code change here.
 * - content hash of the applied Infinigen patch set (every *.patch under
 *   infinigen_generate/, globbed at hash time) plus the Infinigen source
 *   commit (`git rev-parse HEAD` in the tool install generate.ts resolves)
 *   plus the content hash of the installed decorate.py (the file generate.ts
 *   fail-closes on, which also carries live-only edits outside the patches)
 * - the Blender version string, queried via `blender --version`, never hardcoded
 * - the upstream stage's key (a changed bake invalidates finish; a changed
 *   finish invalidates lighting) plus the content hash of the work GLB bytes
 *   the stage actually reads (post-generate bytes for finish, post-finish
 *   bytes for lighting)
 *
 * The full key inputs are written as key.json beside the output: raw
 * values/hashes, human-inspectable, not just the final digest.
 *
 * Safety rules:
 * - only complete entries are served: storeStageCache assembles the entry in
 *   a sibling tmp dir and renames it into place after success; lookup requires
 *   the COMPLETE marker plus every expected artifact. A crashed/killed run
 *   leaves at most a tmp dir, which lookup removes and never serves.
 * - a key whose inputs cannot be hashed (missing file, failed Blender/Git
 *   probe) is REFUSED: miss plus a warning, never a hit, never stored, and
 *   the missing file is never silently dropped from the key.
 *
 * Same-package relative imports only; not part of the reviewed public surface.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import { planLightingDesign } from "../lighting_design/run.js";
import { ROOM_GENERATE_EXTRACT_REL, ROOM_GENERATE_MODULE_REL } from "../room_generate/generate.js";
import { planRoomGenerate } from "../room_generate/run.js";
import { planRoomClinicFinish } from "../room_clinic_finish/run.js";

export const ROOM_CHAIN_CACHE_REL = ".openclinxr/cache/room-chain";

export const ROOM_CHAIN_KEY_SCHEMA = "openclinxr.room-chain-stage-key.v1";

export type RoomChainCacheStage = "room_generate" | "room_clinic_finish" | "lighting_design";

export const ROOM_CHAIN_CACHE_STAGES: readonly RoomChainCacheStage[] = [
  "room_generate",
  "room_clinic_finish",
  "lighting_design",
];

/** Entry-side artifact names per stage (stable names inside the cache dir). */
export const ROOM_CHAIN_CACHE_ARTIFACTS: Record<RoomChainCacheStage, readonly string[]> = {
  room_generate: ["work.glb"],
  room_clinic_finish: ["work.glb", "recipe.json", "report.json"],
  lighting_design: ["rig.json", "report.json"],
};

export type RoomChainKeyFile = { rel: string; sha256: string };

export type RoomChainKeyInputs = {
  schemaVersion: typeof ROOM_CHAIN_KEY_SCHEMA;
  stage: RoomChainCacheStage;
  /** Stage params verbatim, exactly as run.ts hands them to the stage runner. */
  params: Record<string, unknown>;
  /** sha256 of the work GLB bytes the stage reads; null for room_generate. */
  workGlbSha256: string | null;
  /** Upstream stage key; null for room_generate. */
  upstreamKey: string | null;
  env: { OPENCLINXR_ROOM_REALISM: string };
  /** Queried `blender --version` first line, never hardcoded. */
  blenderVersion: string;
  infinigen: { source: string; commit: string; decorateSha256: string };
  patches: RoomChainKeyFile[];
  files: RoomChainKeyFile[];
};

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(absPath: string): string | null {
  try {
    return sha256Hex(readFileSync(absPath));
  } catch {
    return null;
  }
}

/** Canonical JSON: sorted keys at every level so hashing is field-order stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function stageKeyDigest(inputs: RoomChainKeyInputs): string {
  return sha256Hex(canonicalJson(inputs));
}

export function resolveInfinigenSource(): string {
  return (
    process.env["INFINIGEN_SOURCE"] ?? path.join(homedir(), ".openclinxr-tools/infinigen/source")
  );
}

function queryBlenderVersion(blender: string): string | null {
  try {
    const out = execFileSync(blender, ["--version"], { encoding: "utf8", timeout: 60_000 });
    const first = String(out).split("\n")[0]?.trim() ?? "";
    return first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

function queryGitHead(dir: string): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const head = String(out).trim();
    return head.length > 0 ? head : null;
  } catch {
    return null;
  }
}

function listDirFiles(absDir: string, include: (name: string) => boolean): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && include(entry.name))
    .map((entry) => path.join(absDir, entry.name))
    .sort();
}

const isPyFile = (name: string): boolean => name.endsWith(".py");
const isStationTs = (name: string): boolean => name.endsWith(".ts") && !name.endsWith(".test.ts");

/**
 * Every script/source file whose content can change the stage's output,
 * derived from the same plan functions and module constants the runners use.
 * Returns absolute paths. Throws when a stage plan rejects the input (the
 * caller must then skip the cache and let the real runner raise as usual).
 */
export function resolveStageKeyFiles(stage: RoomChainCacheStage, planInput: unknown): string[] {
  const root = repoRoot();
  const files = new Set<string>();
  const chainDir = path.join(root, "packages/openclinxr/factory-stations/src/room_chain");
  files.add(path.join(chainDir, "run.ts"));
  files.add(path.join(chainDir, "cache.ts"));

  // Infinigen patch set: every patch file, globbed at hash time so a new
  // patch is picked up without a code change here.
  const moduleDir = path.join(root, ROOM_GENERATE_MODULE_REL);
  for (const patch of listDirFiles(moduleDir, (name) => name.endsWith(".patch"))) {
    files.add(patch);
  }

  if (stage === "room_generate") {
    const planned = planRoomGenerate(planInput);
    if (planned.issues !== undefined) {
      throw new Error(planned.issues.map((issue) => issue.message).join("; "));
    }
    files.add(String(planned.plan["albedoScript"]));
    files.add(String(planned.plan["occlusionScript"]));
    for (const script of listDirFiles(moduleDir, isPyFile)) files.add(script);
    files.add(path.join(root, ROOM_GENERATE_EXTRACT_REL));
    const stationDir = path.join(root, "packages/openclinxr/factory-stations/src/room_generate");
    for (const ts of listDirFiles(stationDir, isStationTs)) files.add(ts);
  } else if (stage === "room_clinic_finish") {
    const planned = planRoomClinicFinish(planInput);
    if (planned.issues !== undefined) {
      throw new Error(planned.issues.map((issue) => issue.message).join("; "));
    }
    files.add(String(planned.plan["stageScript"]));
    for (const script of planned.plan["moduleScripts"] as string[]) files.add(script);
    // compose.py loads photo/procedural textures from its sibling textures/
    // dir; a changed texture changes finish output.
    const texturesDir = path.join(
      root,
      "packages/openclinxr/factory-stations/src/room_clinic_finish/textures",
    );
    for (const tex of listDirFiles(texturesDir, () => true)) files.add(tex);
    const stationDir = path.join(
      root,
      "packages/openclinxr/factory-stations/src/room_clinic_finish",
    );
    for (const ts of listDirFiles(stationDir, isStationTs)) files.add(ts);
  } else {
    const planned = planLightingDesign(planInput);
    if (planned.issues !== undefined) {
      throw new Error(planned.issues.map((issue) => issue.message).join("; "));
    }
    files.add(String(planned.plan["stageScript"]));
    const stationDir = path.join(root, "packages/openclinxr/factory-stations/src/lighting_design");
    for (const ts of listDirFiles(stationDir, isStationTs)) files.add(ts);
  }
  return [...files].sort();
}

export type CollectStageKeyOptions = {
  /** Stage input object, exactly as run.ts hands it to the stage runner. */
  input: Record<string, unknown>;
  /** Absolute work GLB path whose bytes join the key; omit for room_generate. */
  workGlbPath?: string;
  upstreamKey?: string | null;
  blender?: string;
  /** Test hook: bypass the Blender/Git/filesystem probes. */
  overrides?: {
    blenderVersion?: string;
    infinigenCommit?: string;
    infinigenDecorateSha256?: string;
    fileSha256?: (absPath: string) => string | null;
  };
};

export type CollectStageKeyResult =
  | { ok: true; inputs: RoomChainKeyInputs; key: string }
  | { ok: false; warning: string };

/**
 * Build the full key inputs for a stage. Any input that cannot be hashed
 * (missing file, failed probe) REFUSES the key: miss plus a warning, never
 * a hit, never stored, and the missing file is never silently dropped.
 */
export function collectStageKeyInputs(
  stage: RoomChainCacheStage,
  options: CollectStageKeyOptions,
): CollectStageKeyResult {
  const root = repoRoot();
  const blender = options.blender ?? process.env["BLENDER"] ?? "blender";
  const hashFile = options.overrides?.fileSha256 ?? sha256File;

  let stageFiles: string[];
  try {
    stageFiles = resolveStageKeyFiles(stage, options.input);
  } catch (error) {
    return {
      ok: false,
      warning: `cache skip ${stage}: stage plan failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  const blenderVersion =
    options.overrides?.blenderVersion ?? queryBlenderVersion(blender);
  if (blenderVersion === null || blenderVersion === undefined) {
    return { ok: false, warning: `cache skip ${stage}: cannot query Blender version (${blender} --version failed)` };
  }

  const source = resolveInfinigenSource();
  const commit = options.overrides?.infinigenCommit ?? queryGitHead(source);
  if (commit === null || commit === undefined) {
    return { ok: false, warning: `cache skip ${stage}: cannot resolve Infinigen commit (${source})` };
  }
  const decorateAbs = path.join(
    source,
    "infinigen/core/constraints/example_solver/room/decorate.py",
  );
  const decorateSha256 = options.overrides?.infinigenDecorateSha256 ?? hashFile(decorateAbs);
  if (decorateSha256 === null) {
    return { ok: false, warning: `cache skip ${stage}: cannot hash ${decorateAbs}` };
  }

  let workGlbSha256: string | null = null;
  if (options.workGlbPath !== undefined) {
    workGlbSha256 = hashFile(options.workGlbPath);
    if (workGlbSha256 === null) {
      return { ok: false, warning: `cache skip ${stage}: cannot hash work GLB ${options.workGlbPath}` };
    }
  }

  const toRel = (abs: string): string => path.relative(root, abs);
  const patches: RoomChainKeyFile[] = [];
  const files: RoomChainKeyFile[] = [];
  for (const abs of stageFiles) {
    const sha = hashFile(abs);
    if (sha === null) {
      return { ok: false, warning: `cache skip ${stage}: cannot hash ${abs}` };
    }
    const entry = { rel: toRel(abs), sha256: sha };
    if (abs.endsWith(".patch")) patches.push(entry);
    else files.push(entry);
  }

  const inputs: RoomChainKeyInputs = {
    schemaVersion: ROOM_CHAIN_KEY_SCHEMA,
    stage,
    params: options.input,
    workGlbSha256,
    upstreamKey: options.upstreamKey ?? null,
    env: {
      OPENCLINXR_ROOM_REALISM: process.env["OPENCLINXR_ROOM_REALISM"] ?? "<unset>",
    },
    blenderVersion,
    infinigen: { source, commit, decorateSha256 },
    patches,
    files,
  };
  return { ok: true, inputs, key: stageKeyDigest(inputs) };
}

export function stageCacheRoot(root: string = repoRoot()): string {
  return path.join(root, ROOM_CHAIN_CACHE_REL);
}

export function stageCacheDir(stage: RoomChainCacheStage, key: string, root: string = repoRoot()): string {
  return path.join(stageCacheRoot(root), stage, key);
}

function tmpSibling(dir: string): string {
  return `${dir}.tmp-${process.pid}`;
}

/**
 * Look up a cache entry. Serves only COMPLETE entries with key.json,
 * result.json and every expected artifact; a leftover tmp dir or an
 * incomplete entry is removed and never served.
 */
export function lookupStageCache(
  stage: RoomChainCacheStage,
  key: string,
  root: string = repoRoot(),
): string | null {
  const dir = stageCacheDir(stage, key, root);
  const tmp = tmpSibling(dir);
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  if (!existsSync(dir)) return null;
  const expected = ["COMPLETE", "key.json", "result.json", ...ROOM_CHAIN_CACHE_ARTIFACTS[stage]];
  for (const name of expected) {
    if (!existsSync(path.join(dir, name))) {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
  }
  try {
    const stored = JSON.parse(readFileSync(path.join(dir, "key.json"), "utf8")) as {
      digest?: unknown;
    };
    if (stored.digest !== key) {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return dir;
}

export function readCachedResult(entryDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(entryDir, "result.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Copy cached artifacts into their destination paths (mkdir -p the parents). */
export function restoreStageCache(
  entryDir: string,
  dest: Record<string, string>,
): void {
  for (const [entryName, destPath] of Object.entries(dest)) {
    mkdirSync(path.dirname(destPath), { recursive: true });
    copyFileSync(path.join(entryDir, entryName), destPath);
  }
}

/**
 * Store a stage result. Assembles the entry in a sibling tmp dir and renames
 * it into place, so a crashed/killed run can never leave a servable entry.
 * Never throws: a cache-write failure must not fail a stage that succeeded.
 */
export function storeStageCache(
  stage: RoomChainCacheStage,
  key: string,
  inputs: RoomChainKeyInputs,
  result: Record<string, unknown>,
  artifacts: Record<string, string>,
  root: string = repoRoot(),
): void {
  const dir = stageCacheDir(stage, key, root);
  const tmp = tmpSibling(dir);
  try {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      path.join(tmp, "key.json"),
      `${JSON.stringify({ digest: key, inputs }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(path.join(tmp, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    for (const [entryName, srcPath] of Object.entries(artifacts)) {
      copyFileSync(srcPath, path.join(tmp, entryName));
    }
    writeFileSync(path.join(tmp, "COMPLETE"), "complete\n", "utf8");
    mkdirSync(path.dirname(dir), { recursive: true });
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
    process.stdout.write(`cache store ${stage} ${key}\n`);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    process.stdout.write(
      `cache skip ${stage}: store failed (${error instanceof Error ? error.message : String(error)})\n`,
    );
  }
}
