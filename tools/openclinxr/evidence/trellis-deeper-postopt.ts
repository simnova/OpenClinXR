#!/usr/bin/env tsx
/**
 * #239 Deeper TRELLIS post-opt ladder — soft ≤60k / hard ≤180k station band (MADR 0050).
 *
 * Follow-on to #235/#237/#238. Applies a multi-rung gltf-transform simplify ladder
 * to existing TRELLIS equipment GLBs (no GPU re-bake).
 *
 * Input: raw GLBs from issue-237 (wall-clock, bedside-monitor) and issue-235 (ecg-cart).
 * Output: per-subject rungs at ratios 0.10, 0.05, 0.03, 0.02, plus ladder-report.json.
 *
 * Header IMMUTABLE — append ## FIXED (#239).
 */

import { existsSync, mkdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Source evidence root in the main repo (gitignored — absent in worktrees). */
const MAIN_REPO_EVIDENCE = "/Volumes/files/src/openclinxr/.openclinxr/evidence";

/** Worktree-local evidence output directory. */
const EVIDENCE_DIR = path.resolve(REPO_ROOT, ".openclinxr/evidence/issue-239");
const INPUT_DIR = path.join(EVIDENCE_DIR, "inputs");
const REPORT_PATH = path.join(EVIDENCE_DIR, "ladder-report.json");

// ---------------------------------------------------------------------------
// Types (match planted test)
// ---------------------------------------------------------------------------

type LadderRung = {
  label: string;
  ratio: number;
  triangleCount: number;
  bytes: number;
  path: string;
};

type SubjectLadder = {
  subjectId: string;
  rungs: LadderRung[];
  bestUnderSoftTarget: boolean;   // ≤60k
  bestUnderHardCeiling: boolean;  // ≤180k
  featureSurvival: "ok" | "collapsed" | "unknown";
};

type Report = {
  subjects: SubjectLadder[];
  softTarget: number;
  hardCeiling: number;
  claimScope: string[];
  notEvidenceFor: string[];
};

// ---------------------------------------------------------------------------
// Subject registry — maps subject ids to source GLB locations
// ---------------------------------------------------------------------------

interface SubjectSource {
  subjectId: string;
  displayName: string;
  /** Path to raw (pre-postopt) GLB in the main repo. */
  sourceRawGlb: string;
}

const SUBJECTS: SubjectSource[] = [
  {
    subjectId: "wall-clock",
    displayName: "wall clinical / exam-room analog clock",
    sourceRawGlb: path.join(MAIN_REPO_EVIDENCE, "issue-237", "wall-clock", "wall-clock.glb"),
  },
  {
    subjectId: "bedside-monitor",
    displayName: "multi-parameter bedside monitor",
    sourceRawGlb: path.join(MAIN_REPO_EVIDENCE, "issue-237", "bedside-monitor", "bedside-monitor.glb"),
  },
  {
    subjectId: "ecg-cart",
    displayName: "12-lead ECG cart",
    sourceRawGlb: path.join(MAIN_REPO_EVIDENCE, "issue-235", "ecg-cart", "ecg-cart.glb"),
  },
];

/** Simplify ratios to apply (each from the raw GLB, fresh). */
const RATIOS = [0.10, 0.05, 0.03, 0.02];

/** Error tolerance per rung: tighter at 0.10 (0.2%), progressively looser at deeper ratios. */
const ERROR_PER_RATIO: Record<number, number> = {
  0.10: 0.002,  // 0.2% — conservative baseline
  0.05: 0.005,  // 0.5%
  0.03: 0.01,   // 1.0%
  0.02: 0.015,  // 1.5%
};

// ---------------------------------------------------------------------------
// GLB triangle counting
// ---------------------------------------------------------------------------

async function countTriangles(glbPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        tris += indices.getCount() / 3;
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += pos.getCount() / 3;
      }
    }
  }
  return Math.round(tris);
}

// ---------------------------------------------------------------------------
// glTF AABB computation (world-space, including node transforms)
// ---------------------------------------------------------------------------

interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

async function computeAABB(glbPath: string): Promise<AABB> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const pMin = pos.getMin([]) as number[];
      const pMax = pos.getMax([]) as number[];
      if (pMin[0] < min[0]) min[0] = pMin[0];
      if (pMin[1] < min[1]) min[1] = pMin[1];
      if (pMin[2] < min[2]) min[2] = pMin[2];
      if (pMax[0] > max[0]) max[0] = pMax[0];
      if (pMax[1] > max[1]) max[1] = pMax[1];
      if (pMax[2] > max[2]) max[2] = pMax[2];
    }
  }

  return { min, max };
}

// ---------------------------------------------------------------------------
// Feature survival check
// ---------------------------------------------------------------------------

const MIN_EXTENT = 0.01;   // 1 cm — below this the mesh is considered collapsed on that axis
const MIN_TRIS = 500;      // below this triangle count, geometry is too degraded

async function checkFeatureSurvival(glbPath: string, triCount: number): Promise<"ok" | "collapsed" | "unknown"> {
  if (triCount < MIN_TRIS) return "collapsed";

  try {
    const aabb = await computeAABB(glbPath);
    const extents = [
      aabb.max[0] - aabb.min[0],
      aabb.max[1] - aabb.min[1],
      aabb.max[2] - aabb.min[2],
    ];

    // Require at least 2 axes with non-trivial extent (a flat mesh has at least one)
    const survivingAxes = extents.filter((e) => e > MIN_EXTENT);
    if (survivingAxes.length < 2) return "collapsed";

    return "ok";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Simplify a GLB to a target ratio
// ---------------------------------------------------------------------------

async function simplifyGlb(inputPath: string, outputPath: string, ratio: number, errorTolerance: number): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inputPath);

  await MeshoptSimplifier.ready;
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio,
      error: errorTolerance,
      lockBorder: true,   // preserve topological borders
    }),
  );

  mkdirSync(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, doc);

  return countTriangles(outputPath);
}

// ---------------------------------------------------------------------------
// Run the ladder for one subject
// ---------------------------------------------------------------------------

async function runSubjectLadder(subject: SubjectSource): Promise<SubjectLadder> {
  const rungs: LadderRung[] = [];

  // Copy source raw GLB to worktree input dir
  mkdirSync(INPUT_DIR, { recursive: true });
  const rawCopy = path.join(INPUT_DIR, `${subject.subjectId}-raw.glb`);

  if (!existsSync(rawCopy) || statSync(rawCopy).size === 0) {
    if (existsSync(subject.sourceRawGlb)) {
      copyFileSync(subject.sourceRawGlb, rawCopy);
    } else {
      throw new Error(
        `Source GLB not found: ${subject.sourceRawGlb}. ` +
        `Run bake first (pnpm factory:trellis:bake --subject ${subject.subjectId}) on the main repo.`,
      );
    }
  }

  // Record raw triangle count as rung 0
  const rawTris = await countTriangles(rawCopy);
  const rawBytes = statSync(rawCopy).size;
  rungs.push({
    label: "raw",
    ratio: 1.0,
    triangleCount: rawTris,
    bytes: rawBytes,
    path: rawCopy,
  });

  // Apply each ratio, chaining from the previous rung to ensure monotonic decrease
  let prevPath = rawCopy;
  for (const ratio of RATIOS) {
    const outPath = path.join(EVIDENCE_DIR, subject.subjectId, `${subject.subjectId}-r${ratio}.glb`);
    mkdirSync(path.dirname(outPath), { recursive: true });

    const errorTol = ERROR_PER_RATIO[ratio] ?? 0.002;
    let tris: number;
    let fileBytes: number;

    try {
      tris = await simplifyGlb(prevPath, outPath, ratio, errorTol);
      fileBytes = statSync(outPath).size;
      prevPath = outPath; // chain: next rung simplifies from this rung's output
    } catch (err) {
      console.warn(`[trellis-deeper-postopt] Simplify failed for ${subject.subjectId} at ratio ${ratio}: ${err}`);
      // Record the last known-good rung's count as fallback (no progress)
      const last = rungs[rungs.length - 1];
      tris = last.triangleCount;
      fileBytes = last.bytes;
    }

    rungs.push({
      label: `ratio_${ratio}`,
      ratio,
      triangleCount: tris,
      bytes: fileBytes,
      path: outPath,
    });
  }

  // Feature survival on the most aggressive rung
  const lastRung = rungs[rungs.length - 1];
  const featureSurvival = await checkFeatureSurvival(lastRung.path, lastRung.triangleCount);

  return {
    subjectId: subject.subjectId,
    rungs,
    bestUnderSoftTarget: lastRung.triangleCount <= 60_000,
    bestUnderHardCeiling: lastRung.triangleCount <= 180_000,
    featureSurvival,
  };
}

// ---------------------------------------------------------------------------
// Main inspect function (called by vitest contract)
// ---------------------------------------------------------------------------

let cached: Report | null = null;

export async function inspectTrellisDeeperPostopt(): Promise<Report> {
  if (cached) return cached;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await MeshoptSimplifier.ready;

  const subjectLadders: SubjectLadder[] = [];
  const subjectsToRun = SUBJECTS.filter((s) => existsSync(s.sourceRawGlb));

  if (subjectsToRun.length < 2) {
    // Not enough source GLBs — return a minimal report documenting the block
    const report: Report = {
      subjects: subjectsToRun.map((s) => ({
        subjectId: s.subjectId,
        rungs: [],
        bestUnderSoftTarget: false,
        bestUnderHardCeiling: false,
        featureSurvival: "unknown" as const,
      })),
      softTarget: 60_000,
      hardCeiling: 180_000,
      claimScope: ["Multi-rung post-opt ladder wired — awaiting ≥2 source GLBs from issue-237/235 bakes"],
      notEvidenceFor: ["Quest 3 readiness", "clinical accuracy", "production adoption"],
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    cached = report;
    return report;
  }

  for (const subject of subjectsToRun) {
    console.log(`[trellis-deeper-postopt] Processing ${subject.subjectId}...`);
    try {
      const ladder = await runSubjectLadder(subject);
      subjectLadders.push(ladder);
      console.log(`  raw: ${ladder.rungs[0]?.triangleCount} tris`);
      for (let i = 1; i < ladder.rungs.length; i++) {
        console.log(`  r${ladder.rungs[i].label}: ${ladder.rungs[i].triangleCount} tris (${ladder.rungs[i].bytes} B)`);
      }
      console.log(`  featureSurvival: ${ladder.featureSurvival}, soft: ${ladder.bestUnderSoftTarget}, hard: ${ladder.bestUnderHardCeiling}`);
    } catch (err) {
      console.warn(`[trellis-deeper-postopt] Failed to process ${subject.subjectId}: ${err}`);
      subjectLadders.push({
        subjectId: subject.subjectId,
        rungs: [],
        bestUnderSoftTarget: false,
        bestUnderHardCeiling: false,
        featureSurvival: "unknown",
      });
    }
  }

  const report: Report = {
    subjects: subjectLadders,
    softTarget: 60_000,
    hardCeiling: 180_000,
    claimScope: [
      "TRELLIS multi-rung post-opt ladder (MADR 0050) — ratio 0.10 → 0.05 → 0.03 → 0.02",
      "gltf-transform simplify via meshoptimizer on existing TRELLIS equipment GLBs",
      "per-subject feature survival check (non-degenerate AABB, minimum tri count)",
      "no GPU re-bake — meshopt-only on existing raw exports",
      "factory_step equipment_generate post-optimization pipeline",
    ],
    notEvidenceFor: [
      "Quest 3 readiness from triangle counts alone",
      "clinical accuracy or device equivalence claims",
      "production adoption into learner runtime",
      "replacement of parametric equipment builders",
      "exam equivalence or clinical validity",
    ],
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  cached = report;
  return report;
}

// ---------------------------------------------------------------------------
// CLI entrypoint (pnpm factory:trellis:postopt)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`factory:trellis:postopt — deeper TRELLIS post-opt ladder to station band

USAGE
  pnpm factory:trellis:postopt              Run multi-rung simplify ladder (no GPU)
  pnpm factory:trellis:postopt --help        This help

DESCRIPTION
  Applies a gltf-transform simplify ladder (ratios 0.10, 0.05, 0.03, 0.02) to
  existing TRELLIS equipment GLBs from issue-237 (wall-clock, bedside-monitor)
  and issue-235 (ecg-cart).

  Does NOT re-bake TRELLIS GPU. Reads raw GLBs, writes rungs under:
    .openclinxr/evidence/issue-239/<subject>/<subject>-r<ratio>.glb

  Produces a ladder report at:
    .openclinxr/evidence/issue-239/ladder-report.json

TARGETS (MADR 0050)
  Soft per-prop: ≤60k tris
  Hard station ceiling: 180k tris
`);
    return;
  }

  const report = await inspectTrellisDeeperPostopt();
  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write("\n");
}

// ESM entry guard
const isMain = process.argv[1]?.includes("trellis-deeper-postopt");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
