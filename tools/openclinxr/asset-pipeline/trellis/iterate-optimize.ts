#!/usr/bin/env tsx
/**
 * Proven 3-iteration optimization technique for TRELLIS equipment GLBs.
 * Skill: .agents/skills/trellis-vr-equipment-optimize/
 *
 * Iter 1: direct high-error target ratios from RAW (breaks chain-ratio plateau)
 * Iter 2: weld then same targets
 * Iter 3: quality-preserving champion + quantize; retarget share only if over preferred
 *
 * Budget policy (Quest 3 research 2026-08-11): Meta native Q3 scene ~1.3–1.8M tris.
 * Prop preferred ≤80k is default good-enough; ≤40k is multi-prop share pressure only.
 * Do not hyperoptimize to lowest tris — prefer highest survival-ok count under preferred.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts \
 *     --input .openclinxr/evidence/trellis-bake-vr-hard/ecg-cart/ecg-cart.glb \
 *     --out .openclinxr/evidence/trellis-vr-optimize-iterations/ecg-cart-vr-hard
 *
 * Bake/render stage (#694):
 *   --bake --bake-res 512            high-to-low normal bake of the champion against --input
 *   --target <low.glb> --bake        bake an explicit low rung against --input (stage-only mode)
 *   --render --render-out <png>      render a grade PNG of the target/champion GLB (ab_render.py)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync, copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify, weld, quantize } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bake stage (#694): the high-to-low normal bake is a pipeline stage, not a hand-run probe.
 * hl_bake.py bakes the high-res raw's detail onto the low rung via Cycles selected-to-active,
 * export_mapped.py attaches the baked map to the low GLB, ab_render.py renders a grade PNG.
 * See tools/openclinxr/asset-pipeline/trellis/bake-probe/hl_bake.py for the bake itself.
 */
const BAKE_SCRIPT = path.join(HERE, "bake-probe", "hl_bake.py");
const EXPORT_MAPPED_SCRIPT = path.join(HERE, "bake-probe", "export_mapped.py");
const RENDER_SCRIPT = path.join(HERE, "bake-probe", "ab_render.py");
/** Ladder cells used BAKE_RES=512; the script default is 2048 (16x the bake work). */
const DEFAULT_BAKE_RES = 512;

/** Multi-prop share pressure — not Quest 3 device limit. */
const PROP_SHARE = 40_000;
/** Default good-enough single static prop after grade. */
const PROP_PREFERRED = 80_000;
/** Acceptable when few props / grade prefers density. */
const PROP_ACCEPTABLE = 120_000;
/** Early partial station / few props — not full multi-actor envelope. */
const HARD = 180_000;
/** Station-share ladder target (legacy language #239/#250). */
const STATION_SOFT = 60_000;
/** Optional stretch only — never champion default. */
const STRETCH = 25_000;
/** High error so meshopt actually approaches the ratio (default error stops early → plateau). */
const FORCE_ERROR = 1.0;
const WELD_TOL = 1e-4;

type Rung = {
  iter: number;
  technique: string;
  targetTris: number | null;
  ratio: number;
  triangleCount: number;
  bytes: number;
  aabbVolume: number;
  volumeRatioToRaw: number;
  featureSurvival: "ok" | "collapsed";
  path: string;
};

/** Prefer quality: highest tris still under band (anti-hyperopt). */
function pickMaxUnder(rungs: Rung[], maxTris: number): Rung | undefined {
  return rungs
    .filter((r) => r.triangleCount <= maxTris)
    .sort((a, b) => b.triangleCount - a.triangleCount)[0];
}

function pickChampion(survivors: Rung[]): Rung | undefined {
  return (
    pickMaxUnder(survivors, PROP_PREFERRED) ??
    pickMaxUnder(survivors, PROP_ACCEPTABLE) ??
    pickMaxUnder(survivors, HARD) ??
    survivors.sort((a, b) => a.triangleCount - b.triangleCount)[0]
  );
}

function parseArgs(argv: string[]) {
  let input = "";
  let out = "";
  let bake = false;
  let render = false;
  let target = "";
  let bakeRes = DEFAULT_BAKE_RES;
  let renderOut = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") input = argv[++i] ?? "";
    else if (argv[i] === "--out") out = argv[++i] ?? "";
    else if (argv[i] === "--bake") bake = true;
    else if (argv[i] === "--render") render = true;
    else if (argv[i] === "--target") target = argv[++i] ?? "";
    else if (argv[i] === "--bake-res") bakeRes = Number(argv[++i] ?? DEFAULT_BAKE_RES);
    else if (argv[i] === "--render-out") renderOut = argv[++i] ?? "";
  }
  if (!input || !out) {
    console.error("Usage: iterate-optimize.ts --input <raw.glb> --out <dir> [--bake] [--bake-res <n>] [--target <low.glb>] [--render] [--render-out <png>]");
    process.exit(2);
  }
  if (target && !bake && !render) {
    console.error("--target requires --bake and/or --render (stage-only mode)");
    process.exit(2);
  }
  if (!Number.isFinite(bakeRes) || bakeRes < 1) {
    console.error(`invalid --bake-res ${bakeRes}`);
    process.exit(2);
  }
  return { input: path.resolve(input), out: path.resolve(out), bake, render, target: target ? path.resolve(target) : "", bakeRes, renderOut };
}

async function countTris(glbPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) tris += idx.getCount() / 3;
    }
  }
  return Math.round(tris);
}

async function aabbVolume(glbPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 3) {
        min[0] = Math.min(min[0], Number(arr[i]));
        min[1] = Math.min(min[1], Number(arr[i + 1]));
        min[2] = Math.min(min[2], Number(arr[i + 2]));
        max[0] = Math.max(max[0], Number(arr[i]));
        max[1] = Math.max(max[1], Number(arr[i + 1]));
        max[2] = Math.max(max[2], Number(arr[i + 2]));
      }
    }
  }
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  if (![dx, dy, dz].every(Number.isFinite)) return 0;
  return Math.abs(dx * dy * dz);
}

async function writeSimplified(
  input: string,
  output: string,
  opts: { ratio: number; weldFirst?: boolean; quantizeAfter?: boolean },
): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const ops = [];
  if (opts.weldFirst) {
    // gltf-transform 4.x removed the tolerance option; overwrite re-welds existing indices.
    ops.push(weld({ overwrite: true }));
  }
  ops.push(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: opts.ratio,
      error: FORCE_ERROR,
      lockBorder: false,
    }),
  );
  if (opts.quantizeAfter) {
    ops.push(quantize());
  }
  await doc.transform(...ops);
  await io.write(output, doc);
}

async function measureRung(
  iter: number,
  technique: string,
  targetTris: number | null,
  ratio: number,
  glbPath: string,
  rawVol: number,
): Promise<Rung> {
  const triangleCount = await countTris(glbPath);
  const vol = await aabbVolume(glbPath);
  const volumeRatioToRaw = rawVol > 0 ? vol / rawVol : 0;
  const featureSurvival: "ok" | "collapsed" =
    triangleCount > 500 && volumeRatioToRaw > 0.05 ? "ok" : "collapsed";
  return {
    iter,
    technique,
    targetTris,
    ratio,
    triangleCount,
    bytes: statSync(glbPath).size,
    aabbVolume: vol,
    volumeRatioToRaw,
    featureSurvival,
    path: glbPath,
  };
}

function resolveBlender(): string {
  if (process.env.OPENCLINXR_BLENDER && existsSync(process.env.OPENCLINXR_BLENDER)) {
    return process.env.OPENCLINXR_BLENDER;
  }
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
}

function runCmd(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

type BakeOutcome = {
  bakeReportPath: string;
  normalMapPath: string;
  mappedGlbPath: string;
};

/**
 * High-to-low normal bake stage: bakes the high (raw) detail onto a low rung, then attaches the
 * map to a copy of the low GLB so the mapped deliverable can ship or be rendered directly.
 * Per D9, duration is not a constraint — correctness over wall-clock.
 */
async function bakeHighToLow(opts: {
  highGlb: string;
  lowGlb: string;
  outDir: string;
  res: number;
}): Promise<BakeOutcome> {
  const blender = resolveBlender();
  const high = path.resolve(opts.highGlb);
  const low = path.resolve(opts.lowGlb);
  const bakeDir = path.join(path.resolve(opts.outDir), "bake");
  mkdirSync(bakeDir, { recursive: true });
  const env = { ...process.env, BAKE_RES: String(opts.res) };
  console.log(
    `[bake] high-to-low normal bake res=${opts.res} high=${high} low=${low} blender=${blender}`,
  );
  const bake = await runCmd(
    blender,
    ["--background", "--python", BAKE_SCRIPT, "--", high, low, bakeDir],
    { cwd: path.dirname(BAKE_SCRIPT), timeoutMs: 30 * 60_000, env },
  );
  const reportPath = path.join(bakeDir, "bake-report.json");
  if (!existsSync(reportPath)) {
    throw new Error(
      `bake stage: bake-report.json missing after blender (exit ${bake.code}): ${bake.stderr.slice(-800)}`,
    );
  }
  let report: { status?: string; normalMapPath?: string; error?: string };
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as typeof report;
  } catch (e) {
    throw new Error(`bake stage: unparseable bake-report.json: ${String(e)}`);
  }
  if (report.status !== "baked" || !report.normalMapPath || !existsSync(report.normalMapPath)) {
    throw new Error(
      `bake stage: hl_bake reported status=${report.status} error=${report.error ?? "(none)"} ` +
        `map=${report.normalMapPath ?? "(missing)"}`,
    );
  }
  const mappedGlbPath = path.join(
    path.resolve(opts.outDir),
    path.basename(low).replace(/\.glb$/i, "-mapped.glb"),
  );
  const attach = await runCmd(
    blender,
    ["--background", "--python", EXPORT_MAPPED_SCRIPT, "--", low, report.normalMapPath, mappedGlbPath],
    { cwd: path.dirname(EXPORT_MAPPED_SCRIPT), timeoutMs: 10 * 60_000 },
  );
  if (!existsSync(mappedGlbPath) || statSync(mappedGlbPath).size < 1_000) {
    throw new Error(
      `bake stage: mapped export missing (exit ${attach.code}): ${attach.stderr.slice(-800)}`,
    );
  }
  console.log(`[bake] normal map: ${report.normalMapPath}`);
  console.log(
    `[bake] mapped glb: ${mappedGlbPath} (${statSync(mappedGlbPath).size} bytes, ` +
      `${attach.code === 0 ? "attached" : `attach exit ${attach.code}`})`,
  );
  return { bakeReportPath: reportPath, normalMapPath: report.normalMapPath, mappedGlbPath };
}

/** Render a GLB (optionally with a normal map attached) to a grade PNG via ab_render.py. */
async function renderGlb(opts: {
  glb: string;
  normalMapPath: string | null;
  out: string;
}): Promise<void> {
  const blender = resolveBlender();
  const out = path.resolve(opts.out);
  mkdirSync(path.dirname(out), { recursive: true });
  const result = await runCmd(
    blender,
    ["--background", "--python", RENDER_SCRIPT, "--", path.resolve(opts.glb), opts.normalMapPath ?? "NONE", out],
    { cwd: path.dirname(RENDER_SCRIPT), timeoutMs: 10 * 60_000 },
  );
  if (!existsSync(out) || statSync(out).size < 1_000) {
    throw new Error(
      `render stage: PNG missing/small (exit ${result.code}): ${result.stderr.slice(-800)}`,
    );
  }
  console.log(`[render] ${out}`);
}


type StageOutcome = { bake: BakeOutcome | null; renderOut: string | null };

/** Run the bake and/or render stages on one low GLB against the raw input. */
async function runBakeRenderStages(opts: {
  input: string;
  out: string;
  bake: boolean;
  render: boolean;
  target: string;
  bakeRes: number;
  renderOut: string;
}): Promise<StageOutcome> {
  let bakeResult: BakeOutcome | null = null;
  if (opts.bake) {
    bakeResult = await bakeHighToLow({
      highGlb: opts.input,
      lowGlb: opts.target,
      outDir: opts.out,
      res: opts.bakeRes,
    });
  }
  let rendered: string | null = null;
  if (opts.render) {
    rendered = opts.renderOut || path.join(opts.out, "render.png");
    await renderGlb({
      glb: opts.target,
      normalMapPath: bakeResult ? bakeResult.normalMapPath : null,
      out: rendered,
    });
  }
  return { bake: bakeResult, renderOut: rendered };
}

async function main() {
  const { input, out, bake, render, target, bakeRes, renderOut } = parseArgs(process.argv.slice(2));
  if (!existsSync(input)) {
    console.error("missing input", input);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });

  // Stage-only mode: bake/render an explicit low rung against the raw (used by rung sweeps).
  if (target) {
    if (!existsSync(target)) {
      console.error("missing target", target);
      process.exit(2);
    }
    await runBakeRenderStages({ input, out, bake, render, target, bakeRes, renderOut });
    return;
  }

  await MeshoptSimplifier.ready;

  const rawTris = await countTris(input);
  const rawVol = await aabbVolume(input);
  const rungs: Rung[] = [
    await measureRung(0, "raw", null, 1, input, rawVol),
  ];
  rungs[0].path = path.join(out, "raw-copy.glb");
  copyFileSync(input, rungs[0].path);

  const targets = [
    { name: "hard180k", tris: HARD },
    { name: "acceptable120k", tris: PROP_ACCEPTABLE },
    { name: "preferred80k", tris: PROP_PREFERRED },
    { name: "station60k", tris: STATION_SOFT },
    { name: "share40k", tris: PROP_SHARE },
    { name: "stretch25k", tris: STRETCH },
  ];

  // ── Iter 1: direct high-error targets from RAW ───────────────────────────
  console.log("=== ITER 1: direct high-error targets from raw ===");
  for (const t of targets) {
    const ratio = Math.min(1, Math.max(0.001, t.tris / rawTris));
    const dest = path.join(out, `iter1-${t.name}.glb`);
    console.log(`  target ${t.tris} → ratio ${ratio.toFixed(5)}`);
    await writeSimplified(input, dest, { ratio, weldFirst: false });
    const rung = await measureRung(1, `direct_high_error_${t.name}`, t.tris, ratio, dest, rawVol);
    rungs.push(rung);
    console.log(`    → ${rung.triangleCount} tris survival=${rung.featureSurvival}`);
  }

  // ── Iter 2: weld + same targets from RAW ─────────────────────────────────
  console.log("=== ITER 2: weld + high-error targets from raw ===");
  for (const t of targets) {
    const ratio = Math.min(1, Math.max(0.001, t.tris / rawTris));
    const dest = path.join(out, `iter2-weld-${t.name}.glb`);
    console.log(`  weld+target ${t.tris} → ratio ${ratio.toFixed(5)}`);
    await writeSimplified(input, dest, { ratio, weldFirst: true });
    const rung = await measureRung(2, `weld_high_error_${t.name}`, t.tris, ratio, dest, rawVol);
    rungs.push(rung);
    console.log(`    → ${rung.triangleCount} tris survival=${rung.featureSurvival}`);
  }

  // ── Iter 3: quality-preserving seed + quantize; share retarget only if needed ──
  console.log("=== ITER 3: quality-preserving champion seed + quantize ===");
  const ok = rungs.filter((r) => r.featureSurvival === "ok" && r.iter > 0);
  const seed = pickChampion(ok);

  if (!seed) {
    console.error("No surviving rungs");
    process.exit(2);
  }

  const iter3q = path.join(out, "iter3-best-quantize.glb");
  await writeSimplified(seed.path, iter3q, {
    ratio: 1,
    weldFirst: false,
    quantizeAfter: true,
  });
  // quantize alone: re-read seed and quantize without simplify
  {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(seed.path);
    await doc.transform(quantize());
    await io.write(iter3q, doc);
  }
  rungs.push(
    await measureRung(3, `quantize_from_${seed.technique}`, seed.targetTris, 1, iter3q, rawVol),
  );
  console.log(`  quantize from ${seed.technique} → ${rungs[rungs.length - 1].triangleCount} tris`);

  // Retarget to prop share only when still over preferred (multi-prop pressure path).
  if (seed.triangleCount > PROP_PREFERRED) {
    const ratio = Math.min(1, Math.max(0.001, PROP_SHARE / seed.triangleCount));
    const dest = path.join(out, "iter3-retarget-share40k.glb");
    await writeSimplified(seed.path, dest, { ratio, weldFirst: true });
    const rung = await measureRung(3, "retarget_share40k_from_best", PROP_SHARE, ratio, dest, rawVol);
    rungs.push(rung);
    console.log(`  retarget share40k → ${rung.triangleCount} tris survival=${rung.featureSurvival}`);
  }

  const survivors = rungs.filter((r) => r.featureSurvival === "ok");
  const champion = pickChampion(survivors);

  if (champion) {
    const champPath = path.join(out, "champion.glb");
    copyFileSync(champion.path, champPath);
    champion.path = champPath;
  }

  const stages = champion
    ? await runBakeRenderStages({ input, out, bake, render, target: champion.path, bakeRes, renderOut })
    : { bake: null, renderOut: null };

  const report = {
    skill: "trellis-vr-equipment-optimize",
    technique: "3-iter high-error direct targets + weld + quantize; quality-preserving champion",
    measuredAt: new Date().toISOString(),
    input,
    rawTriangleCount: rawTris,
    budgets: {
      propShare: PROP_SHARE,
      propPreferred: PROP_PREFERRED,
      propAcceptable: PROP_ACCEPTABLE,
      stationSoft: STATION_SOFT,
      hardSkeleton: HARD,
      stretchOptional: STRETCH,
      note:
        "Quest 3 native scene ~1.3–1.8M tris (Meta). Prefer ≤80k prop with grade; ≤40k is share pressure only. Not worn-headset evidence.",
    },
    rungs,
    champion: champion
      ? {
          technique: champion.technique,
          triangleCount: champion.triangleCount,
          path: champion.path,
          underPropShare: champion.triangleCount <= PROP_SHARE,
          underStationSoft: champion.triangleCount <= STATION_SOFT,
          underPropPreferred: champion.triangleCount <= PROP_PREFERRED,
          underPropAcceptable: champion.triangleCount <= PROP_ACCEPTABLE,
          underHard: champion.triangleCount <= HARD,
        }
      : null,
    bakeStage: stages.bake
      ? {
          script: "bake-probe/hl_bake.py",
          attachScript: "bake-probe/export_mapped.py",
          high: input,
          low: champion?.path ?? null,
          resolution: bakeRes,
          bakeReportPath: stages.bake.bakeReportPath,
          normalMapPath: stages.bake.normalMapPath,
          mappedGlbPath: stages.bake.mappedGlbPath,
        }
      : null,
    renderStage: stages.renderOut
      ? { script: "bake-probe/ab_render.py", png: stages.renderOut }
      : null,
    claimScope: [
      "meshopt high-error direct targets from TRELLIS raw",
      "weld before simplify",
      "quality-preserving champion under prop preferred (80k)",
      "not evidence for Quest worn readiness",
    ],
    notEvidenceFor: [
      "Quest 3 readiness",
      "clinical accuracy",
      "photoreal quality",
      "learner runtime adoption",
    ],
    provenVsChainLadder: {
      note: "Chain ratios with default error plateaued ~186k on photoreal and ~59k on hard-surface; direct high-error targets force lower counts when topology allows. Do not force stretch25k when preferred band grades.",
    },
  };

  writeFileSync(path.join(out, "iteration-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("\n=== CHAMPION ===");
  console.log(JSON.stringify(report.champion, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
