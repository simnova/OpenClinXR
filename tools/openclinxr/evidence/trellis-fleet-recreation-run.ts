#!/usr/bin/env tsx
/**
 * #698 — fleet re-creation runner: every frozen census member through the derive chain.
 *
 * The census (tools/openclinxr/asset-pipeline/trellis/census/fleet-census-2026-08-26.json) is
 * FROZEN: 13 source bake-measure.json records -> 11 canonical subjects. The source tree is
 * gitignored and mutable, so this runner never re-scans it for the TARGET SET — it reads the
 * frozen manifest and resolves each source path against the main tree
 * (/Volumes/files/src/openclinxr), verifying the source hash matches the census record.
 *
 * Per subject the derive chain is:
 *   pack -> generate -> decimate -> UV -> bake onto low -> attach -> render mapped and
 *   unmapped siblings -> grade -> terminal disposition.
 *
 * Each stage writes an immutable receipt naming its predecessor receipt and hash, so any stage
 * can be re-run from its predecessor's output without repeating the chain. There is no
 * scheduler, queue or DAG; the receipt chain IS the resume mechanism (a stage receipt present
 * and unforced means the stage is skipped).
 *
 * The visual grade is the ORCHESTRATOR's pixel grade of the mapped/unmapped renders (this
 * runner is text-only and cannot grade pixels). Per fleet-v1.json, adoption requires a graded
 * silhouette, so the terminal disposition recorded here is reject_measured per subject with its
 * measurements; the orchestrator may overturn from the renders.
 *
 * Usage:
 *   pnpm factory:trellis:fleet --dry-run        JSON plan, no Blender, no GPU, no meshopt
 *   pnpm factory:trellis:fleet                  full run over the frozen census
 *   pnpm factory:trellis:fleet --force          re-run stages whose receipts already exist
 *   pnpm factory:trellis:fleet --subject <id>   run a single subject
 *   pnpm factory:trellis:fleet --report-only    rebuild report + census stamp from existing receipts
 *
 * claimScope: whether every frozen census member reached a terminal measured disposition.
 * notEvidenceFor: that any subject improved, that multiview won, or that artifacts were
 *   eliminated. reject_measured per subject closes this card as readily as adopt.
 *
 * Header IMMUTABLE — append ## FIXED (#698).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, "../../..");
/** Main checkout — the gitignored TRELLIS evidence (raws, champions, packs) lives here. */
const MAIN_TREE = "/Volumes/files/src/openclinxr";

const CENSUS_PATH = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/trellis/census/fleet-census-2026-08-26.json",
);
const RUBRIC_PATH = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/trellis/rubrics/fleet-v1.json",
);
const EVIDENCE_ROOT = path.join(REPO_ROOT, ".openclinxr", "evidence");
const FLEET_ROOT = path.join(EVIDENCE_ROOT, "trellis-fleet-recreation");
const REPORT_PATH = path.join(FLEET_ROOT, "fleet-report.json");
/** Landable mirror: the planted contract reads a tracked fixture (#697/#712 gitignored trap). */
const TRACKED_REPORT = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/fixtures/issue-698-fleet-report.json",
);
const TRACKED_REVIEWS_DIR = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/fixtures/issue-698-fleet/reviews",
);

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const BAKE_SCRIPT = path.join(HERE, "..", "asset-pipeline", "trellis", "bake-probe", "hl_bake.py");
const EXPORT_MAPPED_SCRIPT = path.join(HERE, "..", "asset-pipeline", "trellis", "bake-probe", "export_mapped.py");
const RENDER_SCRIPT = path.join(HERE, "..", "asset-pipeline", "trellis", "bake-probe", "ab_render.py");
const UV_SCRIPT = path.join(HERE, "..", "asset-pipeline", "trellis", "bake-probe", "uv_project.py");

/** Standard fleet rung (stretch, per #702/#703 and the boxy-subject sweep). */
const RUNG_TARGET = 25_000;
/** Bake resolution (the #703 ladder's 512 cell, byte-identical to the graded #702 rung). */
const BAKE_RES = 512;
const FORCE_ERROR = 1.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HashedArtifact = { role: string; path: string; sha256: string; bytes?: number };

type StageReceipt = {
  schemaVersion: "openclinxr.trellis-fleet-stage-receipt.v1";
  subjectId: string;
  stage: string;
  generatedAt: string;
  predecessorReceipt: { stage: string; path: string; sha256: string } | null;
  status: "ok" | "failed";
  failure: string | null;
  measurements: Record<string, string | number | boolean | null>;
  artifacts: HashedArtifact[];
};

type Receipts = Record<string, StageReceipt>;

type SubjectRun = {
  subjectId: string;
  receipts: Receipts;
  chainComplete: boolean;
  failedStage: string | null;
  failure: string | null;
  shipped: { kind: string; path: string | null; bytes: number | null; tris: number | null };
};

type Census = {
  schemaVersion?: string;
  sources?: Array<{
    path?: string; sha256?: string; reportedSubjectId?: string;
    canonicalSubjectId?: string; viewCount?: number; wallClockS?: number;
  }>;
  subjects?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function writeJson(p: string, data: unknown): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function rel(p: string): string {
  return path.relative(REPO_ROOT, p).replaceAll("\\", "/");
}

function mainTree(relPath: string): string {
  return path.join(MAIN_TREE, relPath);
}

/** Resolve a receipt artifact path to an absolute file: worktree first, then main tree
 *  (gitignored TRELLIS evidence lives in the main checkout, not in this worktree). */
function artifactAbs(a: HashedArtifact): string {
  const inTree = path.join(REPO_ROOT, a.path);
  if (existsSync(inTree)) return inTree;
  return mainTree(a.path);
}

function census(): Census {
  return readJson(CENSUS_PATH) ?? {};
}

function blenderBinary(): string {
  if (process.env.OPENCLINXR_BLENDER && existsSync(process.env.OPENCLINXR_BLENDER)) {
    return process.env.OPENCLINXR_BLENDER!;
  }
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
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

async function hasUv(glbPath: string): Promise<boolean> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute("TEXCOORD_0")) return true;
    }
  }
  return false;
}

function runBlender(args: string[], timeoutMs: number): { code: number; stdout: string } {
  try {
    const stdout = execFileSync(blenderBinary(), args, {
      encoding: "utf8",
      cwd: REPO_ROOT,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    } as never);
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}

// ---------------------------------------------------------------------------
// Source resolution (frozen census -> main tree)
// ---------------------------------------------------------------------------

function censusSourceFor(subjectId: string): NonNullable<Census["sources"]>[number] {
  const src = (census().sources ?? []).find((s) => s.canonicalSubjectId === subjectId);
  if (!src) throw new Error(`subject ${subjectId} not in frozen census`);
  return src;
}

function subjectDir(subjectId: string): string {
  return path.join(FLEET_ROOT, subjectId);
}

function receiptPath(subjectId: string, stage: string): string {
  return path.join(subjectDir(subjectId), "receipts", `${stage}.json`);
}

function existingReceipt(subjectId: string, stage: string): StageReceipt | null {
  return readJson<StageReceipt>(receiptPath(subjectId, stage));
}

function writeReceipt(subjectId: string, stage: string, predecessor: StageReceipt | null,
                      status: "ok" | "failed", failure: string | null,
                      measurements: StageReceipt["measurements"],
                      artifacts: HashedArtifact[]): StageReceipt {
  const receipt: StageReceipt = {
    schemaVersion: "openclinxr.trellis-fleet-stage-receipt.v1",
    subjectId,
    stage,
    generatedAt: new Date().toISOString(),
    predecessorReceipt: predecessor
      ? { stage: predecessor.stage, path: rel(receiptPath(subjectId, predecessor.stage)), sha256: sha256File(receiptPath(subjectId, predecessor.stage)) }
      : null,
    status,
    failure,
    measurements,
    artifacts,
  };
  writeJson(receiptPath(subjectId, stage), receipt);
  return receipt;
}

/** Find the first artifact of a role anywhere in the receipt chain. */
function artifactFrom(receipts: Receipts, role: string): HashedArtifact | undefined {
  for (const stage of Object.values(receipts)) {
    const a = stage.artifacts.find((x) => x.role === role);
    if (a) return a;
  }
  return undefined;
}

function lastReceipt(receipts: Receipts): StageReceipt | null {
  const order = ["pack", "generate", "decimate", "uv", "bake", "attach", "render"];
  let last: StageReceipt | null = null;
  for (const stage of order) {
    if (receipts[stage]) last = receipts[stage]!;
  }
  return last;
}

/** Resolve the conditioning pack image(s) for a subject (main tree, gitignored). */
function resolvePackImage(subjectId: string): HashedArtifact | null {
  const candidates = [
    `.openclinxr/evidence/trellis-packs/${subjectId}-escape/three_quarter_upper_alpha.png`,
    `.openclinxr/evidence/trellis-escape-hatch/${subjectId}/pack/three_quarter_upper_alpha.png`,
    `.openclinxr/evidence/trellis-escape-hatch/${subjectId}/pack/three_quarter_upper.png`,
  ];
  for (const c of candidates) {
    const abs = mainTree(c);
    if (existsSync(abs)) {
      return { role: "conditioning_image", path: c, sha256: sha256File(abs), bytes: statSync(abs).size };
    }
  }
  return null;
}

/** Resolve the raw bake GLB next to a census source bake-measure.json (main tree). */
function resolveRawGlb(subjectId: string): { glbPath: string; sourceRel: string } | null {
  const source = censusSourceFor(subjectId);
  const sourceRel = source.path ?? "";
  const sourceDir = path.posix.dirname(sourceRel);
  if (!existsSync(mainTree(sourceRel))) return null;
  const glbCandidates = [
    path.posix.join(sourceDir, `${subjectId}-escape.glb`),
    path.posix.join(sourceDir, `${subjectId}-remesh.glb`),
  ];
  for (const c of glbCandidates) {
    if (existsSync(mainTree(c))) return { glbPath: mainTree(c), sourceRel: c };
  }
  const dirAbs = mainTree(sourceDir);
  const found = existsSync(dirAbs) ? readdirSync(dirAbs).filter((f) => f.endsWith(".glb")) : [];
  if (found.length > 0) {
    const c = path.posix.join(sourceDir, found[0]!);
    return { glbPath: mainTree(c), sourceRel: c };
  }
  return null;
}

/** Shipped asset (the comparison column): champion.glb, promoted runtime asset, or none. */
function resolveShipped(subjectId: string): SubjectRun["shipped"] {
  const championRel = `.openclinxr/evidence/trellis-escape-hatch/${subjectId}/optimize/champion.glb`;
  if (existsSync(mainTree(championRel))) {
    return {
      kind: "optimize_champion",
      path: championRel,
      bytes: statSync(mainTree(championRel)).size,
      tris: null,
    };
  }
  const runtime: Record<string, string> = {
    "wall-clock": "apps/ui-xr/public/xr-assets/medical-equipment/wall-clock-analog.glb",
    "bedside-monitor": "apps/ui-xr/public/xr-assets/medical-equipment/bedside-monitor-generated.glb",
    "iv-pole": "apps/ui-xr/public/xr-assets/medical-equipment/iv-pole-with-pump.glb",
  };
  const r = runtime[subjectId];
  if (r) {
    const abs = path.join(REPO_ROOT, r);
    return { kind: "promoted_runtime", path: r, bytes: existsSync(abs) ? statSync(abs).size : null, tris: null };
  }
  return { kind: "none", path: null, bytes: null, tris: null };
}

// ---------------------------------------------------------------------------
// Stage runners — each receives the whole accumulated chain (receipts)
// ---------------------------------------------------------------------------

async function stagePack(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "pack");
  if (existing) return existing;
  const img = resolvePackImage(subjectId);
  if (!img) {
    return writeReceipt(subjectId, "pack", null, "failed",
      "no conditioning image under main-tree trellis-packs/<id>-escape/ or hatch pack/",
      { viewCount: 0 }, []);
  }
  return writeReceipt(subjectId, "pack", null, "ok", null,
    { viewCount: 1, imageBytes: img.bytes ?? null }, [img]);
}

async function stageGenerate(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "generate");
  if (existing) return existing;
  const predecessor = receipts.pack ?? null;
  const source = censusSourceFor(subjectId);
  const sourceAbs = mainTree(source.path ?? "");
  if (!existsSync(sourceAbs)) {
    return writeReceipt(subjectId, "generate", predecessor, "failed",
      `census source missing on main tree: ${source.path}`, {}, []);
  }
  const actualSha = sha256File(sourceAbs);
  if (actualSha !== source.sha256) {
    return writeReceipt(subjectId, "generate", predecessor, "failed",
      `census hash mismatch: recorded ${source.sha256}, on-disk ${actualSha}`,
      { sourceSha256: actualSha }, []);
  }
  const measure = readJson<Record<string, unknown>>(sourceAbs) ?? {};
  const raw = resolveRawGlb(subjectId);
  const measurements: StageReceipt["measurements"] = {
    censusSourceSha256Verified: true,
    viewCount: (measure.viewCount as number) ?? null,
    wallClockS: (measure.wallClockS as number) ?? null,
    bakeVerdict: (measure.verdict as string) ?? null,
    rawTriangleCount: (measure.rawTriangleCount as number) ?? null,
    rawExportBytes: (measure.exportBytes as number) ?? null,
  };
  const artifacts: HashedArtifact[] = [
    { role: "census_source_bake_measure", path: source.path ?? "", sha256: actualSha },
  ];
  if (raw) {
    artifacts.push({
      role: "raw_glb", path: raw.sourceRel, sha256: sha256File(raw.glbPath), bytes: statSync(raw.glbPath).size,
    });
    measurements.rawGlbBytes = statSync(raw.glbPath).size;
  }
  return writeReceipt(subjectId, "generate", predecessor, raw ? "ok" : "failed",
    raw ? null : "raw GLB not found next to the census source bake-measure.json",
    measurements, artifacts);
}

async function stageDecimate(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "decimate");
  if (existing) return existing;
  const predecessor = receipts.generate ?? null;
  const rawArtifact = artifactFrom(receipts, "raw_glb");
  if (!rawArtifact) {
    return writeReceipt(subjectId, "decimate", predecessor, "failed",
      "no raw GLB from generate stage", {}, []);
  }
  await MeshoptSimplifier.ready;
  const rawAbs = mainTree(rawArtifact.path);
  const rawTris = await countTris(rawAbs);
  const target = Math.min(RUNG_TARGET, Math.max(1, Math.floor(rawTris * 0.5)));
  const outAbs = path.join(subjectDir(subjectId), "rungs", `${subjectId}-${target}.glb`);
  mkdirSync(path.dirname(outAbs), { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(rawAbs);
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, Math.max(0.001, target / rawTris)),
      error: FORCE_ERROR,
      lockBorder: false,
    }),
  );
  await io.write(outAbs, doc);
  const rungTris = await countTris(outAbs);
  return writeReceipt(subjectId, "decimate", predecessor, "ok", null,
    {
      rawTriangleCount: rawTris,
      rungTriangleCount: rungTris,
      targetTriangleCount: target,
      decimationRatio: Number((rungTris / rawTris).toFixed(5)),
      rungBytes: statSync(outAbs).size,
    },
    [{ role: "rung_glb", path: rel(outAbs), sha256: sha256File(outAbs), bytes: statSync(outAbs).size }]);
}

async function stageUv(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "uv");
  if (existing) return existing;
  const predecessor = receipts.decimate ?? null;
  const rung = artifactFrom(receipts, "rung_glb");
  if (!rung) {
    return writeReceipt(subjectId, "uv", predecessor, "failed",
      "no rung GLB from decimate stage", {}, []);
  }
  const rungAbs = path.join(REPO_ROOT, rung.path);
  const hasUvs = await hasUv(rungAbs);
  if (hasUvs) {
    return writeReceipt(subjectId, "uv", predecessor, "ok", null,
      { rungHasUvAttribute: true, uvSource: "carried_from_raw" }, []);
  }
  const outAbs = path.join(subjectDir(subjectId), "rungs", `${subjectId}-uvd.glb`);
  runBlender(
    ["--background", "--python", UV_SCRIPT, "--", rungAbs, outAbs],
    10 * 60_000,
  );
  const report = readJson<{ status?: string; error?: string }>(
    outAbs.replace(/\.glb$/, ".uv-report.json"),
  );
  if (report?.status !== "unwrapped" || !existsSync(outAbs)) {
    return writeReceipt(subjectId, "uv", predecessor, "failed",
      `smart-UV project failed: ${report?.error ?? "(no uv-report)"}`, {}, []);
  }
  return writeReceipt(subjectId, "uv", predecessor, "ok", null,
    { rungHasUvAttribute: true, uvSource: "blender_smart_project" },
    [{ role: "rung_glb_uvd", path: rel(outAbs), sha256: sha256File(outAbs), bytes: statSync(outAbs).size }]);
}

async function stageBake(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "bake");
  if (existing) return existing;
  const predecessor = receipts.uv ?? receipts.decimate ?? null;
  const rung = artifactFrom(receipts, "rung_glb_uvd") ?? artifactFrom(receipts, "rung_glb");
  const raw = artifactFrom(receipts, "raw_glb");
  if (!rung || !raw) {
    return writeReceipt(subjectId, "bake", predecessor, "failed",
      "no low rung or raw GLB for the high-to-low bake", {}, []);
  }
  const bakeDir = path.join(subjectDir(subjectId), "bake");
  mkdirSync(bakeDir, { recursive: true });
  const t0 = Date.now();
  const result = runBlender(
    ["--background", "--python", BAKE_SCRIPT, "--", artifactAbs(raw), artifactAbs(rung), bakeDir],
    30 * 60_000,
  );
  const wallClockS = Number(((Date.now() - t0) / 1000).toFixed(1));
  const report = readJson<{ status?: string; error?: string; resolution?: number; normalMapPath?: string }>(
    path.join(bakeDir, "bake-report.json"),
  );
  if (report?.status !== "baked" || !report.normalMapPath || !existsSync(report.normalMapPath)) {
    return writeReceipt(subjectId, "bake", predecessor, "failed",
      `hl_bake status=${report?.status ?? "no report"} error=${report?.error ?? "(none)"} blenderExit=${result.code}`,
      { bakeResolution: BAKE_RES, bakeWallClockS: wallClockS }, []);
  }
  const mapAbs = report.normalMapPath;
  return writeReceipt(subjectId, "bake", predecessor, "ok", null,
    { bakeResolution: BAKE_RES, bakeWallClockS: wallClockS, normalMapBytes: statSync(mapAbs).size },
    [{ role: "normal_map", path: rel(mapAbs), sha256: sha256File(mapAbs), bytes: statSync(mapAbs).size }]);
}

async function stageAttach(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "attach");
  if (existing) return existing;
  const predecessor = receipts.bake ?? null;
  const map = artifactFrom(receipts, "normal_map");
  const rung = artifactFrom(receipts, "rung_glb_uvd") ?? artifactFrom(receipts, "rung_glb");
  if (!map || !rung) {
    return writeReceipt(subjectId, "attach", predecessor, "failed",
      "no normal map or low rung from bake stage", {}, []);
  }
  const outAbs = path.join(subjectDir(subjectId), "rungs", path.basename(rung.path).replace(/\.glb$/, "-mapped.glb"));
  const result = runBlender(
    ["--background", "--python", EXPORT_MAPPED_SCRIPT, "--", artifactAbs(rung), artifactAbs(map), outAbs],
    10 * 60_000,
  );
  const match = /EXPORT_DONE attached=(\d+)/.exec(result.stdout);
  if (!existsSync(outAbs) || statSync(outAbs).size < 1_000) {
    return writeReceipt(subjectId, "attach", predecessor, "failed",
      `mapped export missing (blenderExit=${result.code}): ${result.stdout.slice(-400)}`, {}, []);
  }
  return writeReceipt(subjectId, "attach", predecessor, "ok", null,
    { mappedRungBytes: statSync(outAbs).size, mapAttachedMaterialCount: match ? Number(match[1]) : null },
    [{ role: "mapped_glb", path: rel(outAbs), sha256: sha256File(outAbs), bytes: statSync(outAbs).size }]);
}

async function stageRender(subjectId: string, receipts: Receipts, force: boolean): Promise<StageReceipt> {
  const existing = force ? null : existingReceipt(subjectId, "render");
  if (existing) return existing;
  const predecessor = receipts.attach ?? null;
  const mapped = artifactFrom(receipts, "mapped_glb");
  const rung = artifactFrom(receipts, "rung_glb_uvd") ?? artifactFrom(receipts, "rung_glb");
  const map = artifactFrom(receipts, "normal_map");
  if (!rung) {
    return writeReceipt(subjectId, "render", predecessor, "failed",
      "no rung GLB from attach stage", {}, []);
  }
  const rendersDir = path.join(subjectDir(subjectId), "renders");
  mkdirSync(rendersDir, { recursive: true });
  const artifacts: HashedArtifact[] = [];
  const measurements: StageReceipt["measurements"] = {};

  const unmappedOut = path.join(rendersDir, `${subjectId}-unmapped.png`);
  const r1 = runBlender(
    ["--background", "--python", RENDER_SCRIPT, "--", artifactAbs(rung), "NONE", unmappedOut],
    10 * 60_000,
  );
  if (existsSync(unmappedOut) && statSync(unmappedOut).size >= 1_000) {
    artifacts.push({ role: "render_unmapped", path: rel(unmappedOut), sha256: sha256File(unmappedOut), bytes: statSync(unmappedOut).size });
    measurements.unmappedRenderBytes = statSync(unmappedOut).size;
  } else {
    measurements.unmappedRenderBytes = 0;
    measurements.unmappedRenderFailure = r1.stdout.slice(-200);
  }

  if (mapped) {
    const mappedOut = path.join(rendersDir, `${subjectId}-mapped.png`);
    const r2 = runBlender(
      ["--background", "--python", RENDER_SCRIPT, "--", artifactAbs(mapped), map ? artifactAbs(map) : "NONE", mappedOut],
      10 * 60_000,
    );
    if (existsSync(mappedOut) && statSync(mappedOut).size >= 1_000) {
      artifacts.push({ role: "render_mapped", path: rel(mappedOut), sha256: sha256File(mappedOut), bytes: statSync(mappedOut).size });
      measurements.mappedRenderBytes = statSync(mappedOut).size;
    } else {
      measurements.mappedRenderBytes = 0;
      measurements.mappedRenderFailure = r2.stdout.slice(-200);
    }
  } else {
    measurements.mappedRenderBytes = 0;
    measurements.mappedRenderFailure = "no mapped GLB (attach stage failed)";
  }
  return writeReceipt(subjectId, "render", predecessor, "ok", null, measurements, artifacts);
}

// ---------------------------------------------------------------------------
// Grade + disposition
// ---------------------------------------------------------------------------

function reviewReceiptPath(subjectId: string): string {
  return path.join(TRACKED_REVIEWS_DIR, `${subjectId}.json`);
}

/** Grade stage: write the review receipt (producer/reviewer split, rubric hash). The visual
 *  verdict stays pending the orchestrator. Runs even after a failed chain so every subject
 *  carries a review. */
function stageGrade(subjectId: string, receipts: Receipts, producerSessionId: string, force: boolean): StageReceipt {
  const existing = existingReceipt(subjectId, "grade");
  if (!force && existing && existing.measurements.reviewReceiptSha256 && existsSync(reviewReceiptPath(subjectId))) {
    return existing;
  }
  const predecessor = lastReceipt(receipts);
  const rubricSha256 = sha256File(RUBRIC_PATH);
  const renders = Object.values(receipts)
    .flatMap((r) => r.artifacts)
    .filter((a) => a.role.startsWith("render_"));
  const receipt = {
    schemaVersion: "openclinxr.trellis-fleet-review-receipt.v1",
    subjectId,
    stage: "grade",
    artifactProducerSessionId: producerSessionId,
    reviewerSessionId: null,
    rubricSha256,
    renderImageSha256: Object.fromEntries(renders.map((r) => [r.role, r.sha256])),
    parsedVerdict: {
      status: "pending_orchestrator_grade",
      note: "The worker PRODUCES the renders and measurements; the orchestrator GRADES the pixels. Fill rawVisibleResponse, parsedVerdict and reviewerSessionId (must differ from artifactProducerSessionId) after grading the mapped/unmapped renders.",
    },
    claimScope: ["renders and measurements produced by the worker; the visual verdict is the orchestrator's pixel grade"],
    notEvidenceFor: ["that any subject improved", "that the derived rung is adoptable", "artifact elimination"],
  };
  writeJson(reviewReceiptPath(subjectId), receipt);
  const reviewSha = sha256File(reviewReceiptPath(subjectId));
  return writeReceipt(subjectId, "grade", predecessor, "ok", null,
    { reviewReceiptSha256: reviewSha, rubricSha256, reviewerAssigned: false },
    [{ role: "review_receipt", path: rel(reviewReceiptPath(subjectId)), sha256: reviewSha }]);
}

function dispositionOf(run: SubjectRun): { disposition: "adopt" | "reject_measured"; reason: string } {
  const measurements: Record<string, string | number | boolean | null> = {};
  for (const stage of ["pack", "generate", "decimate", "uv", "bake", "attach", "render"]) {
    const r = run.receipts[stage];
    if (r) Object.assign(measurements, r.measurements);
  }
  const m = (k: string): string => {
    const v = measurements[k];
    return v == null ? "?" : String(v);
  };
  const shipped = run.shipped;
  const shippedDesc = `${shipped.kind}${shipped.bytes != null ? ` ${shipped.bytes} bytes` : " (none)"}`;

  if (run.failedStage) {
    return {
      disposition: "reject_measured",
      reason: `derive chain failed at ${run.failedStage}: ${run.failure ?? "(no reason)"} — raw ${m("rawTriangleCount")} tris/${m("rawGlbBytes")} bytes; no adoptable re-creation was produced; shipped ${shippedDesc} stays`,
    };
  }
  if (measurements.rawTriangleCount == null || measurements.rungTriangleCount == null
      || measurements.mappedRungBytes == null || measurements.mappedRenderBytes == null) {
    return {
      disposition: "reject_measured",
      reason: `derive chain incomplete on measurements (raw=${m("rawTriangleCount")} rung=${m("rungTriangleCount")} mapped=${m("mappedRungBytes")} mappedRender=${m("mappedRenderBytes")}) — nothing adoptable was measured; shipped ${shippedDesc} stays`,
    };
  }
  return {
    disposition: "reject_measured",
    reason: `derive chain complete and measured (raw ${m("rawTriangleCount")} tris/${m("rawGlbBytes")} bytes -> rung ${m("rungTriangleCount")} tris/${m("rungBytes")} bytes -> mapped ${m("mappedRungBytes")} bytes at ${m("bakeResolution")}px map, mapped/unmapped renders produced ${m("mappedRenderBytes")}/${m("unmappedRenderBytes")} bytes); per fleet-v1.json adoption requires a graded silhouette and the orchestrator's pixel grade of the renders is pending — not adoptable on measurement alone; shipped ${shippedDesc} stays`,
  };
}

function artifactMeasurementsOf(run: SubjectRun): Array<{ name: string; value: string | number | boolean | null }> {
  const out: Array<{ name: string; value: string | number | boolean | null }> = [];
  const shipped = run.shipped;
  out.push({ name: "shippedAssetKind", value: shipped.kind });
  if (shipped.bytes != null) out.push({ name: "shippedAssetBytes", value: shipped.bytes });
  if (shipped.tris != null) out.push({ name: "shippedAssetTriangleCount", value: shipped.tris });
  for (const stage of ["pack", "generate", "decimate", "uv", "bake", "attach", "render"]) {
    const r = run.receipts[stage];
    if (!r) continue;
    for (const [k, v] of Object.entries(r.measurements)) {
      out.push({ name: `${stage}.${k}`, value: v });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

async function runSubject(subjectId: string, force: boolean, producerSessionId: string): Promise<SubjectRun> {
  const run: SubjectRun = {
    subjectId,
    receipts: {},
    chainComplete: false,
    failedStage: null,
    failure: null,
    shipped: resolveShipped(subjectId),
  };

  const stages: Array<{ name: string; fn: () => Promise<StageReceipt> }> = [
    { name: "pack", fn: () => stagePack(subjectId, run.receipts, force) },
    { name: "generate", fn: () => stageGenerate(subjectId, run.receipts, force) },
    { name: "decimate", fn: () => stageDecimate(subjectId, run.receipts, force) },
    { name: "uv", fn: () => stageUv(subjectId, run.receipts, force) },
    { name: "bake", fn: () => stageBake(subjectId, run.receipts, force) },
    { name: "attach", fn: () => stageAttach(subjectId, run.receipts, force) },
    { name: "render", fn: () => stageRender(subjectId, run.receipts, force) },
    { name: "grade", fn: () => Promise.resolve(stageGrade(subjectId, run.receipts, producerSessionId, force)) },
  ];

  for (const s of stages) {
    if (run.failedStage && s.name !== "grade") continue; // grade always runs after a failure
    const receipt = await s.fn();
    run.receipts[s.name] = receipt;
    if (receipt.status === "failed") {
      run.failedStage = s.name;
      run.failure = receipt.failure;
    }
  }
  run.chainComplete = run.failedStage === null;
  return run;
}

function buildReport(runs: SubjectRun[], producerSessionId: string): Record<string, unknown> {
  const subjects = runs.map((run) => {
    const d = dispositionOf(run);
    const review = artifactFrom(run.receipts, "review_receipt");
    return {
      subjectId: run.subjectId,
      disposition: d.disposition,
      reason: d.reason,
      artifactMeasurements: artifactMeasurementsOf(run),
      reviews: review
        ? [{ stage: "grade", receipt: { path: review.path, sha256: review.sha256 } }]
        : [],
    };
  });
  return {
    schemaVersion: "openclinxr.trellis-fleet-report.v1",
    issue: "698",
    generatedAt: new Date().toISOString(),
    censusSha256: sha256File(CENSUS_PATH),
    censusPath: rel(CENSUS_PATH),
    rubric: { path: rel(RUBRIC_PATH), sha256: sha256File(RUBRIC_PATH) },
    subjectCount: subjects.length,
    subjects,
    producerSessionId,
    reviewStatus: "pending_orchestrator_grade",
    claimScope: [
      "every frozen census member reached a terminal measured disposition (adopt | reject_measured)",
      "measurements come from the derive chain receipts written by this runner",
      "the visual grade is the orchestrator's pixel grade of the renders and may overturn dispositions",
    ],
    notEvidenceFor: [
      "that any subject improved",
      "that multiview won",
      "that artifacts were eliminated",
      "Quest readiness or clinical accuracy",
    ],
  };
}

function stampCensus(report: Record<string, unknown>): void {
  const c = readJson<Record<string, unknown>>(CENSUS_PATH) ?? {};
  const subjects = (report.subjects as Array<{ subjectId?: string; disposition?: string }>) ?? [];
  c.fleetRun = {
    schemaVersion: "openclinxr.trellis-fleet-run.v1",
    runAt: new Date().toISOString(),
    status: "complete",
    reportPath: rel(TRACKED_REPORT),
    adoptCount: subjects.filter((s) => s.disposition === "adopt").length,
    rejectMeasuredCount: subjects.filter((s) => s.disposition === "reject_measured").length,
    dispositions: Object.fromEntries(subjects.map((s) => [s.subjectId, s.disposition])),
    note: "stamped by the fleet runner (#698); sources and subjects are UNCHANGED from the frozen census — this section is additive",
  };
  writeJson(CENSUS_PATH, c);
}

function dryRun(): string {
  const c = census();
  const subjects = (c.subjects ?? []).sort();
  const plan = {
    mode: "dry-run",
    issue: "698",
    censusSha256: sha256File(CENSUS_PATH),
    censusSources: (c.sources ?? []).length,
    censusSubjects: subjects.length,
    rubric: { path: rel(RUBRIC_PATH), sha256: sha256File(RUBRIC_PATH) },
    rungTarget: RUNG_TARGET,
    bakeRes: BAKE_RES,
    mainTree: MAIN_TREE,
    subjects: subjects.map((s) => {
      const source = censusSourceFor(s);
      const raw = resolveRawGlb(s);
      const pack = resolvePackImage(s);
      const shipped = resolveShipped(s);
      return {
        subjectId: s,
        censusSourcePath: source.path ?? null,
        rawGlbResolved: Boolean(raw),
        packImageResolved: Boolean(pack),
        packViewCount: pack ? 1 : 0,
        shippedKind: shipped.kind,
        shippedBytes: shipped.bytes,
      };
    }),
    reportPath: rel(TRACKED_REPORT),
    stages: ["pack", "generate", "decimate", "uv", "bake", "attach", "render", "grade"],
    processIsolation: "blender_fresh_subprocess_per_stage",
  };
  return JSON.stringify(plan, null, 2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRunOnly = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const reportOnly = argv.includes("--report-only");
  const subjectOnly = argv.includes("--subject") ? argv[argv.indexOf("--subject") + 1] : null;

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "factory:trellis:fleet — #698 fleet re-creation over the frozen census\n\n"
        + "USAGE\n"
        + "  pnpm factory:trellis:fleet --dry-run       JSON plan, no Blender/GPU/meshopt\n"
        + "  pnpm factory:trellis:fleet                 full run over the frozen census\n"
        + "  pnpm factory:trellis:fleet --force         re-run stages whose receipts exist\n"
        + "  pnpm factory:trellis:fleet --subject <id>  run a single subject\n"
        + "  pnpm factory:trellis:fleet --report-only   rebuild report + census stamp from receipts\n",
    );
    return;
  }

  if (dryRunOnly) {
    process.stdout.write(dryRun());
    process.stdout.write("\n");
    return;
  }

  const producerSessionId = process.env.GROK_SESSION_ID ?? `worker_dispatch_issue_698_${Date.now()}`;
  const subjects = subjectOnly ? [subjectOnly] : [...(census().subjects ?? [])].sort();

  if (subjects.length === 0) {
    process.stderr.write("[fleet] no subjects in frozen census\n");
    process.exit(2);
  }

  const runs: SubjectRun[] = [];
  for (const s of subjects) {
    const run = reportOnly
      ? rebuildRunFromReceipts(s, producerSessionId)
      : await runSubject(s, force, producerSessionId);
    runs.push(run);
    process.stdout.write(
      `[fleet] ${s}: chain ${run.chainComplete ? "complete" : `failed at ${run.failedStage}`} — ${dispositionOf(run).disposition}\n`,
    );
  }

  let report = buildReport(runs, producerSessionId);
  // Stamp the census BEFORE recording censusSha256 so the report names the stamped manifest.
  stampCensus(report);
  report = buildReport(runs, producerSessionId);

  writeJson(REPORT_PATH, report);
  // Landable mirror (byte-identical): gitignored .openclinxr is a proof-target trap (#712/#697).
  writeJson(TRACKED_REPORT, report);

  process.stdout.write(`[fleet] report -> ${REPORT_PATH}\n`);
  process.stdout.write(`[fleet] tracked mirror -> ${rel(TRACKED_REPORT)}\n`);
  const subs = report.subjects as Array<{ disposition?: string }>;
  process.stdout.write(
    `[fleet] done — ${runs.length} subjects, `
      + `${subs.filter((x) => x.disposition === "reject_measured").length} reject_measured, `
      + `${subs.filter((x) => x.disposition === "adopt").length} adopt\n`,
  );
}

function rebuildRunFromReceipts(subjectId: string, producerSessionId: string): SubjectRun {
  const run: SubjectRun = {
    subjectId,
    receipts: {},
    chainComplete: true,
    failedStage: null,
    failure: null,
    shipped: resolveShipped(subjectId),
  };
  for (const stage of ["pack", "generate", "decimate", "uv", "bake", "attach", "render", "grade"]) {
    const r = existingReceipt(subjectId, stage);
    if (r) {
      run.receipts[stage] = r;
      if (r.status === "failed" && run.failedStage === null) {
        run.failedStage = stage;
        run.failure = r.failure;
        run.chainComplete = false;
      }
    }
  }
  if (run.receipts.grade && !existsSync(reviewReceiptPath(subjectId))) {
    run.receipts.grade = stageGrade(subjectId, run.receipts, producerSessionId, false);
  }
  return run;
}

const isMain = process.argv[1]
  && (import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))
    || path.basename(process.argv[1]).startsWith("trellis-fleet-recreation-run"));
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[fleet] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
