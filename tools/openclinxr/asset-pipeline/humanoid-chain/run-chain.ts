#!/usr/bin/env -S pnpm exec tsx

/**
 * run-chain.ts — a re-derivable per-actor factory chain runner.
 *
 * Reads an ordered per-actor stage manifest (JSON: actorId, optional
 * materialize {tool, argv, provenance} carried verbatim into the report and
 * never executed, stages[] with
 * {id, name, tool, argv template, kind, inputs[]}, excluded[]) and runs the
 * kept stages in order. Each stage produces a write-once output
 * `<out>/<id>-<name>.glb`, prints `STAGE <id> <name> in=<sha8> out=<sha8>`,
 * and the run ends by writing `<out>/chain-report.json` (per stage: resolved
 * argv, tool sha256 at run time, in/out sha256).
 *
 * This runner is actor-generic: no actor id, asset path, or content hash is
 * hardcoded here. All actor specifics live in manifests/*.json.
 *
 * Placeholders in argv (and collectFrom): {in} {out} {outdir} {inBase}.
 * - {in}: previous stage output (or --input for the first stage).
 * - {out}: this stage's write-once output file.
 * - {outdir}: the --out directory (reports and work dirs live here).
 * - {inBase}: basename of {in} without the .glb suffix.
 *
 * In-place tools (argv names {out} but not {in}) get a copy of {in} at {out}
 * first, mirroring replay.sh copy_stage semantics. Tools that write their GLB
 * into a work dir (bake, optimize) use `collectFrom` to move the product to
 * {out}. kinds: node (pnpm exec tsx), python (mise exec -- python3 -I),
 * blender (blender --background --python; tools naming a #function fragment
 * have no standalone driver and stay excluded until a lane adds one).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  POST_EXPORT_STAGE_REGISTRY,
  type PostExportStage,
} from "@openclinxr/factory-station-core/runner";

export type StageKind = "node" | "python" | "blender";
export type ExcludedReason = "gap" | "metadata_only" | "superseded" | "other";

export interface StageInput {
  name: string;
  gitRef?: string;
  path?: string;
  sha256: string;
}

export interface ChainStage {
  id: string;
  name: string;
  tool: string;
  kind: StageKind;
  argv: string[];
  inputs?: StageInput[];
  collectFrom?: string;
  note?: string;
}

export interface ExcludedStage {
  id: string;
  name: string;
  reason: ExcludedReason;
  note: string;
}

export interface MaterializeRecord {
  tool: string;
  argv: string[];
  provenance: string;
}

export interface ChainManifest {
  actorId: string;
  /** Optional per-actor materialize (Blender bake) provenance record. Carried
   * into chain-report.json verbatim; the runner never executes it — scope is
   * the post-materialize replay. */
  materialize?: MaterializeRecord;
  stages: ChainStage[];
  excluded: ExcludedStage[];
}

export interface StageReport {
  id: string;
  name: string;
  kind: StageKind;
  tool: string;
  toolSha256: string;
  argv: string[];
  inSha256: string;
  outSha256: string;
}

const KINDS: StageKind[] = ["node", "python", "blender"];
const REASONS: ExcludedReason[] = ["gap", "metadata_only", "superseded", "other"];
const SHA256_RE = /^[0-9a-f]{64}$/;

function fail(what: string): never {
  throw new Error(`manifest: ${what}`);
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`expected object at ${what}`);
  return v as Record<string, unknown>;
}

function asNonEmptyString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) fail(`expected non-empty string at ${what}`);
  return v;
}

/** Validate a parsed manifest JSON value; throws on the first violation. */
export function validateManifest(
  raw: unknown,
  registry: Readonly<Record<string, PostExportStage | undefined>> = POST_EXPORT_STAGE_REGISTRY,
): ChainManifest {
  const m = asRecord(raw, "manifest");
  const actorId = asNonEmptyString(m["actorId"], "actorId");
  let materialize: MaterializeRecord | undefined;
  if (m["materialize"] !== undefined) {
    const r = asRecord(m["materialize"], "materialize");
    const tool = r["tool"];
    if (typeof tool !== "string" || tool.length === 0) {
      fail("materialize.tool must be a non-empty string");
    }
    const argv = r["argv"];
    if (!Array.isArray(argv) || argv.length === 0) {
      fail("materialize.argv must be a non-empty array");
    }
    for (const a of argv) {
      if (typeof a !== "string" || a.length === 0) {
        fail("materialize.argv entries must be non-empty strings");
      }
    }
    const provenance = r["provenance"];
    if (typeof provenance !== "string" || provenance.length === 0) {
      fail("materialize.provenance must be a non-empty string");
    }
    materialize = { tool, argv: argv as string[], provenance };
  }
  if (!Array.isArray(m["stages"]) || m["stages"].length === 0) fail("stages must be a non-empty array");
  if (!Array.isArray(m["excluded"])) fail("excluded must be an array");
  const seen = new Set<string>();
  const outNames = new Set<string>();
  const stages: ChainStage[] = m["stages"].map((s, i) => {
    const r = asRecord(s, `stages[${i}]`);
    const id = asNonEmptyString(r["id"], `stages[${i}].id`);
    const name = asNonEmptyString(r["name"], `stages[${i}].name`);
    const tool = asNonEmptyString(r["tool"], `stages[${i}].tool`);
    if (r["postExport"] !== undefined && typeof r["postExport"] !== "boolean") {
      fail(`stages[${i}] (${id}) postExport must be a boolean`);
    }
    if (r["postExport"] === true && (!Object.hasOwn(registry, tool) || registry[tool] === undefined)) {
      fail(`stages[${i}] (${id}) unregistered post-export tool: ${tool}`);
    }
    const kind = r["kind"];
    if (kind !== "node" && kind !== "python" && kind !== "blender") {
      fail(`stages[${i}] (${id}) has unknown kind ${JSON.stringify(kind)}; want one of ${KINDS.join("|")}`);
    }
    if (!Array.isArray(r["argv"]) || r["argv"].length === 0) fail(`stages[${i}] (${id}) argv must be a non-empty array`);
    for (const a of r["argv"]) {
      if (typeof a !== "string" || a.length === 0) fail(`stages[${i}] (${id}) argv entries must be non-empty strings`);
    }
    const flat = (r["argv"] as string[]).join(" ");
    if (!flat.includes("{in}") && !flat.includes("{out}")) {
      fail(`stages[${i}] (${id}) argv is missing a placeholder; want {in} and/or {out} (saw: ${flat})`);
    }
    if (seen.has(id)) fail(`duplicate stage id ${JSON.stringify(id)}`);
    seen.add(id);
    const outName = `${id}-${name}.glb`;
    if (outNames.has(outName)) fail(`duplicate stage output filename ${JSON.stringify(outName)}`);
    outNames.add(outName);
    const stage: ChainStage = { id, name, tool, kind: kind as StageKind, argv: r["argv"] as string[] };
    if (r["inputs"] !== undefined) {
      if (!Array.isArray(r["inputs"])) fail(`stages[${i}] (${id}) inputs must be an array`);
      stage.inputs = r["inputs"].map((inp, j) => {
        const ir = asRecord(inp, `stages[${i}].inputs[${j}]`);
        const inName = asNonEmptyString(ir["name"], `stages[${i}].inputs[${j}].name`);
        const sha = asNonEmptyString(ir["sha256"], `stages[${i}].inputs[${j}].sha256`);
        if (!SHA256_RE.test(sha)) fail(`stages[${i}].inputs[${j}] (${inName}) sha256 is not lowercase hex-64`);
        const entry: StageInput = { name: inName, sha256: sha };
        if (typeof ir["gitRef"] === "string" && ir["gitRef"].length > 0) entry.gitRef = ir["gitRef"];
        if (typeof ir["path"] === "string" && ir["path"].length > 0) entry.path = ir["path"];
        if ((entry.gitRef ? 1 : 0) + (entry.path ? 1 : 0) !== 1) {
          fail(`stages[${i}].inputs[${j}] (${inName}) needs exactly one of gitRef, path`);
        }
        return entry;
      });
    }
    if (r["collectFrom"] !== undefined) {
      stage.collectFrom = asNonEmptyString(r["collectFrom"], `stages[${i}].collectFrom`);
    }
    if (r["note"] !== undefined) {
      if (typeof r["note"] !== "string") fail(`stages[${i}].note must be a string`);
      stage.note = r["note"];
    }
    if (!flat.includes("{out}") && stage.collectFrom === undefined) {
      fail(`stages[${i}] (${id}) names no {out} and has no collectFrom; the stage would produce nothing`);
    }
    return stage;
  });
  const excluded: ExcludedStage[] = m["excluded"].map((s, i) => {
    const r = asRecord(s, `excluded[${i}]`);
    const reason = r["reason"];
    if (!REASONS.includes(reason as ExcludedReason)) {
      fail(`excluded[${i}] has unknown reason ${JSON.stringify(reason)}; want one of ${REASONS.join("|")}`);
    }
    const note = r["note"];
    if (typeof note !== "string" || note.length === 0) fail(`excluded[${i}] needs a required non-empty note`);
    return {
      id: asNonEmptyString(r["id"], `excluded[${i}].id`),
      name: asNonEmptyString(r["name"], `excluded[${i}].name`),
      reason: reason as ExcludedReason,
      note,
    };
  });
  return {
    actorId,
    ...(materialize === undefined ? {} : { materialize }),
    stages,
    excluded,
  };
}

/**
 * Path of the Blender materializer whose argparse set bounds recorded
 * materialize argv (read at invocation time; never imported or executed).
 */
export const MATERIALIZER_REL =
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py";

/** Flags a recorded materialize argv must always carry. F declares
 * `--output` with required=True (F :2635); the reference/role/garment/budget
 * pairs are per-actor data and stay in the manifests, not here. */
export const REQUIRED_MATERIALIZE_FLAGS: readonly string[] = ["--output"];

/** Repo root discovered by walking up from this module, so materializer
 * resolution never depends on process.cwd() (N1: print-materialize-invocation
 * from any cwd succeeds). Same pnpm-workspace.yaml walk as
 * packages/openclinxr/factory-station-core/src/repo-root.ts, inlined so this
 * tool keeps no package dependency. */
function repoRootFromModule(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`workspace root (pnpm-workspace.yaml) not found above ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
}

/** Parse the long-flag set from F's `add_argument("--...")` calls. Reads F at
 * call time so the bound tracks the materializer, not a stale copy. */
export function materializerFlagSet(source?: string): Set<string> {
  const text = source ?? readFileSync(join(repoRootFromModule(), MATERIALIZER_REL), "utf8");
  const flags = new Set<string>();
  for (const m of text.matchAll(/add_argument\(\s*["'](--[\w-]+)/g)) flags.add(m[1] as string);
  return flags;
}

/** Optional hook receiving the resolved (tool, argv). Default is a noop, so
 * the pure path never spawns; tests inject a recorder to capture the argv. */
export type MaterializeSpawn = (tool: string, argv: string[]) => void;

/**
 * materializeInvocation — resolve the recorded Blender bake command for a
 * manifest: substitute {out} with the given path, return the recorded
 * tool+argv verbatim otherwise. The chain runner never calls this during
 * replay (cap36: replay scope is post-materialize); it exists so a proof
 * script can re-derive the exact bake command from the manifest.
 *
 * Throws when the manifest carries no materialize record, when argv lacks
 * {out}, when argv names a flag F's argparse set does not declare, or when a
 * required flag (--output) is missing.
 */
export function materializeInvocation(
  manifest: ChainManifest,
  out: string,
  opts?: { knownFlags?: Set<string>; spawn?: MaterializeSpawn },
): { tool: string; argv: string[] } {
  const record = manifest.materialize;
  if (record === undefined) throw new Error("materialize: manifest carries no materialize record");
  if (!record.argv.some((a) => a.includes("{out}"))) {
    throw new Error("materialize: argv lacks {out}");
  }
  const known = opts?.knownFlags ?? materializerFlagSet();
  const used = new Set<string>();
  for (const a of record.argv) {
    if (a.startsWith("--")) used.add(a.split("=")[0] as string);
  }
  for (const flag of used) {
    if (!known.has(flag)) {
      throw new Error(`materialize: argv flag ${flag} is not declared by ${MATERIALIZER_REL}`);
    }
  }
  for (const flag of REQUIRED_MATERIALIZE_FLAGS) {
    if (!used.has(flag)) throw new Error(`materialize: argv misses required flag ${flag}`);
  }
  const argv = record.argv.map((a) => a.split("{out}").join(out));
  (opts?.spawn ?? (() => {}))(record.tool, argv);
  return { tool: record.tool, argv };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toolFileFor(tool: string): string {
  return tool.split("#")[0] ?? tool;
}

function substitute(template: string, vars: Record<string, string>): string {
  // Longest placeholder first so {in} never corrupts {inBase} if a template
  // ever names both.
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  let out = template;
  for (const k of keys) out = out.split(`{${k}}`).join(vars[k] as string);
  return out;
}

function runTool(kind: StageKind, root: string, toolAbs: string, argv: string[], stageId: string): void {
  let cmd = "";
  let args: string[] = [];
  if (kind === "node") {
    cmd = "pnpm";
    args = ["exec", "tsx", toolAbs, ...argv];
  } else if (kind === "python") {
    cmd = "mise";
    args = ["exec", "--", "python3", "-I", toolAbs, ...argv];
  } else {
    cmd = "blender";
    args = ["--background", "--python", toolAbs, "--", ...argv];
  }
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.error) throw new Error(`stage ${stageId}: failed to spawn ${cmd}: ${String(r.error.message ?? r.error)}`);
  if (r.status !== 0) throw new Error(`stage ${stageId}: ${cmd} exited ${r.status}`);
}

function materializeInput(root: string, outDir: string, stageId: string, inp: StageInput): void {
  const dest = join(outDir, ".inputs", inp.name);
  if (existsSync(dest)) {
    const actual = sha256File(dest);
    if (actual !== inp.sha256) {
      throw new Error(`stage ${stageId}: cached input ${dest} sha256 ${actual} != manifest ${inp.sha256}; refusing`);
    }
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (inp.gitRef) {
    const r = spawnSync("git", ["-C", root, "show", inp.gitRef], { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
    if (r.error) throw new Error(`stage ${stageId}: git show failed: ${String(r.error.message ?? r.error)}`);
    if (r.status !== 0) throw new Error(`stage ${stageId}: git show ${inp.gitRef} exited ${r.status}`);
    writeFileSync(dest, r.stdout as Buffer);
  } else {
    const src = isAbsolute(inp.path ?? "") ? (inp.path as string) : resolve(root, inp.path as string);
    if (!existsSync(src)) throw new Error(`stage ${stageId}: input path missing: ${src}`);
    copyFileSync(src, dest);
  }
  const actual = sha256File(dest);
  if (actual !== inp.sha256) {
    throw new Error(`stage ${stageId}: input ${inp.name} sha256 ${actual} != manifest ${inp.sha256}; refusing`);
  }
}

export interface RunChainOptions {
  manifestPath: string;
  input: string;
  out: string;
  root?: string;
  postExportRegistry?: Readonly<Record<string, PostExportStage | undefined>>;
}

export interface StageVars {
  [key: string]: string;
  in: string;
  out: string;
  outdir: string;
  inBase: string;
}

/**
 * resolveStageArgv — pure argv template substitution for one stage (the same
 * mapping runChain applies before spawning the tool). Exported so the
 * stage-21 replayability test resolves argv without running any stage.
 */
export function resolveStageArgv(stage: ChainStage, vars: StageVars): string[] {
  return stage.argv.map((a) => substitute(a, vars));
}

export interface ChainReport {
  generator: string;
  schemaVersion: string;
  actorId: string;
  manifest: string;
  manifestSha256: string;
  input: string;
  /** Echo of the manifest's materialize record when present (never executed). */
  materialize?: MaterializeRecord;
  stages: StageReport[];
  excluded: ExcludedStage[];
  status: "complete" | "failed";
  failedStage?: string;
  error?: string;
  claimScope: string;
  notEvidenceFor: string[];
}

export const CHAIN_CLAIM_SCOPE = "replays the kept post-materialize stages of this manifest only";
export const CHAIN_NOT_EVIDENCE_FOR = [
  "full historical reproduction",
  "visual acceptance",
  "clinical validity",
  "Quest readiness",
  "promotion",
];

/** Run every kept stage in manifest order; returns the chain report object. */
export function runChain(opts: RunChainOptions): ChainReport {
  const root = opts.root ?? process.cwd();
  const manifestRaw = readFileSync(opts.manifestPath, "utf8");
  const manifest = validateManifest(JSON.parse(manifestRaw), opts.postExportRegistry);
  const manifestSha256 = createHash("sha256").update(manifestRaw).digest("hex");
  const input = resolve(opts.input);
  if (!existsSync(input)) throw new Error(`input missing: ${input}`);
  const outDir = resolve(opts.out);
  if (existsSync(outDir)) throw new Error(`refusing to overwrite write-once stage: ${outDir} already exists`);
  mkdirSync(outDir);

  const baseReport = {
    generator: "tools/openclinxr/asset-pipeline/humanoid-chain/run-chain.ts",
    schemaVersion: "openclinxr.humanoid-chain.report.v1",
    actorId: manifest.actorId,
    manifest: opts.manifestPath,
    manifestSha256,
    input,
    ...(manifest.materialize === undefined ? {} : { materialize: manifest.materialize }),
    excluded: manifest.excluded,
    claimScope: CHAIN_CLAIM_SCOPE,
    notEvidenceFor: CHAIN_NOT_EVIDENCE_FOR,
  };

  const reports: StageReport[] = [];
  let prev = input;
  for (const stage of manifest.stages) {
    const inPath = prev;
    const outPath = join(outDir, `${stage.id}-${stage.name}.glb`);
    const tmpPath = join(outDir, `.tmp-${stage.id}-${stage.name}.glb`);
    if (existsSync(outPath)) throw new Error(`refusing to overwrite write-once stage: ${outPath}`);
    if (existsSync(tmpPath)) throw new Error(`refusing to overwrite write-once stage: ${tmpPath}`);
    try {
      for (const inp of stage.inputs ?? []) materializeInput(root, outDir, stage.id, inp);

      const vars = {
        in: inPath,
        out: tmpPath,
        outdir: outDir,
        inBase: basename(inPath).replace(/\.glb$/i, ""),
      };
      const argv = resolveStageArgv(stage, vars);
      // Make report/work dirs the argv names before the tool runs.
      // --out names a work DIRECTORY only in collectFrom stages (e.g. stage
      // 04 --out {outdir}/.work-04); otherwise {out} is the tool's output
      // FILE (e.g. stage 23 --out {out}) and pre-creating it as a directory
      // breaks file-producing tools (kevin-collar S5: os.replace onto the
      // mkdir'd dir raised IsADirectoryError).
      for (let i = 0; i < argv.length; i += 1) {
        if ((argv[i] === "--outdir" || (argv[i] === "--out" && stage.collectFrom)) && i + 1 < argv.length) {
          mkdirSync(argv[i + 1] as string, { recursive: true });
        } else if (argv[i] === "--report" && i + 1 < argv.length) {
          mkdirSync(dirname(argv[i + 1] as string), { recursive: true });
        }
      }

      const toolAbs = resolve(root, toolFileFor(stage.tool));
      if (!existsSync(toolAbs)) throw new Error(`stage ${stage.id}: tool missing: ${toolAbs}`);
      const toolSha256 = sha256File(toolAbs);
      const inSha256 = sha256File(inPath);

      const stdoutHasOut = argv.includes(tmpPath);
      const stdoutHasIn = argv.includes(inPath);
      if (stdoutHasOut && !stdoutHasIn) copyFileSync(inPath, tmpPath);
      runTool(stage.kind, root, toolAbs, argv, stage.id);
      if (stage.collectFrom) {
        const src = substitute(stage.collectFrom, vars);
        if (!existsSync(src)) throw new Error(`stage ${stage.id}: collectFrom missing: ${src}`);
        if (existsSync(outPath)) throw new Error(`refusing to overwrite write-once stage: ${outPath}`);
        renameSync(src, outPath);
        if (existsSync(tmpPath)) rmSync(tmpPath);
      } else {
        if (!existsSync(tmpPath)) {
          throw new Error(`stage ${stage.id}: tool produced no output at ${outPath}`);
        }
        if (existsSync(outPath)) throw new Error(`refusing to overwrite write-once stage: ${outPath}`);
        renameSync(tmpPath, outPath);
      }
      const outSha256 = sha256File(outPath);
      // eslint-disable-next-line no-console
      console.log(`STAGE ${stage.id} ${stage.name} in=${inSha256.slice(0, 8)} out=${outSha256.slice(0, 8)}`);
      reports.push({ id: stage.id, name: stage.name, kind: stage.kind, tool: stage.tool, toolSha256, argv, inSha256, outSha256 });
      prev = outPath;
    } catch (e) {
      if (existsSync(tmpPath)) rmSync(tmpPath);
      const msg = e instanceof Error ? e.message : String(e);
      const failed: ChainReport = { ...baseReport, stages: reports, status: "failed", failedStage: stage.id, error: msg };
      writeFileSync(join(outDir, "chain-report.json"), `${JSON.stringify(failed, null, 2)}\n`);
      throw e;
    }
  }

  const report: ChainReport = {
    ...baseReport,
    stages: reports,
    status: "complete",
  };
  writeFileSync(join(outDir, "chain-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseCli(argv: string[]): RunChainOptions {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifestPath = val("--manifest");
  const input = val("--input");
  const out = val("--out");
  if (!manifestPath || !input || !out) {
    throw new Error("usage: run-chain.ts --manifest <file> --input <glb> --out <dir> [--root <dir>]");
  }
  const root = val("--root");
  return root === undefined ? { manifestPath, input, out } : { manifestPath, input, out, root };
}

function main(): void {
  try {
    runChain(parseCli(process.argv.slice(2)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    if (msg.startsWith("usage:") || msg.startsWith("manifest:")) process.exit(2);
    else if (msg.startsWith("refusing to overwrite write-once stage:")) process.exit(3);
    else process.exit(1);
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
