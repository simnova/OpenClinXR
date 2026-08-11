#!/usr/bin/env tsx
/**
 * VR-oriented post-opt ladder after multi-view TRELLIS bake (chain-ratio baseline).
 * Prefer factory:trellis:optimize (iterate-optimize.ts) for production champions —
 * high-error direct targets + quality-preserving band selection.
 *
 * Bands (skill trellis-vr-equipment-optimize, Quest 3 research 2026-08-11):
 *   prop share ≤40k · preferred ≤80k · acceptable ≤120k · skeleton hard ≤180k
 * Chain ladders often plateau ~59k on hard-surface packs (still under preferred).
 * No GPU re-bake.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/vr-postopt-ladder.ts \
 *     --input .openclinxr/evidence/trellis-bake/ecg-cart/ecg-cart.glb \
 *     --out .openclinxr/evidence/trellis-bake/ecg-cart/vr-ladder
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const RATIOS = [0.1, 0.05, 0.03, 0.02, 0.015, 0.01, 0.0075, 0.005];
/** Multi-prop share pressure (not Quest 3 device limit). */
const SOFT = 40_000;
/** Early partial station / few props. */
const HARD = 180_000;
/** Preferred single-prop stop (documented; chain may land ~59k under this). */
const PROP_PREFERRED = 80_000;

function parseArgs(argv: string[]) {
  let input = "";
  let out = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") input = argv[++i] ?? "";
    else if (argv[i] === "--out") out = argv[++i] ?? "";
  }
  if (!input || !out) {
    console.error("Usage: vr-postopt-ladder.ts --input <glb> --out <dir>");
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
        min[0] = Math.min(min[0], arr[i]);
        min[1] = Math.min(min[1], arr[i + 1]);
        min[2] = Math.min(min[2], arr[i + 2]);
        max[0] = Math.max(max[0], arr[i]);
        max[1] = Math.max(max[1], arr[i + 1]);
        max[2] = Math.max(max[2], arr[i + 2]);
      }
    }
  }
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  if (![dx, dy, dz].every(Number.isFinite)) return 0;
  return Math.abs(dx * dy * dz);
}

async function simplifyTo(
  input: string,
  output: string,
  ratio: number,
): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio,
      error: 0.001,
    }),
  );
  await io.write(output, doc);
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
  const rungs: Array<Record<string, unknown>> = [
    {
      label: "raw",
      ratio: 1,
      triangleCount: rawTris,
      path: input,
      bytes: statSync(input).size,
      aabbVolume: rawVol,
    },
  ];

  let source = input;
  for (const ratio of RATIOS) {
    const label = `r${ratio}`;
    const dest = path.join(out, `ecg-cart-${label}.glb`);
    console.log(`simplify ratio=${ratio} …`);
    await simplifyTo(source, dest, ratio);
    const tris = await countTris(dest);
    const vol = await aabbVolume(dest);
    const survival =
      tris > 500 && rawVol > 0 && vol / rawVol > 0.05 ? "ok" : "collapsed";
    rungs.push({
      label,
      ratio,
      triangleCount: tris,
      path: dest,
      bytes: statSync(dest).size,
      aabbVolume: vol,
      featureSurvival: survival,
    });
    console.log(`  → ${tris} tris survival=${survival}`);
    // chain from previous for progressive reduction when ratio is absolute from original
    // Actually gltf-transform ratio is relative to CURRENT mesh — chaining is intentional for deeper cuts
    source = dest;
  }

  // Prefer denser rungs under preferred (anti-hyperopt); chain often lands ~59k.
  const ok = rungs.filter((r) => r.featureSurvival !== "collapsed");
  const bestPreferred = [...ok]
    .filter((r) => (r.triangleCount as number) <= PROP_PREFERRED)
    .sort((a, b) => (b.triangleCount as number) - (a.triangleCount as number))[0];
  const bestSoft = [...ok]
    .filter((r) => (r.triangleCount as number) <= SOFT)
    .sort((a, b) => (b.triangleCount as number) - (a.triangleCount as number))[0];
  const bestHard = [...ok]
    .filter((r) => (r.triangleCount as number) <= HARD)
    .sort((a, b) => (b.triangleCount as number) - (a.triangleCount as number))[0];

  const report = {
    subjectId: "ecg-cart",
    propShare: SOFT,
    propPreferred: PROP_PREFERRED,
    hardSkeleton: HARD,
    note: "Chain-ratio baseline ladder. Prefer factory:trellis:optimize for champions. Preferred ≤80k; share ≤40k; skeleton hard ≤180k. Quest 3 scene class ~1.3–1.8M (Meta native).",
    rungs,
    bestUnderPropPreferred: Boolean(bestPreferred),
    bestPreferred: bestPreferred ?? null,
    bestUnderShare: Boolean(bestSoft),
    bestSoft: bestSoft ?? null,
    bestUnderHardCeiling: Boolean(bestHard),
    bestHard: bestHard ?? null,
    claimScope: ["meshopt post-opt ladder after multi-view TRELLIS bake"],
    notEvidenceFor: ["Quest 3 worn readiness", "clinical accuracy", "learner runtime adoption"],
  };
  writeFileSync(path.join(out, "vr-ladder-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        bestPreferred: bestPreferred?.triangleCount,
        bestShare: bestSoft?.triangleCount,
        bestHard: bestHard?.triangleCount,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
