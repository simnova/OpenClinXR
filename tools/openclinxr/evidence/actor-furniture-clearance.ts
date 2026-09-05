/**
 * #169 — actor vs patient-support furniture clearance (live scene).
 *
 * Enumerates every shipped station, loads each in ui-xr (scene-overview), and
 * measures XZ footprint overlap between actors and support surfaces (fixture
 * chairs/stretchers AND equipment-mounted beds/chairs).
 *
 * SCOPE (honest; do not substitute a wider claim):
 *   This module only measures PATIENT SUPPORT surfaces — beds, stretchers, patient
 *   chairs (plus family seats as collision furniture). It has NO opinion about
 *   non-support geometry (work surfaces, layout carts, room props, wall equipment).
 *   A green "inside=[none]" means "no standing actor is inside a support surface",
 *   NOT "no standing actor is inside any room geometry". Non-support occupancy is
 *   #183 (`actor-prop-intersection.ts`).
 *
 * Detection metric (calibrated; not centre-in-shrunk-box):
 *   overlapFractionOfSmaller = area(actor∩support) / min(area(actor), area(support))
 *   AND body straddles deck top
 *   AND standing with feet near floor → inside furniture
 *   Seated: flagged only when feet remain near floor (planted through seat).
 *   Supine on-deck is never "inside" (counterweight #133).
 *
 * claimScope: collision resolution — standing actor and support share space.
 * notEvidenceFor: clinical staging, seating patients, Quest readiness, furniture art,
 * non_support_prop_occupancy (see #183).
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
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

export const CLEARANCE_EVIDENCE_DIR = ".openclinxr/evidence/issue-169";
export const PRE_FIX_NAME = "pre-fix.json";

/**
 * Overlap fraction of the SMALLER footprint at/above which a standing figure is
 * "inside" furniture (when also straddling the deck with feet near floor).
 *
 * Calibrated: waist-deep half-in fails (~0.3–0.6); grazing a rail / standing
 * beside passes (~0–0.1). f=0.18 sits between those bands.
 * Rejected: centre-in-0.12m-margin (#133 blind spot); pure AABB any-touch.
 */
export const INSIDE_OVERLAP_FRACTION_THRESHOLD = 0.18;

export type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

export type ActorClearance = {
  scenarioId: string;
  actorId: string;
  posture: string;
  actorFootprint: Footprint;
  actorMinY: number;
  actorMaxY: number;
  nearestSupportId: string | null;
  nearestSupportSource: string | null;
  nearestSupportDeckTopY: number | null;
  nearestSupportFootprint: Footprint | null;
  overlapFractionOfSmaller: number;
  straddlesDeck: boolean;
  isInsideFurniture: boolean;
};

export type StationClearance = {
  scenarioId: string;
  environmentId: string;
  hasCeiling: boolean;
  patientSupportSurfaceCount: number;
  supportSurfaces: {
    id: string;
    source: string;
    footprint: Footprint;
    deckTopY: number;
  }[];
  actors: ActorClearance[];
};

export type ActorFurnitureClearanceReport = {
  stations: StationClearance[];
  control: ActorClearance | null;
  insideOverlapFractionThreshold: number;
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.actor-furniture-clearance.v1";
  kind: "actor_furniture_clearance_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: ActorFurnitureClearanceReport;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

let cachedReport: ActorFurnitureClearanceReport | null = null;
let measureInFlight: Promise<ActorFurnitureClearanceReport> | null = null;

function preFixPath(): string {
  return path.join(CLEARANCE_EVIDENCE_DIR, PRE_FIX_NAME);
}

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

export function footprintArea(f: Footprint): number {
  return Math.max(0, f.maxX - f.minX) * Math.max(0, f.maxZ - f.minZ);
}

export function overlapFootprint(a: Footprint, b: Footprint): Footprint | null {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minZ = Math.max(a.minZ, b.minZ);
  const maxZ = Math.min(a.maxZ, b.maxZ);
  if (maxX <= minX || maxZ <= minZ) return null;
  return { minX, maxX, minZ, maxZ };
}

export function overlapFractionOfSmaller(a: Footprint, b: Footprint): number {
  const o = overlapFootprint(a, b);
  if (!o) return 0;
  const smaller = Math.min(footprintArea(a), footprintArea(b));
  if (smaller <= 1e-9) return 0;
  return footprintArea(o) / smaller;
}

export async function inspectActorFurnitureClearance(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
}): Promise<ActorFurnitureClearanceReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_ACTOR_FURNITURE_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveClearance({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeClearanceDump(report, {
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

async function tryReadArtifact(filePath: string): Promise<ActorFurnitureClearanceReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = (parsed.report ?? parsed) as ActorFurnitureClearanceReport | undefined;
    if (report?.stations && Array.isArray(report.stations) && report.stations.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writeClearanceDump(
  report: ActorFurnitureClearanceReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.actor-furniture-clearance.v1" as const,
    kind: "actor_furniture_clearance_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_actor_xz_footprint_vs_support_surface",
      "fixture_and_equipment_mounted_supports",
      "overlap_fraction_of_smaller_calibrated_threshold",
      "collision_resolution_not_clinical_staging",
    ],
    notEvidenceFor: [
      "clinical_staging_seated_or_supine_posture",
      "quest_readiness",
      "furniture_art_realism",
      "exam_equivalence",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`actor-furniture-clearance: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveClearance(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<ActorFurnitureClearanceReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : await listShippedScenarioManifestIds();

  if (scenarios.length === 0) {
    throw new Error("inspectActorFurnitureClearance: listShippedScenarioManifestIds returned empty");
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
        const stations: StationClearance[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`actor-furniture-clearance: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForFrames(page, 8, 120_000);
          await page.waitForTimeout(900);
          const live = await readLiveClearanceFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const row: StationClearance = {
            scenarioId: sid,
            environmentId: live.environmentId,
            hasCeiling: live.hasCeiling,
            patientSupportSurfaceCount: live.patientSupportSurfaceCount,
            supportSurfaces: live.supportSurfaces,
            actors: live.actors.map((a) => ({ ...a, scenarioId: sid })),
          };
          stations.push(row);
          const inside = row.actors.filter((a) => a.isInsideFurniture).map((a) => a.actorId);
          process.stdout.write(
            `  ${row.scenarioId} env=${row.environmentId} ceiling=${row.hasCeiling} `
            + `support=${row.patientSupportSurfaceCount} `
            + `inside=[${inside.join(",") || "none"}]\n`,
          );
        }

        return {
          stations,
          control: pickControl(stations),
          insideOverlapFractionThreshold: INSIDE_OVERLAP_FRACTION_THRESHOLD,
        };
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

function pickControl(stations: StationClearance[]): ActorClearance | null {
  const standing = stations.flatMap((s) =>
    s.actors.filter((a) => a.posture === "standing" && !a.isInsideFurniture),
  );
  if (standing.length === 0) {
    const anyOk = stations.flatMap((s) => s.actors.filter((a) => !a.isInsideFurniture));
    return anyOk[0] ?? null;
  }
  const withOverlap = standing
    .filter((a) => a.overlapFractionOfSmaller > 0)
    .sort((a, b) => b.overlapFractionOfSmaller - a.overlapFractionOfSmaller);
  if (withOverlap.length > 0) return withOverlap[0]!;
  const nearSupport = standing.find((a) => a.nearestSupportId);
  return nearSupport ?? standing[0]!;
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
  ).catch(() => undefined);
  await page.waitForTimeout(400);
}

type LiveStation = {
  scenarioId: string;
  environmentId: string;
  hasCeiling: boolean;
  patientSupportSurfaceCount: number;
  supportSurfaces: StationClearance["supportSurfaces"];
  actors: Omit<ActorClearance, "scenarioId">[];
};

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Scene root: browserPageWindow.__openClinXrDebugScene (same as station-room-not-empty).
 */
export async function readLiveClearanceFromPage(page: Page): Promise<LiveStation> {
  const threshold = INSIDE_OVERLAP_FRACTION_THRESHOLD;
  return page.evaluate(`(() => {
    const insideThreshold = ${threshold};
    const win = browserPageWindow;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(browserPageWindow.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";

    function worldBox(obj) {
      if (!obj || typeof obj.updateWorldMatrix !== "function") return null;
      obj.updateWorldMatrix(true, true);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let any = false;
      obj.traverse(function (child) {
        if (!child || !child.isMesh || !child.geometry) return;
        if (child.geometry.computeBoundingBox) child.geometry.computeBoundingBox();
        const bb = child.geometry.boundingBox;
        if (!bb) return;
        child.updateWorldMatrix(true, false);
        const m = child.matrixWorld.elements;
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

    function fpOf(b) {
      return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    }

    function area(f) {
      return Math.max(0, f.maxX - f.minX) * Math.max(0, f.maxZ - f.minZ);
    }

    function overlapFrac(a, b) {
      const minX = Math.max(a.minX, b.minX);
      const maxX = Math.min(a.maxX, b.maxX);
      const minZ = Math.max(a.minZ, b.minZ);
      const maxZ = Math.min(a.maxZ, b.maxZ);
      if (maxX <= minX || maxZ <= minZ) return 0;
      const o = (maxX - minX) * (maxZ - minZ);
      const smaller = Math.min(area(a), area(b));
      if (smaller <= 1e-9) return 0;
      return o / smaller;
    }

    let shell = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (o) {
        if (o && o.name === "openclinxr.station-environment-shell") shell = o;
      });
    }

    let hasCeiling = false;
    if (shell && shell.userData && shell.userData.hasCeiling === true) hasCeiling = true;
    if (shell) {
      shell.traverse(function (o) {
        if (!o) return;
        const name = typeof o.name === "string" ? o.name : "";
        if (name === "openclinxr.station-environment.ceiling" || (o.userData && o.userData.isCeiling === true)) {
          hasCeiling = true;
        }
      });
    }

    const fixtureSupportRoots = [];
    if (shell) {
      for (let i = 0; i < shell.children.length; i++) {
        const child = shell.children[i];
        if (!child || !child.userData) continue;
        const slotId = child.userData.fixtureSlotId;
        if (typeof slotId !== "string" || !slotId) continue;
        if (child.userData.isMarkerCube === true) continue;
        const kind = String(child.userData.openClinXrStretcherKind || child.userData.openClinXrChairKind || "");
        const idLow = slotId.toLowerCase();
        // family/parent/visitor chairs are collision furniture but NOT patient supports
        // (#209 — oncology/psych legitimately ship two seats; one-support counts patient only).
        const isFamilySeat = idLow.indexOf("family_chair") >= 0
          || idLow.indexOf("parent_chair") >= 0
          || idLow.indexOf("visitor_chair") >= 0;
        const isBedClass = kind.indexOf("stretcher") >= 0
          || idLow === "stretcher" || idLow.indexOf("stretcher") >= 0
          || idLow === "bed" || idLow.endsWith("_bed")
          || idLow.indexOf("exam_table") >= 0;
        const isPatientChair = idLow === "patient_chair" || idLow.indexOf("patient_chair") >= 0
          || (kind.indexOf("chair") >= 0 && !isFamilySeat && !isBedClass);
        const isSupport = !isFamilySeat && (isBedClass || isPatientChair);
        if (isSupport) {
          fixtureSupportRoots.push({
            root: child,
            id: slotId,
            bedClass: isBedClass,
            chairClass: isPatientChair && !isBedClass,
          });
        }
        // Family seats still participate in inside-furniture collision (standing through seat).
        if (isFamilySeat && (kind.indexOf("chair") >= 0 || idLow.indexOf("chair") >= 0)) {
          fixtureSupportRoots.push({
            root: child,
            id: slotId,
            bedClass: false,
            chairClass: false,
            familySeat: true,
          });
        }
      }
    }

    const PATIENT_SUPPORT_EQ = {
      post_op_bed_equipment: true,
      pediatric_stretcher_equipment: true,
      exam_table_equipment: true,
      chairs_equipment: true,
    };
    const equipmentSupportRoots = [];
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (!object || !object.userData) return;
        const id = object.userData.openClinXrEquipmentId;
        if (typeof id !== "string" || !id) return;
        if (!PATIENT_SUPPORT_EQ[id]) return;
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
        equipmentSupportRoots.push({ root: object, id: id });
      });
    }

    const supports = [];
    const seenSupportRoots = [];
    function pushSupport(root, id, source, flags) {
      // #209: stamped fixtures appear as both fixtureSlotId and openClinXrEquipmentId —
      // keep one row; prefer equipment source so bank-wide source set includes mounts.
      const existingIdx = seenSupportRoots.indexOf(root);
      if (existingIdx >= 0) {
        if (source === "equipment" && supports[existingIdx] && supports[existingIdx].source === "fixture") {
          supports[existingIdx].source = "equipment";
          supports[existingIdx].id = id;
        }
        return;
      }
      const box = worldBox(root);
      if (!box) return;
      let deckTop = box.maxY;
      const ud = root.userData || {};
      if (typeof ud.deckTopYMeters === "number") deckTop = ud.deckTopYMeters;
      else if (typeof ud.seatHeightMeters === "number") deckTop = ud.seatHeightMeters;
      else {
        // Equipment parametric beds/chairs often lack seat metadata; box.maxY is the
        // backrest/rail tip (~1.6 m) and makes straddle blind. Prefer seat/mattress band.
        const idLow = String(id).toLowerCase();
        if (idLow.indexOf("chair") >= 0) deckTop = 0.42;
        else if (
          idLow.indexOf("bed") >= 0
          || idLow.indexOf("table") >= 0
          || idLow.indexOf("stretcher") >= 0
        ) {
          deckTop = 0.55;
        } else if (source === "equipment" && box.maxY > 0.9) {
          deckTop = Math.min(0.55, Math.max(0.42, box.minY + 0.45));
        }
      }
      const idLow = String(id).toLowerCase();
      const bedClass = flags && typeof flags.bedClass === "boolean"
        ? flags.bedClass
        : (
          idLow.indexOf("stretcher") >= 0
          || idLow.indexOf("bed") >= 0
          || idLow.indexOf("exam_table") >= 0
          || idLow.indexOf("table") >= 0
        );
      const familySeat = flags && flags.familySeat === true;
      const chairClass = flags && typeof flags.chairClass === "boolean"
        ? flags.chairClass
        : (!bedClass && !familySeat && idLow.indexOf("chair") >= 0);
      seenSupportRoots.push(root);
      supports.push({
        id: id,
        source: source,
        footprint: fpOf(box),
        deckTopY: deckTop,
        box: box,
        bedClass: bedClass,
        chairClass: chairClass,
        familySeat: familySeat,
      });
    }
    for (let i = 0; i < fixtureSupportRoots.length; i++) {
      const fr = fixtureSupportRoots[i];
      // Prefer equipment source when the fixture fulfills a declared equipment id (#209 stamp).
      const eqId = fr.root.userData && fr.root.userData.openClinXrEquipmentId;
      const fixtureSource = (typeof eqId === "string" && PATIENT_SUPPORT_EQ[eqId]) ? "equipment" : "fixture";
      const fixtureId = fixtureSource === "equipment" ? eqId : fr.id;
      pushSupport(fr.root, fixtureId, fixtureSource, fr);
    }
    for (let i = 0; i < equipmentSupportRoots.length; i++) {
      pushSupport(equipmentSupportRoots[i].root, equipmentSupportRoots[i].id, "equipment", null);
    }

    // #209 — patientSupportSurfaceCount: one patient bed/table OR one patient chair.
    // Family seats never count. When a bed-class support exists, chairs are seating only.
    const hasBedClass = supports.some(function (s) { return s.bedClass && !s.familySeat; });
    const patientSupportCount = supports.filter(function (s) {
      if (s.familySeat) return false;
      if (hasBedClass) return s.bedClass;
      return s.bedClass || s.chairClass;
    }).length;

    const actors = [];
    if (scene && typeof scene.traverse === "function") {
      const actorRoots = [];
      scene.traverse(function (object) {
        if (!object || !object.userData) return;
        const actorId = object.userData.openClinXrActorId;
        if (typeof actorId !== "string" || !actorId) return;
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

      for (let ai = 0; ai < actorRoots.length; ai++) {
        const actor = actorRoots[ai];
        const abox = worldBox(actor);
        if (!abox) continue;
        const posture = String(actor.userData.openClinXrActorPosture || "standing").toLowerCase();
        const actorId = String(actor.userData.openClinXrActorId);
        const afp = fpOf(abox);

        let best = null;
        let bestFrac = 0;
        for (let si = 0; si < supports.length; si++) {
          const s = supports[si];
          const frac = overlapFrac(afp, s.footprint);
          if (frac > bestFrac) {
            bestFrac = frac;
            best = s;
          }
        }
        if (!best && supports.length > 0) {
          const cx = (afp.minX + afp.maxX) / 2;
          const cz = (afp.minZ + afp.maxZ) / 2;
          let bestDist = Infinity;
          for (let si = 0; si < supports.length; si++) {
            const s = supports[si];
            const sx = (s.footprint.minX + s.footprint.maxX) / 2;
            const sz = (s.footprint.minZ + s.footprint.maxZ) / 2;
            const d = (cx - sx) * (cx - sx) + (cz - sz) * (cz - sz);
            if (d < bestDist) {
              bestDist = d;
              best = s;
              bestFrac = overlapFrac(afp, s.footprint);
            }
          }
        }

        const deckTop = best ? best.deckTopY : null;
        const straddlesDeck = best !== null && deckTop !== null
          && abox.minY < deckTop - 0.15
          && abox.maxY > deckTop + 0.1;
        const feetNearFloor = abox.minY < 0.2;
        // Standing plant-through only. Seated feet are *supposed* to be near the floor while
        // the pelvis rests on the seat — feetNearFloor cannot distinguish on vs through.
        // Supine: intentionally on-deck (counterweight). Full seated CONTACT (pelvis-on-seat
        // vs buried) is the #159/#166 staging gap — named here, not a silent skip.
        let isInside = false;
        if (posture === "supine" || posture === "seated") {
          isInside = false;
        } else {
          isInside = bestFrac >= insideThreshold && straddlesDeck && feetNearFloor;
        }

        actors.push({
          actorId: actorId,
          posture: posture,
          actorFootprint: afp,
          actorMinY: abox.minY,
          actorMaxY: abox.maxY,
          nearestSupportId: best ? best.id : null,
          nearestSupportSource: best ? best.source : null,
          nearestSupportDeckTopY: deckTop,
          nearestSupportFootprint: best ? best.footprint : null,
          overlapFractionOfSmaller: bestFrac,
          straddlesDeck: straddlesDeck,
          isInsideFurniture: isInside,
        });
      }
    }

    let environmentId = "";
    if (shell && shell.userData && typeof shell.userData.environmentId === "string") {
      environmentId = shell.userData.environmentId;
    }
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment
      && typeof scene.userData.openClinXrStationEnvironment.environmentId === "string") {
      environmentId = scene.userData.openClinXrStationEnvironment.environmentId;
    }

    return {
      scenarioId: scenarioId,
      environmentId: environmentId,
      hasCeiling: hasCeiling,
      patientSupportSurfaceCount: patientSupportCount,
      supportSurfaces: supports
        .filter(function (s) {
          if (s.familySeat) return false;
          if (hasBedClass) return s.bedClass;
          return s.bedClass || s.chairClass;
        })
        .map(function (s) {
          return {
            id: s.id,
            source: s.source,
            footprint: s.footprint,
            deckTopY: s.deckTopY,
          };
        }),
      actors: actors,
    };
  })()`) as Promise<LiveStation>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const writePreFix = args.includes("--write-pre-fix");
  const force = args.includes("--force");
  const report = await inspectActorFurnitureClearance({
    writePreFix,
    force,
    label: writePreFix ? "pre-fix" : "measure",
  });
  if (!writePreFix) {
    await writeClearanceDump(report, {
      outputPath: path.join(CLEARANCE_EVIDENCE_DIR, "latest.json"),
      label: "latest",
    });
  }
  const insideCount = report.stations.reduce(
    (n, s) => n + s.actors.filter((a) => a.isInsideFurniture).length,
    0,
  );
  process.stdout.write(
    `actor-furniture-clearance: ${report.stations.length} stations, ${insideCount} actors inside furniture\n`,
  );
  // Print a compact table for calibration
  for (const st of report.stations) {
    for (const a of st.actors) {
      if (a.isInsideFurniture || a.overlapFractionOfSmaller >= 0.05) {
        process.stdout.write(
          `  CAL ${st.scenarioId}/${a.actorId} posture=${a.posture} `
          + `overlap=${(a.overlapFractionOfSmaller * 100).toFixed(1)}% `
          + `straddle=${a.straddlesDeck} inside=${a.isInsideFurniture} `
          + `support=${a.nearestSupportId}[${a.nearestSupportSource}]\n`,
        );
      }
    }
  }
  if (report.control) {
    process.stdout.write(
      `  CONTROL ${report.control.scenarioId}/${report.control.actorId} `
      + `overlap=${(report.control.overlapFractionOfSmaller * 100).toFixed(1)}% `
      + `inside=${report.control.isInsideFurniture}\n`,
    );
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("actor-furniture-clearance.ts")
  || process.argv[1]?.endsWith("actor-furniture-clearance.js");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
