#!/usr/bin/env tsx
/**
 * Proven 3-iteration optimization technique for TRELLIS equipment GLBs.
 * Skill: .agents/skills/trellis-vr-equipment-optimize/
 *
 * Iter 1: direct high-error target ratios from RAW (breaks chain-ratio plateau)
 * Iter 2: weld then same targets
 * Iter 3: best-of so far → optional re-target if over soft + quantize stats
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts \
 *     --input .openclinxr/evidence/trellis-bake-vr-hard/ecg-cart/ecg-cart.glb \
 *     --out .openclinxr/evidence/trellis-vr-optimize-iterations/ecg-cart-vr-hard
 */
import { existsSync, mkdirSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify, weld, quantize } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const SOFT = 40_000;
const STATION_SOFT = 60_000;
const HARD = 180_000;
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

function parseArgs(argv: string[]) {
  let input = "";
  let out = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") input = argv[++i] ?? "";
    else if (argv[i] === "--out") out = argv[++i] ?? "";
  }
  if (!input || !out) {
    console.error("Usage: iterate-optimize.ts --input <raw.glb> --out <dir>");
    process.exit(2);
  }
  return { input: path.resolve(input), out: path.resolve(out) };
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
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
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
    ops.push(weld({ tolerance: WELD_TOL }));
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

async function main() {
  const { input, out } = parseArgs(process.argv.slice(2));
  if (!existsSync(input)) {
    console.error("missing input", input);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
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
    { name: "station60k", tris: STATION_SOFT },
    { name: "soft40k", tris: SOFT },
    { name: "soft25k", tris: 25_000 },
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

  // ── Iter 3: pick best under soft/hard, quantize, optional second pass ───
  console.log("=== ITER 3: best survivor + quantize / re-target soft ===");
  const ok = rungs.filter((r) => r.featureSurvival === "ok" && r.iter > 0);
  const bestSoft = ok
    .filter((r) => r.triangleCount <= SOFT)
    .sort((a, b) => a.triangleCount - b.triangleCount)[0];
  const bestStation = ok
    .filter((r) => r.triangleCount <= STATION_SOFT)
    .sort((a, b) => a.triangleCount - b.triangleCount)[0];
  const bestHard = ok
    .filter((r) => r.triangleCount <= HARD)
    .sort((a, b) => a.triangleCount - b.triangleCount)[0];
  const seed = bestSoft ?? bestStation ?? bestHard ?? ok.sort((a, b) => a.triangleCount - b.triangleCount)[0];

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

  if (seed.triangleCount > SOFT) {
    const ratio = Math.min(1, Math.max(0.001, SOFT / seed.triangleCount));
    const dest = path.join(out, "iter3-retarget-soft40k.glb");
    await writeSimplified(seed.path, dest, { ratio, weldFirst: true });
    const rung = await measureRung(3, "retarget_soft40k_from_best", SOFT, ratio, dest, rawVol);
    rungs.push(rung);
    console.log(`  retarget soft40k → ${rung.triangleCount} tris survival=${rung.featureSurvival}`);
  }

  const survivors = rungs.filter((r) => r.featureSurvival === "ok");
  const champion =
    survivors.filter((r) => r.triangleCount <= SOFT).sort((a, b) => a.triangleCount - b.triangleCount)[0] ??
    survivors.filter((r) => r.triangleCount <= STATION_SOFT).sort((a, b) => a.triangleCount - b.triangleCount)[0] ??
    survivors.filter((r) => r.triangleCount <= HARD).sort((a, b) => a.triangleCount - b.triangleCount)[0] ??
    survivors.sort((a, b) => a.triangleCount - b.triangleCount)[0];

  if (champion) {
    const champPath = path.join(out, "champion.glb");
    copyFileSync(champion.path, champPath);
    champion.path = champPath;
  }

  const report = {
    skill: "trellis-vr-equipment-optimize",
    technique: "3-iter high-error direct targets + weld + quantize/retarget",
    measuredAt: new Date().toISOString(),
    input,
    rawTriangleCount: rawTris,
    budgets: { soft: SOFT, stationSoft: STATION_SOFT, hard: HARD },
    rungs,
    champion: champion
      ? {
          technique: champion.technique,
          triangleCount: champion.triangleCount,
          path: champion.path,
          underSoft: champion.triangleCount <= SOFT,
          underStationSoft: champion.triangleCount <= STATION_SOFT,
          underHard: champion.triangleCount <= HARD,
        }
      : null,
    claimScope: [
      "meshopt high-error direct targets from TRELLIS raw",
      "weld before simplify",
      "not evidence for Quest worn readiness",
    ],
    notEvidenceFor: [
      "Quest 3 readiness",
      "clinical accuracy",
      "photoreal quality",
      "learner runtime adoption",
    ],
    provenVsChainLadder: {
      note: "Chain ratios with default error plateaued ~186k on photoreal and ~59k on hard-surface; direct high-error targets force lower counts when topology allows",
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
