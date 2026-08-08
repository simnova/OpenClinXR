/**
 * #207 — exam_surface / overbed_surface / work_surface distinctness (in-process).
 *
 * Calls production `buildStationEnvironment` and reads world AABB + mesh stats for
 * the three clinical surface slot ids. No Vite boot — pure three.js Groups
 * (same pattern as generator-sweep-harness.ts).
 *
 * claimScope: fixture layout surface geometry identity in the parametric shell.
 * notEvidenceFor: clinical furniture realism, Quest readiness, equipment mount planner.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Box3,
  Vector3,
  type Object3D,
} from "../../../apps/ui-xr/node_modules/three/build/three.module.js";
import { ENVIRONMENT_SHELL_DESCRIPTORS } from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";
import { buildStationEnvironment } from "../../../apps/ui-xr/src/station-environment.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const ISSUE_207_EVIDENCE_DIR = ".openclinxr/evidence/issue-207";
export const PRE_FIX_NAME = "pre-fix.json";

/** Clinical surface slots under test — never a longer list. */
export const SURFACE_SLOT_IDS = ["exam_surface", "overbed_surface", "work_surface"] as const;
export type SurfaceSlotId = (typeof SURFACE_SLOT_IDS)[number];

export type SurfaceRow = {
  slotId: string;
  meshNames: string[];
  triangleCount: number;
  sizeMeters: { x: number; y: number; z: number };
  /** Distinctness key: size + triangle count + mesh leaf names (not slot id). */
  signature: string;
  /** Diagnostic — environment that supplied this row (first hit in bank order). */
  environmentId?: string;
  position?: { x: number; y: number; z: number };
  fixtureKind?: string;
};

export type FixtureSurfaceDistinctReport = {
  surfaces: SurfaceRow[];
  claimScope: string[];
  notEvidenceFor: string[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.fixture-surface-distinct.v1";
  kind: "fixture_surface_distinct";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: FixtureSurfaceDistinctReport;
  /** Ambient failure class for calibration — mechanism, not only counts. */
  ambientFailureClass?: string;
};

let cachedReport: FixtureSurfaceDistinctReport | null = null;

function absEvidence(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

function preFixPath(): string {
  return absEvidence(ISSUE_207_EVIDENCE_DIR, PRE_FIX_NAME);
}

function countMeshStats(root: Object3D): { meshNames: string[]; triangleCount: number } {
  const meshNames: string[] = [];
  let triangleCount = 0;
  root.traverse((obj) => {
    const mesh = obj as Object3D & {
      isMesh?: boolean;
      geometry?: {
        index?: { count: number } | null;
        getAttribute: (name: string) => { count: number } | undefined;
      };
    };
    if (!mesh.isMesh || !mesh.geometry) return;
    const leaf = String(mesh.name ?? "").split(".").pop() || mesh.name || "mesh";
    meshNames.push(leaf);
    const idx = mesh.geometry.index;
    const pos = mesh.geometry.getAttribute("position");
    if (idx && typeof idx.count === "number") {
      triangleCount += idx.count / 3;
    } else if (pos && typeof pos.count === "number") {
      triangleCount += pos.count / 3;
    }
  });
  return { meshNames, triangleCount };
}

function worldSize(root: Object3D): { x: number; y: number; z: number } {
  const box = new Box3().setFromObject(root);
  const size = new Vector3();
  box.getSize(size);
  return { x: size.x, y: size.y, z: size.z };
}

function surfaceSignature(row: Omit<SurfaceRow, "signature" | "environmentId" | "position" | "fixtureKind">): string {
  const sx = row.sizeMeters.x.toFixed(3);
  const sy = row.sizeMeters.y.toFixed(3);
  const sz = row.sizeMeters.z.toFixed(3);
  const names = [...row.meshNames].sort().join(",");
  return `size=${sx}x${sy}x${sz}|tris=${Math.round(row.triangleCount)}|meshes=${names}`;
}

/**
 * Find the first root Group for a fixture slot id under a built shell.
 * Roots carry fixtureSlotId and name `openclinxr.station-environment.fixture-slot.<id>`.
 */
function findFixtureRoot(shell: Object3D, slotId: string): Object3D | null {
  let found: Object3D | null = null;
  shell.traverse((obj) => {
    if (found) return;
    if (obj.userData?.fixtureSlotId === slotId && String(obj.name ?? "").includes("fixture-slot")) {
      found = obj;
    }
  });
  return found;
}

/** Environments that declare at least one of the three surface slots — dynamic, not hardcoded. */
export function listEnvironmentsWithSurfaceSlots(): Array<{
  environmentId: string;
  slotIds: string[];
}> {
  const out: Array<{ environmentId: string; slotIds: string[] }> = [];
  for (const [environmentId, descriptor] of Object.entries(ENVIRONMENT_SHELL_DESCRIPTORS)) {
    const slotIds = descriptor.fixtureSlots
      .map((s) => s.slotId)
      .filter((id) => (SURFACE_SLOT_IDS as readonly string[]).includes(id));
    if (slotIds.length > 0) {
      out.push({ environmentId, slotIds: [...new Set(slotIds)] });
    }
  }
  return out.sort((a, b) => a.environmentId.localeCompare(b.environmentId));
}

/**
 * Inspect the three clinical surfaces by building production shells.
 * One representative row per slot id (first environment in bank that declares it).
 */
export function measureFixtureSurfaceDistinct(): FixtureSurfaceDistinctReport {
  const wanted = new Set<string>(SURFACE_SLOT_IDS);
  const bySlot = new Map<string, SurfaceRow>();

  for (const { environmentId, slotIds } of listEnvironmentsWithSurfaceSlots()) {
    const need = slotIds.filter((id) => wanted.has(id) && !bySlot.has(id));
    if (need.length === 0) continue;

    const shell = buildStationEnvironment({ environmentId });
    for (const slotId of need) {
      const root = findFixtureRoot(shell, slotId);
      if (!root) continue;
      const { meshNames, triangleCount } = countMeshStats(root);
      const sizeMeters = worldSize(root);
      const base = {
        slotId,
        meshNames,
        triangleCount,
        sizeMeters,
      };
      bySlot.set(slotId, {
        ...base,
        signature: surfaceSignature(base),
        environmentId,
        position: { x: root.position.x, y: root.position.y, z: root.position.z },
        fixtureKind: String(root.userData?.openClinXrFixtureKind ?? ""),
      });
    }
    if (bySlot.size >= SURFACE_SLOT_IDS.length) break;
  }

  return {
    surfaces: SURFACE_SLOT_IDS.map((id) => bySlot.get(id)).filter(Boolean) as SurfaceRow[],
    claimScope: [
      "fixture_layout_surface_geometry_identity",
      "exam_overbed_work_surface_distinctness",
    ],
    notEvidenceFor: [
      "clinical_furniture_realism",
      "quest_readiness",
      "equipment_mount_planner_placement",
    ],
  };
}

function ambientFailureClassFromReport(report: FixtureSurfaceDistinctReport): string {
  const exam = report.surfaces.find((s) => s.slotId === "exam_surface");
  const work = report.surfaces.find((s) => s.slotId === "work_surface");
  if (!exam || !work) {
    return "missing_surface_rows";
  }
  const longest = Math.max(exam.sizeMeters.x, exam.sizeMeters.z);
  if (exam.signature === work.signature) {
    return `exam_surface_shares_work_surface_signature longestXZ=${longest.toFixed(3)}m (need exam-table ~1.85m, distinct builders)`;
  }
  if (longest < 1.5) {
    return `exam_surface_undersized longestXZ=${longest.toFixed(3)}m (EXAM_TABLE_LENGTH_M=1.85)`;
  }
  return "surfaces_distinct_and_exam_table_sized";
}

export async function inspectFixtureSurfaceDistinct(input?: {
  force?: boolean;
  writePreFix?: boolean;
  label?: string;
}): Promise<FixtureSurfaceDistinctReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;

  if (!input?.force && !input?.writePreFix) {
    if (process.env.OPENCLINXR_FIXTURE_SURFACE_USE_DISK === "1") {
      const fromDisk = await tryReadArtifact(preFixPath());
      if (fromDisk) {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }
  }

  const report = measureFixtureSurfaceDistinct();

  if (input?.writePreFix) {
    writeReportArtifact(report, {
      outputPath: preFixPath(),
      label: input.label ?? "pre-fix",
      ambientFailureClass: ambientFailureClassFromReport(report),
    });
  }

  if (!input?.writePreFix) {
    cachedReport = report;
  }
  return report;
}

async function tryReadArtifact(filePath: string): Promise<FixtureSurfaceDistinctReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = (parsed.report ?? parsed) as FixtureSurfaceDistinctReport | undefined;
    if (report?.surfaces && Array.isArray(report.surfaces) && report.surfaces.length > 0) {
      return report;
    }
    return null;
  });
}

function writeReportArtifact(
  report: FixtureSurfaceDistinctReport,
  opts: { outputPath: string; label: string; ambientFailureClass?: string },
): void {
  mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  const payload: ArtifactPayload = withTreeStamp({
    schemaVersion: "openclinxr.fixture-surface-distinct.v1",
    kind: "fixture_surface_distinct",
    label: opts.label,
    generatedAt: new Date().toISOString(),
    claimScope: report.claimScope,
    notEvidenceFor: report.notEvidenceFor,
    report,
    ambientFailureClass: opts.ambientFailureClass,
  });
  writeFileSync(opts.outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Lit ui-xr capture: one station with exam_surface + one with work_surface, side by side.
 * Uses the same scene-overview path as #183 room captures (§10y — not a point cloud).
 */
export async function captureSurfacesAfterPng(input?: {
  baseUrl?: string;
  outputPath?: string;
}): Promise<string> {
  const { chromium } = await import("playwright");
  const { spawnPortlessDevServer } = await import("./lib/portless-server.js");
  const {
    ROOM_CAPTURE_MODE,
    buildRoomCaptureUrl,
    waitForStationShell,
  } = await import("./ui-xr-environment-room-capture.js");
  const { mkdir, readFile } = await import("node:fs/promises");

  // peds asthma → pediatric_urgent_care_bay (exam_surface); primary care → work_surface desk.
  const scenarios = [
    { id: "peds_asthma_parent_anxiety_v1", label: "exam_surface" },
    { id: "primary_care_dyslipidemia_joint_pain_v1", label: "work_surface" },
  ] as const;

  const outputPath =
    input?.outputPath
    ?? absEvidence(ISSUE_207_EVIDENCE_DIR, "surfaces-after.png");

  let server: { url: string; proc: { kill: (s: string) => void } } | undefined;
  let owned = false;
  try {
    const baseUrl =
      input?.baseUrl
      ?? (await (async () => {
        owned = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const cellB64: string[] = [];
      try {
        for (const scenario of scenarios) {
          const url = buildRoomCaptureUrl(baseUrl, scenario.id, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          // Advance a few frames so fixtures settle.
          await page.waitForTimeout(1500);
          const cellPath = absEvidence(ISSUE_207_EVIDENCE_DIR, `cell-${scenario.label}.png`);
          await mkdir(path.dirname(cellPath), { recursive: true });
          await page.screenshot({ path: cellPath, type: "png" });
          cellB64.push((await readFile(cellPath)).toString("base64"));
        }
      } finally {
        await page.close().catch(() => undefined);
      }

      // Side-by-side composite via a second page (no sharp/pngjs dep).
      const sheet = await browser.newPage({ viewport: { width: 2560, height: 720 } });
      try {
        const html = `<!doctype html><html><body style="margin:0;display:flex;background:#141820">
<img src="data:image/png;base64,${cellB64[0]}" width="1280" height="720" alt="exam_surface station"/>
<img src="data:image/png;base64,${cellB64[1]}" width="1280" height="720" alt="work_surface station"/>
</body></html>`;
        await sheet.setContent(html, { waitUntil: "load" });
        await mkdir(path.dirname(outputPath), { recursive: true });
        await sheet.screenshot({ path: outputPath, type: "png" });
      } finally {
        await sheet.close().catch(() => undefined);
      }
      process.stdout.write(`fixture-surface-distinct: wrote ${outputPath}\n`);
      return outputPath;
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (owned && server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

/** CLI: write pre-fix, dump JSON, or capture surfaces-after.png. */
async function main(): Promise<void> {
  const writePreFix = process.argv.includes("--write-pre-fix");
  const captureAfter = process.argv.includes("--capture-after");
  const report = await inspectFixtureSurfaceDistinct({
    force: true,
    writePreFix,
    label: writePreFix ? "pre-fix" : "live",
  });
  console.log(JSON.stringify({
    surfaces: report.surfaces.map((s) => ({
      slotId: s.slotId,
      signature: s.signature,
      sizeMeters: s.sizeMeters,
      triangleCount: s.triangleCount,
      longestXZ: Math.max(s.sizeMeters.x, s.sizeMeters.z),
      environmentId: s.environmentId,
      fixtureKind: s.fixtureKind,
    })),
    ambientFailureClass: ambientFailureClassFromReport(report),
    wrotePreFix: writePreFix ? preFixPath() : null,
  }, null, 2));
  if (captureAfter) {
    await captureSurfacesAfterPng();
  }
}

const isDirect =
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
