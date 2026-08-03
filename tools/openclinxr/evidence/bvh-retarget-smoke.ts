/**
 * bvh-retarget-smoke.ts — end-to-end gate for the BVH -> full-Anny retarget bake.
 *
 * Runs the real headless Blender bake (apply_bvh_to_anny_full.py), then validates the
 * emitted diagnostics (motion / thigh swing / self-standing rest / mesh explode / skin
 * weights / license) plus a GLB structural check. Optionally proves determinism by baking
 * twice and comparing the animation-channel fingerprint.
 *
 * The bake is invoked with --no-strict so the report always lands even when unhealthy;
 * this gate turns the diagnostics.blockers into a non-zero exit.
 *
 * Run:              tsx tools/openclinxr/evidence/bvh-retarget-smoke.ts
 * Deterministic:    tsx tools/openclinxr/evidence/bvh-retarget-smoke.ts --assert-deterministic
 * Product license:  tsx tools/openclinxr/evidence/bvh-retarget-smoke.ts --product --map cmu
 * Validate latest:  tsx tools/openclinxr/evidence/bvh-retarget-smoke.ts --validate-latest
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

const SCHEMA_VERSION = "openclinxr.bvh-retarget-smoke.v1";
const REPORT_GLOB = "docs/openclinxr/bvh-retarget-smoke-*.json";
const BAKE_SCRIPT = "tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py";
const MESH =
  ".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.anny_base.obj";
const REST =
  ".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.anny_base.anny_rest_skeleton.json";
const BLENDER_TIMEOUT_MS = 240_000;

type ClipSet = { map: string; scale: string; bvhs: string[] };
const CLIP_SETS: Record<string, ClipSet> = {
  mblab: {
    map: "mblab",
    scale: "0.01",
    bvhs: [
      "tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/mblab_walking.bvh",
      "tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/mblab_running.bvh",
    ],
  },
  cmu: {
    map: "cmu",
    scale: "0.1",
    bvhs: [
      "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_07_01_walk.bvh",
      "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_16_15_run.bvh",
    ],
  },
};

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
  mapSet: string;
  product: boolean;
  assertDeterministic: boolean;
};

const defaultOutputPath = () =>
  `docs/openclinxr/bvh-retarget-smoke-${new Date().toISOString().slice(0, 10)}.json`;

function parseArgs(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const opts: CliOptions = {
    validateLatest: false,
    mapSet: "mblab",
    product: false,
    assertDeterministic: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--validate-latest") opts.validateLatest = true;
    else if (a === "--validate") opts.validatePath = args[++i];
    else if (a === "--output") opts.outputPath = args[++i];
    else if (a === "--map") opts.mapSet = args[++i];
    else if (a === "--product") opts.product = true;
    else if (a === "--assert-deterministic") opts.assertDeterministic = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return opts;
}

async function getBlenderVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("blender", ["--version"], { timeout: 30_000 });
    return stdout.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

type BakeResult = { exitCode: number; report: any | null; reportPath: string; glbBytes: number };

async function runBake(clip: ClipSet, outGlb: string, product: boolean): Promise<BakeResult> {
  const args = [
    "--background",
    "--factory-startup",
    "--python",
    BAKE_SCRIPT,
    "--",
    "--mesh",
    MESH,
    "--rest-skeleton",
    REST,
    "--output-glb",
    outGlb,
    "--map",
    clip.map,
    "--scale-bvh",
    clip.scale,
    "--no-root-motion",
    "--no-strict", // report must land even when unhealthy; this gate enforces the verdict
  ];
  if (product) args.push("--product");
  for (const b of clip.bvhs) args.push("--bvh", b);

  let exitCode = 0;
  try {
    await execFileAsync("blender", args, { timeout: BLENDER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  } catch (e: any) {
    exitCode = typeof e?.code === "number" ? e.code : 1;
  }
  const reportPath = outGlb.replace(/\.glb$/, ".bvh-retarget-report.json");
  let report: any = null;
  let glbBytes = 0;
  if (existsSync(reportPath)) report = JSON.parse(await readFile(reportPath, "utf-8"));
  if (existsSync(outGlb)) glbBytes = (await readFile(outGlb)).byteLength;
  return { exitCode, report, reportPath, glbBytes };
}

function structuralGlbBlockers(glbPath: string, bytes: Buffer | null): string[] {
  const blockers: string[] = [];
  if (!bytes || bytes.byteLength < 4096) {
    blockers.push(`glb_too_small:${bytes?.byteLength ?? 0}`);
    return blockers;
  }
  const magic = bytes.toString("ascii", 0, 4);
  if (magic !== "glTF") blockers.push("glb_magic_missing");
  const version = bytes.readUInt32LE(4);
  if (version !== 2) blockers.push(`glb_version_not_2:${version}`);
  const declared = bytes.readUInt32LE(8);
  if (declared !== bytes.byteLength) blockers.push(`glb_length_mismatch:${declared}!=${bytes.byteLength}`);
  return blockers;
}

async function buildReport(opts: CliOptions): Promise<any> {
  const clip = CLIP_SETS[opts.mapSet];
  if (!clip) throw new Error(`Unknown --map set: ${opts.mapSet} (have ${Object.keys(CLIP_SETS).join(",")})`);
  const blenderVersion = await getBlenderVersion();
  const blockers: string[] = [];
  if (!blenderVersion) {
    return report({
      opts,
      blenderVersion: null,
      bakeExit: null,
      diagnostics: null,
      glbBytes: 0,
      fingerprints: [],
      blockers: ["blender_unavailable"],
    });
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "bvh-smoke-"));
  const fingerprints: string[] = [];
  let diagnostics: any = null;
  let bakeExit = 0;
  let glbBytes = 0;
  try {
    const runs = opts.assertDeterministic ? 2 : 1;
    for (let r = 0; r < runs; r++) {
      const outGlb = path.join(tmp, `bake-${r}.glb`);
      const res = await runBake(clip, outGlb, opts.product);
      bakeExit = res.exitCode;
      if (!res.report) {
        blockers.push("no_report_emitted");
        break;
      }
      diagnostics = res.report.diagnostics ?? null;
      glbBytes = res.glbBytes;
      const glbBuf = existsSync(outGlb) ? await readFile(outGlb) : null;
      blockers.push(...structuralGlbBlockers(outGlb, glbBuf));
      if (diagnostics?.fingerprint) fingerprints.push(diagnostics.fingerprint);
    }
    // Trust the diagnostics blockers the bake self-check already computed.
    if (diagnostics?.blockers?.length) blockers.push(...diagnostics.blockers);
    if (opts.assertDeterministic) {
      if (fingerprints.length === 2 && fingerprints[0] !== fingerprints[1]) {
        blockers.push(`nondeterministic:${fingerprints[0]}!=${fingerprints[1]}`);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  return report({ opts, blenderVersion, bakeExit, diagnostics, glbBytes, fingerprints, blockers });
}

function report(input: {
  opts: CliOptions;
  blenderVersion: string | null;
  bakeExit: number | null;
  diagnostics: any;
  glbBytes: number;
  fingerprints: string[];
  blockers: string[];
}): any {
  const uniqueBlockers = [...new Set(input.blockers)];
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    claimScope: "animation_retarget_validation_not_clinical_validity",
    providerBoundary: { localOnly: true, externalNetworkUsed: false, paidApiUsed: false },
    tool: { command: "blender", package: "Blender", version: input.blenderVersion, license: "GPL-3.0-or-later-tooling" },
    input: {
      mapSet: input.opts.mapSet,
      product: input.opts.product,
      assertDeterministic: input.opts.assertDeterministic,
      mesh: MESH,
    },
    bake: { exitCode: input.bakeExit, glbBytes: input.glbBytes, fingerprints: input.fingerprints },
    diagnostics: input.diagnostics,
    verdict: { passed: uniqueBlockers.length === 0, blockers: uniqueBlockers },
    notEvidenceFor: ["clinical_validity", "scoring_validity", "production_asset_readiness", "quest_readiness"],
  };
}

function validateReport(r: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const req = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
  req(r?.schemaVersion === SCHEMA_VERSION, `schemaVersion !== ${SCHEMA_VERSION}`);
  req(typeof r?.generatedAt === "string", "generatedAt missing");
  req(r?.claimScope === "animation_retarget_validation_not_clinical_validity", "claimScope wrong");
  req(r?.providerBoundary?.localOnly === true, "providerBoundary.localOnly must be true");
  req(typeof r?.verdict?.passed === "boolean", "verdict.passed missing");
  req(Array.isArray(r?.verdict?.blockers), "verdict.blockers must be array");
  req(r?.verdict?.passed === true, `verdict not passed: ${JSON.stringify(r?.verdict?.blockers)}`);
  return { ok: errors.length === 0, errors };
}

async function latestPath(): Promise<string | null> {
  const files = await globFiles(REPORT_GLOB);
  return files.sort().at(-1) ?? null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.validatePath || opts.validateLatest) {
    const p = opts.validatePath ?? (await latestPath());
    if (!p) throw new Error("No bvh-retarget-smoke report to validate.");
    const v = validateReport(await readJson<any>(p));
    if (v.ok) { console.log(`Validated ${p}`); return; }
    for (const e of v.errors) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  const r = await buildReport(opts);
  const out = opts.outputPath ?? defaultOutputPath();
  await writeJson(out, r);
  console.log(`Wrote ${out}`);
  console.log(`verdict.passed=${r.verdict.passed} blockers=${JSON.stringify(r.verdict.blockers)}`);
  if (!r.verdict.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
