/**
 * #144 — live per-station actor mesh integrity.
 *
 * Every garment gate reads the six GLB files. This inspector reads the LIVE scene
 * per station: cast-resolved path vs URL the loader fetched, live vs source triangle
 * counts, garment region presence, mesh height.
 *
 * Reuses room-capture probe helpers (spawnPortlessDevServer + waitForStationShell +
 * page.evaluate). Does not invent a fourth harness.
 *
 * claimScope: live mesh matches cast-resolved source; garment region present live.
 * notEvidenceFor: garment authoring quality, clinical wardrobe, room contents, Quest readiness.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export type StagedActorMesh = {
  scenarioId: string;
  actorId: string;
  castResolvedPath: string;
  loadedUrl: string;
  liveTriangleCount: number;
  sourceTriangleCount: number;
  hasGarmentRegionLive: boolean;
  liveMeshHeightMeters: number;
};

export type PerStationActorIntegrityReport = {
  stations: string[];
  actors: StagedActorMesh[];
  /** Pre-fix discriminator notes — what separates stations mechanically. */
  discriminatorNotes?: string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const INTEGRITY_EVIDENCE_DIR = ".openclinxr/evidence/issue-144";
export const PRE_FIX_NAME = "pre-fix.json";

/** Garment region as #103 / regenerated cast files tag it — not legacy anny_surface_scrub names. */
const REAL_GARMENT_RE = /openclinxr_real_garment_/i;
/**
 * #278 — MakeClothes library garments on the hm08 body_param bodies (the other rail's real
 * garment meshes, tokens mirror garment-covers-its-region.ts). The live probe must see a
 * re-cast library body as dressed, not as a garment-less figure.
 */
const LIBRARY_GARMENT_RE = /makeclothes_library_(scrub|shirt|pant|trouser|gown)/i;

let cachedReport: PerStationActorIntegrityReport | null = null;
let measureInFlight: Promise<PerStationActorIntegrityReport> | null = null;

const sourceTriCache = new Map<string, number>();

function absFromRepo(relOrAbs: string): string {
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  // runtime paths are /generated-humanoids/foo.glb
  if (relOrAbs.startsWith("/generated-humanoids/")) {
    return path.join(repoRoot, "apps/ui-xr/public", relOrAbs.slice(1));
  }
  if (relOrAbs.startsWith("/xr-assets/")) {
    return path.join(repoRoot, "apps/ui-xr/public", relOrAbs.slice(1));
  }
  return path.join(repoRoot, relOrAbs);
}

function primitiveTriangleCount(prim: {
  getIndices: () => { getCount: () => number } | null;
  getAttribute: (name: string) => { getCount: () => number } | null;
}): number {
  const indices = prim.getIndices();
  if (indices) return Math.floor(indices.getCount() / 3);
  const pos = prim.getAttribute("POSITION");
  if (pos) return Math.floor(pos.getCount() / 3);
  return 0;
}

async function sourceTriangleCountForPath(runtimeOrAssetPath: string): Promise<number> {
  const key = runtimeOrAssetPath;
  if (sourceTriCache.has(key)) return sourceTriCache.get(key)!;

  const candidates = [
    absFromRepo(runtimeOrAssetPath),
    // cast table uses apps/ui-xr/public/generated-humanoids/...
    absFromRepo(
      runtimeOrAssetPath.replace(/^\/generated-humanoids\//u, "apps/ui-xr/public/generated-humanoids/"),
    ),
  ];
  for (const abs of candidates) {
    if (!existsSync(abs)) continue;
    try {
      const document = await new NodeIO().read(abs);
      let tris = 0;
      for (const mesh of document.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          tris += primitiveTriangleCount(prim);
        }
      }
      sourceTriCache.set(key, tris);
      return tris;
    } catch {
      // try next candidate
    }
  }
  sourceTriCache.set(key, 0);
  return 0;
}

/**
 * Live scene probe: staged actors with mesh stats + loaded asset path from
 * scene asset evidence matched by sceneObjectName / actor id.
 */
async function readLiveActorIntegrityFromPage(page: Page): Promise<Array<{
  actorId: string;
  loadedUrl: string;
  liveTriangleCount: number;
  hasGarmentRegionLive: boolean;
  liveMeshHeightMeters: number;
}>> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const assetEv = win.__openClinXrSceneAssetEvidence;
    if (!scene || typeof scene.traverse !== "function") return [];

    // Map sceneObjectName / assetPath from scene asset evidence (what the loader fetched).
    const assets = (assetEv && Array.isArray(assetEv.assets)) ? assetEv.assets : [];
    const pathByObjectName = {};
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      if (!a || typeof a.sceneObjectName !== "string") continue;
      if (typeof a.assetPath === "string" && a.assetPath.length > 0) {
        pathByObjectName[a.sceneObjectName] = a.assetPath;
      }
    }

    // Actor roots: openClinXrActorId on slot or humanoid; prefer leaf with skinned mesh.
    const tagged = [];
    scene.traverse(function (object) {
      const id = object.userData && object.userData.openClinXrActorId;
      if (typeof id === "string" && id.length > 0) tagged.push(object);
    });

    // Prefer deepest tagged nodes that actually contain geometry (humanoid over empty slot).
    function hasGeometry(root) {
      let found = false;
      if (typeof root.traverse !== "function") return false;
      root.traverse(function (o) {
        if (o.isSkinnedMesh || (o.isMesh && o.geometry)) found = true;
      });
      return found;
    }

    const roots = tagged.filter(function (root) {
      if (!hasGeometry(root)) return false;
      let hasTaggedDescendantWithGeo = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (child) {
          if (child === root) return;
          const id = child.userData && child.userData.openClinXrActorId;
          if (typeof id === "string" && id.length > 0 && hasGeometry(child)) {
            hasTaggedDescendantWithGeo = true;
          }
        });
      }
      return !hasTaggedDescendantWithGeo;
    });

    function mulMat4Vec3(e, x, y, z) {
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      return [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
      ];
    }

    function meshWorldHeight(mesh) {
      if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos || pos.count === 0) return null;
      let minY = Infinity;
      let maxY = -Infinity;
      const stride = Math.max(1, Math.floor(pos.count / 2000));
      for (let i = 0; i < pos.count; i += stride) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const y = mesh.matrixWorld && mesh.matrixWorld.elements
          ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)[1]
          : vy;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      return maxY - minY;
    }

    function triangleCount(mesh) {
      const geo = mesh.geometry;
      if (!geo) return 0;
      const index = geo.index;
      if (index && typeof index.count === "number") return Math.floor(index.count / 3);
      const pos = geo.attributes && geo.attributes.position;
      if (pos && typeof pos.count === "number") return Math.floor(pos.count / 3);
      return 0;
    }

    const out = [];
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      const actorId = root.userData.openClinXrActorId;
      let liveTris = 0;
      let hasGarment = false;
      let height = 0;
      let loadedUrl = "";

      // Match loader path: walk names under this root against scene asset evidence.
      if (typeof root.traverse === "function") {
        root.traverse(function (object) {
          const n = object.name || "";
          if (n && pathByObjectName[n] && !loadedUrl) {
            loadedUrl = pathByObjectName[n];
          }
          if (object.isMesh || object.isSkinnedMesh) {
            liveTris += triangleCount(object);
            if (REAL_GARMENT_RE.test(n)) hasGarment = true;
            if (LIBRARY_GARMENT_RE.test(n)) hasGarment = true;
            if (object.userData && object.userData.openClinXrRealGarmentRegion) hasGarment = true;
            const h = meshWorldHeight(object);
            if (h !== null && h > height) height = h;
          }
        });
      }

      // Fallback: any evidence asset whose path we can associate by actor id substring.
      if (!loadedUrl) {
        for (let i = 0; i < assets.length; i++) {
          const a = assets[i];
          if (!a || a.status !== "loaded") continue;
          const p = typeof a.assetPath === "string" ? a.assetPath : "";
          if (!p) continue;
          if (p.indexOf("humanoid") < 0 && p.indexOf("generated-human") < 0) continue;
          // Prefer unique match later; collect first humanoid as weak fallback only if single actor.
        }
      }

      out.push({
        actorId: actorId,
        loadedUrl: loadedUrl,
        liveTriangleCount: liveTris,
        hasGarmentRegionLive: hasGarment,
        liveMeshHeightMeters: height
      });
    }

    // Second pass: if multiple actors lack loadedUrl, assign loaded humanoid assets by order.
    const loadedHumanoidPaths = [];
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      if (!a || a.status !== "loaded") continue;
      const p = typeof a.assetPath === "string" ? a.assetPath : "";
      if (!p) continue;
      if (p.indexOf("/generated-humanoids/") >= 0 || p.indexOf("/xr-assets/humanoids/") >= 0) {
        loadedHumanoidPaths.push(p);
      }
    }
    const missing = out.filter(function (row) { return !row.loadedUrl; });
    if (missing.length > 0 && loadedHumanoidPaths.length === out.length) {
      for (let i = 0; i < out.length; i++) {
        if (!out[i].loadedUrl && loadedHumanoidPaths[i]) {
          out[i].loadedUrl = loadedHumanoidPaths[i];
        }
      }
    } else if (missing.length > 0) {
      // Match by basename tokens in actorId (aisha, williams, omar, reed, ...).
      for (let m = 0; m < missing.length; m++) {
        const row = missing[m];
        const id = (row.actorId || "").toLowerCase();
        for (let i = 0; i < loadedHumanoidPaths.length; i++) {
          const p = loadedHumanoidPaths[i].toLowerCase();
          const base = p.split("/").pop() || "";
          // common: patient → cast, nurse → nurse, spouse/partner/parent → spouse/parent
          if (id.indexOf("nurse") >= 0 && (base.indexOf("nurse") >= 0 || p.indexOf("nurse") >= 0)) {
            row.loadedUrl = loadedHumanoidPaths[i];
            break;
          }
          if ((id.indexOf("patient") >= 0 || id.indexOf("aisha") >= 0 || id.indexOf("jordan") >= 0 || id.indexOf("robert") >= 0)
            && (base.indexOf("patient") >= 0 || base.indexOf("adult_cast") >= 0 || base.indexOf("aisha") >= 0)) {
            row.loadedUrl = loadedHumanoidPaths[i];
            break;
          }
          if ((id.indexOf("partner") >= 0 || id.indexOf("spouse") >= 0 || id.indexOf("parent") >= 0 || id.indexOf("family") >= 0)
            && (base.indexOf("spouse") >= 0 || base.indexOf("partner") >= 0 || base.indexOf("parent") >= 0 || base.indexOf("omar") >= 0)) {
            row.loadedUrl = loadedHumanoidPaths[i];
            break;
          }
        }
      }
    }

    return out;
  })()`.replace("REAL_GARMENT_RE", "/openclinxr_real_garment_/i")
    .replace("LIBRARY_GARMENT_RE", "/makeclothes_library_(scrub|shirt|pant|trouser|gown)/i")) as Promise<Array<{
    actorId: string;
    loadedUrl: string;
    liveTriangleCount: number;
    hasGarmentRegionLive: boolean;
    liveMeshHeightMeters: number;
  }>>;
}

async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  // #187: do NOT release after the first skinned mesh. Parent/nurse/family slots start loads in
  // parallel; measuring at skinned>=1 leaves secondaries as 1266-tri primitives with empty loadedUrl.
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: {
            userData?: Record<string, unknown>;
            isSkinnedMesh?: boolean;
          }) => void) => void;
        };
        __openClinXrSceneAssetEvidence?: {
          loadedCount?: number;
          assets?: Array<{ status?: string; assetPath?: string }>;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
      });
      const assets = win.__openClinXrSceneAssetEvidence?.assets ?? [];
      const humanoidAssets = assets.filter((a) => {
        const p = typeof a.assetPath === "string" ? a.assetPath : "";
        return p.includes("/generated-humanoids/") || p.includes("/xr-assets/humanoids/");
      });
      // Loads must have been requested; every humanoid slot must leave pending.
      if (humanoidAssets.length === 0) return false;
      const allSettled = humanoidAssets.every(
        (a) => a.status === "loaded" || a.status === "failed",
      );
      const anyLoaded = humanoidAssets.some((a) => a.status === "loaded");
      // One skinned mesh per successfully loaded humanoid is ideal; require at least one
      // and settlement of every requested humanoid path.
      return allSettled && anyLoaded && skinned >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

async function measureLiveAllStations(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<PerStationActorIntegrityReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : listShippedCastScenarioIds();

  if (scenarios.length === 0) {
    throw new Error("inspectPerStationActorIntegrity: listShippedCastScenarioIds returned empty");
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
        const actors: StagedActorMesh[] = [];
        const discriminatorNotes: string[] = [];

        for (const scenarioId of scenarios) {
          process.stdout.write(`actor-integrity: goto ${scenarioId}\n`);
          const cast = resolveScenarioActorCast(scenarioId);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          await page.waitForTimeout(1200);

          const live = await readLiveActorIntegrityFromPage(page);
          const liveById = new Map(live.map((a) => [a.actorId, a]));

          for (const entry of cast) {
            const liveRow = liveById.get(entry.actorId);
            // Also try role-ish fuzzy if slot remapped ids.
            let match = liveRow;
            if (!match) {
              const role = entry.role.toLowerCase();
              match = live.find((a) => {
                const id = a.actorId.toLowerCase();
                if (role === "patient" && id.includes("patient")) return true;
                if (role === "nurse" && id.includes("nurse")) return true;
                if ((role === "family" || role === "parent" || role === "spouse")
                  && (id.includes("partner") || id.includes("spouse") || id.includes("parent") || id.includes("family"))) {
                  return true;
                }
                return false;
              });
            }

            const castPath = entry.runtimeAssetPath;
            const sourceTriangleCount = await sourceTriangleCountForPath(entry.assetPath);
            const loadedUrl = match?.loadedUrl ?? "";
            const row: StagedActorMesh = {
              scenarioId,
              actorId: entry.actorId,
              castResolvedPath: castPath,
              loadedUrl,
              liveTriangleCount: match?.liveTriangleCount ?? 0,
              sourceTriangleCount,
              hasGarmentRegionLive: match?.hasGarmentRegionLive ?? false,
              liveMeshHeightMeters: match?.liveMeshHeightMeters ?? 0,
            };
            actors.push(row);

            const castFile = castPath.split("/").pop() ?? "";
            const loadedFile = loadedUrl.split("/").pop() ?? "";
            const pathMatch = loadedUrl.length > 0 && loadedUrl.includes(castFile);
            process.stdout.write(
              `  ${scenarioId}/${entry.actorId} cast=${castFile} loaded=${loadedFile || "(none)"} `
              + `liveTris=${row.liveTriangleCount} srcTris=${row.sourceTriangleCount} `
              + `garment=${row.hasGarmentRegionLive} h=${row.liveMeshHeightMeters.toFixed(3)} `
              + `pathOk=${pathMatch}\n`,
            );

            if (!pathMatch && (scenarioId.includes("ob_") || scenarioId.includes("psych_"))) {
              discriminatorNotes.push(
                `${scenarioId}/${entry.actorId}: cast=${castFile} loaded=${loadedFile || "empty"}`,
              );
            }
          }
        }

        return { stations: [...scenarios], actors, discriminatorNotes };
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

export async function writeIntegrityDump(
  report: PerStationActorIntegrityReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath
    ?? path.join(INTEGRITY_EVIDENCE_DIR, `${input?.label ?? "measure"}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    schemaVersion: "openclinxr.per-station-actor-integrity.v1",
    kind: "per_station_actor_integrity",
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_mesh_matches_cast_resolved_source",
      "live_garment_region_openclinxr_real_garment_or_makeclothes_library",
      "stations_enumerated_from_scenario_bank",
    ],
    notEvidenceFor: [
      "garment_authoring_quality",
      "clinical_wardrobe_plausibility",
      "room_contents",
      "quest_readiness",
    ],
    report,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`actor-integrity: wrote ${outputPath}\n`);
  return outputPath;
}

/**
 * Measure live actor integrity across shipped cast stations.
 * Signature is the implementer's choice; contracts call this name.
 */
export async function inspectPerStationActorIntegrity(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When set, also write this path (pre-fix proof). */
  writePath?: string;
}): Promise<PerStationActorIntegrityReport> {
  if (!input?.force && cachedReport) return cachedReport;
  if (!input?.force && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    const report = await measureLiveAllStations({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });
    if (input?.writePath) {
      await writeIntegrityDump(report, { outputPath: input.writePath, label: input.label ?? "pre-fix" });
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let label = "cli";
  let writePath: string | undefined;
  let scenarioFilter: string[] | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--label" && args[i + 1]) label = args[++i]!;
    else if (arg === "--write" && args[i + 1]) writePath = args[++i]!;
    else if (arg === "--scenario" && args[i + 1]) {
      scenarioFilter = (scenarioFilter ?? []).concat(args[++i]!);
    }
  }
  const defaultPreFix = path.join(INTEGRITY_EVIDENCE_DIR, PRE_FIX_NAME);
  const report = await inspectPerStationActorIntegrity({
    force: true,
    label,
    scenarioIds: scenarioFilter,
    writePath: writePath ?? (label === "pre-fix" ? defaultPreFix : undefined),
  });
  if (!writePath && label !== "pre-fix") {
    await writeIntegrityDump(report, { label });
  }
  process.stdout.write(
    `actor-integrity: ${report.stations.length} stations, ${report.actors.length} actors\n`,
  );
  if (report.discriminatorNotes?.length) {
    process.stdout.write(`discriminator notes:\n${report.discriminatorNotes.join("\n")}\n`);
  }
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("per-station-actor-integrity.ts")
    || process.argv[1].endsWith("per-station-actor-integrity.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
