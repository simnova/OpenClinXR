#!/usr/bin/env tsx
/**
 * #697 — controlled TRELLIS conditioning comparison: four arms, one seed, one source set.
 *
 * The fleet shipped single-view conditioning and never ran a controlled comparison of view
 * selection or view count. This runner performs that comparison:
 *
 *   arm                  ordered conditioning views
 *   single_shared_front  front                          (the SHIPPED condition — the control)
 *   current_four         front, right, ¾-left, ¾-right  (documented pack selection)
 *   cardinal_four        front, back, left, right       (which four, inside the envelope)
 *   cardinal_six         front, back, left, right, top, bottom (operator's six; OUT of the
 *                                                       MultiImageConditionedMixin envelope,
 *                                                       flagged experimentalOutOfTrainingEnvelope)
 *
 * All four arms share ONE eight-image source set (rendered from one GLB by
 * blender/render_conditioning_source_set.py), ONE seed, ONE sampler configuration (the
 * pipeline defaults — no overrides, matching the shipped fleet bakes), one byte-identical
 * front image at input zero, RAW outputs only (no post-opt), and blinded randomized board
 * positions for the orchestrator's visual grade.
 *
 * Writes .openclinxr/evidence/trellis-conditioning-policy/:
 *   source-set/           8 conditioning images + pack-manifest.json (hashes + camera metadata)
 *   arms/<armId>/         bake-measure.json + <armId>.glb per arm
 *   boards/               one comparison board per visual stage + board-key.json (blind key)
 *   receipts/<armId>.json review receipts (hashes, rubric hash, producer/reviewer session ids)
 *   conditioning-report.json  the machine-checkable report the planted contract reads
 *
 * The runner does NOT grade the boards — it produces them. The orchestrator grades the
 * pixels; receipts carry the producer/reviewer session-id split.
 *
 * Usage:
 *   pnpm factory:trellis:conditioning --dry-run          JSON plan, no GPU
 *   pnpm factory:trellis:conditioning --render-source-set  Blender render only
 *   pnpm factory:trellis:conditioning                    full run (bake ×4 → boards → report)
 *   pnpm factory:trellis:conditioning --force            re-bake every arm
 *
 * ENVIRONMENT
 *   OPENCLINXR_CONDITIONING_SOURCE_GLB   source GLB (default: repo or main-tree midband kit)
 *   OPENCLINXR_CONDITIONING_SEED         seed override (default 20260828)
 *   OPENCLINXR_CONDITIONING_PORT         studio dev-server port for board capture (default 5297)
 *   OPENCLINXR_BLENDER                   blender binary (default: blender on PATH)
 *
 * claimScope: whether four comparable arms were generated and graded against a rubric fixed
 *   in advance (conditioning-v1.json). retain_single_view and reject_all_measured are real
 *   outcomes — the fleet is single-view today and staying there is a result.
 * notEvidenceFor: that multiview improves output, that six views are usable, or that any arm wins.
 *
 * Header IMMUTABLE — append ## FIXED (#697).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { runGlbGradeCapture } from "./model-vetting-glb-grade-capture.js";
import { buildContactSheet } from "./isolated-subject-harness.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, "../../..");

const EVIDENCE_ROOT = path.join(REPO_ROOT, ".openclinxr", "evidence");
const POLICY_ROOT = path.join(EVIDENCE_ROOT, "trellis-conditioning-policy");
const SOURCE_SET_DIR = path.join(POLICY_ROOT, "source-set");
const ARMS_DIR = path.join(POLICY_ROOT, "arms");
const RECEIPTS_DIR = path.join(POLICY_ROOT, "receipts");
const BOARDS_DIR = path.join(POLICY_ROOT, "boards");
const REPORT_PATH = path.join(POLICY_ROOT, "conditioning-report.json");
const BOARD_KEY_PATH = path.join(BOARDS_DIR, "board-key.json");

const VENV_PYTHON = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  ".openclinxr-tools/trellis2-apple/venv/bin/python3",
);
const TRELLIS_ROOT = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  ".openclinxr-tools/trellis2-apple/src",
);
const WEIGHTS_PATH = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  "ComfyUI/models/trellis2",
);
const DINOV3_PATH = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  "ComfyUI/models/dinov3",
);

const RUN_BAKE_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/run_bake_isolated.py",
);
const MEASURE_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/measure_conditioning_geometry.py",
);
const RENDER_SOURCE_SET_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/render_conditioning_source_set.py",
);
const RUBRIC_PATH = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/trellis/rubrics/conditioning-v1.json",
);

const DEFAULT_SEED = 20260828;
/** Per-bake timeout: a 4-view bake measured 2250 s in #255; six views may run longer. */
const BAKE_TIMEOUT_MS = 7_200_000;
const STUDIO_PORT = Number(process.env.OPENCLINXR_CONDITIONING_PORT ?? 5297);

const SIX_CARDINALS = ["front", "back", "left", "right", "top", "bottom"] as const;

/** The eight-view source set. front is input zero in every arm. */
const SOURCE_SET_VIEWS = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "three_quarter_left",
  "three_quarter_right",
] as const;

interface ArmDef {
  armId: string;
  displayName: string;
  views: readonly string[];
  experimentalOutOfTrainingEnvelope: boolean;
}

export const ARMS: readonly ArmDef[] = [
  {
    armId: "single_shared_front",
    displayName: "single shared front (the shipped condition)",
    views: ["front"],
    experimentalOutOfTrainingEnvelope: false,
  },
  {
    armId: "current_four",
    displayName: "current four (documented pack selection)",
    views: ["front", "right", "three_quarter_left", "three_quarter_right"],
    experimentalOutOfTrainingEnvelope: false,
  },
  {
    armId: "cardinal_four",
    displayName: "cardinal four (front/back/left/right)",
    views: ["front", "back", "left", "right"],
    experimentalOutOfTrainingEnvelope: false,
  },
  {
    armId: "cardinal_six",
    displayName: "cardinal six (operator request; outside the learned envelope)",
    views: ["front", "back", "left", "right", "top", "bottom"],
    experimentalOutOfTrainingEnvelope: true,
  },
];

/** Sampler configuration: the shipped fleet bakes pass NO sampler overrides (pipeline
 *  defaults). The control arm must be the shipped condition, so every arm gets the same
 *  declared sampler spec — one sampler hash across arms by construction. */
const SAMPLER_SPEC = { overrides: {}, note: "pipeline_defaults_no_overrides" } as const;
export const SAMPLER_PARAMETER_SHA256 = createHash("sha256")
  .update(JSON.stringify(SAMPLER_SPEC))
  .digest("hex");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function resolveSourceGlb(): string {
  const env = process.env.OPENCLINXR_CONDITIONING_SOURCE_GLB;
  if (env) return env;
  const rel = ".openclinxr/evidence/equipment-kit-approach-b/compare-renders/stab_E_midband.glb";
  const inTree = path.join(REPO_ROOT, rel);
  if (existsSync(inTree)) return inTree;
  // Main tree kit (gitignored, may be absent in worktrees).
  const mainTree = path.join("/Volumes/files/src/openclinxr", rel);
  if (existsSync(mainTree)) return mainTree;
  return inTree;
}

function blenderBinary(): string {
  return process.env.OPENCLINXR_BLENDER ?? "blender";
}

function sourceSetManifest(): { views?: Array<{ view?: string; sha256?: string; elevDeg?: number; azimDeg?: number }> } {
  return readJson(path.join(SOURCE_SET_DIR, "pack-manifest.json")) ?? {};
}

/** Validate the source set: all six cardinals + the two three-quarters present with hashes. */
function validateSourceSet(): string[] {
  const manifest = sourceSetManifest();
  const present = new Set((manifest.views ?? []).map((v) => v.view?.replace(/\.png$/, "")));
  const missing: string[] = [];
  for (const view of SOURCE_SET_VIEWS) {
    if (!existsSync(path.join(SOURCE_SET_DIR, `${view}.png`))) missing.push(view);
    else if (!present.has(view)) missing.push(`${view} (no manifest hash)`);
  }
  return missing;
}

function inputImageRecord(view: string): { path: string; sha256: string; viewId: string } {
  const abs = path.join(SOURCE_SET_DIR, `${view}.png`);
  return {
    path: path.relative(REPO_ROOT, abs).replaceAll("\\", "/"),
    sha256: sha256File(abs),
    viewId: view,
  };
}

// ---------------------------------------------------------------------------
// Step 1 — render the source set (Blender, deterministic, no LLM)
// ---------------------------------------------------------------------------

function renderSourceSet(force: boolean): void {
  const manifest = sourceSetManifest();
  const allPresent = SOURCE_SET_VIEWS.every((v) => existsSync(path.join(SOURCE_SET_DIR, `${v}.png`)));
  if (allPresent && !force) {
    process.stdout.write(`[conditioning] source set present (${SOURCE_SET_VIEWS.length} views) — skipping render\n`);
    return;
  }
  const glb = resolveSourceGlb();
  if (!existsSync(glb)) {
    throw new Error(
      `source GLB not found: ${glb} (set OPENCLINXR_CONDITIONING_SOURCE_GLB)`,
    );
  }
  mkdirSync(SOURCE_SET_DIR, { recursive: true });
  process.stdout.write(`[conditioning] rendering ${SOURCE_SET_VIEWS.length}-view source set from ${glb}\n`);
  const out = execFileSync(
    blenderBinary(),
    ["--background", "--python", RENDER_SOURCE_SET_SCRIPT, "--", "--glb", glb, "--out-dir", SOURCE_SET_DIR, "--resolution", "1024"],
    { encoding: "utf8", cwd: REPO_ROOT, timeout: 1_800_000, maxBuffer: 20 * 1024 * 1024 },
  );
  process.stdout.write(out);
  const missing = validateSourceSet();
  if (missing.length > 0) {
    throw new Error(`source set incomplete after render: missing ${missing.join(", ")}`);
  }
  process.stdout.write(`[conditioning] source set rendered: ${SOURCE_SET_VIEWS.length} views\n`);
}

// ---------------------------------------------------------------------------
// Step 2 — bake each arm (fresh OS subprocess per arm, #237 isolation)
// ---------------------------------------------------------------------------

type BakeMeasure = {
  verdict?: string;
  verdictReason?: string;
  seed?: number;
  rawTriangleCount?: number | null;
  exportBytes?: number | null;
  exportPath?: string | null;
  wallClockS?: number | null;
  effectiveSamplerParams?: Record<string, unknown>;
};

function armBakeDir(armId: string): string {
  return path.join(ARMS_DIR, armId);
}

function armGlbPath(armId: string): string {
  return path.join(armBakeDir(armId), `${armId}.glb`);
}

function armBakeMeasure(armId: string): BakeMeasure | null {
  return readJson(path.join(armBakeDir(armId), "bake-measure.json"));
}

function bakeArm(arm: ArmDef, seed: number, force: boolean): void {
  const outputDir = armBakeDir(arm.armId);
  const existing = armBakeMeasure(arm.armId);
  if (!force && existing?.verdict === "mesh_exported" && existsSync(armGlbPath(arm.armId))) {
    process.stdout.write(`[conditioning] ${arm.armId}: bake already complete — skipping (use --force to re-bake)\n`);
    return;
  }
  mkdirSync(outputDir, { recursive: true });
  const argv: string[] = [
    RUN_BAKE_SCRIPT,
    "--subject-id", arm.armId,
    "--display-name", arm.displayName,
    "--output-dir", outputDir,
    "--weights-path", WEIGHTS_PATH,
    "--dinov3-path", DINOV3_PATH,
    "--trellis-root", TRELLIS_ROOT,
    "--seed", String(seed),
  ];
  for (const view of arm.views) {
    argv.push("--input-image", path.join(SOURCE_SET_DIR, `${view}.png`));
  }
  process.stdout.write(
    `[conditioning] ${arm.armId}: bake (${arm.views.length} view${arm.views.length > 1 ? "s" : ""}, seed ${seed}, fresh subprocess)...\n`,
  );
  const t0 = Date.now();
  const out = execFileSync(VENV_PYTHON, argv, {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: BAKE_TIMEOUT_MS,
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  process.stdout.write(out);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const measure = armBakeMeasure(arm.armId);
  process.stdout.write(
    `[conditioning] ${arm.armId}: bake finished in ${elapsed}s verdict=${measure?.verdict ?? "missing_report"}\n`,
  );
}

// ---------------------------------------------------------------------------
// Step 3 — geometry measurement (rubric metric set)
// ---------------------------------------------------------------------------

function measureGeometry(armId: string): Record<string, unknown> {
  const glb = armGlbPath(armId);
  const measure = armBakeMeasure(armId);
  const outPath = path.join(armBakeDir(armId), "geometry.json");
  const argv = [
    MEASURE_SCRIPT,
    "--glb", glb,
    "--wall-clock-s", String(measure?.wallClockS ?? 0),
    "--raw-bytes", String(measure?.exportBytes ?? 0),
    "--out", outPath,
  ];
  const out = execFileSync(VENV_PYTHON, argv, { encoding: "utf8", cwd: REPO_ROOT, timeout: 300_000 });
  const parsed = readJson<Record<string, unknown>>(outPath);
  if (!parsed) {
    throw new Error(`geometry measurement failed for ${armId}: ${out.slice(0, 400)}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 4 — comparison boards (blinded randomized positions; orchestrator grades)
// ---------------------------------------------------------------------------

const VISUAL_STAGES = ["critical_visible_integrity", "silhouette_and_cross_view_identity", "texture_contamination"] as const;

/** Deterministic shuffle (LCG) so board positions are reproducible. */
function shuffleArmOrder(arms: readonly ArmDef[], seed: number): readonly ArmDef[] {
  const arr = [...arms];
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

async function captureBoards(force: boolean): Promise<{
  boards: Record<string, { path: string; sha256: string } | null>;
  armRenders: Record<string, Record<string, string | null>>;
  refused: Record<string, string>;
}> {
  const boardsRoot = BOARDS_DIR;
  const boardImages: Record<string, { path: string; sha256: string } | null> = {};
  const armRenders: Record<string, Record<string, string | null>> = {};
  const refused: Record<string, string> = {};

  // Stage capture only when at least one arm GLB exists.
  const glbs = ARMS.map((a) => armGlbPath(a.armId)).filter((p) => existsSync(p));
  if (glbs.length === 0) {
    throw new Error("no arm GLBs to capture — run the bakes first");
  }

  const { gallery } = await runGlbGradeCapture({
    glbPaths: glbs.map((p) => path.relative(REPO_ROOT, p).replaceAll("\\", "/")),
    outputRoot: ".openclinxr/evidence/trellis-conditioning-policy/boards/glb-grade",
    port: STUDIO_PORT,
    views: ["front", "three_quarter"],
  });

  const assetImages: Record<string, Record<string, string> | null> = {};
  for (const asset of gallery.assets) {
    assetImages[path.basename(asset.sourceGlbPath, ".glb")] = asset.images;
    if (!asset.images && asset.refusedReason) {
      refused[path.basename(asset.sourceGlbPath, ".glb")] = asset.refusedReason;
    }
  }

  // One deterministic blind permutation across all boards: label A/B/C/D by position.
  const ordered = shuffleArmOrder(ARMS, 0x697);
  const letters = ["A", "B", "C", "D"] as const;
  const positionKey = ordered.map((arm, i) => ({ letter: letters[i]!, armId: arm.armId }));
  mkdirSync(boardsRoot, { recursive: true });
  writeFileSync(
    BOARD_KEY_PATH,
    `${JSON.stringify({ schemaVersion: "openclinxr.trellis-conditioning-board-key.v1", positions: positionKey, boardImageSha256: {} }, null, 2)}\n`,
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    for (const stage of VISUAL_STAGES) {
      const passView: Record<string, string> = {
        critical_visible_integrity: "front_lit",
        silhouette_and_cross_view_identity: "front_structure",
        texture_contamination: "three_quarter_lit",
      };
      const key = passView[stage]!;
      const cells: Array<{ imagePath: string; label: string }> = [];
      for (const entry of positionKey) {
        const images = assetImages[entry.armId];
        const rel = images?.[key];
        if (!rel) {
          // No render for this arm at this stage: document in the receipt via `refused`,
          // and leave the cell out of the board rather than composing a broken cell.
          process.stdout.write(
            `[conditioning] board ${stage}: ${entry.armId} has no ${key} render${refused[entry.armId] ? ` (${refused[entry.armId]})` : ""}\n`,
          );
          continue;
        }
        cells.push({ imagePath: path.join(REPO_ROOT, rel), label: entry.letter });
        armRenders[entry.armId] ??= {};
        armRenders[entry.armId]![stage] = rel;
      }
      if (cells.length === 0) {
        process.stdout.write(`[conditioning] board ${stage}: no renders at all — skipping board\n`);
        boardImages[stage] = null;
        continue;
      }
      const outPath = path.join(boardsRoot, `${stage}.png`);
      try {
        await buildContactSheet({ page, cells, outPath, columns: 2, cellWidth: 900, cellHeight: 900 });
        boardImages[stage] = { path: path.relative(REPO_ROOT, outPath).replaceAll("\\", "/"), sha256: sha256File(outPath) };
        process.stdout.write(`[conditioning] board ${stage} -> ${outPath}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`[conditioning] board ${stage} FAILED: ${message}\n`);
        boardImages[stage] = null;
      }
    }
  } finally {
    await browser.close();
  }

  // Update the key with the board hashes (needed for the receipts).
  const key = readJson<{ positions?: unknown; boardImageSha256?: Record<string, string | null> }>(BOARD_KEY_PATH) ?? {};
  key.boardImageSha256 = Object.fromEntries(
    VISUAL_STAGES.map((s) => [s, boardImages[s]?.sha256 ?? null]),
  );
  writeFileSync(BOARD_KEY_PATH, `${JSON.stringify(key, null, 2)}\n`);

  return { boards: boardImages, armRenders, refused };
}

// ---------------------------------------------------------------------------
// Step 5 — review receipts + report
// ---------------------------------------------------------------------------

function writeReviewReceipts(input: {
  boards: Record<string, { path: string; sha256: string } | null>;
  armRenders: Record<string, Record<string, string | null>>;
  refused: Record<string, string>;
}): Record<string, string> {
  const producerSessionId = process.env.GROK_SESSION_ID ?? "producer_worker_dispatch_issue_697";
  const rubricSha256 = sha256File(RUBRIC_PATH);
  const receiptHashes: Record<string, string> = {};
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  for (const arm of ARMS) {
    const boardHashes = Object.fromEntries(
      VISUAL_STAGES.map((s) => [s, input.boards[s]?.sha256 ?? null]),
    );
    const renderHashes: Record<string, string | null> = {};
    for (const stage of VISUAL_STAGES) {
      const rel = input.armRenders[arm.armId]?.[stage];
      renderHashes[stage] = rel ? sha256File(path.join(REPO_ROOT, rel)) : null;
    }
    const receipt = {
      schemaVersion: "openclinxr.trellis-conditioning-review-receipt.v1",
      armId: arm.armId,
      boardImageSha256: boardHashes,
      armRenderImageSha256: renderHashes,
      rubricSha256,
      provider: "grok-harness",
      model: process.env.OPENCLINXR_WORKER_MODEL ?? "deepseek-v4-flash",
      producerSessionId,
      reviewerSessionId: null,
      rawVisibleResponse: null,
      parsedVerdict: {
        status: "pending_orchestrator_grade",
        note: "The worker PRODUCES the board; the orchestrator GRADES it. Fill rawVisibleResponse, parsedVerdict and reviewerSessionId (must differ from producerSessionId) after grading boards/board-key.json.",
      },
      claimScope: ["board produced by worker; verdict is the orchestrator's pixel grade"],
      notEvidenceFor: ["any arm winning", "multiview improving output", "six views usable"],
    };
    const rel = path.relative(REPO_ROOT, path.join(RECEIPTS_DIR, `${arm.armId}.json`)).replaceAll("\\", "/");
    writeFileSync(path.join(REPO_ROOT, rel), `${JSON.stringify(receipt, null, 2)}\n`);
    receiptHashes[arm.armId] = sha256File(path.join(REPO_ROOT, rel));
  }
  return receiptHashes;
}

type ArmRecord = {
  armId: string;
  status: string;
  seed: number;
  samplerParameterSha256: string;
  inputImages: Array<{ path: string; sha256: string; viewId: string }>;
  experimentalOutOfTrainingEnvelope?: boolean;
  geometry?: Record<string, unknown>;
  reviewReceipt?: { path: string; sha256: string };
  failure?: { reason: string };
};

function buildArmRecords(seed: number, receiptHashes: Record<string, string>): ArmRecord[] {
  const records: ArmRecord[] = [];
  for (const arm of ARMS) {
    const measure = armBakeMeasure(arm.armId);
    const base: ArmRecord = {
      armId: arm.armId,
      status: measure?.verdict === "mesh_exported" ? "mesh_exported" : "failed_measured",
      seed,
      samplerParameterSha256: SAMPLER_PARAMETER_SHA256,
      inputImages: arm.views.map(inputImageRecord),
      ...(arm.experimentalOutOfTrainingEnvelope ? { experimentalOutOfTrainingEnvelope: true } : {}),
    };
    if (measure?.verdict !== "mesh_exported") {
      base.failure = { reason: measure?.verdictReason ?? `bake did not export a mesh (verdict=${measure?.verdict ?? "no bake-measure.json"})` };
      records.push(base);
      continue;
    }
    const geometry = measureGeometry(arm.armId);
    const receiptRel = path.relative(REPO_ROOT, path.join(RECEIPTS_DIR, `${arm.armId}.json`)).replaceAll("\\", "/");
    records.push({
      ...base,
      geometry,
      reviewReceipt: { path: receiptRel, sha256: receiptHashes[arm.armId]! },
    });
  }
  return records;
}

/** Deterministic conclusion from the rubric decision order's measurable stage
 *  (geometry diagnostics). The visual stages dominate per the rubric but are the
 *  orchestrator's pixel grade, so the report records them as pending and the
 *  orchestrator may overturn this conclusion from the boards. */
export function decidePolicy(arms: ArmRecord[]): { conclusion: string; reason: string; decisionStage: string } {
  const control = arms.find((a) => a.armId === "single_shared_front");
  const multiview = arms.filter((a) => a.armId !== "single_shared_front");
  const healthy = arms.filter((a) => a.status === "mesh_exported" && a.geometry);

  if (healthy.length === 0) {
    return {
      conclusion: "reject_all_measured",
      reason: `no arm exported a mesh (control=${control?.status ?? "missing"}, ${multiview.map((a) => `${a.armId}=${a.status}`).join(", ")}) — there is nothing to compare`,
      decisionStage: "geometry_diagnostics",
    };
  }
  if (!control || control.status !== "mesh_exported") {
    return {
      conclusion: "reject_all_measured",
      reason: `the single-view control arm did not export a mesh (${control?.status ?? "missing"}) — without the shipped-condition baseline no view-count delta can be read`,
      decisionStage: "geometry_diagnostics",
    };
  }

  const cg = control.geometry!;
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const arm of multiview) {
    if (arm.status !== "mesh_exported" || !arm.geometry) {
      regressions.push(`${arm.armId} did not export a mesh (${arm.status})`);
      continue;
    }
    const g = arm.geometry;
    const boundary = Number(g.boundaryEdgeCount ?? 0);
    const controlBoundary = Number(cg.boundaryEdgeCount ?? 0);
    if (boundary > controlBoundary * 1.02) {
      regressions.push(`${arm.armId} boundaryEdgeCount ${controlBoundary} -> ${boundary}`);
    }
    if (cg.isWatertight === true && g.isWatertight !== true) {
      regressions.push(`${arm.armId} lost watertightness (control watertight)`);
    }
    if (Number(cg.signedVolume ?? 0) >= 0 && Number(g.signedVolume ?? 0) < 0) {
      regressions.push(`${arm.armId} signed volume flipped positive -> negative (inverted/degenerate winding)`);
    }
    if (Number(g.weldedComponentCount ?? 0) > Number(cg.weldedComponentCount ?? 0) * 2) {
      regressions.push(`${arm.armId} component count >2x control (fragmentation)`);
    }
    const better =
      boundary < controlBoundary
      && g.isWatertight === true
      && Number(g.signedVolume ?? 0) >= 0
      && Number(g.weldedComponentCount ?? 0) <= Number(cg.weldedComponentCount ?? 0);
    if (better) improvements.push(arm.armId);
  }

  if (regressions.length > 0) {
    return {
      conclusion: "retain_single_view",
      reason: `multiview arms regressed the single-view control on measured geometry: ${regressions.join("; ")}. Per conditioning-v1.json the ties/regressions retain the single-view control; the orchestrator's visual grade of the boards is pending and may overturn this.`,
      decisionStage: "geometry_diagnostics",
    };
  }
  if (improvements.length === multiview.length) {
    return {
      conclusion: "adopt_multiview",
      reason: `every multiview arm strictly improved on the control across boundary edges, watertightness, winding and component count (${improvements.join(", ")}). Visual grade pending.`,
      decisionStage: "geometry_diagnostics",
    };
  }
  return {
    conclusion: "retain_single_view",
    reason: "no multiview arm is a clear measured improvement over the single-view control on the rubric geometry stage, and ties retain the single-view control (conditioning-v1.json). Visual grade pending.",
    decisionStage: "geometry_diagnostics",
  };
}

function writeReport(arms: ArmRecord[], boards: Record<string, { path: string; sha256: string } | null>): void {
  const policy = decidePolicy(arms);
  const boardSha256 = Object.fromEntries(
    VISUAL_STAGES.map((s) => [s, boards[s]?.sha256 ?? null]),
  );
  const report = {
    schemaVersion: "openclinxr.trellis-conditioning-report.v1",
    issue: "697",
    subject: "ecg-cart-midband",
    subjectDisplayName: "12-lead ECG cart midband kit (Stab E)",
    generatedAt: new Date().toISOString(),
    seed: arms[0]?.seed ?? null,
    samplerParameterSha256: SAMPLER_PARAMETER_SHA256,
    samplerSpec: { ...SAMPLER_SPEC },
    sourceSet: {
      dir: path.relative(REPO_ROOT, SOURCE_SET_DIR).replaceAll("\\", "/"),
      viewCount: SOURCE_SET_VIEWS.length,
      sixCardinalsRecorded: SIX_CARDINALS.every((v) => existsSync(path.join(SOURCE_SET_DIR, `${v}.png`))),
      manifestPath: path.relative(REPO_ROOT, path.join(SOURCE_SET_DIR, "pack-manifest.json")).replaceAll("\\", "/"),
      manifestSha256: sha256File(path.join(SOURCE_SET_DIR, "pack-manifest.json")),
    },
    rubric: {
      path: path.relative(REPO_ROOT, RUBRIC_PATH).replaceAll("\\", "/"),
      sha256: sha256File(RUBRIC_PATH),
    },
    arms,
    boards: {
      dir: path.relative(REPO_ROOT, BOARDS_DIR).replaceAll("\\", "/"),
      boardKeyPath: path.relative(REPO_ROOT, BOARD_KEY_PATH).replaceAll("\\", "/"),
      boardKeySha256: sha256File(BOARD_KEY_PATH),
      boardImageSha256: boardSha256,
      visualGradeStatus: "pending_orchestrator_grade",
      claimScope: "blinded boards produced by the worker; the orchestrator grades the pixels",
    },
    policy,
    claimScope: [
      "four comparable arms generated from one eight-image source set, one seed, one sampler configuration, RAW outputs only",
      "graded against conditioning-v1.json fixed before the run",
      "retain_single_view and reject_all_measured are real outcomes",
    ],
    notEvidenceFor: [
      "that multiview improves output",
      "that six views are usable",
      "that any arm wins",
      "Quest readiness or clinical accuracy",
    ],
  };
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[conditioning] report -> ${REPORT_PATH}\n`);
  process.stdout.write(`[conditioning] policy conclusion: ${policy.conclusion}\n`);
}

// ---------------------------------------------------------------------------
// Dry-run plan
// ---------------------------------------------------------------------------

function dryRun(): string {
  const sourceSet = validateSourceSet();
  return JSON.stringify(
    {
      mode: "dry-run",
      issue: "697",
      subject: "ecg-cart-midband",
      seed: Number(process.env.OPENCLINXR_CONDITIONING_SEED ?? DEFAULT_SEED),
      samplerParameterSha256: SAMPLER_PARAMETER_SHA256,
      samplerSpec: SAMPLER_SPEC,
      sourceGlb: resolveSourceGlb(),
      sourceSetDir: path.relative(REPO_ROOT, SOURCE_SET_DIR).replaceAll("\\", "/"),
      sourceSetViews: SOURCE_SET_VIEWS.length,
      sourceSetComplete: sourceSet.length === 0,
      sourceSetMissing: sourceSet,
      arms: ARMS.map((a) => ({
        armId: a.armId,
        views: a.views,
        viewCount: a.views.length,
        experimentalOutOfTrainingEnvelope: a.experimentalOutOfTrainingEnvelope,
        outputDir: path.relative(REPO_ROOT, armBakeDir(a.armId)).replaceAll("\\", "/"),
        bakeMeasurePresent: armBakeMeasure(a.armId)?.verdict ?? null,
      })),
      boardStages: [...VISUAL_STAGES],
      boardsDir: path.relative(REPO_ROOT, BOARDS_DIR).replaceAll("\\", "/"),
      reportPath: path.relative(REPO_ROOT, REPORT_PATH).replaceAll("\\", "/"),
      rubric: {
        path: path.relative(REPO_ROOT, RUBRIC_PATH).replaceAll("\\", "/"),
        sha256: sha256File(RUBRIC_PATH),
      },
      venvPython: VENV_PYTHON,
      trellisRoot: TRELLIS_ROOT,
      studioPort: STUDIO_PORT,
      rawOutputsOnly: true,
      processIsolation: "fresh_subprocess_per_arm",
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRunOnly = argv.includes("--dry-run");
  const renderOnly = argv.includes("--render-source-set");
  const force = argv.includes("--force");

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "factory:trellis:conditioning — #697 controlled 4-arm conditioning comparison\n\n"
        + "USAGE\n"
        + "  pnpm factory:trellis:conditioning --dry-run            JSON plan, no GPU\n"
        + "  pnpm factory:trellis:conditioning --render-source-set Blender source-set render only\n"
        + "  pnpm factory:trellis:conditioning                     full run: bake x4 -> boards -> report\n"
        + "  pnpm factory:trellis:conditioning --force             re-bake every arm\n",
    );
    return;
  }

  if (dryRunOnly) {
    process.stdout.write(dryRun());
    process.stdout.write("\n");
    return;
  }

  const seed = Number(process.env.OPENCLINXR_CONDITIONING_SEED ?? DEFAULT_SEED);

  renderSourceSet(force);

  if (renderOnly) {
    process.stdout.write(`[conditioning] source set ready (seed ${seed}); run without --render-source-set to bake\n`);
    return;
  }

  const missing = validateSourceSet();
  if (missing.length > 0) {
    throw new Error(`source set incomplete: missing ${missing.join(", ")} — render it first`);
  }

  for (const arm of ARMS) {
    bakeArm(arm, seed, force);
  }

  // Boards: capture per arm, compose one blind board per visual stage. A board
  // failure is recorded, not fatal — the report and receipts document it.
  let boards: Record<string, { path: string; sha256: string } | null>;
  let armRenders: Record<string, Record<string, string | null>>;
  let refused: Record<string, string>;
  try {
    const boardResult = await captureBoards(force);
    ({ boards, armRenders, refused } = boardResult);
  } catch (err) {
    process.stdout.write(`[conditioning] board capture failed: ${err instanceof Error ? err.message : String(err)}\n`);
    boards = Object.fromEntries(VISUAL_STAGES.map((s) => [s, null]));
    armRenders = {};
    refused = {};
  }

  const receiptHashes = writeReviewReceipts({ boards, armRenders, refused });
  const arms = buildArmRecords(seed, receiptHashes);
  writeReport(arms, boards);

  process.stdout.write(`[conditioning] done — ${arms.filter((a) => a.status === "mesh_exported").length}/${arms.length} arms exported\n`);
}

// tsx/node: compare path forms so tests can import this module without running the CLI
// (same pattern as model-vetting-glb-grade-capture.ts).
const isMain = process.argv[1]
  && (import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))
    || path.basename(process.argv[1]).startsWith("trellis-conditioning-run"));
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[conditioning] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
