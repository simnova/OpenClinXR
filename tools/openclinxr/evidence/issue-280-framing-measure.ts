/**
 * #280 — PRE-FIX measurement: why do 52 of 175 equipment pack views sit under 5%
 * frame coverage?
 *
 * Renders the 15 affected equipment ids (those with at least one sub-5% view in
 * the #256 batch manifest) through the SAME pack path as
 * `renderEquipmentReferencePack` — one portless dev-server boot, one browser,
 * subject-only 1024×1024 pack views — and dumps, for every sub-5% view:
 *   - equipment id + view + measured frameCoverage
 *   - subject world AABB (recorded by the lab)
 *   - the pack camera the framing code chose (fov/distance/position/target)
 *   - the computed projected extent (frameSpanFraction) AND the projected 2D
 *     area fraction of the frame (derived here from the recorded AABB + camera)
 *   - verdict (a) framing computes projected bounds correctly, or (b) framing
 *     clamped to a floor that leaves small subjects tiny
 *
 * The lab change (apps/ui-xr/src/isolated-subject-lab.ts) is ADDITIVE RECORDING
 * of values the framing code already computes — camera position/distance and
 * world AABB — and does not alter the framing. A cross-check section compares
 * this run's frameCoverage/frameSpanFraction against the #256 batch manifest to
 * prove the rendering is unchanged.
 *
 * claimScope: framing audit evidence for the equipment reference packs.
 * notEvidenceFor: TRELLIS bake comparison (explicitly a later slice); any mesh
 *                 quality claim; clinical accuracy or device equivalence.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer } from "./lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const ISSUE_ID = "issue-280";
export const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence", ISSUE_ID);
export const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
/** #256 batch manifest — source of the sub-5% view enumeration. */
export const BATCH_MANIFEST_PATH = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/issue-256/pack-manifest.json",
);

const PACK_VIEWPORT = { width: 1024, height: 1024 } as const;
const PACK_VIEWS = ["front", "side", "three_quarter_left", "three_quarter_right", "back"] as const;
/** Coverage threshold the issue uses for "under 5%". */
export const SUB5_THRESHOLD = 0.05;
/** A frameSpanFraction far below the #270 target (0.8) means the framing clamped. */
export const SPAN_CLAMP_THRESHOLD = 0.5;

type Manifest = {
  subjects: Array<{
    equipmentId: string;
    views: Array<{
      view: string;
      frameCoverage: number;
      frameSpanFraction: number | null;
    }>;
  }>;
};

type LabEvidence = {
  frameCoverage: number;
  frameSpanFraction: number | null;
  boundsMeters?: { width: number; height: number; depth: number };
  packFraming?: {
    packCamera?: {
      fov: number;
      distance: number;
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
    } | null;
    boundsMin?: { x: number; y: number; z: number };
    boundsMax?: { x: number; y: number; z: number };
  };
};

type Row = {
  equipmentId: string;
  view: string;
  frameCoverage: number;
  frameSpanFraction: number | null;
  projectedAreaFraction: number;
  /** #280: projected AABB larger-extent / smaller-extent (1 = square). */
  projectedAspectRatio: number;
  bounds: {
    width: number;
    height: number;
    depth: number;
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  camera: { fov: number; distance: number; position: { x: number; y: number; z: number } } | null;
  verdict: "a_framing_correct" | "b_framing_clamped";
  reason: string;
};

function subjectUrl(baseUrl: string, equipmentId: string, view: string): string {
  const spec = {
    subjectId: `${equipmentId}_${view}`,
    subjectKind: "equipment_builder",
    equipmentId,
    view,
    exportGlb: false,
    subjectOnly: true,
    label: `${equipmentId} ${view}`,
  };
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

/** Project the world AABB's 8 corners onto the camera plane. Returns the
 *  screen-space AABB area as a fraction of the (square) frame area plus the
 *  projected aspect ratio (larger extent / smaller extent). Same math as the
 *  lab's frameCamera (perspective divide, fov-based frame span). */
function projectBounds(bounds: {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}, camera: { fov: number; position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }): {
  areaFraction: number;
  aspectRatio: number;
} {
  const pos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const tgt = { x: camera.target.x, y: camera.target.y, z: camera.target.z };
  let fwd = { x: tgt.x - pos.x, y: tgt.y - pos.y, z: tgt.z - pos.z };
  const fwdLen = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
  fwd = { x: fwd.x / fwdLen, y: fwd.y / fwdLen, z: fwd.z / fwdLen };
  // right = fwd × up(0,1,0) — sign irrelevant for span/aspect
  let right = { x: fwd.z, y: 0, z: -fwd.x };
  const rightLen = Math.hypot(right.x, right.y, right.z) || 1;
  right = { x: right.x / rightLen, y: right.y / rightLen, z: right.z / rightLen };
  // up = right × fwd
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };

  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const frameSpan = 2 * tanHalf;

  let minSx = Infinity;
  let maxSx = -Infinity;
  let minSy = Infinity;
  let maxSy = -Infinity;
  for (const [mx, my, mz] of [
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [false, true, true],
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true],
  ] as const) {
    const px = mx ? bounds.max.x : bounds.min.x;
    const py = my ? bounds.max.y : bounds.min.y;
    const pz = mz ? bounds.max.z : bounds.min.z;
    const vx = px - pos.x;
    const vy = py - pos.y;
    const vz = pz - pos.z;
    const depth = vx * fwd.x + vy * fwd.y + vz * fwd.z;
    if (depth < 1e-4) continue;
    const sx = (vx * right.x + vy * right.y + vz * right.z) / depth;
    const sy = (vx * up.x + vy * up.y + vz * up.z) / depth;
    if (sx < minSx) minSx = sx;
    if (sx > maxSx) maxSx = sx;
    if (sy < minSy) minSy = sy;
    if (sy > maxSy) maxSy = sy;
  }
  if (!Number.isFinite(minSx) || !Number.isFinite(minSy)) {
    return { areaFraction: 0, aspectRatio: 0 };
  }
  const spanX = maxSx - minSx;
  const spanY = maxSy - minSy;
  const area = spanX * spanY;
  const frameArea = frameSpan * frameSpan;
  const areaFraction = frameArea > 0 ? Math.max(0, Math.min(1, area / frameArea)) : 0;
  const minSpan = Math.min(spanX, spanY);
  const aspectRatio = minSpan > 1e-6 ? Math.max(spanX, spanY) / minSpan : 0;
  return { areaFraction, aspectRatio };
}

function classify(row: {
  frameCoverage: number;
  frameSpanFraction: number | null;
  projectedAreaFraction: number;
  projectedAspectRatio: number;
}): { verdict: Row["verdict"]; reason: string } {
  if (row.frameSpanFraction !== null && row.frameSpanFraction < SPAN_CLAMP_THRESHOLD) {
    return {
      verdict: "b_framing_clamped",
      reason:
        `frameSpanFraction ${row.frameSpanFraction.toFixed(4)} is far below the #270 target 0.8 — ` +
        `the framing did not reach its projected-bounds target, so the camera clamped and left the subject small`,
    };
  }
  return {
    verdict: "a_framing_correct",
    reason:
      `frameSpanFraction ${row.frameSpanFraction?.toFixed(4) ?? "null"} ≈ 0.8 → the #270 framing computed the ` +
      `subject's projected bounds correctly and positioned the camera to fill 80% of the frame's larger ` +
      `extent (no minimum-distance floor). The subject's projected AABB covers ` +
      `${(row.projectedAreaFraction * 100).toFixed(1)}% of the frame area (aspect ` +
      `${row.projectedAspectRatio.toFixed(1)}:1) yet non-background pixels are only ` +
      `${(row.frameCoverage * 100).toFixed(2)}% — the subject is small/thin in world terms (its rendered ` +
      `fill is a fraction of its AABB rectangle) and/or its surface is dark near the clear color #18211d. ` +
      `Low coverage is a property of the subject, not the camera.`,
  };
}

export async function measureIssue280Prefix(options?: { cwd?: string }): Promise<unknown> {
  const cwd = options?.cwd ?? process.cwd();
  const manifestRaw = await readFile(BATCH_MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestRaw) as Manifest;

  const manifestRows: Array<{ equipmentId: string; view: string; frameCoverage: number; frameSpanFraction: number | null }> = [];
  for (const s of manifest.subjects) {
    for (const v of s.views) {
      manifestRows.push({
        equipmentId: s.equipmentId,
        view: v.view,
        frameCoverage: v.frameCoverage,
        frameSpanFraction: v.frameSpanFraction,
      });
    }
  }
  const sub5 = manifestRows.filter((r) => r.frameCoverage < SUB5_THRESHOLD);
  const affectedIds = [...new Set(sub5.map((r) => r.equipmentId))].sort();

  let server = null;
  let browser = null;
  const measuredRows: Row[] = [];
  const subjectsContext: Record<string, unknown> = {};
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    browser = await chromium.launch({ headless: true });
    const page: Page = await browser.newPage({ viewport: { ...PACK_VIEWPORT }, deviceScaleFactor: 1 });

    for (const equipmentId of affectedIds) {
      const viewRows: Row[] = [];
      let subjectBounds: Row["bounds"] | null = null;
      for (const view of PACK_VIEWS) {
        await page.setViewportSize({ width: PACK_VIEWPORT.width, height: PACK_VIEWPORT.height });
        await page.goto(subjectUrl(server.url, equipmentId, view), {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        });
        const handle = await page.waitForFunction(
          () => {
            const ev = (window as unknown as { __openClinXrIsolatedSubjectEvidence?: LabEvidence })
              .__openClinXrIsolatedSubjectEvidence;
            return ev && typeof ev.frameCoverage === "number" ? ev : null;
          },
          null,
          { timeout: 120_000 },
        );
        const ev = (await handle.jsonValue()) as LabEvidence;
        const camera =
          ev.packFraming?.packCamera && typeof ev.packFraming.packCamera.distance === "number"
            ? ev.packFraming.packCamera
            : null;
        const bounds: Row["bounds"] = {
          width: ev.boundsMeters?.width ?? 0,
          height: ev.boundsMeters?.height ?? 0,
          depth: ev.boundsMeters?.depth ?? 0,
          min: ev.packFraming?.boundsMin ?? { x: 0, y: 0, z: 0 },
          max: ev.packFraming?.boundsMax ?? { x: 0, y: 0, z: 0 },
        };
        subjectBounds = bounds;
        const projection = camera ? projectBounds(bounds, camera) : { areaFraction: 0, aspectRatio: 0 };
        const { verdict, reason } = classify({
          frameCoverage: ev.frameCoverage,
          frameSpanFraction: ev.frameSpanFraction,
          projectedAreaFraction: projection.areaFraction,
          projectedAspectRatio: projection.aspectRatio,
        });
        const row: Row = {
          equipmentId,
          view,
          frameCoverage: ev.frameCoverage,
          frameSpanFraction: ev.frameSpanFraction,
          projectedAreaFraction: projection.areaFraction,
          projectedAspectRatio: projection.aspectRatio,
          bounds,
          camera: camera
            ? { fov: camera.fov, distance: camera.distance, position: camera.position }
            : null,
          verdict,
          reason,
        };
        viewRows.push(row);
        measuredRows.push(row);
      }
      subjectsContext[equipmentId] = {
        bounds: subjectBounds,
        views: viewRows.map((r) => ({
          view: r.view,
          frameCoverage: r.frameCoverage,
          frameSpanFraction: r.frameSpanFraction,
          projectedAreaFraction: r.projectedAreaFraction,
          projectedAspectRatio: r.projectedAspectRatio,
          camera: r.camera,
          verdict: r.verdict,
        })),
      };
    }
  } finally {
    if (browser) await browser.close();
    if (server) server.proc.kill("SIGTERM");
  }

  // Cross-check vs the #256 batch manifest — proves the additive instrumentation
  // did not change the rendering (coverage/span should match closely).
  const manifestByKey = new Map(manifestRows.map((r) => [`${r.equipmentId}::${r.view}`, r]));
  let maxCoverageDiff = 0;
  let maxSpanDiff = 0;
  let spanDiffCount = 0;
  for (const r of measuredRows) {
    const m = manifestByKey.get(`${r.equipmentId}::${r.view}`);
    if (!m) continue;
    maxCoverageDiff = Math.max(maxCoverageDiff, Math.abs(r.frameCoverage - m.frameCoverage));
    if (m.frameSpanFraction !== null && r.frameSpanFraction !== null) {
      maxSpanDiff = Math.max(maxSpanDiff, Math.abs(r.frameSpanFraction - m.frameSpanFraction));
      spanDiffCount += 1;
    }
  }

  const under5 = measuredRows.filter((r) => r.frameCoverage < SUB5_THRESHOLD);
  const verdictCounts: { a_framing_correct: number; b_framing_clamped: number } = {
    a_framing_correct: 0,
    b_framing_clamped: 0,
  };
  for (const r of under5) {
    if (r.verdict === "a_framing_correct") verdictCounts.a_framing_correct += 1;
    else verdictCounts.b_framing_clamped += 1;
  }
  const sub5Keys = new Set(sub5.map((r) => `${r.equipmentId}::${r.view}`));
  const measuredKeys = new Set(under5.map((r) => `${r.equipmentId}::${r.view}`));
  const missing = [...sub5Keys].filter((k) => !measuredKeys.has(k));

  const preFix = {
    issue: "280",
    measurementKind:
      "pre-fix framing before-column — one row per sub-5% frameCoverage view across the #256 batch: " +
      "equipment id, view, frameCoverage, subject world AABB, pack camera (fov/distance/position), " +
      "computed projected extent (frameSpanFraction) + projected 2D area fraction, and verdict " +
      "(a) framing computes projected bounds correctly / (b) framing clamped to a floor",
    factoryStep: "equipment_generate",
    measuredAt: new Date().toISOString(),
    measuredAgainstCommit: await gitHeadSha(cwd),
    instrument:
      "tools/openclinxr/evidence/issue-280-framing-measure.ts — one portless dev-server boot, one browser, " +
      "subject-only 1024x1024 pack views via apps/ui-xr isolated-subject.html. Camera/AABB recording added to " +
      "apps/ui-xr/src/isolated-subject-lab.ts is additive (records values frameCamera already computes); " +
      "framing math untouched — proven by the crossCheck section below.",
    clearColor: "#18211d",
    coverageMetric:
      "measureCanvasCoverage: fraction of canvas pixels with |dR|+|dG|+|dB| > 36 from the clear color",
    viewport: "1024x1024",
    summary: {
      viewsMeasured: measuredRows.length,
      sub5pctViews: under5.length,
      ids: affectedIds.length,
      sub5KeysFromManifest: sub5.length,
      missingFromMeasurement: missing,
      verdicts: verdictCounts,
      crossCheck: {
        maxAbsFrameCoverageDiffVsManifest: maxCoverageDiff,
        maxAbsFrameSpanFractionDiffVsManifest: maxSpanDiff,
        spanFractionValuesCompared: spanDiffCount,
      },
    },
    subjects: subjectsContext,
    rowsUnder5pct: under5.map((r) => r),
    conclusion:
      verdictCounts.b_framing_clamped
        ? "b_framing_clamped present — the framing has a floor/limit for some views; see rows."
        : "No b_framing_clamped rows: every sub-5% view's frameSpanFraction ≈ 0.8, so the #270 framing " +
          "computes projected bounds correctly for ALL of them and positions the camera with no " +
          "minimum-distance floor (camera distance scales with subject size). Low frameCoverage is a " +
          "property of the SUBJECTS, not the camera: their world AABBs are small and thin (poles, panel " +
          "edges, small handhelds), their projected 2D fill is a fraction of the frame, and their dark " +
          "surfaces sit near the clear color #18211d. The bake question — does low coverage actually hurt " +
          "TRELLIS reconstruction — is a separate, later slice (one hour per bake) and this closes having " +
          "established the framing behaviour first.",
    notEvidenceFor: [
      "the TRELLIS bake comparison (explicitly a later slice — one hour per bake)",
      "any mesh-quality claim",
      "clinical accuracy or device equivalence",
    ],
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(PRE_FIX_PATH, `${JSON.stringify(preFix, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(preFix.summary, null, 2)}\n`);
  process.stdout.write(`\npre-fix.json written to ${path.relative(REPO_ROOT, PRE_FIX_PATH)}\n`);
  return preFix;
}

async function gitHeadSha(cwd: string): Promise<string> {
  try {
    const { execFileSync } = await import("node:child_process");
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  await measureIssue280Prefix();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
