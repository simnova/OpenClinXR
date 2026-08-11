#!/usr/bin/env tsx
/**
 * factory:trellis:pack — gltfpack delivery after optimize (zeux/meshoptimizer).
 *
 * Delivery step only: vertex cache, quantize, optional meshopt compression.
 * Prefer simplify already done by factory:trellis:optimize (high-error targets).
 * Optional -si re-simplify is gated and defaults OFF so we don't destroy champion topology.
 *
 * Usage:
 *   pnpm factory:trellis:pack --input champion.glb --out champion-meshopt.glb
 *   pnpm factory:trellis:pack --input champion.glb --out out.glb --compress
 *   pnpm factory:trellis:pack --input champion.glb --out out.glb --si 0.035 --aggressive
 *   pnpm factory:trellis:pack --help
 *
 * Measured 2026-08-11 (VR-hard ECG raw ~974k):
 *   gltfpack -si 0.035 -sa ≈ 33.9k tris; our high-error champion ≈ 34.4k
 *   -sa -se 1 can zero the mesh — never default
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const require = createRequire(import.meta.url);

function findGltfpack(): string {
  const local = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../..",
    "node_modules/.bin/gltfpack",
  );
  // mac path fix for fileURL
  const candidates = [
    path.join(process.cwd(), "node_modules/.bin/gltfpack"),
    local.replace(/^\/private/, ""),
    local,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // resolve via require
  try {
    const pkg = require.resolve("gltfpack/package.json");
    const bin = path.join(path.dirname(pkg), "cli.js");
    if (existsSync(bin)) return process.execPath; // node cli — handled below
  } catch {
    /* fall through */
  }
  return "gltfpack";
}

function parseArgs(argv: string[]) {
  const out: {
    help?: boolean;
    input?: string;
    output?: string;
    compress?: boolean;
    si?: number;
    aggressive?: boolean;
    se?: number;
    report?: string;
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--input" || a === "-i") out.input = argv[++i];
    else if (a === "--out" || a === "-o") out.output = argv[++i];
    else if (a === "--compress" || a === "-cc" || a === "-c") out.compress = true;
    else if (a === "--si") out.si = Number(argv[++i]);
    else if (a === "--aggressive" || a === "-sa") out.aggressive = true;
    else if (a === "--se") out.se = Number(argv[++i]);
    else if (a === "--report") out.report = argv[++i];
  }
  return out;
}

const HELP = `factory:trellis:pack — gltfpack delivery (meshoptimizer)

USAGE
  pnpm factory:trellis:pack --input <glb> --out <glb> [--compress]
  pnpm factory:trellis:pack --input <glb> --out <glb> --si 0.035 --aggressive

FLAGS
  --input / -i     Source GLB (usually champion from factory:trellis:optimize)
  --out / -o       Output GLB path
  --compress       Meshopt compression (-cc). Smaller files; needs meshopt decoder at load.
  --si R           Optional re-simplify ratio (default: none — delivery only on already-optimized mesh)
  --aggressive     gltfpack -sa (only with --si; can destroy mesh if combined with huge -se)
  --se E           Simplification error bound (default gltfpack 0.01). Do not use 1 with -sa.
  --report PATH    Write JSON measure next to pack
  --help

PIPELINE
  bake → optimize (high-error targets) → pack (this) → grade

NOT EVIDENCE FOR
  Quest readiness, clinical accuracy, learner runtime adoption
`;

async function countTris(glbPath: string): Promise<number> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(glbPath);
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const pr of m.listPrimitives()) {
      const idx = pr.getIndices();
      if (idx) t += idx.getCount() / 3;
    }
  }
  return Math.round(t);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args.output) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 2);
  }
  const input = path.resolve(args.input);
  const output = path.resolve(args.output);
  if (!existsSync(input)) {
    process.stderr.write(`missing input: ${input}\n`);
    process.exit(2);
  }
  mkdirSync(path.dirname(output), { recursive: true });

  const gltfpackBin = path.join(process.cwd(), "node_modules/.bin/gltfpack");
  const argv: string[] = ["-i", input, "-o", output];
  if (args.si != null && Number.isFinite(args.si)) {
    argv.push("-si", String(args.si));
    if (args.aggressive) argv.push("-sa");
    if (args.se != null && Number.isFinite(args.se)) argv.push("-se", String(args.se));
  }
  if (args.compress) argv.push("-cc");

  process.stdout.write(`[factory:trellis:pack] gltfpack ${argv.join(" ")}\n`);
  execFileSync(gltfpackBin, argv, { stdio: "inherit", cwd: process.cwd() });

  let inTris: number | null = null;
  let outTris: number | null = null;
  try {
    inTris = await countTris(input);
    outTris = await countTris(output);
  } catch (e) {
    process.stderr.write(`[factory:trellis:pack] tri count warning: ${e}\n`);
  }

  const report = {
    tool: "gltfpack",
    library: "zeux/meshoptimizer",
    input,
    output,
    compress: Boolean(args.compress),
    si: args.si ?? null,
    aggressive: Boolean(args.aggressive),
    se: args.se ?? null,
    inputBytes: statSync(input).size,
    outputBytes: statSync(output).size,
    inputTriangleCount: inTris,
    outputTriangleCount: outTris,
    claimScope: ["gltfpack delivery after TRELLIS optimize"],
    notEvidenceFor: ["Quest readiness", "clinical accuracy", "exam equivalence"],
  };

  const reportPath =
    args.report ??
    path.join(path.dirname(output), path.basename(output, path.extname(output)) + ".pack-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(
    `[factory:trellis:pack] done tris ${inTris ?? "?"} → ${outTris ?? "?"} bytes ${report.inputBytes} → ${report.outputBytes}\n`,
  );
  process.stdout.write(`[factory:trellis:pack] report ${reportPath}\n`);

  // Soft gate: refuse zero-triangle outputs
  if (outTris != null && outTris < 500) {
    process.stderr.write(
      `[factory:trellis:pack] REFUSE: output triangle count ${outTris} looks destroyed (use milder --si / avoid -sa -se 1)\n`,
    );
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
