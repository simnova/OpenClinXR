/**
 * #235 TRELLIS multi-case bake + post-opt from Grok MV packs + MADR 0050.
 *
 * #233 proved one ECG image → mesh_exported (991k tris, postOpt null).
 * #232 shipped multi-view packs for ecg-cart, wall-clock, bedside-monitor.
 *
 * This module:
 *  1. Reads per-subject bake-measure.json artifacts from the Python bake script
 *  2. For each exported mesh, runs gltf-transform simplify (meshopt post-opt)
 *  3. Records rawTriangleCount and postOptTriangleCount per subject
 *  4. Assigns per-subject verdicts using the contract vocabulary
 *
 * Header IMMUTABLE — append ## FIXED (#235).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const __dirname = path.resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// Types (match planted contract)
// ---------------------------------------------------------------------------

export type SubjectVerdict =
  | "mesh_exported"
  | "runs_but_over_budget"
  | "blocked_build"
  | "inconclusive_blocked";

export type SubjectRow = {
  subjectId: string;
  displayName: string;
  verdict: SubjectVerdict;
  verdictReason: string;
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
  exportPath: string | null;
  postOptPath: string | null;
  exportBytes: number | null;
  postOptBytes: number | null;
  stages: Record<string, unknown>;
};

export type MultiCaseReport = {
  schemaVersion: "openclinxr.trellis-multicase-postopt.v1";
  issue: "235";
  factoryStep: "equipment_generate";
  generatedAt: string;
  subjects: SubjectRow[];
  claimScope: string[];
  notEvidenceFor: string[];
};

// ---------------------------------------------------------------------------
// Evidence directory
// ---------------------------------------------------------------------------

const EVIDENCE_DIR = path.resolve(REPO_ROOT, ".openclinxr/evidence/issue-235");
const REPORT_PATH = path.join(EVIDENCE_DIR, "multi-case-report.json");

// Subjects to expect (from #232 packs)
const EXPECTED_SUBJECTS = ["ecg-cart", "wall-clock", "bedside-monitor"];

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
// Post-opt: gltf-transform simplify with meshoptimizer
// ---------------------------------------------------------------------------

async function runPostOpt(inputPath: string, outputPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inputPath);

  await MeshoptSimplifier.ready;
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.10,       // target 10% of original vertices (aggressive for ~1M→~180k tris)
      error: 0.002,      // 0.2% error limit
      lockBorder: true,  // preserve topological borders (thin features)
    }),
  );

  mkdirSync(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, doc);

  return countTriangles(outputPath);
}

// ---------------------------------------------------------------------------
// Load per-subject bake artifacts from Python bake script
// ---------------------------------------------------------------------------

interface BakeMeasure {
  subjectId: string;
  displayName?: string;
  verdict: string;
  verdictReason?: string;
  stages?: Record<string, unknown>;
  rawTriangleCount?: number | null;
  exportPath?: string | null;
  exportBytes?: number | null;
  texturedPbr?: string;
  wallClockS?: number;
  claimScope?: string[];
  notEvidenceFor?: string[];
}

function loadBakeArtifacts(): BakeMeasure[] {
  const results: BakeMeasure[] = [];

  for (const subjectId of EXPECTED_SUBJECTS) {
    const artifactPath = path.join(EVIDENCE_DIR, subjectId, "bake-measure.json");
    if (existsSync(artifactPath)) {
      try {
        const raw = readFileSync(artifactPath, "utf-8");
        const parsed = JSON.parse(raw) as BakeMeasure;
        results.push(parsed);
      } catch (err) {
        console.warn(`[trellis-multicase-postopt] Failed to read ${artifactPath}: ${err}`);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main inspect function (called by vitest contract)
// ---------------------------------------------------------------------------

let cached: MultiCaseReport | null = null;

export async function inspectTrellisMulticasePostopt(): Promise<MultiCaseReport> {
  if (cached) return cached;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await MeshoptSimplifier.ready;

  const bakes = loadBakeArtifacts();

  if (bakes.length < 2) {
    // Fallback: return a blocked report
    const fallback: MultiCaseReport = {
      schemaVersion: "openclinxr.trellis-multicase-postopt.v1",
      issue: "235",
      factoryStep: "equipment_generate",
      generatedAt: new Date().toISOString(),
      subjects: bakes.map((b) => ({
        subjectId: b.subjectId,
        displayName: b.displayName ?? b.subjectId,
        verdict: "blocked_build" as SubjectVerdict,
        verdictReason: b.verdictReason ?? "Python bake not yet executed or fewer than 2 subjects available",
        rawTriangleCount: b.rawTriangleCount ?? null,
        postOptTriangleCount: null,
        exportPath: b.exportPath ?? null,
        postOptPath: null,
        exportBytes: b.exportBytes ?? null,
        postOptBytes: null,
        stages: b.stages ?? {},
      })),
      claimScope: ["multi-case post-opt pipeline wired — awaiting Python bake execution"],
      notEvidenceFor: ["Quest 3 readiness", "clinical accuracy", "production adoption"],
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(fallback, null, 2)}\n`);
    cached = fallback;
    return fallback;
  }

  const subjects: SubjectRow[] = [];

  for (const bake of bakes) {
    const subjectId = bake.subjectId;
    const displayName = bake.displayName ?? subjectId;
    const rawTris = bake.rawTriangleCount ?? null;
    const exportPath = bake.exportPath ?? null;
    const exportBytes = bake.exportBytes ?? null;

    // Determine base verdict from Python bake
    let verdict: SubjectVerdict;
    if (bake.verdict === "mesh_exported") {
      verdict = "mesh_exported";
    } else if (bake.verdict === "blocked_build" || bake.verdict === "blocked_model") {
      verdict = "blocked_build";
    } else {
      verdict = "inconclusive_blocked";
    }

    let postOptTris: number | null = null;
    let postOptPath: string | null = null;
    let postOptBytes: number | null = null;

    // Run post-opt if mesh was exported
    if (verdict === "mesh_exported" && exportPath && existsSync(exportPath)) {
      try {
        const optDir = path.join(EVIDENCE_DIR, subjectId);
        mkdirSync(optDir, { recursive: true });
        const optGlb = path.join(optDir, `${subjectId}-postopt.glb`);
        postOptTris = await runPostOpt(exportPath, optGlb);
        postOptPath = optGlb;
        postOptBytes = existsSync(optGlb) ? statSync(optGlb).size : null;

        // MADR 0050: record both raw and post-opt; do not reject solely on raw.
        // Post-opt verdict adjustment: if still over 180k after post-opt, mark runs_but_over_budget.
        if (postOptTris > 180_000) {
          verdict = "runs_but_over_budget";
        }
      } catch (err) {
        console.warn(`[trellis-multicase-postopt] Post-opt failed for ${subjectId}: ${err}`);
        // Leave postOpt null; verdict stays as-is.
      }
    }

    subjects.push({
      subjectId,
      displayName,
      verdict,
      verdictReason:
        bake.verdictReason ?? `Bake verdict: ${bake.verdict}, raw tris: ${rawTris}, post-opt: ${postOptTris}`,
      rawTriangleCount: rawTris,
      postOptTriangleCount: postOptTris,
      exportPath,
      postOptPath,
      exportBytes,
      postOptBytes,
      stages: bake.stages ?? {},
    });
  }

  const report: MultiCaseReport = {
    schemaVersion: "openclinxr.trellis-multicase-postopt.v1",
    issue: "235",
    factoryStep: "equipment_generate",
    generatedAt: new Date().toISOString(),
    subjects,
    claimScope: [
      "TRELLIS Metal multi-case bake (≥2 subjects) from #232 Grok multi-view packs",
      "per-subject raw and post-opt triangle counts (MADR 0050)",
      "gltf-transform simplify via meshoptimizer post-opt on every exported mesh",
      "MIT model + MIT Metal packages + local DINOv3",
      "factory_step equipment_generate input material pipeline",
    ],
    notEvidenceFor: [
      "Quest 3 readiness",
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
