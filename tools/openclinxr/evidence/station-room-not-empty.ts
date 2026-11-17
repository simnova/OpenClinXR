/**
 * #133 / #143 — live station room inspector: closed shell + patient support, no double-bed.
 * #213 — the same sheet now records whether the actors had loaded (live vs cast humanoid count).
 *
 * Enumerates stations from shipped scene manifests, loads each in ui-xr (scene-overview),
 * and reads fixture / ceiling / equipment / actor-vs-furniture facts from the LIVE scene
 * after the render loop advances. Since #213 the capture waits for humanoid assets
 * (waitForHumanoidAssetsLoaded) and records liveObservedHumanoids beside the cast count.
 *
 * claimScope: closed parametric shell + one patient support path per station + no actor-in-furniture
 * + humanoid presence observed vs declared cast.
 * notEvidenceFor: Quest readiness, trim/detail kit, clinical furniture realism, 180k triangle budget,
 * humanoid wardrobe/posture quality.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScenarioActorCast } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import {
  type MeasurementTreeStamp,
  tryReadStampedArtifact,
  withTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { chromium, type Page } from "./lib/slotted-playwright.js";
import {
  explicitSelectionCacheKey,
  isUsableSampledDiskReport,
  selectionCacheKey,
} from "./station-subset/room-supine-sample.js";
import type { SampleRecord } from "./station-subset.js";
import { selectStationSubset } from "./station-subset.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const STATION_ROOM_EVIDENCE_DIR = ".openclinxr/evidence/issue-133";
export const PRE_FIX_NAME = "pre-fix.json";
/** S2: fixed sampled siblings — a sampled run writes here, never the canonical path. */
export const PRE_FIX_SAMPLED_NAME = "pre-fix.json.sampled.json";
export const LATEST_NAME = "latest.json";
export const LATEST_SAMPLED_NAME = "latest.json.sampled.json";

/** Equipment ids that count as a patient lie/sit surface (ONE path with fixture support). */
export const PATIENT_SUPPORT_EQUIPMENT_IDS = new Set([
  "post_op_bed_equipment",
  "pediatric_stretcher_equipment",
  "exam_table_equipment",
  "chairs_equipment",
]);

export type RoomFacts = {
  scenarioId: string;
  environmentId: string;
  declaredSlotIds: string[];
  builtSlotIds: string[];
  markerCubeSlotIds: string[];
  mountedEquipmentIds: string[];
  hasCeiling: boolean;
  shellTriangles: number;
  patientSupportSurfaceCount: number;
  actorsIntersectingFurniture: string[];
  /** Cast humanoids the scenario declares, from resolveScenarioActorCast (Node side). */
  castExpectedHumanoids: number;
  /** Outermost openClinXrActorId roots carrying a skinned mesh with nonzero triangles. */
  liveObservedHumanoids: number;
};

/** One station's humanoid presence as the artifact must carry it (#213). */
export type HumanoidPresenceRow = {
  scenarioId: string;
  castExpected: number;
  liveObserved: number;
};

/**
 * Scenario ids whose live humanoid count fell below the cast — a panel captured mid-load
 * must not be indistinguishable from a station with no cast. Consumed by
 * the-station-sheet-records-whether-the-actors-loaded.test.ts.
 */
export function selectHumanoidPresenceMismatches(rows: readonly HumanoidPresenceRow[]): string[] {
  return rows
    .filter((row) => row.liveObserved < row.castExpected)
    .map((row) => row.scenarioId);
}

export type StationRoomNotEmptyReport = {
  rooms: RoomFacts[];
  /** R6: the selection this report measured (null when it measured everything). */
  sample: SampleRecord | null;
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.station-room-not-empty.v1";
  kind: "station_room_not_empty_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: StationRoomNotEmptyReport;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

let cachedReport: StationRoomNotEmptyReport | null = null;
/** F2: what selection the cached report measured ("full" or `seed:sorted-ids`). */
let cachedKey: string | null = null;
let measureInFlight: Promise<StationRoomNotEmptyReport> | null = null;
/** F2: what selection the in-flight measure is for. */
let measureInFlightKey: string | null = null;

/** Test seam: replace the live browser measurement (no browser). Null = production path. */
type MeasureLiveRoomsFn = typeof measureLiveRooms;
let measureLiveRoomsForTest: MeasureLiveRoomsFn | null = null;

/** Test seam: stub the live measurement. Pass null to restore production measurement. */
export function setStationRoomMeasureLiveForTest(fn: MeasureLiveRoomsFn | null): void {
  measureLiveRoomsForTest = fn;
}

/** Test seam: restore production measurement and drop in-process caches. */
export function resetStationRoomTestSeam(): void {
  measureLiveRoomsForTest = null;
  cachedReport = null;
  cachedKey = null;
  measureInFlight = null;
  measureInFlightKey = null;
}

function preFixPath(): string {
  return path.join(STATION_ROOM_EVIDENCE_DIR, PRE_FIX_NAME);
}

function latestPath(): string {
  return path.join(STATION_ROOM_EVIDENCE_DIR, LATEST_NAME);
}

function sampledPreFixPath(): string {
  return path.join(STATION_ROOM_EVIDENCE_DIR, PRE_FIX_SAMPLED_NAME);
}

function sampledLatestPath(): string {
  return path.join(STATION_ROOM_EVIDENCE_DIR, LATEST_SAMPLED_NAME);
}

/** S2: a sampled pre-fix write goes to the fixed sampled path, never canonical. */
export function stationRoomPreFixPathForReport(report: StationRoomNotEmptyReport): string {
  return report.sample ? sampledPreFixPath() : preFixPath();
}

/** S2: a sampled latest write goes to the fixed sampled path, never canonical. */
export function stationRoomLatestPathForReport(report: StationRoomNotEmptyReport): string {
  return report.sample ? sampledLatestPath() : latestPath();
}

/** CW1: pure selection — the sampled-or-full station list, no browser. */
export type StationRoomSampleSelection = {
  ids: string[];
  sample: SampleRecord | null;
};

export function selectStationRoomScenarioIds(
  allIds: string[],
  env: NodeJS.ProcessEnv = process.env,
): StationRoomSampleSelection {
  const subset = selectStationSubset(allIds, env);
  if (subset.full) return { ids: [...allIds], sample: null };
  return { ids: [...subset.ids], sample: { seed: subset.seed as string, ids: [...subset.ids] } };
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
 * Signature consumed by station-room-not-empty.test.ts planted contracts.
 * Measures once across the full shipped manifest bank (shared across vitest cases).
 */
export async function inspectStationRoomNotEmpty(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
  /** Test-only: redirect artifact reads/writes under this root (default: repo CWD). */
  evidenceRoot?: string;
}): Promise<StationRoomNotEmptyReport> {
  // S1: the seeded subset applies whenever the caller did not name stations —
  // including force:true re-measures, so each forced call re-measures the SAME
  // sampled ids (same seed -> same ids). Explicit scenarioIds bypass sampling.
  // One `station-subset: seed=` line is printed here on sampled runs.
  const selection: StationRoomSampleSelection = input?.scenarioIds?.length
    ? { ids: [...input.scenarioIds], sample: null }
    : selectStationRoomScenarioIds(await listShippedScenarioManifestIds());
  const sampled = selection.sample !== null;
  const needed = selection.ids;
  // F2: reuse only the exact selection identity — never a full report for a sampled
  // call, never another seed's sample, never a concurrent different-key flight.
  // R3-F1: an explicit scenarioIds call gets its own key, distinct from "full".
  const key = input?.scenarioIds?.length
    ? explicitSelectionCacheKey(input.scenarioIds)
    : selectionCacheKey(selection.sample);

  if (!input?.force && !input?.writePreFix && cachedReport && cachedKey === key) {
    return cachedReport;
  }
  if (!input?.force && !input?.writePreFix && measureInFlight && measureInFlightKey === key) {
    return measureInFlight;
  }

  const task: Promise<StationRoomNotEmptyReport> = (async () => {
    const atRoot = (p: string): string =>
      input?.evidenceRoot ? path.join(input.evidenceRoot, p) : p;
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env["OPENCLINXR_STATION_ROOM_USE_DISK"] === "1") {
        // Sampled runs read only the sampled artifact; full runs read only canonical.
        const fromDisk = sampled
          ? await tryReadArtifact(atRoot(sampledPreFixPath()))
          : await tryReadArtifact(atRoot(preFixPath()));
        // F3: a sampled artifact is reusable only on exact seed + sample ids,
        // with the measured rooms covering every requested id.
        if (fromDisk && sampled && selection.sample) {
          if (
            isUsableSampledDiskReport({
              reportSample: fromDisk.sample,
              measuredScenarioIds: fromDisk.rooms.map((r) => r.scenarioId),
              requestedSeed: selection.sample.seed,
              requestedSampleIds: selection.sample.ids,
              neededIds: needed,
            })
          ) {
            cachedReport = fromDisk;
            cachedKey = key;
            return fromDisk;
          }
          process.stdout.write(
            `station-room-not-empty: refusing sampled disk artifact for seed=${selection.sample.seed} sample=[${[...selection.sample.ids].sort().join(",")}]\n`,
          );
        } else if (fromDisk && !sampled) {
          // R3-F3: a canonical artifact is served only when it carries no sample —
          // coverage comes from measured rooms, never from recorded sample ids.
          if (fromDisk.sample !== null) {
            process.stdout.write(
              `station-room-not-empty: refusing canonical disk artifact carrying sample seed=${fromDisk.sample.seed} (canonical only by a full run)\n`,
            );
          } else {
            const covered = new Set(fromDisk.rooms.map((r) => r.scenarioId));
            if (needed.every((id) => covered.has(id))) {
              cachedReport = fromDisk;
              cachedKey = key;
              return fromDisk;
            }
            process.stdout.write(
              `station-room-not-empty: refusing disk artifact (covers ${covered.size} of ${needed.length} needed)\n`,
            );
          }
        }
      }
    }

    const liveBaseUrl = input?.baseUrl;
    const measured = await (measureLiveRoomsForTest ?? measureLiveRooms)({
      ...(liveBaseUrl === undefined ? {} : { baseUrl: liveBaseUrl }),
      scenarioIds: needed,
    });
    // S2: the measured report records its own selection (null on full runs).
    const report: StationRoomNotEmptyReport = {
      rooms: measured.rooms,
      sample: selection.sample,
    };

    if (input?.writePreFix) {
      await writeRoomDump(report, {
        outputPath: atRoot(stationRoomPreFixPathForReport(report)),
        label: input?.label ?? "pre-fix",
      });
    }

    // R3-F1: every completed call is cached under its own key, so a repeated
    // explicit selection is served without re-measuring.
    cachedReport = report;
    cachedKey = key;
    return report;
  })();
  measureInFlight = task;
  measureInFlightKey = key;

  try {
    return await task;
  } finally {
    if (measureInFlight === task) {
      measureInFlight = null;
      measureInFlightKey = null;
    }
  }
}

async function tryReadArtifact(filePath: string): Promise<StationRoomNotEmptyReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = (parsed["report"] ?? parsed) as Partial<StationRoomNotEmptyReport> | undefined;
    if (report?.rooms && Array.isArray(report.rooms) && report.rooms.length > 0) {
      return { rooms: report.rooms, sample: report.sample ?? null };
    }
    return null;
  });
}

export async function writeRoomDump(
  report: StationRoomNotEmptyReport,
  input?: { outputPath?: string; label?: string; evidenceRoot?: string },
): Promise<string> {
  // F1: the default is the routed path — a sampled report never lands on canonical
  // through this writer, even when the caller passes no outputPath. evidenceRoot
  // (test-only) redirects the default under a temp root; explicit outputPath wins.
  const outputPath = input?.outputPath
    ?? path.join(input?.evidenceRoot ?? ".", stationRoomPreFixPathForReport(report));
  // R3-F3: canonical only by a full run, on every public path — a sampled report
  // addressed at a canonical artifact throws instead of overwriting it.
  if (report.sample !== null) {
    for (const canonical of [preFixPath(), latestPath()]) {
      if (path.resolve(outputPath) === path.resolve(canonical)) {
        throw new Error(
          `station-room-not-empty: refusing to write sampled report (seed=${report.sample.seed}) to canonical path ${outputPath} (canonical artifact ${canonical})`,
        );
      }
    }
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.station-room-not-empty.v1" as const,
    kind: "station_room_not_empty_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_station_shell_ceiling",
      "live_fixture_slot_geometry",
      "live_equipment_patient_support",
      "live_actor_vs_furniture_aabb",
      "live_humanoid_presence_observed_vs_cast",
    ],
    notEvidenceFor: [
      "quest_readiness",
      "trim_detail_kit",
      "clinical_furniture_realism",
      "180k_triangle_budget_as_hardware_ceiling",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`station-room-not-empty: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveRooms(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<{ rooms: RoomFacts[] }> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : await listShippedScenarioManifestIds();

  if (scenarios.length === 0) {
    throw new Error("inspectStationRoomNotEmpty: listShippedScenarioManifestIds returned empty");
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
        const rooms: RoomFacts[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`station-room-not-empty: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          // #213: waitForStationShell resolves on the station shell and says NOTHING about
          // humanoids — the panel used to be captured 8 frames + 900 ms later, loaded or not.
          // waitForHumanoidAssetsLoaded (ui-xr-environment-room-capture.ts:921) is the wait the
          // single-station path already relies on. Bounded: a station that never finishes loading
          // is recorded as liveObserved=0 (a real finding), not allowed to kill the sweep.
          try {
            await waitForHumanoidAssetsLoaded(page, 180_000);
          } catch (err) {
            process.stdout.write(
              `  waitForHumanoidAssetsLoaded not satisfied for ${scenarioId}: ${String(err)}\n`,
            );
          }
          await waitForFrames(page, 8, 120_000);
          await page.waitForTimeout(900);
          const live = await readLiveRoomFactsFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const row: RoomFacts = {
            scenarioId: sid,
            environmentId: live.environmentId,
            declaredSlotIds: live.declaredSlotIds,
            builtSlotIds: live.builtSlotIds,
            markerCubeSlotIds: live.markerCubeSlotIds,
            mountedEquipmentIds: live.mountedEquipmentIds,
            hasCeiling: live.hasCeiling,
            shellTriangles: live.shellTriangles,
            patientSupportSurfaceCount: live.patientSupportSurfaceCount,
            actorsIntersectingFurniture: live.actorsIntersectingFurniture,
            castExpectedHumanoids: resolveScenarioActorCast(sid).length,
            liveObservedHumanoids: live.liveObservedHumanoids,
          };
          rooms.push(row);
          process.stdout.write(
            `  ${row.scenarioId} env=${row.environmentId} ceiling=${row.hasCeiling} `
            + `shellT=${row.shellTriangles} support=${row.patientSupportSurfaceCount} `
            + `humanoids=${row.liveObservedHumanoids}/${row.castExpectedHumanoids} `
            + `built=[${row.builtSlotIds.join(",")}] markers=[${row.markerCubeSlotIds.join(",")}] `
            + `actorsInFurn=[${row.actorsIntersectingFurniture.join(",")}]\n`,
          );
        }
        return { rooms };
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

async function waitForFrames(page: Page, minFrames: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = browserPageWindow as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
      };
      return (win.__openClinXrFrameStats?.framesObserved ?? 0) >= need;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Reads shell fixtures, ceiling, equipment support, and actor-vs-furniture embedding.
 */
export async function readLiveRoomFactsFromPage(page: Page): Promise<RoomFacts> {
  return page.evaluate(`(() => {
    const win = browserPageWindow;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(browserPageWindow.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    const stationMeta = scene && scene.userData && scene.userData.openClinXrStationEnvironment
      ? scene.userData.openClinXrStationEnvironment
      : null;
    if (stationMeta && typeof stationMeta.scenarioId === "string" && stationMeta.scenarioId) {
      scenarioId = stationMeta.scenarioId;
    }

    function triangleCount(mesh) {
      if (!mesh || !mesh.isMesh || !mesh.geometry) return 0;
      const g = mesh.geometry;
      if (g.index && typeof g.index.count === "number") return Math.floor(g.index.count / 3);
      if (g.attributes && g.attributes.position && typeof g.attributes.position.count === "number") {
        return Math.floor(g.attributes.position.count / 3);
      }
      return 0;
    }

    function worldBox(obj) {
      if (!obj || typeof obj.updateWorldMatrix !== "function") return null;
      obj.updateWorldMatrix(true, true);
      // Prefer three.js Box3 if present on constructor prototypes via scene helpers
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let any = false;
      obj.traverse(function (child) {
        if (!child || !child.isMesh || !child.geometry) return;
        child.geometry.computeBoundingBox && child.geometry.computeBoundingBox();
        const bb = child.geometry.boundingBox;
        if (!bb) return;
        child.updateWorldMatrix(true, false);
        const m = child.matrixWorld.elements;
        // Transform 8 corners of local AABB
        const xs = [bb.min.x, bb.max.x];
        const ys = [bb.min.y, bb.max.y];
        const zs = [bb.min.z, bb.max.z];
        for (let ix = 0; ix < 2; ix++) {
          for (let iy = 0; iy < 2; iy++) {
            for (let iz = 0; iz < 2; iz++) {
              const x = xs[ix], y = ys[iy], z = zs[iz];
              const wx = m[0]*x + m[4]*y + m[8]*z + m[12];
              const wy = m[1]*x + m[5]*y + m[9]*z + m[13];
              const wz = m[2]*x + m[6]*y + m[10]*z + m[14];
              minX = Math.min(minX, wx); minY = Math.min(minY, wy); minZ = Math.min(minZ, wz);
              maxX = Math.max(maxX, wx); maxY = Math.max(maxY, wy); maxZ = Math.max(maxZ, wz);
              any = true;
            }
          }
        }
      });
      if (!any) return null;
      return { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ };
    }

    function boxesOverlap(a, b) {
      return a.minX <= b.maxX && a.maxX >= b.minX
        && a.minY <= b.maxY && a.maxY >= b.minY
        && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
    }

    let shell = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (o) {
        if (o && o.name === "openclinxr.station-environment-shell") shell = o;
      });
    }

    const declaredSlotIds = [];
    if (shell && shell.userData && Array.isArray(shell.userData.fixtureSlots)) {
      for (const s of shell.userData.fixtureSlots) {
        if (s && typeof s.slotId === "string") declaredSlotIds.push(s.slotId);
      }
    }

    const builtSlotIds = [];
    const markerCubeSlotIds = [];
    const fixtureSupportRoots = [];
    let hasCeiling = false;
    let shellTriangles = 0;

    if (shell) {
      // Ceiling mesh or userData flag
      if (shell.userData && shell.userData.hasCeiling === true) hasCeiling = true;
      shell.traverse(function (o) {
        if (!o) return;
        const name = typeof o.name === "string" ? o.name : "";
        if (name === "openclinxr.station-environment.ceiling" || (o.userData && o.userData.isCeiling === true)) {
          hasCeiling = true;
        }
        // Shell triangles: floor/walls/ceiling/trim only (not fixture-slot subtree)
        if (o.isMesh) {
          let underFixture = false;
          let p = o;
          while (p && p !== shell) {
            const pn = typeof p.name === "string" ? p.name : "";
            if (pn.indexOf("fixture-slot") >= 0) { underFixture = true; break; }
            p = p.parent;
          }
          if (!underFixture) shellTriangles += triangleCount(o);
        }
      });

      for (let i = 0; i < shell.children.length; i++) {
        const child = shell.children[i];
        if (!child || !child.userData) continue;
        const slotId = child.userData.fixtureSlotId;
        if (typeof slotId !== "string" || !slotId) continue;
        if (child.userData.isMarkerCube === true) {
          markerCubeSlotIds.push(slotId);
        } else {
          builtSlotIds.push(slotId);
          const kind = String(child.userData.openClinXrStretcherKind || child.userData.openClinXrChairKind || "");
          const idLow = slotId.toLowerCase();
          // #209: family/parent/visitor chairs are not patient supports (one-support rule).
          const isFamilySeat = idLow.indexOf("family_chair") >= 0
            || idLow.indexOf("parent_chair") >= 0
            || idLow.indexOf("visitor_chair") >= 0;
          const isBedClass = kind.indexOf("stretcher") >= 0
            || idLow === "stretcher" || idLow.indexOf("stretcher") >= 0
            || idLow === "bed" || idLow.endsWith("_bed")
            || idLow.indexOf("exam_table") >= 0;
          const isPatientChair = !isFamilySeat && (
            idLow === "patient_chair" || idLow.indexOf("patient_chair") >= 0
            || (kind.indexOf("chair") >= 0 && !isBedClass)
          );
          if (!isFamilySeat && (isBedClass || isPatientChair)) {
            fixtureSupportRoots.push({
              root: child,
              bedClass: isBedClass,
              chairClass: isPatientChair && !isBedClass,
            });
          }
        }
      }
    }

    // Equipment support surfaces
    const PATIENT_SUPPORT_EQ = {
      post_op_bed_equipment: true,
      pediatric_stretcher_equipment: true,
      exam_table_equipment: true,
      chairs_equipment: true,
    };
    const mountedEquipmentIds = [];
    const equipmentSupportRoots = [];
    const published = win.__openClinXrDeclaredEquipmentMountEvidence;
    if (published && Array.isArray(published.items)) {
      for (const item of published.items) {
        if (item && typeof item.equipmentId === "string" && item.equipmentId) {
          if (mountedEquipmentIds.indexOf(item.equipmentId) < 0) mountedEquipmentIds.push(item.equipmentId);
        }
      }
    }
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (!object || !object.userData) return;
        const id = object.userData.openClinXrEquipmentId;
        if (typeof id !== "string" || !id) return;
        // outermost equipment root
        let ancestorHas = false;
        let p = object.parent;
        let depth = 0;
        while (p && depth < 12) {
          if (p.userData && typeof p.userData.openClinXrEquipmentId === "string" && p.userData.openClinXrEquipmentId) {
            ancestorHas = true; break;
          }
          p = p.parent; depth++;
        }
        if (ancestorHas) return;
        if (mountedEquipmentIds.indexOf(id) < 0) mountedEquipmentIds.push(id);
        if (PATIENT_SUPPORT_EQ[id]) {
          equipmentSupportRoots.push({
            root: object,
            bedClass: id.indexOf("chair") < 0,
            chairClass: id.indexOf("chair") >= 0,
            id: id,
          });
        }
      });
    }

    // #209: one patient support — exclude family seats; if a bed/table exists, chairs are not patient supports.
    // Dedup stamped fixtures that also carry openClinXrEquipmentId.
    const patientCandidates = [];
    const seenRoots = [];
    function addCandidate(entry) {
      const root = entry.root;
      if (seenRoots.indexOf(root) >= 0) return;
      seenRoots.push(root);
      patientCandidates.push(entry);
    }
    for (let i = 0; i < fixtureSupportRoots.length; i++) addCandidate(fixtureSupportRoots[i]);
    for (let i = 0; i < equipmentSupportRoots.length; i++) addCandidate(equipmentSupportRoots[i]);
    const hasBedClass = patientCandidates.some(function (c) { return c.bedClass; });
    const patientSupportRoots = patientCandidates.filter(function (c) {
      if (hasBedClass) return c.bedClass;
      return c.bedClass || c.chairClass;
    });
    const patientSupportSurfaceCount = patientSupportRoots.length;

    // Actors INSIDE furniture — contract counterweight is "stands inside", not "touches"
    // or "rests on". Supine/seated on a support is valid clinical staging (#150).
    // Use actor horizontal CENTER inside a shrunken furniture footprint + feet near floor.
    const actorsIntersectingFurniture = [];
    // Humanoid presence (#213): count of actor roots with real skinned geometry, filled below.
    let liveObservedHumanoids = 0;
    const supportBoxes = [];
    function pushSupport(root, deckHint) {
      const box = worldBox(root);
      if (!box) return;
      let deckTop = typeof deckHint === "number" ? deckHint : box.maxY;
      if (root.userData) {
        if (typeof root.userData.deckTopYMeters === "number") deckTop = root.userData.deckTopYMeters;
        else if (typeof root.userData.seatHeightMeters === "number") deckTop = root.userData.seatHeightMeters;
      }
      supportBoxes.push({ box: box, deckTop: deckTop });
    }
    for (const r of patientCandidates) pushSupport(r.root, null);

    if (scene && typeof scene.traverse === "function") {
      const actorRoots = [];
      scene.traverse(function (object) {
        if (!object || !object.userData) return;
        const actorId = object.userData.openClinXrActorId;
        if (typeof actorId !== "string" || !actorId) return;
        // Prefer outermost actor root
        let ancestorHas = false;
        let p = object.parent;
        let depth = 0;
        while (p && depth < 12) {
          if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId) {
            ancestorHas = true; break;
          }
          p = p.parent; depth++;
        }
        if (ancestorHas) return;
        actorRoots.push(object);
      });

      for (const actor of actorRoots) {
        const abox = worldBox(actor);
        if (!abox) continue;
        const posture = String(actor.userData.openClinXrActorPosture || "standing").toLowerCase();
        const actorId = String(actor.userData.openClinXrActorId);
        // Resting on a support is intentional; only flag standing (or unknown) plant-through.
        if (posture === "supine" || posture === "seated") continue;
        const cx = (abox.minX + abox.maxX) / 2;
        const cz = (abox.minZ + abox.maxZ) / 2;
        // Floor-planted standing: lowest skinned vertex near floor (not already on a deck).
        const feetNearFloor = abox.minY < 0.2;
        if (!feetNearFloor) continue;
        for (const s of supportBoxes) {
          // Shrink footprint so grazing a rail/edge is not "inside".
          const margin = 0.12;
          const insideXZ =
            cx >= s.box.minX + margin && cx <= s.box.maxX - margin
            && cz >= s.box.minZ + margin && cz <= s.box.maxZ - margin;
          if (!insideXZ) continue;
          // Body must actually pierce the deck (not merely share a room AABB with a tall prop).
          if (abox.minY < s.deckTop - 0.15 && abox.maxY > s.deckTop + 0.1) {
            const label = actorId + "@" + posture;
            if (actorsIntersectingFurniture.indexOf(label) < 0) actorsIntersectingFurniture.push(label);
          }
        }
      }

      // Humanoid presence (#213): an actor root counts as OBSERVED only when it carries a skinned
      // mesh with nonzero triangles. A root that exists without skin is mid-load or a stub and
      // must not count — the artifact must distinguish "captured mid-load" from "no cast".
      for (const actor of actorRoots) {
        let skinnedTris = 0;
        actor.traverse(function (o) {
          const isSkinned = o.isSkinnedMesh === true || (o.type === "SkinnedMesh") || (o.isMesh && o.skeleton);
          if (!isSkinned) return;
          const geo = o.geometry;
          if (!geo) return;
          const index = geo.index;
          if (index && typeof index.count === "number") {
            skinnedTris += Math.floor(index.count / 3);
            return;
          }
          const pos = geo.attributes && geo.attributes.position;
          if (pos && typeof pos.count === "number") skinnedTris += Math.floor(pos.count / 3);
        });
        if (skinnedTris > 0) liveObservedHumanoids += 1;
      }
    }

    let environmentId = "";
    if (stationMeta && typeof stationMeta.environmentId === "string") environmentId = stationMeta.environmentId;
    if (!environmentId && shell && shell.userData && typeof shell.userData.environmentId === "string") {
      environmentId = shell.userData.environmentId;
    }

    return {
      scenarioId: scenarioId,
      environmentId: environmentId,
      declaredSlotIds: declaredSlotIds,
      builtSlotIds: builtSlotIds,
      markerCubeSlotIds: markerCubeSlotIds,
      mountedEquipmentIds: mountedEquipmentIds.sort(),
      hasCeiling: hasCeiling,
      shellTriangles: shellTriangles,
      patientSupportSurfaceCount: patientSupportSurfaceCount,
      actorsIntersectingFurniture: actorsIntersectingFurniture,
      liveObservedHumanoids: liveObservedHumanoids,
    };
  })()`) as Promise<RoomFacts>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const writePreFix = args.includes("--write-pre-fix");
  const force = args.includes("--force");
  const report = await inspectStationRoomNotEmpty({ writePreFix, force, label: writePreFix ? "pre-fix" : "measure" });
  if (!writePreFix) {
    // S2: a sampled run writes the sampled sibling, never canonical latest.json.
    await writeRoomDump(report, {
      outputPath: stationRoomLatestPathForReport(report),
      label: "latest",
    });
  }
  process.stdout.write(`station-room-not-empty: ${report.rooms.length} rooms measured\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("station-room-not-empty.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
