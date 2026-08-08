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
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const DECLARED_EQUIPMENT_EVIDENCE_DIR = ".openclinxr/evidence/issue-140";
export const PRE_FIX_NAME = "pre-fix.json";

export type MountedEquipment = {
  equipmentId: string;
  source: "gltf" | "parametric" | "fallback" | "none";
  triangleCount: number;
  meshCount: number;
};

export type StationEquipment = {
  scenarioId: string;
  declaredEquipmentIds: string[];
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
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
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
  for (const prop of raw.roomProps ?? []) {
    const id = prop.propId;
    if (!id) continue;
    // Affordance/trace-only props without a geometry-bearing role stay out.
    if (prop.semanticRole === "review_cue" || prop.semanticRole === "objective_cue") continue;
    ids.add(id);
  }
  return [...ids].sort();
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
        outputPath: preFixPath(),
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
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.declared-equipment-mounted.v1" as const,
    kind: "declared_equipment_mounting_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "shipped_scene_manifest_equipmentPlacements",
      "live_scene_userData_openClinXrEquipmentId",
      "mesh_and_triangle_counts_under_equipment_roots",
    ],
    notEvidenceFor: [
      "clinical_correctness_of_equipment",
      "room_prop_labels",
      "environment_shell",
      "quest_readiness",
      "scoring_validity",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`declared-equipment-mounted: wrote ${outputPath}\n`);
  return outputPath;
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
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForEquipmentOrFrames(page, 120_000);
          // Allow GLTF loaders a beat (ED bay real assets).
          await page.waitForTimeout(1500);
          const live = await readLiveEquipmentFromPage(page);
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
        server.proc.kill("SIGTERM");
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
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < 6) return false;
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
 */
export async function readLiveEquipmentFromPage(page: Page): Promise<{
  scenarioId: string;
  mounted: MountedEquipment[];
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
            };
          }
        }
      });
    }

    return { scenarioId: scenarioId, mounted: Object.keys(byId).map(function (k) { return byId[k]; }) };
  })()`) as Promise<{ scenarioId: string; mounted: MountedEquipment[] }>;
}

// CLI: write pre-fix or remeasure
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const writePreFix = process.argv.includes("--write-pre-fix");
  const force = process.argv.includes("--force");
  inspectDeclaredEquipmentMounting({ writePreFix, force, label: writePreFix ? "pre-fix" : "cli" })
    .then((report) => {
      process.stdout.write(`stations=${report.stations.length}\n`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
