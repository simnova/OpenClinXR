/**
 * #183 — standing actor vs NON-SUPPORT geometry (live scene).
 *
 * #169 (actor-furniture-clearance) enumerates PATIENT SUPPORT surfaces only and is
 * correct in that scope. This module covers the remainder: room/layout props,
 * architecture fixtures (work surface, door, board, overbed), non-support equipment
 * mounts, and family/visitor chairs. It does NOT re-measure patient beds/chairs
 * covered by #169.
 *
 * Metric (peer-locked to #169; do not invent a second threshold):
 *   overlapFractionXZ = area(actor∩prop) / min(area(actor), area(prop))
 *   AND vertical straddle of the prop AABB
 *   AND actorPosture === "standing"
 *   → "inside" when fraction >= INSIDE_OVERLAP_FRACTION_THRESHOLD (0.18)
 *
 * WHAT THIS METRIC CANNOT SEE (§6e): a thin beam through a chest (small-volume
 * pierce). Residual is eye-graded; do not add a scalar to cover it.
 *
 * claimScope: standing actor vs non-support opaque layout/architecture/equipment.
 * notEvidenceFor: clinical staging, seated/supine plant quality, Quest readiness,
 * furniture art realism, thin-beam pierce detection.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import {
  INSIDE_OVERLAP_FRACTION_THRESHOLD,
  listShippedScenarioManifestIds,
  type Footprint,
} from "./actor-furniture-clearance.js";
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

export const PROP_INTERSECTION_EVIDENCE_DIR = ".openclinxr/evidence/issue-183";
export const PRE_FIX_NAME = "pre-fix.json";
export const AFTER_PNG_NAME = "actor-prop-after.png";

/** Re-export so contracts and CLI share one number with #169. */
export { INSIDE_OVERLAP_FRACTION_THRESHOLD };

export type PropRow = {
  scenarioId: string;
  actorId: string;
  propId: string;
  propSource: string;
  overlapFractionXZ: number;
  verticalStraddle: boolean;
  actorPosture: string;
  /** Diagnostic — not asserted by the planted contract. */
  actorFootprint?: Footprint;
  propFootprint?: Footprint;
  propMinY?: number;
  propMaxY?: number;
  actorMinY?: number;
  actorMaxY?: number;
};

export type StationPropIntersection = {
  scenarioId: string;
  environmentId: string;
  propCount: number;
  actorCount: number;
  /** Full actor×prop cross product (may be large). Empty only if no props OR no actors. */
  collisions: PropRow[];
};

export type ActorPropIntersectionReport = {
  stations: StationPropIntersection[];
  insideOverlapFractionThreshold: number;
  /** Standing pairs that clear the inside predicate. */
  collisionCount: number;
  /** Sets swept vs excluded — unlocked decision record. */
  propInclusionPolicy: {
    included: string[];
    excluded: string[];
  };
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.actor-prop-intersection.v1";
  kind: "actor_prop_intersection_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: ActorPropIntersectionReport;
};

let cachedReport: ActorPropIntersectionReport | null = null;
let measureInFlight: Promise<ActorPropIntersectionReport> | null = null;

function preFixPath(): string {
  return path.join(PROP_INTERSECTION_EVIDENCE_DIR, PRE_FIX_NAME);
}

export async function inspectActorPropIntersection(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
}): Promise<ActorPropIntersectionReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_ACTOR_PROP_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLivePropIntersection({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writePropDump(report, {
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

async function tryReadArtifact(filePath: string): Promise<ActorPropIntersectionReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = (parsed.report ?? parsed) as ActorPropIntersectionReport | undefined;
    if (report?.stations && Array.isArray(report.stations) && report.stations.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writePropDump(
  report: ActorPropIntersectionReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.actor-prop-intersection.v1" as const,
    kind: "actor_prop_intersection_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "standing_actor_xz_footprint_vs_non_support_prop",
      "architecture_layout_equipment_family_chair",
      "overlap_fraction_of_smaller_calibrated_threshold_from_169",
      "not_patient_support_surfaces_owned_by_169",
    ],
    notEvidenceFor: [
      "thin_beam_chest_pierce",
      "clinical_staging_seated_or_supine",
      "quest_readiness",
      "furniture_art_realism",
      "exam_equivalence",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`actor-prop-intersection: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLivePropIntersection(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<ActorPropIntersectionReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : await listShippedScenarioManifestIds();

  if (scenarios.length === 0) {
    throw new Error("inspectActorPropIntersection: listShippedScenarioManifestIds returned empty");
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
        const stations: StationPropIntersection[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`actor-prop-intersection: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForFrames(page, 8, 120_000);
          await page.waitForTimeout(900);
          const live = await readLivePropIntersectionFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const collisions = live.collisions.map((c) => ({ ...c, scenarioId: sid }));
          const station: StationPropIntersection = {
            scenarioId: sid,
            environmentId: live.environmentId,
            propCount: live.propCount,
            actorCount: live.actorCount,
            collisions,
          };
          stations.push(station);
          const hits = collisions.filter(
            (c) =>
              c.actorPosture === "standing"
              && c.overlapFractionXZ >= INSIDE_OVERLAP_FRACTION_THRESHOLD
              && c.verticalStraddle,
          );
          process.stdout.write(
            `  ${sid} env=${station.environmentId} props=${station.propCount} `
            + `actors=${station.actorCount} pairs=${collisions.length} `
            + `inside=${hits.length}\n`,
          );
          for (const h of hits) {
            process.stdout.write(
              `    HIT ${h.actorId} ∩ ${h.propId}[${h.propSource}] `
              + `f=${h.overlapFractionXZ.toFixed(3)} straddle=${h.verticalStraddle}\n`,
            );
          }
        }

        const collisionCount = stations.reduce(
          (n, s) =>
            n
            + s.collisions.filter(
              (c) =>
                c.actorPosture === "standing"
                && c.overlapFractionXZ >= INSIDE_OVERLAP_FRACTION_THRESHOLD
                && c.verticalStraddle,
            ).length,
          0,
        );

        return {
          stations,
          insideOverlapFractionThreshold: INSIDE_OVERLAP_FRACTION_THRESHOLD,
          collisionCount,
          propInclusionPolicy: {
            included: [
              "architecture_fixtures (work_surface, door_leaf, wall_board, overbed_surface, exam_surface)",
              "procedural_layout_props (monitor/desk/cart fixture else-branch)",
              "family_chair / parent_chair / visitor_chair (standing-through seat)",
              "non_support equipment mounts (openClinXrEquipmentId not in PATIENT_SUPPORT set)",
              "roomProp roots tagged openClinXrEquipmentId that are not patient supports",
            ],
            excluded: [
              "patient supports owned by #169 (patient_chair, stretcher, bed, exam_table_equipment, post_op_bed, pediatric_stretcher, chairs_equipment as patient seat)",
              "learner_start and isMarkerCube=true (0.18 m spawn anchors)",
              "shell structure floor/walls/ceiling/wall-trim",
              "actor humanoid meshes",
              "HUD / debug / nameplate overlays when identifiable by name",
            ],
          },
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
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

async function waitForFrames(page: Page, minFrames: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
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
  propCount: number;
  actorCount: number;
  collisions: Omit<PropRow, "scenarioId">[];
};

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Scene root: window.__openClinXrDebugScene (same as #169).
 */
export async function readLivePropIntersectionFromPage(page: Page): Promise<LiveStation> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";

    function worldBox(obj) {
      if (!obj || typeof obj.updateWorldMatrix !== "function") return null;
      obj.updateWorldMatrix(true, true);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let any = false;
      obj.traverse(function (child) {
        if (!child || !child.isMesh || !child.geometry) return;
        if (child.visible === false) return;
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

    const PATIENT_SUPPORT_EQ = {
      post_op_bed_equipment: true,
      pediatric_stretcher_equipment: true,
      exam_table_equipment: true,
      chairs_equipment: true,
    };

    function isPatientSupportSlotId(slotId) {
      const idLow = String(slotId).toLowerCase();
      if (idLow.indexOf("family_chair") >= 0
        || idLow.indexOf("parent_chair") >= 0
        || idLow.indexOf("visitor_chair") >= 0) {
        return false; // family seats are NON-support for this module (include as props)
      }
      if (idLow === "patient_chair" || idLow.indexOf("patient_chair") >= 0) return true;
      if (idLow === "stretcher" || idLow.indexOf("stretcher") >= 0) return true;
      if (idLow === "bed" || idLow.endsWith("_bed") || idLow.indexOf("post_op_bed") >= 0) return true;
      if (idLow.indexOf("exam_table") >= 0) return true;
      return false;
    }

    function isShellStructureName(name) {
      if (typeof name !== "string") return false;
      return name === "openclinxr.station-environment.floor"
        || name === "openclinxr.station-environment.back-wall"
        || name === "openclinxr.station-environment.left-wall"
        || name === "openclinxr.station-environment.right-wall"
        || name === "openclinxr.station-environment.ceiling"
        || name === "openclinxr.station-environment.wall-trim"
        || name === "openclinxr.station-environment-shell";
    }

    function isHudName(name) {
      if (typeof name !== "string") return false;
      const n = name.toLowerCase();
      return n.indexOf("debug") >= 0
        || n.indexOf("hud") >= 0
        || n.indexOf("nameplate") >= 0
        || n.indexOf("placard") >= 0
        || n.indexOf("metadata") >= 0
        || n.indexOf("overlay") >= 0;
    }

    function parentChain(obj, maxDepth) {
      const chain = [];
      let p = obj;
      let d = 0;
      while (p && d < maxDepth) {
        chain.push(typeof p.name === "string" ? p.name : "(unnamed)");
        p = p.parent;
        d++;
      }
      return chain;
    }

    let shell = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (o) {
        if (o && o.name === "openclinxr.station-environment-shell") shell = o;
      });
    }

    // ---- props ----
    const props = [];
    const seenRoots = [];

    function pushProp(root, id, source) {
      if (!root) return;
      if (seenRoots.indexOf(root) >= 0) return;
      if (root.userData && root.userData.isMarkerCube === true) return;
      const box = worldBox(root);
      if (!box) return;
      // Tiny spawn markers that slipped past isMarkerCube
      const dx = box.maxX - box.minX;
      const dy = box.maxY - box.minY;
      const dz = box.maxZ - box.minZ;
      if (dx < 0.22 && dy < 0.12 && dz < 0.22) return;
      seenRoots.push(root);
      props.push({
        id: id,
        source: source,
        footprint: fpOf(box),
        minY: box.minY,
        maxY: box.maxY,
        root: root,
      });
    }

    // Fixture children of shell (architecture, layout, family chairs)
    if (shell) {
      for (let i = 0; i < shell.children.length; i++) {
        const child = shell.children[i];
        if (!child) continue;
        if (isShellStructureName(child.name)) continue;
        const ud = child.userData || {};
        if (ud.isMarkerCube === true) continue;
        const slotId = typeof ud.fixtureSlotId === "string" ? ud.fixtureSlotId : "";
        if (!slotId) continue;
        if (isPatientSupportSlotId(slotId)) continue;
        // Prefer kind-tagged architecture; otherwise layout / family
        const kind = typeof ud.openClinXrFixtureKind === "string" ? ud.openClinXrFixtureKind : "";
        let source = "fixture_layout";
        if (kind === "work_surface" || kind === "door_leaf" || kind === "wall_board"
          || kind === "overbed_surface") {
          source = "architecture_fixture";
        } else if (kind === "procedural_layout_prop") {
          source = "fixture_layout";
        } else if (String(slotId).toLowerCase().indexOf("chair") >= 0) {
          source = "family_chair";
        }
        pushProp(child, slotId, source);
      }
    }

    // Non-support equipment + roomProp roots in the full scene
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (!object || !object.userData) return;
        const id = object.userData.openClinXrEquipmentId;
        if (typeof id !== "string" || !id) return;
        if (PATIENT_SUPPORT_EQ[id]) return;
        // Skip if already captured as fixture child
        if (seenRoots.indexOf(object) >= 0) return;
        // Prefer outermost equipment root
        let ancestorHas = false;
        let p = object.parent;
        let depth = 0;
        while (p && depth < 12) {
          if (p.userData && typeof p.userData.openClinXrEquipmentId === "string"
            && p.userData.openClinXrEquipmentId) {
            ancestorHas = true; break;
          }
          p = p.parent; depth++;
        }
        if (ancestorHas) return;
        // Skip fixture supports that also carry equipment id stamps
        const slotId = object.userData.fixtureSlotId;
        if (typeof slotId === "string" && isPatientSupportSlotId(slotId)) return;
        if (object.userData.isMarkerCube === true) return;
        if (isHudName(object.name)) return;
        // If this is already a shell fixture child we pushed, skip
        if (typeof slotId === "string" && slotId && shell) {
          // already handled in shell children loop when fixtureSlotId present
          let underShell = false;
          let q = object;
          let d2 = 0;
          while (q && d2 < 16) {
            if (q === shell) { underShell = true; break; }
            q = q.parent; d2++;
          }
          if (underShell && typeof object.userData.fixtureSlotId === "string") return;
        }
        pushProp(object, id, "equipment_or_room_prop");
      });
    }

    // ---- actors ----
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
          if (p.userData && typeof p.userData.openClinXrActorId === "string"
            && p.userData.openClinXrActorId) {
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
        actors.push({
          actorId: String(actor.userData.openClinXrActorId),
          posture: posture,
          footprint: fpOf(abox),
          minY: abox.minY,
          maxY: abox.maxY,
        });
      }
    }

    // Full actor × prop cross product (contract needs rows even when f=0)
    const collisions = [];
    for (let ai = 0; ai < actors.length; ai++) {
      const a = actors[ai];
      for (let pi = 0; pi < props.length; pi++) {
        const prop = props[pi];
        const frac = overlapFrac(a.footprint, prop.footprint);
        // Vertical straddle: body spans the prop's vertical range (feet below top, head above base).
        // Same family as #169 deck straddle, keyed on prop AABB rather than seat metadata.
        const verticalStraddle =
          a.minY < prop.maxY - 0.15
          && a.maxY > prop.minY + 0.1;
        collisions.push({
          actorId: a.actorId,
          propId: prop.id,
          propSource: prop.source,
          overlapFractionXZ: frac,
          verticalStraddle: verticalStraddle,
          actorPosture: a.posture,
          actorFootprint: a.footprint,
          propFootprint: prop.footprint,
          propMinY: prop.minY,
          propMaxY: prop.maxY,
          actorMinY: a.minY,
          actorMaxY: a.maxY,
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
      propCount: props.length,
      actorCount: actors.length,
      collisions: collisions,
    };
  })()`) as Promise<LiveStation>;
}

/**
 * Lit room capture of one station — same path as #211 psych-station-after.png.
 */
export async function captureActorPropAfterPng(input?: {
  baseUrl?: string;
  scenarioId?: string;
  outputPath?: string;
}): Promise<string> {
  const scenarioId = input?.scenarioId ?? "primary_care_dyslipidemia_joint_pain_v1";
  const outputPath =
    input?.outputPath
    ?? path.join(PROP_INTERSECTION_EVIDENCE_DIR, AFTER_PNG_NAME);

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input?.baseUrl
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
        const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForFrames(page, 8, 120_000);
        await page.waitForTimeout(1200);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await page.screenshot({ path: outputPath, type: "png" });
        process.stdout.write(`actor-prop-intersection: wrote ${outputPath}\n`);
        return outputPath;
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const writePreFix = args.includes("--write-pre-fix");
  const force = args.includes("--force");
  const captureAfter = args.includes("--capture-after");
  const report = await inspectActorPropIntersection({
    writePreFix,
    force,
    label: writePreFix ? "pre-fix" : "measure",
  });
  if (!writePreFix) {
    await writePropDump(report, {
      outputPath: path.join(PROP_INTERSECTION_EVIDENCE_DIR, "latest.json"),
      label: "latest",
    });
  }
  process.stdout.write(
    `actor-prop-intersection: ${report.stations.length} stations, `
    + `${report.collisionCount} standing-inside collisions (threshold=${report.insideOverlapFractionThreshold})\n`,
  );
  // Compact calibration table
  for (const st of report.stations) {
    for (const c of st.collisions) {
      if (
        c.actorPosture === "standing"
        && (c.overlapFractionXZ >= 0.05 || (c.overlapFractionXZ > 0 && c.verticalStraddle))
      ) {
        process.stdout.write(
          `  CAL ${st.scenarioId}/${c.actorId} ∩ ${c.propId}[${c.propSource}] `
          + `f=${(c.overlapFractionXZ * 100).toFixed(1)}% `
          + `straddle=${c.verticalStraddle} posture=${c.actorPosture}\n`,
        );
      }
    }
  }
  if (captureAfter) {
    await captureActorPropAfterPng();
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("actor-prop-intersection.ts");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
