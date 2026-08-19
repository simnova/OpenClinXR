/**
 * #185 — room-prop channel consults parametric equipment builders.
 *
 * Measures declared roomProps in the LIVE ui-xr scene: builder arm coverage,
 * mounted root counts (XOR dual-mount), unit-box body detection, source tags.
 *
 * claimScope: roomProp → buildDeclaredEquipmentGeometry when a builder arm exists.
 * notEvidenceFor: clinical staging, Quest readiness, art realism of furniture.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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

export const ISSUE_185_EVIDENCE_DIR = ".openclinxr/evidence/issue-185";
export const PRE_FIX_NAME = "pre-fix.json";
export const GRADE_PNG_NAME = "room-props-grade.png";

export type PropRender = {
  scenarioId: string;
  propId: string;
  hasBuilder: boolean;
  mountedRootCount: number;
  bodyMeshCount: number;
  triangleCount: number;
  sourceTag: string;
  isUnitBoxBody: boolean;
};

export type RoomPropBuilderReport = {
  props: PropRender[];
  builderArmIds: string[];
  preFixRenderedPropIds: string[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.room-prop-uses-real-builder.v1";
  kind: "room_prop_builder_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  /** Flat pre-fix table rows (one per declared prop id). */
  rows: Array<{
    propId: string;
    hasBuilder: boolean;
    mountedRootCount: number;
    bodyMeshCount: number;
    triangleCount: number;
    sourceTag: string;
    isUnitBoxBody: boolean;
    scenarioId: string;
  }>;
  report: RoomPropBuilderReport;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");
const buildersPath = path.join(
  repoRoot,
  "apps/ui-xr/src/station-equipment-builders.ts",
);

let cachedReport: RoomPropBuilderReport | null = null;
let measureInFlight: Promise<RoomPropBuilderReport> | null = null;

/** Discover `case "…"` arms from station-equipment-builders (no hardcoded list). */
export async function listDeclaredEquipmentBuilderArms(): Promise<string[]> {
  const src = await readFile(buildersPath, "utf8");
  const ids = new Set<string>();
  for (const match of src.matchAll(/case\s+"([a-z0-9_]+_equipment)"/gu)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids].sort();
}

/** Keep in sync with apps/ui-xr/src/station-equipment.ts ROOM_PROP_BUILDER_ALIASES. */
const ROOM_PROP_BUILDER_ALIASES: Readonly<Record<string, string>> = {
  "safe-room-soft-chair": "safe_room_chair_equipment",
  safe_room_soft_chair: "safe_room_chair_equipment",
  "telehealth-tablet-stand": "tablet_visit_equipment",
  telehealth_tablet_stand: "tablet_visit_equipment",
  "observer-station": "observation_station_equipment",
  observer_station: "observation_station_equipment",
  "safety-plan-whiteboard": "safety_plan_whiteboard_equipment",
  safety_plan_whiteboard: "safety_plan_whiteboard_equipment",
  "ekg-leads-on-bed": "ekg_leads_on_bed_equipment",
  ekg_leads_on_bed: "ekg_leads_on_bed_equipment",
  "chest-pain-monitor": "monitor_equipment",
  chest_pain_monitor: "monitor_equipment",
  "handoff-whiteboard": "safety_plan_whiteboard_equipment",
  handoff_whiteboard: "safety_plan_whiteboard_equipment",
  "parent-coaching-chair": "parent_chair_equipment",
  parent_coaching_chair: "parent_chair_equipment",
  "pediatric-pulse-ox-monitor": "pulse_oximeter_equipment",
  pediatric_pulse_ox_monitor: "pulse_oximeter_equipment",
  "pediatric-nebulizer-station": "nebulizer_mask_equipment",
  pediatric_nebulizer_station: "nebulizer_mask_equipment",
};

export function resolveRoomPropBuilderEquipmentId(
  propId: string,
  armSet: ReadonlySet<string> | readonly string[],
): string | null {
  if (!propId) return null;
  const arms = armSet instanceof Set ? armSet : new Set(armSet);
  if (arms.has(propId)) return propId;
  const alias = ROOM_PROP_BUILDER_ALIASES[propId] ?? ROOM_PROP_BUILDER_ALIASES[propId.replace(/-/gu, "_")];
  if (alias && arms.has(alias)) return alias;
  const normalized = propId.replace(/-/gu, "_");
  if (arms.has(normalized)) return normalized;
  if (!normalized.endsWith("_equipment")) {
    const withSuffix = `${normalized}_equipment`;
    if (arms.has(withSuffix)) return withSuffix;
  }
  return null;
}

function preFixPath(): string {
  return path.join(ISSUE_185_EVIDENCE_DIR, PRE_FIX_NAME);
}

function gradePngPath(): string {
  return path.join(ISSUE_185_EVIDENCE_DIR, GRADE_PNG_NAME);
}

export async function listShippedScenarioIdsWithRoomProps(): Promise<string[]> {
  if (!existsSync(generatedRoot)) return [];
  const entries = await readdir(generatedRoot, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(generatedRoot, entry.name, "scene-manifest.v1.json");
    if (!existsSync(manifestPath)) continue;
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
      roomProps?: unknown[];
    };
    if (Array.isArray(raw.roomProps) && raw.roomProps.length > 0) ids.push(entry.name);
  }
  return ids.sort();
}

export async function readRoomPropIds(scenarioId: string): Promise<string[]> {
  const { classifyRoomProp } = await import("../../../apps/ui-xr/src/room-prop-classification.js");
  const manifestPath = path.join(generatedRoot, scenarioId, "scene-manifest.v1.json");
  if (!existsSync(manifestPath)) return [];
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    roomProps?: Array<{ propId?: string; label?: string; semanticRole?: string | null }>;
  };
  const ids: string[] = [];
  for (const prop of raw.roomProps ?? []) {
    if (!prop.propId) continue;
    // #223: cue/overlay props are not furniture-channel subjects for this contract.
    // They keep affordance tags without unit-box geometry; #185 (3) measures physical only.
    const cls = classifyRoomProp(prop.propId, {
      label: prop.label ?? null,
      semanticRole: prop.semanticRole ?? null,
    });
    if (cls.classification === "cue_or_overlay") continue;
    ids.push(prop.propId);
  }
  return ids;
}

/**
 * Signature consumed by room-prop-uses-real-builder.test.ts planted contracts.
 */
export async function inspectRoomPropUsesRealBuilder(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
  writeGradePng?: boolean;
}): Promise<RoomPropBuilderReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_ROOM_PROP_BUILDER_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const builderArmIds = await listDeclaredEquipmentBuilderArms();
    const report = await measureLive({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
      writeGradePng: input?.writeGradePng === true,
      builderArmIds,
    });

    // #228: baseline from tracked manifests (physical props). Not gitignored pre-fix.
    const preFixIds = await loadPreFixRenderedPropIds();
    if (preFixIds.length > 0) {
      report.preFixRenderedPropIds = preFixIds;
    }

    if (input?.writePreFix) {
      // Still write a dump for local calibration, but contract baseline prefers manifests.
      if (report.preFixRenderedPropIds.length === 0) {
        report.preFixRenderedPropIds = [...new Set(report.props.map((p) => p.propId))].sort();
      }
      await writeDump(report, {
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

/**
 * #228 / #223 — baseline must come from TRACKED scene manifests, not a gitignored
 * pre-fix snapshot under .openclinxr/evidence. Only physical (non-cue) prop ids are
 * required to keep rendering geometry; cues are affordance-only after #223.
 */
export async function listTrackedManifestRenderablePropIds(): Promise<string[]> {
  const { classifyRoomProp } = await import("../../../apps/ui-xr/src/room-prop-classification.js");
  const scenarios = await listShippedScenarioIdsWithRoomProps();
  const ids = new Set<string>();
  for (const scenarioId of scenarios) {
    const propIds = await readRoomPropIds(scenarioId);
    for (const propId of propIds) {
      const cls = classifyRoomProp(propId);
      if (cls.classification === "physical_object") ids.add(propId);
    }
  }
  return [...ids].sort();
}

async function loadPreFixRenderedPropIds(): Promise<string[]> {
  // Prefer tracked manifests (clean-clone safe). Fall back to legacy pre-fix file only
  // when manifests are empty (dev without generated assets).
  const fromManifests = await listTrackedManifestRenderablePropIds();
  if (fromManifests.length > 0) return fromManifests;

  if (!existsSync(preFixPath())) return [];
  try {
    const raw = JSON.parse(await readFile(preFixPath(), "utf8")) as {
      report?: RoomPropBuilderReport;
      rows?: Array<{ propId?: string }>;
    };
    if (Array.isArray(raw.report?.preFixRenderedPropIds) && raw.report!.preFixRenderedPropIds.length > 0) {
      return raw.report!.preFixRenderedPropIds;
    }
    if (Array.isArray(raw.report?.props)) {
      return [...new Set(raw.report!.props.map((p) => p.propId))].sort();
    }
    if (Array.isArray(raw.rows)) {
      return [...new Set(raw.rows.map((r) => r.propId).filter((id): id is string => Boolean(id)))].sort();
    }
  } catch {
    // ignore
  }
  return [];
}

async function tryReadArtifact(filePath: string): Promise<RoomPropBuilderReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as RoomPropBuilderReport | undefined;
    if (report?.props && Array.isArray(report.props) && report.builderArmIds?.length) {
      return report;
    }
    return null;
  });
}

export async function writeDump(
  report: RoomPropBuilderReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.room-prop-uses-real-builder.v1" as const,
    kind: "room_prop_builder_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "scene_manifest_roomProps",
      "buildDeclaredEquipmentGeometry_case_arms",
      "live_openClinXrEquipmentId_roots",
      "unit_box_body_detection",
    ],
    notEvidenceFor: [
      "clinical_staging",
      "quest_readiness",
      "furniture_art_realism",
      "scoring_validity",
    ],
    rows: report.props.map((p) => ({
      propId: p.propId,
      hasBuilder: p.hasBuilder,
      mountedRootCount: p.mountedRootCount,
      bodyMeshCount: p.bodyMeshCount,
      triangleCount: p.triangleCount,
      sourceTag: p.sourceTag,
      isUnitBoxBody: p.isUnitBoxBody,
      scenarioId: p.scenarioId,
    })),
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`room-prop-uses-real-builder: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLive(input: {
  baseUrl?: string;
  scenarioIds?: string[];
  writeGradePng?: boolean;
  builderArmIds: string[];
}): Promise<RoomPropBuilderReport> {
  const builderArmIds = input.builderArmIds;
  const armSet = new Set(builderArmIds);
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : await listShippedScenarioIdsWithRoomProps();

  if (scenarios.length === 0) {
    throw new Error("inspectRoomPropUsesRealBuilder: no scenarios with roomProps");
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
        const props: PropRender[] = [];
        let gradeScenario: string | null = null;

        for (const scenarioId of scenarios) {
          process.stdout.write(`room-prop-uses-real-builder: goto ${scenarioId}\n`);
          const declaredPropIds = await readRoomPropIds(scenarioId);
          if (declaredPropIds.length === 0) continue;

          // Prefer a station with ≥2 builder-backed props for the grade capture.
          const backedCount = declaredPropIds.filter(
            (id) => resolveRoomPropBuilderEquipmentId(id, armSet) !== null,
          ).length;
          if (backedCount >= 2 && !gradeScenario) gradeScenario = scenarioId;
          if (!gradeScenario && backedCount >= 1) gradeScenario = scenarioId;
          if (!gradeScenario) gradeScenario = scenarioId;

          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await page.waitForFunction(
            () => {
              const win = window as unknown as {
                __openClinXrFrameStats?: { framesObserved?: number };
              };
              return (win.__openClinXrFrameStats?.framesObserved ?? 0) >= 6;
            },
            undefined,
            { timeout: 120_000 },
          );
          await page.waitForTimeout(800);

          const live = await readLivePropsFromPage(page, declaredPropIds, builderArmIds);
          for (const row of live) {
            props.push({ ...row, scenarioId: row.scenarioId || scenarioId });
          }
          process.stdout.write(
            `  ${scenarioId} props=${live.map((p) => `${p.propId}:builder=${p.hasBuilder}/box=${p.isUnitBoxBody}/src=${p.sourceTag}/roots=${p.mountedRootCount}`).join("; ")}\n`,
          );
        }

        if (input.writeGradePng && gradeScenario) {
          await captureGradePng(page, baseUrl, gradeScenario);
        }

        return {
          props,
          builderArmIds,
          preFixRenderedPropIds: [],
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

async function captureGradePng(page: Page, baseUrl: string, scenarioId: string): Promise<void> {
  await mkdir(ISSUE_185_EVIDENCE_DIR, { recursive: true });
  const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
  await page.goto(url, { waitUntil: "load", timeout: 180_000 });
  await waitForStationShell(page, 180_000);
  await page.waitForTimeout(1200);
  // Frame builder-backed props (ED monitor at ~-1.55,1.42,-1.15) — not doorway-only (#191).
  await page.evaluate(`(() => {
    const win = window;
    const cam = win.__openClinXrDebugCamera || win.__openClinXrCamera;
    if (cam && cam.position) {
      cam.position.set(0.2, 1.45, 0.55);
      if (typeof cam.lookAt === "function") cam.lookAt(-1.4, 1.15, -0.95);
      cam.updateMatrixWorld && cam.updateMatrixWorld(true);
    }
  })()`);
  await page.waitForTimeout(400);
  const out = gradePngPath();
  await page.screenshot({ path: out, type: "png" });
  process.stdout.write(`room-prop-uses-real-builder: wrote grade ${out}\n`);
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 */
async function readLivePropsFromPage(
  page: Page,
  declaredPropIds: string[],
  builderArmIds: string[],
): Promise<PropRender[]> {
  const armJson = JSON.stringify(builderArmIds);
  const declaredJson = JSON.stringify(declaredPropIds);
  return page.evaluate(`((builderArmIds, declaredPropIds) => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    const armSet = {};
    for (let i = 0; i < builderArmIds.length; i++) armSet[builderArmIds[i]] = true;

    var aliases = {
      "safe-room-soft-chair": "safe_room_chair_equipment",
      "telehealth-tablet-stand": "tablet_visit_equipment",
      "observer-station": "observation_station_equipment",
      "safety-plan-whiteboard": "safety_plan_whiteboard_equipment",
      "ekg-leads-on-bed": "ekg_leads_on_bed_equipment",
      "chest-pain-monitor": "monitor_equipment",
      "handoff-whiteboard": "safety_plan_whiteboard_equipment",
      "parent-coaching-chair": "parent_chair_equipment",
      "pediatric-pulse-ox-monitor": "pulse_oximeter_equipment",
      "pediatric-nebulizer-station": "nebulizer_mask_equipment"
    };
    function resolveBuilderId(propId) {
      if (armSet[propId]) return propId;
      if (aliases[propId] && armSet[aliases[propId]]) return aliases[propId];
      var norm = String(propId).replace(/-/g, "_");
      if (aliases[norm] && armSet[aliases[norm]]) return aliases[norm];
      if (armSet[norm]) return norm;
      if (!/_equipment$/.test(norm) && armSet[norm + "_equipment"]) return norm + "_equipment";
      return null;
    }

    function countGeometry(root) {
      var meshCount = 0;
      var triangleCount = 0;
      var unitBoxBodies = 0;
      if (!root || typeof root.traverse !== "function") {
        return { meshCount: 0, triangleCount: 0, unitBoxBodies: 0 };
      }
      root.traverse(function (obj) {
        if (!obj || !obj.isMesh || !obj.geometry) return;
        // Skip markers / nameplates
        var n = typeof obj.name === "string" ? obj.name : "";
        if (n.indexOf(".label") >= 0 || n.indexOf("glb-affordance") >= 0 || n.indexOf("nameplate") >= 0) return;
        meshCount += 1;
        var g = obj.geometry;
        var pos = g.attributes && g.attributes.position;
        var vertCount = pos && typeof pos.count === "number" ? pos.count : 0;
        // BoxGeometry default is 8 unique corners; BufferGeometry may expand.
        if (vertCount === 8 || vertCount === 24) {
          // Prefer parameter-backed box detection when present
          if (g.type === "BoxGeometry" || (g.parameters && g.parameters.width === 1 && g.parameters.height === 1 && g.parameters.depth === 1)) {
            unitBoxBodies += 1;
          } else if (vertCount === 8 || vertCount === 24) {
            // scaled BoxGeometry often has 24 verts (non-indexed)
            unitBoxBodies += 1;
          }
        }
        if (g.index && typeof g.index.count === "number") {
          triangleCount += Math.floor(g.index.count / 3);
        } else if (vertCount > 0) {
          triangleCount += Math.floor(vertCount / 3);
        }
      });
      return { meshCount: meshCount, triangleCount: triangleCount, unitBoxBodies: unitBoxBodies };
    }

    function objectCarriesId(object, equipmentId) {
      var ud = object.userData || {};
      if (ud.openClinXrEquipmentId === equipmentId) return true;
      // #209 fixture stamp may fulfill via aliases.
      if (Array.isArray(ud.openClinXrEquipmentIdAliases)) {
        for (var ai = 0; ai < ud.openClinXrEquipmentIdAliases.length; ai++) {
          if (ud.openClinXrEquipmentIdAliases[ai] === equipmentId) return true;
        }
      }
      return false;
    }

    function rootsForId(equipmentId) {
      var roots = [];
      if (!scene || typeof scene.traverse !== "function") return roots;
      scene.traverse(function (object) {
        if (!objectCarriesId(object, equipmentId)) return;
        var ancestorHas = false;
        var p = object.parent;
        var depth = 0;
        while (p && depth < 10) {
          if (objectCarriesId(p, equipmentId)) {
            ancestorHas = true;
            break;
          }
          p = p.parent;
          depth += 1;
        }
        if (!ancestorHas) roots.push(object);
      });
      return roots;
    }

    var rows = [];
    for (var i = 0; i < declaredPropIds.length; i++) {
      var propId = declaredPropIds[i];
      var builderId = resolveBuilderId(propId);
      var hasBuilder = builderId !== null;
      var roots = rootsForId(propId);
      // Also count roots tagged with the resolved builder arm (equipment channel).
      // Dedup by object identity: a fixture stamped with both propId alias and builder
      // equipmentId is ONE root (#223 / psych safe-room-soft-chair).
      if (builderId && builderId !== propId) {
        var extra = rootsForId(builderId);
        for (var e = 0; e < extra.length; e++) {
          if (roots.indexOf(extra[e]) < 0) roots.push(extra[e]);
        }
      }
      var bodyMeshCount = 0;
      var triangleCount = 0;
      var unitBoxFlags = 0;
      var sourceTag = "none";
      for (var r = 0; r < roots.length; r++) {
        var c = countGeometry(roots[r]);
        bodyMeshCount += c.meshCount;
        triangleCount += c.triangleCount;
        unitBoxFlags += c.unitBoxBodies;
        var sud = roots[r].userData || {};
        if (typeof sud.openClinXrEquipmentSource === "string") {
          sourceTag = sud.openClinXrEquipmentSource;
        }
      }
      // Unit box body: a single box body mesh (plus optional decoration) — flag when
      // every measured body mesh is a unit box OR the only body is a scaled box.
      var isUnitBoxBody = roots.length > 0 && bodyMeshCount > 0 && unitBoxFlags >= 1 && unitBoxFlags >= Math.max(1, bodyMeshCount - 6);
      // Stricter: primary body is unit box when source is fallback and mesh count is low decoration.
      if (sourceTag === "fallback" && bodyMeshCount >= 1 && unitBoxFlags >= 1) {
        isUnitBoxBody = true;
      }
      if (sourceTag === "parametric" || sourceTag === "gltf") {
        isUnitBoxBody = false;
      }
      rows.push({
        scenarioId: scenarioId,
        propId: propId,
        hasBuilder: hasBuilder,
        mountedRootCount: roots.length,
        bodyMeshCount: bodyMeshCount,
        triangleCount: triangleCount,
        sourceTag: sourceTag,
        isUnitBoxBody: isUnitBoxBody,
      });
    }
    return rows;
  })(${armJson}, ${declaredJson})`) as Promise<PropRender[]>;
}

// CLI
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const writePreFix = process.argv.includes("--write-pre-fix");
  const writeGrade = process.argv.includes("--write-grade");
  const force = process.argv.includes("--force");
  inspectRoomPropUsesRealBuilder({
    writePreFix,
    writeGradePng: writeGrade,
    force: force || writePreFix || writeGrade,
    label: writePreFix ? "pre-fix" : "cli",
  })
    .then((report) => {
      process.stdout.write(
        JSON.stringify(
          {
            propCount: report.props.length,
            builderArms: report.builderArmIds.length,
            backed: report.props.filter((p) => p.hasBuilder).length,
            boxes: report.props.filter((p) => p.hasBuilder && p.isUnitBoxBody).length,
            dual: report.props.filter((p) => p.mountedRootCount > 1).length,
            preFixIds: report.preFixRenderedPropIds.length,
          },
          null,
          2,
        ) + "\n",
      );
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
