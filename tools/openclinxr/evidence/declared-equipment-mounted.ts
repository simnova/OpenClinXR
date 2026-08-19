/**
 * #140 — declared clinical equipment mounting inspector.
 *
 * Enumerates stations from SHIPPED scene manifests under
 * apps/ui-xr/public/xr-assets/generated/, reads declared equipment ids from
 * equipmentPlacements, and measures what is mounted in the LIVE scene
 * (userData.openClinXrEquipmentId + mesh/triangle counts).
 *
 * claimScope: whether a station mounts the equipment its own manifest declares.
 * notEvidenceFor: clinical correctness, room props (#139), environment shell,
 * Quest readiness, scoring.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  computeMeasurementTreeStamp,
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { REAL_EQUIPMENT_GLTF_BY_ID } from "../../../apps/ui-xr/src/station-equipment.js";
import { measureParametricComposite } from "../../../apps/ui-xr/src/station-equipment-composite-measure.js";

export const DECLARED_EQUIPMENT_EVIDENCE_DIR = ".openclinxr/evidence/issue-140";
export const PRE_FIX_NAME = "pre-fix.json";

export type MountedEquipment = {
  equipmentId: string;
  source: "gltf" | "parametric" | "fallback" | "none";
  triangleCount: number;
  meshCount: number;
  /**
   * #245 — scene-asset-evidence status at the probe's sample instant.
   * "unknown" when no matching evidence record exists (e.g. no assetPath match).
   */
  assetStatusAtSample?: "pending" | "loaded" | "failed" | "unknown";
  /**
   * #245 — true when the runtime kept the primitive fallback active for this asset
   * (the "loaded but suppressed" branch); false when the GLB attached normally.
   */
  fallbackActiveAtSample?: boolean;
  /**
   * #245 — ms between GLTF load completion/failure and the probe's sample.
   * Positive = sampled after the loader resolved; negative = sampled before;
   * null = the asset never resolved; undefined = no evidence match.
   */
  sampledAtMsRelativeToLoad?: number | null;
  /**
   * #245 — geometry after waiting for every scene asset to resolve (re-sample).
   * Distinguishes a sampling-instant defect (§10m) from a genuine mount failure.
   */
  triangleCountAfterLoad?: number;
  meshCountAfterLoad?: number;
  /**
   * #258 — world-space AABB of the mounted root's VISIBLE geometry (hidden
   * placeholder/nameplate/affordance meshes excluded). Triangle counts prove
   * geometry reached the scene; these prove WHERE it landed. Consumed by the
   * placement-envelope contract in declared-equipment-mounted.test.ts. This is
   * the UNION of the mount and any parametric stand (the stand is what reaches
   * the floor plane the #258 placement contract checks).
   */
  worldAabbMin?: { x: number; y: number; z: number };
  worldAabbMax?: { x: number; y: number; z: number };
  /**
   * #268 — live world-space AABB of the mounted root's GLB BODY only, EXCLUDING
   * the parametric stand (a ".stand"-named group under the slot). The aspect
   * contract asserts on this extent; for ids without a stand it equals
   * worldAabbMin/Max.
   */
  worldBodyAabbMin?: { x: number; y: number; z: number };
  worldBodyAabbMax?: { x: number; y: number; z: number };
  /** #258 — the mount node's world translation (the outermost tagged root). */
  mountNodeWorldPosition?: { x: number; y: number; z: number };
};

export type StationEquipment = {
  scenarioId: string;
  declaredEquipmentIds: string[];
  /**
   * #258 — declared placement positions from the shipped manifest's
   * equipmentPlacements (the descriptor the mount is supposed to land within).
   * Empty for ids the station mounts without a declared placement (e.g. the
   * hardcoded ED bay ECG cart / IV pole, which use DEFAULT_POSITIONS).
   */
  declaredPlacements: Record<string, { x: number; y: number; z: number }>;
  mounted: MountedEquipment[];
  undeclaredMountedIds: string[];
};

export type DeclaredEquipmentMountingReport = {
  stations: StationEquipment[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.declared-equipment-mounted.v1";
  kind: "declared_equipment_mounting_live";
  label: string;
  generatedAt: string;
  /** #245 — the commit the measurement was taken against (same value as treeStamp.head). */
  measuredAgainstCommit: string;
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
  /**
   * #258 — file-level local bounds of every shipped real-equipment GLB (from the
   * tracked files, via gltf-transform). The calibration half of the placement
   * table: world AABB (live) vs asset-local bounds (file) shows whether a bad
   * mount is an origin/scale property of the asset or a mount-path defect.
   */
  assetLocalBounds?: Record<string, { min: number[]; max: number[] }>;
  /**
   * #266 — the declared placement envelope for each gltf-sourced equipment id:
   * the parametric composite's total local AABB (the footprint the placement
   * descriptor was authored against). null for ids without a DEDICATED
   * parametric builder (e.g. the ED bay library GLBs, which have no composite
   * envelope to fit). The world-extent contract pairs these rows with the live
   * worldAabbMin/Max spans to catch unit-normalized GLBs that render oversized.
   */
  declaredPlacementEnvelope?: Record<string, { min: number[]; max: number[]; source: string } | null>;
  claimScope: string[];
  notEvidenceFor: string[];
  report: DeclaredEquipmentMountingReport;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

let cachedReport: DeclaredEquipmentMountingReport | null = null;
let measureInFlight: Promise<DeclaredEquipmentMountingReport> | null = null;

function preFixPath(): string {
  return path.join(DECLARED_EQUIPMENT_EVIDENCE_DIR, PRE_FIX_NAME);
}

/** Stations = every shipped scene-manifest directory (never a hardcoded list). */
export async function listShippedScenarioManifestIds(): Promise<string[]> {
  if (!existsSync(generatedRoot)) return [];
  const entries = await readdir(generatedRoot, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(generatedRoot, entry.name, "scene-manifest.v1.json");
    if (existsSync(manifestPath)) ids.push(entry.name);
  }
  return ids.sort();
}

/**
 * #186 — union equipmentPlacements ∪ bundle.equipment ∪ roomProps that carry geometry.
 * Empty equipmentPlacements alone was blind to stations that only declare bundle/roomProps.
 */
export async function readDeclaredEquipmentIds(scenarioId: string): Promise<string[]> {
  const manifestPath = path.join(generatedRoot, scenarioId, "scene-manifest.v1.json");
  if (!existsSync(manifestPath)) return [];
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    equipmentPlacements?: Record<string, unknown>;
    equipment?: Array<{ equipmentId?: string } | string>;
    roomProps?: Array<{ propId?: string; semanticRole?: string }>;
  };
  const ids = new Set<string>();
  for (const id of Object.keys(raw.equipmentPlacements ?? {})) {
    if (id) ids.add(id);
  }
  for (const row of raw.equipment ?? []) {
    const id = typeof row === "string" ? row : row.equipmentId;
    if (id) ids.add(id);
  }
  // roomProps with geometry (not pure metadata) surface as declared mount candidates.
  const { classifyRoomProp } = await import("../../../apps/ui-xr/src/room-prop-classification.js");
  for (const prop of raw.roomProps ?? []) {
    const id = prop.propId;
    if (!id) continue;
    // Affordance/trace-only props without a geometry-bearing role stay out.
    if (prop.semanticRole === "review_cue" || prop.semanticRole === "objective_cue") continue;
    // #223: cue/overlay vocabulary is not furniture equipment to mount.
    const cls = classifyRoomProp(id, { semanticRole: prop.semanticRole ?? null });
    if (cls.classification === "cue_or_overlay") continue;
    ids.add(id);
  }
  return [...ids].sort();
}

/**
 * #258 — declared placement positions (equipmentPlacements[id].position) from the
 * shipped scene manifest. The placement envelope a gltf-sourced mount must land
 * within is authored against the parametric builders' conventions: floor kinds
 * (y≈0) are base-on-floor; elevated kinds (y>0) are origin-centered mount-height.
 */
export async function readDeclaredEquipmentPlacements(scenarioId: string): Promise<
  Record<string, { x: number; y: number; z: number }>
> {
  const manifestPath = path.join(generatedRoot, scenarioId, "scene-manifest.v1.json");
  if (!existsSync(manifestPath)) return {};
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    equipmentPlacements?: Record<
      string,
      { position?: { x?: number; y?: number; z?: number } } | undefined
    >;
  };
  const out: Record<string, { x: number; y: number; z: number }> = {};
  for (const [id, p] of Object.entries(raw.equipmentPlacements ?? {})) {
    const pos = p?.position;
    if (pos && typeof pos.x === "number" && typeof pos.y === "number" && typeof pos.z === "number") {
      out[id] = { x: pos.x, y: pos.y, z: pos.z };
    }
  }
  return out;
}

/**
 * Signature consumed by declared-equipment-mounted.test.ts planted contracts.
 * Measures once across the full shipped manifest bank (shared across vitest cases).
 */
export async function inspectDeclaredEquipmentMounting(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
  /**
   * #258 — override the pre-fix artifact path (default
   * .openclinxr/evidence/issue-140/pre-fix.json). The #258 contract reads
   * .openclinxr/evidence/issue-258/pre-fix.json.
   */
  preFixOutputPath?: string;
}): Promise<DeclaredEquipmentMountingReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_EQUIPMENT_MOUNT_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveEquipmentMounting({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeEquipmentMountDump(report, {
        outputPath: input.preFixOutputPath ?? preFixPath(),
        label: input?.label ?? "pre-fix",
      });
    }

    if (!input?.scenarioIds) {
      cachedReport = report;
    }
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

async function tryReadArtifact(filePath: string): Promise<DeclaredEquipmentMountingReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null). Fresh stamps still serve.
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as DeclaredEquipmentMountingReport | undefined;
    if (
      report?.stations
      && Array.isArray(report.stations)
      && report.stations.length > 0
    ) {
      return report;
    }
    return null;
  });
}

export async function writeEquipmentMountDump(
  report: DeclaredEquipmentMountingReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const stamp = computeMeasurementTreeStamp();
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.declared-equipment-mounted.v1" as const,
    kind: "declared_equipment_mounting_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    measuredAgainstCommit: stamp.head,
    assetLocalBounds: await measureAssetLocalBounds(),
    declaredPlacementEnvelope: measureDeclaredPlacementEnvelopes(),
    claimScope: [
      "shipped_scene_manifest_equipmentPlacements",
      "live_scene_userData_openClinXrEquipmentId",
      "mesh_and_triangle_counts_under_equipment_roots",
      "world_space_aabb_and_mount_node_translation_of_live_mounted_equipment",
      "asset_local_bounds_from_shipped_glb_files",
      "declared_placement_envelope_from_parametric_composite_builders",
    ],
    notEvidenceFor: [
      "clinical_correctness_of_equipment",
      "room_prop_labels",
      "environment_shell",
      "quest_readiness",
      "scoring_validity",
      "asset_scale_or_origin_being_correct",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`declared-equipment-mounted: wrote ${outputPath}\n`);
  return outputPath;
}

/**
 * #258 — file-level local AABB of every shipped real-equipment GLB, read from the
 * tracked files with gltf-transform. Pairs with the live world AABB rows so a
 * placement failure is attributable: origin/scale properties live in the asset,
 * mount-path defects live in the runtime.
 */
async function measureAssetLocalBounds(): Promise<Record<string, { min: number[]; max: number[] }>> {
  const io = new NodeIO();
  const out: Record<string, { min: number[]; max: number[] }> = {};
  const equipmentDir = path.join(repoRoot, "apps/ui-xr/public/xr-assets/medical-equipment");
  for (const [equipmentId, fileName] of Object.entries(REAL_EQUIPMENT_GLTF_BY_ID)) {
    try {
      const doc = await io.read(path.join(equipmentDir, fileName));
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      let found = false;
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute("POSITION");
          if (!pos) continue;
          const arr = pos.getArray();
          if (!arr) continue;
          for (let i = 0; i < pos.getCount(); i += 1) {
            const x = arr[i * 3];
            const y = arr[i * 3 + 1];
            const z = arr[i * 3 + 2];
            if (x < min[0]) min[0] = x;
            if (y < min[1]) min[1] = y;
            if (z < min[2]) min[2] = z;
            if (x > max[0]) max[0] = x;
            if (y > max[1]) max[1] = y;
            if (z > max[2]) max[2] = z;
            found = true;
          }
        }
      }
      if (found) {
        out[equipmentId] = {
          min: min.map((v) => Math.round(v * 1000) / 1000),
          max: max.map((v) => Math.round(v * 1000) / 1000),
        };
      }
    } catch {
      // Asset absent in this tree — leave the row out rather than fail the dump.
    }
  }
  return out;
}

/**
 * #266 — the declared placement envelope per gltf-sourced equipment id: the
 * parametric composite's total local AABB (the footprint the placement
 * descriptor was authored against). null for ids without a DEDICATED parametric
 * builder (ED bay library GLBs use the generic fallback and have no composite
 * envelope to fit). The world-extent contract pairs these rows with the live
 * worldAabbMin/Max spans.
 */
function measureDeclaredPlacementEnvelopes(): Record<
  string,
  { min: number[]; max: number[]; source: string } | null
> {
  const out: Record<string, { min: number[]; max: number[]; source: string } | null> = {};
  for (const equipmentId of Object.keys(REAL_EQUIPMENT_GLTF_BY_ID)) {
    const composite = measureParametricComposite(equipmentId);
    if (composite.source !== "parametric") {
      out[equipmentId] = null;
      continue;
    }
    out[equipmentId] = {
      min: [composite.totalAabbMin.x, composite.totalAabbMin.y, composite.totalAabbMin.z],
      max: [composite.totalAabbMax.x, composite.totalAabbMax.y, composite.totalAabbMax.z],
      source: composite.source,
    };
  }
  return out;
}

async function measureLiveEquipmentMounting(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<DeclaredEquipmentMountingReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : await listShippedScenarioManifestIds();

  if (scenarios.length === 0) {
    throw new Error("inspectDeclaredEquipmentMounting: listShippedScenarioManifestIds returned empty");
  }

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const stations: StationEquipment[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`declared-equipment-mounted: goto ${scenarioId}\n`);
          const declaredEquipmentIds = await readDeclaredEquipmentIds(scenarioId);
          const declaredPlacements = await readDeclaredEquipmentPlacements(scenarioId);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          // #245 — watch GLTF load resolution timing from the first available frame
          // so "sampledAtMs relative to loader completion" is observable, not guessed.
          await page.evaluate(`(() => {
            const win = window;
            if (win.__openClinXrEquipmentLoadWatch) return;
            const watch = { startMs: performance.now(), byAsset: {} };
            win.__openClinXrEquipmentLoadWatch = watch;
            win.setInterval(function () {
              const ev = win.__openClinXrSceneAssetEvidence;
              if (!ev || !Array.isArray(ev.assets)) return;
              for (let i = 0; i < ev.assets.length; i++) {
                const a = ev.assets[i];
                if (!watch.byAsset[a.assetId] && (a.status === "loaded" || a.status === "failed")) {
                  watch.byAsset[a.assetId] = { resolvedAtMs: performance.now(), status: a.status };
                }
              }
            }, 50);
          })()`);
          await waitForStationShell(page, 180_000);
          await waitForEquipmentOrFrames(page, 120_000);
          // Allow GLTF loaders a beat (ED bay real assets).
          await page.waitForTimeout(1500);
          let live = await readLiveEquipmentFromPage(page);
          decorateGltfLoadTiming(live);
          // #245 — if any gltf-sourced equipment was still pending at the sample
          // instant, wait for all scene assets to resolve, then re-sample. If the
          // count grows to the source file's magnitude only after waiting, the
          // probe was sampling before load completion (§10m class), not the mount.
          const pendingGltfIds = live.mounted
            .filter((m) => m.source === "gltf")
            .filter((m) => m.assetStatusAtSample === "pending")
            .map((m) => m.equipmentId);
          if (pendingGltfIds.length > 0) {
            try {
              await page.waitForFunction(
                `(() => {
                  const ev = window.__openClinXrSceneAssetEvidence;
                  return !ev || !Array.isArray(ev.assets) || ev.pendingCount === 0;
                })()`,
                undefined,
                { timeout: 30_000 },
              );
            } catch {
              // timeout — the asset never resolved; keep the pending sample as-is.
            }
            await page.waitForTimeout(300);
            const liveAfter = await readLiveEquipmentFromPage(page);
            decorateGltfLoadTiming(liveAfter);
            for (const m of live.mounted) {
              const after = liveAfter.mounted.find((o) => o.equipmentId === m.equipmentId);
              if (after && after.triangleCount > m.triangleCount) {
                m.triangleCountAfterLoad = after.triangleCount;
                m.meshCountAfterLoad = after.meshCount;
              }
            }
          }
          const sid = live.scenarioId || scenarioId;
          const mountedIds = new Set(live.mounted.map((m) => m.equipmentId));
          const undeclaredMountedIds = live.mounted
            .map((m) => m.equipmentId)
            .filter((id) => id && !declaredEquipmentIds.includes(id));
          // Ensure every declared id has a row (source none if missing).
          const mounted: MountedEquipment[] = [...live.mounted];
          for (const id of declaredEquipmentIds) {
            if (!mountedIds.has(id)) {
              mounted.push({
                equipmentId: id,
                source: "none",
                triangleCount: 0,
                meshCount: 0,
              });
            }
          }
          const row: StationEquipment = {
            scenarioId: sid,
            declaredEquipmentIds,
            declaredPlacements,
            mounted,
            undeclaredMountedIds,
          };
          stations.push(row);
          process.stdout.write(
            `  ${sid} declared=[${declaredEquipmentIds.join(",")}] `
            + `mounted=${JSON.stringify(live.mounted.map((m) => `${m.equipmentId}:${m.source}:${m.meshCount}m/${m.triangleCount}t`))}\n`,
          );
        }
        return { stations };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

async function waitForEquipmentOrFrames(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: { traverse?: (cb: (o: unknown) => void) => void };
        __openClinXrDeclaredEquipmentMountEvidence?: { items?: unknown[] };
        __openClinXrSceneAssetEvidence?: {
          assets?: Array<{ status?: string; assetPath?: string }>;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < 6) return false;
      // #253 — a medical-equipment GLB that is still "pending" at the first sample reads as
      // the #245 placeholder signature (3m/26t) even though the GLB attaches a beat later
      // (measured: the 8.4 MB bedside monitor resolves after the wall clock in ed_stroke).
      // Sample only after every recorded medical-equipment asset reached loaded/failed, so
      // the reported mounted state is the SETTLED state, not a pre-load race. Equipment
      // assets are recorded synchronously at mount time (before first frames), so an empty
      // equipment list after frames means the station mounts no real equipment GLB.
      const ev = win.__openClinXrSceneAssetEvidence;
      if (ev && Array.isArray(ev.assets)) {
        const equipmentAssets = ev.assets.filter((a) =>
          typeof a.assetPath === "string" && a.assetPath.includes("/xr-assets/medical-equipment/"));
        if (equipmentAssets.length > 0) {
          return equipmentAssets.every((a) => a.status === "loaded" || a.status === "failed");
        }
      }
      if (win.__openClinXrDeclaredEquipmentMountEvidence?.items) return true;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      return true;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Prefers published evidence; falls back to scene userData tags.
 * #245 — also returns the sample instant (performance.now), a trimmed snapshot of
 * window.__openClinXrSceneAssetEvidence (per-asset status), and the load watch.
 */
export async function readLiveEquipmentFromPage(page: Page): Promise<{
  scenarioId: string;
  mounted: MountedEquipment[];
  sampleNowMs: number;
  assetStates: Array<{
    assetId: string;
    status: string;
    fallbackActive: boolean;
    assetPath: string;
  }>;
  loadWatch: Record<string, { resolvedAtMs: number; status: string }>;
}> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
        typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
      scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
    }

    const published = win.__openClinXrDeclaredEquipmentMountEvidence;
    if (published && typeof published.scenarioId === "string" && published.scenarioId.length > 0) {
      scenarioId = published.scenarioId;
    }

    function countGeometry(root) {
      let meshCount = 0;
      let triangleCount = 0;
      if (!root || typeof root.traverse !== "function") return { meshCount: 0, triangleCount: 0 };
      root.traverse(function (obj) {
        if (!obj || !obj.isMesh || !obj.geometry) return;
        meshCount += 1;
        const g = obj.geometry;
        if (g.index && typeof g.index.count === "number") {
          triangleCount += Math.floor(g.index.count / 3);
        } else if (g.attributes && g.attributes.position && typeof g.attributes.position.count === "number") {
          triangleCount += Math.floor(g.attributes.position.count / 3);
        }
      });
      return { meshCount: meshCount, triangleCount: triangleCount };
    }

    function resolveEquipmentIds(object) {
      const ud = object.userData || {};
      const ids = [];
      if (typeof ud.openClinXrEquipmentId === "string" && ud.openClinXrEquipmentId.length > 0) {
        ids.push(ud.openClinXrEquipmentId);
      }
      // #209: fixture may fulfill multiple suppressed declared ids (aliases).
      if (Array.isArray(ud.openClinXrEquipmentIdAliases)) {
        for (let i = 0; i < ud.openClinXrEquipmentIdAliases.length; i++) {
          const a = ud.openClinXrEquipmentIdAliases[i];
          if (typeof a === "string" && a.length > 0 && ids.indexOf(a) < 0) ids.push(a);
        }
      }
      if (ids.length === 0 && typeof ud.openClinXrRuntimeEquipmentAssetId === "string") {
        const assetId = ud.openClinXrRuntimeEquipmentAssetId;
        const m = assetId.match(/\\.([a-z0-9_]+_equipment)\\./i)
          || assetId.match(/(?:^|[.])([a-z0-9_]+_equipment)(?:$|[.])/i);
        if (m) ids.push(m[1]);
        else if (assetId === "ecg" || assetId.indexOf("ecg") >= 0) ids.push("ecg_cart_equipment");
        else if (assetId.indexOf("iv") >= 0 && assetId.indexOf("pole") >= 0) ids.push("iv_stand_equipment");
        else if (assetId === "iv" || /iv_stand|iv-pole/i.test(assetId)) ids.push("iv_stand_equipment");
      }
      if (ids.length === 0) {
        const name = typeof object.name === "string" ? object.name : "";
        const nm = name.match(/([a-z0-9_]+_equipment)/i);
        if (nm) ids.push(nm[1]);
      }
      return ids;
    }

    // #258 — a mount is visible when neither it nor any ancestor is hidden (the
    // GLB slot hides its placeholder/nameplate/affordance siblings after attach).
    function isVisibleInTree(object) {
      let o = object;
      while (o) {
        if (o.visible === false) return false;
        o = o.parent;
      }
      return true;
    }

    // #258 — world AABB of the VISIBLE geometry under a mount root. Manual 4x4
    // transform of each POSITION by matrixWorld (no THREE global on window).
    // #268 — a SECOND pass excludes the parametric STAND (a ".stand"-named
    // group under the slot, e.g. openclinxr.equipment.bedside_monitor_equipment.
    // stand): the aspect contract asserts on the gltf BODY, and the stand is
    // separate parametric geometry that would otherwise widen the bounds and
    // mask the body's aspect (measured: union width 0.28 from the stand base
    // vs body 0.22 post-fix). worldAabbMin/Max stays the UNION (the #258
    // placement-envelope contract needs the stand to reach the floor plane);
    // worldBodyAabbMin/Max is the body-only extent for the #268 aspect contract.
    function hasStandAncestor(object) {
      let p = object.parent;
      while (p) {
        if (typeof p.name === "string" && p.name.endsWith(".stand")) return true;
        p = p.parent;
      }
      return false;
    }
    function computeWorldBounds(object, skipStand) {
      try { object.updateWorldMatrix(true, true); } catch (e) {}
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      let found = false;
      object.traverse(function (o) {
        if (!o || !o.isMesh || !o.geometry || !isVisibleInTree(o)) return;
        if (skipStand && hasStandAncestor(o)) return;
        const attr = o.geometry.attributes && o.geometry.attributes.position;
        if (!attr || !attr.array || !attr.count) return;
        const m = o.matrixWorld && o.matrixWorld.elements;
        if (!m) return;
        const count = attr.count;
        // #258 — InterleavedBufferAttribute (stride 8: pos3+normal3+uv2) reads of the
        // raw array mix position with normal components (measured: wall-clock GLB
        // reported node ± 1.0 because unit normals were read as positions). Use the
        // attribute API, which resolves the interleaved offset/stride the same way the
        // runtime does. §6v: measure with the instrument the runtime uses.
        for (let i = 0; i < count; i++) {
          const x = attr.getX(i); const y = attr.getY(i); const z = attr.getZ(i);
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (wx < min[0]) min[0] = wx;
          if (wy < min[1]) min[1] = wy;
          if (wz < min[2]) min[2] = wz;
          if (wx > max[0]) max[0] = wx;
          if (wy > max[1]) max[1] = wy;
          if (wz > max[2]) max[2] = wz;
          found = true;
        }
      });
      if (!found) return null;
      const r3 = function (v) { return Math.round(v * 1000) / 1000; };
      return {
        min: { x: r3(min[0]), y: r3(min[1]), z: r3(min[2]) },
        max: { x: r3(max[0]), y: r3(max[1]), z: r3(max[2]) },
      };
    }

    function worldPositionOf(object) {
      try { object.updateWorldMatrix(true, false); } catch (e) {}
      const m = object.matrixWorld && object.matrixWorld.elements;
      if (!m) return null;
      const r3 = function (v) { return Math.round(v * 1000) / 1000; };
      return { x: r3(m[12]), y: r3(m[13]), z: r3(m[14]) };
    }

    const byId = {};
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        const ids = resolveEquipmentIds(object);
        if (!ids.length) return;
        // Prefer outermost root tagged with equipment (no ancestor also resolving).
        let ancestorHas = false;
        let p = object.parent;
        let depth = 0;
        while (p && depth < 10) {
          if (resolveEquipmentIds(p).length > 0) {
            ancestorHas = true;
            break;
          }
          p = p.parent;
          depth += 1;
        }
        if (ancestorHas) return;
        const counts = countGeometry(object);
        const bounds = computeWorldBounds(object, false);
        const bodyBounds = computeWorldBounds(object, true);
        const mountPosition = worldPositionOf(object);
        const ud = object.userData || {};
        let source = "fallback";
        if (ud.openClinXrEquipmentSource === "gltf" || ud.openClinXrEquipmentSource === "parametric"
            || ud.openClinXrEquipmentSource === "fallback") {
          source = ud.openClinXrEquipmentSource;
        } else if (counts.triangleCount > 50) {
          // Pre-fix heuristic: real ED GLBs are denser than placeholder boxes.
          source = "gltf";
        }
        for (let ii = 0; ii < ids.length; ii++) {
          const id = ids[ii];
          const prev = byId[id];
          if (!prev || counts.triangleCount > prev.triangleCount || counts.meshCount > prev.meshCount) {
            byId[id] = {
              equipmentId: id,
              source: source,
              triangleCount: counts.triangleCount,
              meshCount: counts.meshCount,
              worldAabbMin: bounds ? bounds.min : undefined,
              worldAabbMax: bounds ? bounds.max : undefined,
              worldBodyAabbMin: bodyBounds ? bodyBounds.min : undefined,
              worldBodyAabbMax: bodyBounds ? bodyBounds.max : undefined,
              mountNodeWorldPosition: mountPosition,
            };
          }
        }
      });
    }

    const assetStates = [];
    const evidence = win.__openClinXrSceneAssetEvidence;
    if (evidence && Array.isArray(evidence.assets)) {
      for (let i = 0; i < evidence.assets.length; i++) {
        const a = evidence.assets[i];
        assetStates.push({
          assetId: a.assetId,
          status: a.status,
          fallbackActive: Boolean(a.fallbackActive),
          assetPath: typeof a.assetPath === "string" ? a.assetPath : "",
        });
      }
    }
    const watch = win.__openClinXrEquipmentLoadWatch;
    return {
      scenarioId: scenarioId,
      mounted: Object.keys(byId).map(function (k) { return byId[k]; }),
      sampleNowMs: performance.now(),
      assetStates: assetStates,
      loadWatch: watch && watch.byAsset ? watch.byAsset : {},
    };
  })()`) as Promise<{
    scenarioId: string;
    mounted: MountedEquipment[];
    sampleNowMs: number;
    assetStates: Array<{ assetId: string; status: string; fallbackActive: boolean; assetPath: string }>;
    loadWatch: Record<string, { resolvedAtMs: number; status: string }>;
  }>;
}

/**
 * #245 — decorate gltf-sourced mounted equipment with load status + timing from
 * window.__openClinXrSceneAssetEvidence and the injected load watch. Matching is
 * by assetPath suffix (the glb filename from REAL_EQUIPMENT_GLTF_BY_ID), so it is
 * robust to bundle model assetIds that differ from the equipment id.
 */
function decorateGltfLoadTiming(live: {
  sampleNowMs: number;
  assetStates: Array<{ assetId: string; status: string; fallbackActive: boolean; assetPath: string }>;
  loadWatch: Record<string, { resolvedAtMs: number; status: string }>;
  mounted: MountedEquipment[];
}): void {
  for (const m of live.mounted) {
    if (m.source !== "gltf") continue;
    const fileName = REAL_EQUIPMENT_GLTF_BY_ID[m.equipmentId];
    const state = fileName
      ? live.assetStates.find((s) => s.assetPath.toLowerCase().includes(fileName.toLowerCase()))
      : undefined;
    m.assetStatusAtSample = (
      state?.status === "pending" || state?.status === "loaded" || state?.status === "failed"
        ? state.status
        : "unknown"
    );
    m.fallbackActiveAtSample = state ? Boolean(state.fallbackActive) : undefined;
    if (!state) continue;
    const resolved = live.loadWatch[state.assetId];
    if (state.status === "loaded" || state.status === "failed") {
      m.sampledAtMsRelativeToLoad = resolved
        ? Math.round(live.sampleNowMs - resolved.resolvedAtMs)
        : 0;
    } else {
      // Still pending at the sample instant: sampled BEFORE load completion.
      m.sampledAtMsRelativeToLoad = null;
    }
  }
}

// CLI: write pre-fix or remeasure
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const writePreFix = process.argv.includes("--write-pre-fix");
  const force = process.argv.includes("--force");
  const preFixIdx = process.argv.indexOf("--pre-fix-path");
  const preFixOutputPath = preFixIdx >= 0 && process.argv[preFixIdx + 1]
    ? process.argv[preFixIdx + 1]
    : undefined;
  inspectDeclaredEquipmentMounting({
    writePreFix,
    force,
    label: writePreFix ? "pre-fix" : "cli",
    preFixOutputPath,
  })
    .then((report) => {
      process.stdout.write(`stations=${report.stations.length}\n`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
