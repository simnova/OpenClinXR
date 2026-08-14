/**
 * GLB-grade capture (#59) — trustworthy path from a GLB on disk to grade-worthy images.
 *
 * Design choices (implementer-owned):
 * 1. Thin sibling: synthesises an ephemeral ModelVettingReport and drives the real
 *    model-vetting-studio three.js renderer via Playwright (same path as turntable-capture).
 *    Why not only `--glb` on turntable: grade needs self-check + dual lit/structure passes +
 *    gallery coverage; turntable gets `--glb` as the report-ceremony removal for one-off use.
 * 2. Structure pass = MeshNormalMaterial + wireframe (surface orientation + interior edges).
 * 3. Tolerance: DEFAULT_RELATIVE_TOLERANCE = 0.15 on max(height, horizontalExtent) relative
 *    error. CLAIM: catches the historical Blender 1.25 vs 2.0 (~60%) and any path that draws a
 *    figure ≥20% off the NodeIO probe (e.g. 1.25 vs 1.5). NOT tuned so current assets pass —
 *    refuse is the correct outcome when they disagree.
 *
 * Independence: probe = glTF-Transform NodeIO outside the browser; in-page =
 * three.js GLTFLoader scene-graph AABB (sourceMeshAabbMeters, pre-normalize).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { chromium, type Browser, type Page } from "playwright";
import {
  validateModelVettingReport,
  type ModelVettingCandidate,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { computeMeasurementTreeStamp, type MeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";

// ---------------------------------------------------------------------------
// Pure exports (planted contracts)
// ---------------------------------------------------------------------------

export type GlbGradeCapturePlan = {
  sourceGlbPath: string;
  views: string[];
};

/**
 * Build a capture plan from a path alone — no hand-authored ModelVettingReport required.
 */
export function planGlbGradeCapture(input: {
  glbPath: string;
  views: readonly string[];
}): GlbGradeCapturePlan {
  if (!input.glbPath || typeof input.glbPath !== "string") {
    throw new Error("planGlbGradeCapture requires glbPath");
  }
  if (!input.views?.length) {
    throw new Error("planGlbGradeCapture requires at least one view");
  }
  return {
    sourceGlbPath: input.glbPath,
    views: [...input.views],
  };
}

export type MeasuredGeometry = { height: number; horizontalExtent: number };

/**
 * DEFAULT_RELATIVE_TOLERANCE = 0.15
 *
 * CLAIM: relative |a−b|/max(|a|,|b|,ε) on height OR horizontalExtent past 15% refuses.
 * Would catch historical Blender harness (probe 1.25 vs harness 2.0 ≈ 60%) and the
 * intermediate 1.25 vs 1.5 (20%) case in the planted contract. A default loose enough
 * to admit 60% error is not a check.
 *
 * NOT: tuned until today's assets pass. If a shipped asset disagrees past 15%, write
 * no image — that is the instrument working.
 *
 * Probe metric: glTF-Transform NodeIO with **node world matrices** applied to POSITION
 * (scene-graph AABB). Raw untransformed POSITION would systematically disagree with
 * three.js matrixWorld bounds on rotated bind poses (e.g. parent laid along −Z) even when
 * both instruments read the same file — that is not "drawing something other than the file".
 * Independence remains: different parser (NodeIO vs three GLTFLoader) + different runtime.
 */
export const DEFAULT_RELATIVE_TOLERANCE = 0.15;

/**
 * Scene-graph mesh AABB via glTF-Transform (outside any browser). Applies each mesh
 * node's world matrix to POSITION so the metric family matches three.js sourceMeshAabb.
 */
export async function probeSceneGraphMeshAabb(glbPath: string): Promise<MeasuredGeometry | null> {
  const document = await new NodeIO().read(glbPath);
  return meshAabbFromDocumentWorld(document);
}

function meshAabbFromDocumentWorld(document: Document): MeasuredGeometry | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let has = false;

  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        has = true;
        for (let i = 0; i + 2 < arr.length; i += 3) {
          const [x, y, z] = transformPoint(
            Number(arr[i]),
            Number(arr[i + 1]),
            Number(arr[i + 2]),
            world,
          );
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };

  for (const scene of document.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visit(root);
  }
  // Fallback: nodes not reached via scenes
  if (!has) {
    for (const node of document.getRoot().listNodes()) visit(node);
  }
  if (!has) return null;
  const height = maxY - minY;
  const horizontalExtent = Math.max(maxX - minX, maxZ - minZ);
  return { height, horizontalExtent };
}

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  // column-major 4x4
  const ox = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const oy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const oz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  return [ox, oy, oz];
}

export function evaluateGeometrySelfCheck(input: {
  probe: MeasuredGeometry;
  inPage: MeasuredGeometry;
  tolerance?: number;
}): { agrees: boolean; writeImages: boolean; relativeError: number } {
  const tol = input.tolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const heightErr = relativeError(input.probe.height, input.inPage.height);
  const horizErr = relativeError(input.probe.horizontalExtent, input.inPage.horizontalExtent);
  const relativeErrorValue = Math.max(heightErr, horizErr);
  const agrees = relativeErrorValue <= tol;
  return {
    agrees,
    writeImages: agrees,
    relativeError: relativeErrorValue,
  };
}

function relativeError(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom;
}

/** Byte-exact comparison — three copies of one buffer under three names fails this. */
export function passesDiffer(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Coverage + report synthesis
// ---------------------------------------------------------------------------

export const GENERATED_HUMANOIDS_DIR = "apps/ui-xr/public/generated-humanoids";

/** Four promoted cagematch current/ assets re-baked in #64. */
export const CAGEMATCH_SHIPPED_CURRENT_GLBS = [
  "apps/ui-xr/public/cagematch/anny-garment-hint-v1/current/peds_patient_child_garment_hint_v1.glb",
  "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb",
  "apps/ui-xr/public/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb",
  "apps/ui-xr/public/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb",
] as const;

export const DEFAULT_EVIDENCE_ROOT = ".openclinxr/evidence/glb-grade-capture";
export const DEFAULT_PUBLIC_STAGING = "apps/arena/model-vetting-studio/public/glb-grade-staging";
export const TEMPLATE_REPORT =
  "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-07.json";

const GRADE_VIEWS = ["front", "three_quarter"] as const;
const GRADE_PASSES = ["lit", "structure"] as const;

export type GlbGradeAssetResult = {
  sourceGlbPath: string;
  assetId: string;
  exists: boolean;
  selfCheck: {
    agrees: boolean;
    writeImages: boolean;
    relativeError: number;
    tolerance: number;
    probe: MeasuredGeometry | null;
    inPage: MeasuredGeometry | null;
  };
  images: Record<string, string> | null;
  refusedReason: string | null;
  notes: string[];
};

export type GlbGradeGallery = {
  schemaVersion: "openclinxr.glb-grade-capture.v1";
  generatedAt: string;
  /**
   * #89 — the TREE this capture ran against, not the minute. A pixel grade is a human judgement
   * made once and acted on for days; it must say which commit produced it. Same convention as the
   * measurement writers (31 modules carry `measuredAgainstCommit` / `treeStamp`).
   */
  measuredAgainstCommit: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: "browser_threejs_render_with_independent_geometry_self_check_not_visual_realism_or_readiness";
  purpose: string;
  defaultRelativeTolerance: number;
  coverage: {
    generatedHumanoidsGlbCount: number;
    cagematchCurrentGlbCount: number;
    total: number;
    missingOnDisk: string[];
  };
  assets: GlbGradeAssetResult[];
  notEvidenceFor: string[];
};

export async function listShippedHumanoidGlbs(cwd = process.cwd()): Promise<string[]> {
  const generatedDir = path.join(cwd, GENERATED_HUMANOIDS_DIR);
  const generated: string[] = [];
  if (existsSync(generatedDir)) {
    for (const name of await readdir(generatedDir)) {
      if (name.endsWith(".glb")) {
        generated.push(path.join(GENERATED_HUMANOIDS_DIR, name).replaceAll("\\", "/"));
      }
    }
  }
  generated.sort();
  const cagematch = [...CAGEMATCH_SHIPPED_CURRENT_GLBS];
  return [...generated, ...cagematch];
}

/**
 * Synthesise a one-candidate ModelVettingReport from a GLB path alone
 * (pattern from review-glb-optimization-visual-cagematch.ts:193-204).
 */
export async function synthesizeEphemeralReportForGlb(input: {
  glbPath: string;
  publicGlbPath: string;
  templateReportPath?: string;
  candidateId?: string;
}): Promise<ModelVettingReport> {
  const templatePath = input.templateReportPath ?? TEMPLATE_REPORT;
  const template = JSON.parse(await readFile(templatePath, "utf8")) as ModelVettingReport;
  const stem = path.basename(input.glbPath, ".glb").replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
  const candidateId = input.candidateId ?? `glb_grade_${stem}`;
  const base = structuredClone(template.candidates[0]!) as ModelVettingCandidate;
  const candidate: ModelVettingCandidate = {
    ...base,
    candidateId,
    actorId: `actor_${stem}`,
    actorDisplayRole: `grade capture · ${stem}`,
    reuseKey: `glb_grade:${stem}`,
    sourceGlbPath: input.publicGlbPath,
    provenancePath: input.publicGlbPath.replace(/\.glb$/i, ".provenance.json"),
    sourcePreflightStatus: "ready_for_browser_grade_capture",
    sourceKind: "imported_humanoid_candidate",
    usesRealAnnyForwardPass: false,
    gateResult: "blocked_before_scene",
    provenance: {
      ...base.provenance,
      sourceGlbPath: input.publicGlbPath,
      provenancePath: input.publicGlbPath.replace(/\.glb$/i, ".provenance.json"),
      sourceReportCandidateId: candidateId,
      auditPointers: [...base.provenance.auditPointers, "glb-grade-capture-ephemeral"],
    },
  };
  const report: ModelVettingReport = {
    ...structuredClone(template),
    generatedAt: new Date().toISOString(),
    candidates: [candidate],
    decision: {
      ...template.decision,
      status: "blocked_before_scene",
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: "Grade-capture ephemeral report; not a promotion vehicle.",
    },
  };
  const validation = validateModelVettingReport(report);
  if (!validation.ok) {
    throw new Error(`Ephemeral model-vetting report invalid: ${validation.errors.join("; ")}`);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Capture runner
// ---------------------------------------------------------------------------

type CaptureEvidence = {
  meshCount?: number;
  sourceMeshAabbMeters?: {
    height: number;
    horizontalExtent: number;
    width: number;
    depth: number;
  };
  normalizedBoundsMeters?: { width: number; height: number; depth: number };
  capturePass?: string;
  captureView?: string;
};

export async function runGlbGradeCapture(options: {
  glbPaths?: string[];
  allShippedHumanoids?: boolean;
  outputRoot?: string;
  publicStagingRoot?: string;
  port?: number;
  views?: readonly string[];
  cwd?: string;
  /** issue-341 debug: force alpha-0 body-hide primitives visible in magenta. */
  hideMaskMagenta?: boolean;
}): Promise<{ gallery: GlbGradeGallery; galleryPath: string; runDir: string }> {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? 5197;
  const views = options.views?.length ? [...options.views] : [...GRADE_VIEWS];
  const glbPaths = options.allShippedHumanoids || !options.glbPaths?.length
    ? await listShippedHumanoidGlbs(cwd)
    : options.glbPaths;
  // #89: fail closed — a gallery that cannot name its tree must not be written at all.
  const treeStamp = computeMeasurementTreeStamp(cwd);
  const runId = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const evidenceRoot = options.outputRoot ?? DEFAULT_EVIDENCE_ROOT;
  const runDir = path.join(cwd, evidenceRoot, runId);
  const latestDir = path.join(cwd, evidenceRoot, "latest");
  const publicStaging = path.join(cwd, options.publicStagingRoot ?? DEFAULT_PUBLIC_STAGING, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(publicStaging, { recursive: true });

  const missingOnDisk = glbPaths.filter((p) => !existsSync(path.join(cwd, p)));
  // Stage ALL glbs + one multi-candidate report BEFORE starting the studio so Vite
  // never SPA-falls-back mid-run (observed after sequential per-asset report writes).
  const staged = await stageAllAssets({ cwd, glbPaths, publicStaging });
  const server = await startStudioServer(port, cwd);
  let browser: Browser | null = null;
  const assets: GlbGradeAssetResult[] = [];

  try {
    browser = await chromium.launch({ headless: true });

    for (const entry of staged.entries) {
      const context = await browser.newContext({
        viewport: { width: 4096, height: 4096 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      try {
        assets.push(await gradeOneGlb({
          glbPath: entry.sourceGlbPath,
          assetId: entry.assetId,
          candidateId: entry.candidateId,
          reportUrl: staged.reportUrl,
          cwd,
          page,
          port,
          views,
          runDir,
          hideMaskMagenta: options.hideMaskMagenta,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        assets.push({
          sourceGlbPath: entry.sourceGlbPath,
          assetId: entry.assetId,
          exists: entry.exists,
          selfCheck: {
            agrees: false,
            writeImages: false,
            relativeError: 1,
            tolerance: DEFAULT_RELATIVE_TOLERANCE,
            probe: null,
            inPage: null,
          },
          images: null,
          refusedReason: `capture_error:${message.slice(0, 200)}`,
          notes: [message],
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    stopServer(server);
  }

  const gallery: GlbGradeGallery = {
    schemaVersion: "openclinxr.glb-grade-capture.v1",
    generatedAt: new Date().toISOString(),
    measuredAgainstCommit: treeStamp.head,
    treeStamp,
    claimScope: "browser_threejs_render_with_independent_geometry_self_check_not_visual_realism_or_readiness",
    purpose:
      "Render every shipped humanoid through the real model-vetting three.js path, fail-closed when "
      + "in-page geometry disagrees with the NodeIO probe, and emit lit+structure passes for human grading. "
      + "Does not assert any asset looks right.",
    defaultRelativeTolerance: DEFAULT_RELATIVE_TOLERANCE,
    coverage: {
      generatedHumanoidsGlbCount: glbPaths.filter((p) => p.includes("generated-humanoids")).length,
      cagematchCurrentGlbCount: glbPaths.filter((p) => p.includes("/cagematch/")).length,
      total: glbPaths.length,
      missingOnDisk,
    },
    assets,
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
      "b_plus_visual_realism_gate",
      "visual_grade_verdict",
    ],
  };

  const galleryPath = path.join(runDir, "gallery.json");
  await writeFile(galleryPath, `${JSON.stringify(gallery, null, 2)}\n`, "utf8");
  await mkdir(latestDir, { recursive: true });
  await writeFile(path.join(latestDir, "gallery.json"), `${JSON.stringify(gallery, null, 2)}\n`, "utf8");
  // Keep a small index of the run for validate-latest
  await writeFile(
    path.join(latestDir, "run-pointer.json"),
    `${JSON.stringify({ runId, runDir: path.relative(cwd, runDir), galleryPath: path.relative(cwd, galleryPath) }, null, 2)}\n`,
    "utf8",
  );

  return { gallery, galleryPath, runDir };
}

type StagedEntry = {
  sourceGlbPath: string;
  assetId: string;
  candidateId: string;
  publicGlbPath: string;
  exists: boolean;
};

async function stageAllAssets(input: {
  cwd: string;
  glbPaths: string[];
  publicStaging: string;
}): Promise<{ reportUrl: string; entries: StagedEntry[] }> {
  const runLeaf = path.basename(input.publicStaging);
  const entries: StagedEntry[] = [];
  const candidates: ModelVettingCandidate[] = [];

  for (const glbPath of input.glbPaths) {
    const assetId = path.basename(glbPath, ".glb").replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
    const candidateId = `glb_grade_${assetId}`;
    const absGlb = path.join(input.cwd, glbPath);
    const exists = existsSync(absGlb);
    const publicGlbPath = path.join(
      "apps/arena/model-vetting-studio/public",
      "glb-grade-staging",
      runLeaf,
      `${assetId}.glb`,
    ).replaceAll("\\", "/");
    if (exists) {
      await copyFile(absGlb, path.join(input.cwd, publicGlbPath));
      const one = await synthesizeEphemeralReportForGlb({
        glbPath,
        publicGlbPath,
        candidateId,
      });
      candidates.push(one.candidates[0]!);
    }
    entries.push({ sourceGlbPath: glbPath, assetId, candidateId, publicGlbPath, exists });
  }

  // Multi-candidate report (turntable pattern) — single URL for the whole run.
  const template = JSON.parse(await readFile(path.join(input.cwd, TEMPLATE_REPORT), "utf8")) as ModelVettingReport;
  const report: ModelVettingReport = {
    ...structuredClone(template),
    generatedAt: new Date().toISOString(),
    candidates: candidates.length
      ? candidates
      : structuredClone(template.candidates).slice(0, 1),
    decision: {
      ...template.decision,
      status: "blocked_before_scene",
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: "glb-grade multi-candidate ephemeral report",
    },
  };
  const validation = validateModelVettingReport(report);
  if (!validation.ok) {
    throw new Error(`Multi-candidate grade report invalid: ${validation.errors.join("; ")}`);
  }
  const reportRel = path.join(
    "apps/arena/model-vetting-studio/public",
    "glb-grade-staging",
    runLeaf,
    "grade-report.json",
  ).replaceAll("\\", "/");
  await writeFile(path.join(input.cwd, reportRel), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const reportUrl = `/${reportRel.slice("apps/arena/model-vetting-studio/public/".length)}`;
  return { reportUrl, entries };
}

async function gradeOneGlb(input: {
  glbPath: string;
  assetId: string;
  candidateId: string;
  reportUrl: string;
  cwd: string;
  page: Page;
  port: number;
  views: string[];
  runDir: string;
  hideMaskMagenta?: boolean;
}): Promise<GlbGradeAssetResult> {
  const plan = planGlbGradeCapture({ glbPath: input.glbPath, views: input.views });
  const assetId = input.assetId;
  const notes: string[] = [];
  const absGlb = path.join(input.cwd, input.glbPath);

  if (!existsSync(absGlb)) {
    return {
      sourceGlbPath: plan.sourceGlbPath,
      assetId,
      exists: false,
      selfCheck: {
        agrees: false,
        writeImages: false,
        relativeError: 1,
        tolerance: DEFAULT_RELATIVE_TOLERANCE,
        probe: null,
        inPage: null,
      },
      images: null,
      refusedReason: "glb_missing_on_disk",
      notes: ["file not present; worktree may lack gitignored cagematch assets"],
    };
  }

  // Independent instrument A: glTF-Transform NodeIO scene-graph AABB (no browser).
  const probe = await probeSceneGraphMeshAabb(absGlb);
  if (!probe) {
    return {
      sourceGlbPath: plan.sourceGlbPath,
      assetId,
      exists: true,
      selfCheck: {
        agrees: false,
        writeImages: false,
        relativeError: 1,
        tolerance: DEFAULT_RELATIVE_TOLERANCE,
        probe: null,
        inPage: null,
      },
      images: null,
      refusedReason: "probe_mesh_aabb_unavailable",
      notes: ["NodeIO world-space mesh AABB unavailable"],
    };
  }

  // Independent instrument B: three.js GLTFLoader via studio capture (first lit front for AABB).
  const firstView = input.views[0] ?? "front";
  const evidence = await captureView({
    page: input.page,
    port: input.port,
    reportUrl: input.reportUrl,
    candidateId: input.candidateId,
    view: firstView,
    capturePass: "lit",
    hideMaskMagenta: input.hideMaskMagenta,
  });
  const inPageRaw = evidence.sourceMeshAabbMeters;
  if (!inPageRaw || !(inPageRaw.height > 0)) {
    return {
      sourceGlbPath: plan.sourceGlbPath,
      assetId,
      exists: true,
      selfCheck: {
        agrees: false,
        writeImages: false,
        relativeError: 1,
        tolerance: DEFAULT_RELATIVE_TOLERANCE,
        probe,
        inPage: null,
      },
      images: null,
      refusedReason: "in_page_source_mesh_aabb_unavailable",
      notes: [
        `capture evidence keys: ${Object.keys(evidence).join(",")}`,
        `meshCount=${evidence.meshCount ?? "n/a"}`,
      ],
    };
  }
  const inPage: MeasuredGeometry = {
    height: inPageRaw.height,
    horizontalExtent: inPageRaw.horizontalExtent,
  };
  const check = evaluateGeometrySelfCheck({ probe, inPage });
  notes.push(
    `probe height=${probe.height.toFixed(4)} horiz=${probe.horizontalExtent.toFixed(4)}`,
    `inPage height=${inPage.height.toFixed(4)} horiz=${inPage.horizontalExtent.toFixed(4)}`,
    `relativeError=${check.relativeError.toFixed(4)} tol=${DEFAULT_RELATIVE_TOLERANCE}`,
  );

  if (!check.writeImages) {
    notes.push("REFUSED: geometry self-check failed — writing no grade images");
    return {
      sourceGlbPath: plan.sourceGlbPath,
      assetId,
      exists: true,
      selfCheck: {
        ...check,
        tolerance: DEFAULT_RELATIVE_TOLERANCE,
        probe,
        inPage,
      },
      images: null,
      refusedReason: "geometry_self_check_disagreement",
      notes,
    };
  }

  // Self-check passed — write lit + structure for each view.
  const images: Record<string, string> = {};
  const assetOutDir = path.join(input.runDir, "assets", assetId);
  await mkdir(assetOutDir, { recursive: true });

  for (const view of input.views) {
    for (const pass of GRADE_PASSES) {
      const shot = await captureViewWithScreenshot({
        page: input.page,
        port: input.port,
        reportUrl: input.reportUrl,
        candidateId: input.candidateId,
        view,
        capturePass: pass,
        screenshotPath: path.join(assetOutDir, `${view}_${pass}.png`),
        hideMaskMagenta: input.hideMaskMagenta,
      });
      images[`${view}_${pass}`] = path.relative(input.cwd, shot.screenshotPath).replaceAll("\\", "/");
    }
  }

  // Pixel-diff guard: lit vs structure of same view must differ.
  const litFront = path.join(input.cwd, images[`${firstView}_lit`]!);
  const structFront = path.join(input.cwd, images[`${firstView}_structure`]!);
  const litBytes = new Uint8Array(await readFile(litFront));
  const structBytes = new Uint8Array(await readFile(structFront));
  if (!passesDiffer(litBytes, structBytes)) {
    notes.push("FAIL: lit and structure passes are identical pixels — removing images");
    await rm(assetOutDir, { recursive: true, force: true });
    return {
      sourceGlbPath: plan.sourceGlbPath,
      assetId,
      exists: true,
      selfCheck: {
        ...check,
        tolerance: DEFAULT_RELATIVE_TOLERANCE,
        probe,
        inPage,
      },
      images: null,
      refusedReason: "lit_and_structure_identical_pixels",
      notes,
    };
  }
  notes.push(
    `lit_sha256=${createHash("sha256").update(litBytes).digest("hex").slice(0, 12)}`,
    `structure_sha256=${createHash("sha256").update(structBytes).digest("hex").slice(0, 12)}`,
  );

  return {
    sourceGlbPath: plan.sourceGlbPath,
    assetId,
    exists: true,
    selfCheck: {
      ...check,
      tolerance: DEFAULT_RELATIVE_TOLERANCE,
      probe,
      inPage,
    },
    images,
    refusedReason: null,
    notes,
  };
}

async function captureView(input: {
  page: Page;
  port: number;
  reportUrl: string;
  candidateId: string;
  view: string;
  capturePass: "lit" | "structure";
  hideMaskMagenta?: boolean;
}): Promise<CaptureEvidence> {
  const url =
    `http://127.0.0.1:${input.port}/?reportUrl=${encodeURIComponent(input.reportUrl)}`
    + `&captureCandidateId=${encodeURIComponent(input.candidateId)}`
    + `&captureView=${encodeURIComponent(input.view)}`
    + `&capturePass=${encodeURIComponent(input.capturePass)}`
    + (input.hideMaskMagenta ? "&captureHideMaskMagenta=1" : "");
  // Preflight: ensure the ephemeral report is served as JSON (not HTML 404/error).
  const reportProbe = await input.page.request.get(`http://127.0.0.1:${input.port}${input.reportUrl}`);
  if (!reportProbe.ok()) {
    throw new Error(`reportUrl HTTP ${reportProbe.status()} for ${input.reportUrl}`);
  }
  const reportText = await reportProbe.text();
  try {
    JSON.parse(reportText);
  } catch {
    throw new Error(`reportUrl is not JSON (${reportText.slice(0, 120)}) for ${input.reportUrl}`);
  }

  await input.page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  try {
    const handle = await input.page.waitForFunction(
      () => {
        const evidence = (window as unknown as {
          __openClinXrModelVettingCandidateCaptureEvidence?: CaptureEvidence & { meshCount?: number };
        }).__openClinXrModelVettingCandidateCaptureEvidence;
        return evidence && typeof evidence.meshCount === "number" && evidence.meshCount > 0
          ? evidence
          : null;
      },
      null,
      { timeout: 120_000 },
    );
    return (await handle.jsonValue()) as CaptureEvidence;
  } catch (err) {
    const bodyText = await input.page.locator("body").innerText().catch(() => "");
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `captureView timeout for ${input.candidateId} ${input.view}/${input.capturePass}: ${message}; body=${bodyText.slice(0, 400)}`,
    );
  }
}

async function captureViewWithScreenshot(input: {
  page: Page;
  port: number;
  reportUrl: string;
  candidateId: string;
  view: string;
  capturePass: "lit" | "structure";
  screenshotPath: string;
  hideMaskMagenta?: boolean;
}): Promise<{ screenshotPath: string; evidence: CaptureEvidence }> {
  const evidence = await captureView(input);
  await mkdir(path.dirname(input.screenshotPath), { recursive: true });
  // Prefer the three.js canvas (preserveDrawingBuffer) over full-page chrome.
  const canvas = input.page.locator("#model-vetting-candidate-capture-canvas");
  if (await canvas.count()) {
    await canvas.screenshot({ path: input.screenshotPath });
  } else {
    await input.page.screenshot({ path: input.screenshotPath });
  }
  return { screenshotPath: input.screenshotPath, evidence };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateGlbGradeGallery(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["gallery must be an object"] };
  if (value.schemaVersion !== "openclinxr.glb-grade-capture.v1") {
    errors.push("schemaVersion must be openclinxr.glb-grade-capture.v1");
  }
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    errors.push("assets must be a non-empty array");
  }
  if (isRecord(value.coverage)) {
    if (typeof value.coverage.total !== "number" || value.coverage.total < 1) {
      errors.push("coverage.total must be >= 1");
    }
  } else {
    errors.push("coverage must be an object");
  }
  if (Array.isArray(value.assets)) {
    for (const [i, asset] of value.assets.entries()) {
      if (!isRecord(asset)) {
        errors.push(`assets/${i} must be object`);
        continue;
      }
      if (typeof asset.sourceGlbPath !== "string") errors.push(`assets/${i}/sourceGlbPath required`);
      if (!isRecord(asset.selfCheck)) errors.push(`assets/${i}/selfCheck required`);
      else if (typeof asset.selfCheck.agrees !== "boolean") {
        errors.push(`assets/${i}/selfCheck.agrees must be boolean`);
      }
    }
  }
  if (!Array.isArray(value.notEvidenceFor) || !value.notEvidenceFor.includes("quest_readiness")) {
    errors.push("notEvidenceFor must preserve false readiness gates");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export async function validateLatestGallery(cwd = process.cwd()): Promise<{
  ok: boolean;
  galleryPath: string;
  errors: string[];
}> {
  const galleryPath = path.join(cwd, DEFAULT_EVIDENCE_ROOT, "latest", "gallery.json");
  if (!existsSync(galleryPath)) {
    return { ok: false, galleryPath, errors: [`missing ${galleryPath}`] };
  }
  const gallery = JSON.parse(await readFile(galleryPath, "utf8")) as unknown;
  const validation = validateGlbGradeGallery(gallery);
  if (!validation.ok) return { ok: false, galleryPath, errors: validation.errors };

  // Coverage contract: every generated-humanoids GLB + four cagematch current assets named.
  const expected = await listShippedHumanoidGlbs(cwd);
  const named = new Set(
    (gallery as GlbGradeGallery).assets.map((a) => a.sourceGlbPath.replaceAll("\\", "/")),
  );
  const missing = expected.filter((p) => !named.has(p));
  if (missing.length) {
    return {
      ok: false,
      galleryPath,
      errors: missing.map((p) => `coverage gap: ${p} not named in gallery`),
    };
  }
  return { ok: true, galleryPath, errors: [] };
}

// ---------------------------------------------------------------------------
// Server helpers (same pattern as turntable / review-glb visual)
// ---------------------------------------------------------------------------

async function startStudioServer(port: number, cwd: string): Promise<ChildProcess> {
  const child = spawn("pnpm", ["--filter", "@openclinxr/model-vetting-studio", "dev:portless"], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (child.exitCode !== null) {
      throw new Error(`Model Vetting Studio exited early: ${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out starting Model Vetting Studio on ${port}: ${output.slice(-2000)}`);
}

function stopServer(server: ChildProcess): void {
  if (server.exitCode === null) server.kill("SIGTERM");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  let allShipped = false;
  let validateLatest = false;
  let hideMaskMagenta = false;
  let port = 5197;
  let outputRoot: string | undefined;
  const glbPaths: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--all-shipped-humanoids") allShipped = true;
    else if (arg === "--validate-latest") validateLatest = true;
    else if (arg === "--hide-mask-magenta") hideMaskMagenta = true;
    else if (arg === "--glb" && argv[i + 1]) glbPaths.push(argv[++i]!);
    else if (arg === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (arg === "--output-root" && argv[i + 1]) outputRoot = argv[++i]!;
  }

  if (validateLatest) {
    const result = await validateLatestGallery();
    if (!result.ok) {
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, galleryPath: result.galleryPath }, null, 2));
    return;
  }

  const { gallery, galleryPath, runDir } = await runGlbGradeCapture({
    allShippedHumanoids: allShipped || glbPaths.length === 0,
    glbPaths: glbPaths.length ? glbPaths : undefined,
    port,
    hideMaskMagenta,
    outputRoot,
  });
  const agreed = gallery.assets.filter((a) => a.selfCheck.agrees).length;
  const refused = gallery.assets.filter((a) => a.refusedReason).length;
  console.log(JSON.stringify({
    galleryPath,
    runDir,
    total: gallery.assets.length,
    agreed,
    refused,
    missingOnDisk: gallery.coverage.missingOnDisk,
    assets: gallery.assets.map((a) => ({
      path: a.sourceGlbPath,
      agrees: a.selfCheck.agrees,
      relativeError: a.selfCheck.relativeError,
      refusedReason: a.refusedReason,
      imageCount: a.images ? Object.keys(a.images).length : 0,
    })),
  }, null, 2));
}

// tsx/node: compare path forms so CLI always runs when invoked directly. The loose
// `includes(import.meta.url)` fallback fires under vitest (import.meta.url IS this module),
// starting an orphaned capture for every test import — so match the invoked basename instead.
const isMain = process.argv[1]
  && (import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))
    || path.basename(process.argv[1]).startsWith("model-vetting-glb-grade-capture"));
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
