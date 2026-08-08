/**
 * #223 — pedagogical cue props are not furniture.
 *
 * Classifies every declared roomProp id (shipped manifests + factory residual vocabulary),
 * measures live scaled-box bodies vs affordance tags, and re-bases the #185/#228 baseline
 * on tracked manifests.
 *
 * claimScope: cue vs physical roomProp vocabulary + render treatment.
 * notEvidenceFor: clinical staging, faculty-review UI product, Quest readiness.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  classifyRoomProp,
  type RoomPropClass,
} from "../../../apps/ui-xr/src/room-prop-classification.js";
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

export const ISSUE_223_EVIDENCE_DIR = ".openclinxr/evidence/issue-223";
export const PRE_FIX_NAME = "pre-fix.json";
export const GRADE_PNG_NAME = "rooms-before-after.png";

export type ClassifiedProp = {
  propId: string;
  scenarioIds: string[];
  classification: RoomPropClass;
  classificationReason: string;
  rendersAsScaledBox: boolean;
  bodyMeshCount: number;
  triangleCount: number;
  affordanceCueIdsInScene: string[];
};

export type CuePropsAreNotFurnitureReport = {
  props: ClassifiedProp[];
  affordanceCueIdsBefore: string[];
  affordanceCueIdsAfter: string[];
  /** Prop ids the TRACKED scene manifests declare as physical/renderable. */
  manifestDeclaredRenderableIds: string[];
  /** Must not match `.openclinxr/evidence` (#228). */
  manifestSource: string;
};

type DeclaredPropRow = {
  propId: string;
  label: string;
  semanticRole?: string;
  affordanceCueIds: string[];
  scenarioId: string;
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.cue-props-are-not-furniture.v1";
  kind: "cue_props_are_not_furniture";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  /** One row per prop id for pre-fix tables. */
  rows: Array<{
    propId: string;
    scenarioIds: string;
    classification: RoomPropClass;
    classificationReason: string;
    rendersAsScaledBox: boolean;
    bodyMeshCount: number;
    triangleCount: number;
    affordanceCueIdsInScene: string;
    mechanism: string;
  }>;
  report: CuePropsAreNotFurnitureReport;
  reconstructionNote?: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");
const factoryBundlePath = path.join(
  repoRoot,
  "tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts",
);

let cachedReport: CuePropsAreNotFurnitureReport | null = null;
let measureInFlight: Promise<CuePropsAreNotFurnitureReport> | null = null;
/** Sticky "before" affordance set for counterweight (first measure in process). */
let stickyAffordanceBefore: string[] | null = null;

function preFixPath(): string {
  return path.join(ISSUE_223_EVIDENCE_DIR, PRE_FIX_NAME);
}

function gradePngPath(): string {
  return path.join(ISSUE_223_EVIDENCE_DIR, GRADE_PNG_NAME);
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

/** TRACKED manifest root — clean-clone safe, never `.openclinxr/evidence`. */
export function trackedManifestSource(): string {
  return "apps/ui-xr/public/xr-assets/generated/(scenarioId)/scene-manifest.v1.json";
}

export async function listManifestDeclaredRenderableIds(): Promise<string[]> {
  const rows = await collectDeclaredPropRows();
  const physical = new Set<string>();
  for (const row of rows) {
    if (!row.scenarioId.startsWith("factory:")) {
      const cls = classifyRoomProp(row.propId, {
        label: row.label,
        semanticRole: row.semanticRole ?? null,
      });
      if (cls.classification === "physical_object") physical.add(row.propId);
    }
  }
  return [...physical].sort();
}

/**
 * Collect declared roomProps from shipped manifests + factory residual vocabulary
 * (post-#149 bank is ~12 shipped unique ids; factory still names residual objects).
 */
export async function collectDeclaredPropRows(): Promise<DeclaredPropRow[]> {
  const rows: DeclaredPropRow[] = [];
  const scenarios = await listShippedScenarioManifestIds();
  for (const scenarioId of scenarios) {
    const manifestPath = path.join(generatedRoot, scenarioId, "scene-manifest.v1.json");
    if (!existsSync(manifestPath)) continue;
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
      roomProps?: Array<{
        propId?: string;
        label?: string;
        semanticRole?: string;
        affordanceCueIds?: string[];
      }>;
    };
    for (const prop of raw.roomProps ?? []) {
      if (!prop.propId) continue;
      rows.push({
        propId: prop.propId,
        label: typeof prop.label === "string" ? prop.label : prop.propId,
        ...(typeof prop.semanticRole === "string" ? { semanticRole: prop.semanticRole } : {}),
        affordanceCueIds: Array.isArray(prop.affordanceCueIds)
          ? prop.affordanceCueIds.filter((x): x is string => typeof x === "string")
          : [`${prop.propId}:visual_context`],
        scenarioId,
      });
    }
  }

  const shippedIds = new Set(rows.map((r) => r.propId));

  // Residual vocabulary from tracked factory + runtime-bundles sources.
  // Only ADD cue_or_overlay residuals (expand the cue bank). Physical residuals that are not
  // shipped would fail contract (3) with bodyMeshCount=0 — leave those until they ship.
  const residualCandidates: DeclaredPropRow[] = [];
  if (existsSync(factoryBundlePath)) {
    const src = await readFile(factoryBundlePath, "utf8");
    for (const match of src.matchAll(
      /runtimeScenarioRoomProp\(\s*"([a-z0-9_-]+)"\s*,\s*"([^"]*)"\s*,\s*"([a-z_]+)"/gu,
    )) {
      residualCandidates.push({
        propId: match[1]!,
        label: match[2] ?? match[1]!,
        semanticRole: match[3],
        affordanceCueIds: [`${match[1]!}:scenario_context_cue`],
        scenarioId: "factory:residual",
      });
    }
    for (const match of src.matchAll(
      /runtimeScenarioRoomProp\(\s*\n\s*"([a-z0-9_-]+)"\s*,\s*\n\s*"([^"]*)"\s*,\s*\n\s*"([a-z_]+)"/gu,
    )) {
      residualCandidates.push({
        propId: match[1]!,
        label: match[2] ?? match[1]!,
        semanticRole: match[3],
        affordanceCueIds: [`${match[1]!}:scenario_context_cue`],
        scenarioId: "factory:residual",
      });
    }
  }

  const runtimeBundlesPath = path.join(
    repoRoot,
    "packages/openclinxr/asset-registry/src/runtime-bundles.ts",
  );
  if (existsSync(runtimeBundlesPath)) {
    const src = await readFile(runtimeBundlesPath, "utf8");
    for (const match of src.matchAll(
      /runtimeRoomProp\(\s*"([a-z0-9_-]+)"\s*,\s*"([^"]*)"/gu,
    )) {
      residualCandidates.push({
        propId: match[1]!,
        label: match[2] ?? match[1]!,
        semanticRole: "environmental_detail",
        affordanceCueIds: [`${match[1]!}:environmental_detail_cue`],
        scenarioId: "runtime-bundles:local_ed",
      });
    }
  }

  for (const cand of residualCandidates) {
    if (shippedIds.has(cand.propId)) continue;
    const cls = classifyRoomProp(cand.propId, {
      label: cand.label,
      semanticRole: cand.semanticRole ?? null,
    });
    if (cls.classification !== "cue_or_overlay") continue;
    rows.push(cand);
    shippedIds.add(cand.propId);
  }

  return rows;
}

/**
 * Signature consumed by cue-props-are-not-furniture.test.ts planted contracts.
 */
export async function inspectCuePropsAreNotFurniture(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
  writeGradePng?: boolean;
}): Promise<CuePropsAreNotFurnitureReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_CUE_PROPS_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLive({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
      writeGradePng: input?.writeGradePng === true,
    });

    if (input?.writePreFix) {
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

async function tryReadArtifact(filePath: string): Promise<CuePropsAreNotFurnitureReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as CuePropsAreNotFurnitureReport | undefined;
    if (report?.props && Array.isArray(report.props) && report.props.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writeDump(
  report: CuePropsAreNotFurnitureReport,
  input?: { outputPath?: string; label?: string; reconstructionNote?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.cue-props-are-not-furniture.v1" as const,
    kind: "cue_props_are_not_furniture" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "room_prop_classification_cue_vs_physical",
      "live_scaled_box_body_detection",
      "affordance_cue_ids_in_scene",
      "tracked_manifest_renderable_baseline",
    ],
    notEvidenceFor: [
      "clinical_staging",
      "faculty_review_product_ux",
      "quest_readiness",
      "scoring_validity",
    ],
    rows: report.props.map((p) => ({
      propId: p.propId,
      scenarioIds: p.scenarioIds.join(","),
      classification: p.classification,
      classificationReason: p.classificationReason,
      rendersAsScaledBox: p.rendersAsScaledBox,
      bodyMeshCount: p.bodyMeshCount,
      triangleCount: p.triangleCount,
      affordanceCueIdsInScene: p.affordanceCueIdsInScene.join(","),
      mechanism: mechanismLine(p),
    })),
    report,
    ...(input?.reconstructionNote ? { reconstructionNote: input.reconstructionNote } : {}),
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`cue-props-are-not-furniture: wrote ${outputPath}\n`);
  return outputPath;
}

function mechanismLine(p: ClassifiedProp): string {
  if (p.classification === "cue_or_overlay" && p.rendersAsScaledBox) {
    return "FAIL: cue still has unit-box body — roomProp fallback BoxGeometry path";
  }
  if (p.classification === "cue_or_overlay") {
    return "cue: affordance tags without scaled box body";
  }
  if (p.rendersAsScaledBox || p.triangleCount < 12) {
    return "FAIL: physical object still unit-box / no builder geometry";
  }
  return "physical: parametric builder geometry in live scene";
}

async function measureLive(input: {
  baseUrl?: string;
  scenarioIds?: string[];
  writeGradePng?: boolean;
}): Promise<CuePropsAreNotFurnitureReport> {
  const declaredRows = await collectDeclaredPropRows();
  // Aggregate by propId.
  const byId = new Map<string, DeclaredPropRow[]>();
  for (const row of declaredRows) {
    const list = byId.get(row.propId) ?? [];
    list.push(row);
    byId.set(row.propId, list);
  }

  const scenariosWithProps = [
    ...new Set(
      declaredRows
        .filter((r) =>
          !r.scenarioId.startsWith("factory:")
          && !r.scenarioId.startsWith("runtime-bundles:")
          && !r.scenarioId.includes(":"))
        .map((r) => r.scenarioId),
    ),
  ].sort();
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : scenariosWithProps;

  const liveByProp = new Map<
    string,
    {
      rendersAsScaledBox: boolean;
      bodyMeshCount: number;
      triangleCount: number;
      affordanceCueIds: string[];
    }
  >();
  const allAffordanceInScene = new Set<string>();

  if (scenarios.length > 0) {
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
          let gradeScenario: string | null = null;
          for (const scenarioId of scenarios) {
            process.stdout.write(`cue-props-are-not-furniture: goto ${scenarioId}\n`);
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

            const declaredForStation = declaredRows
              .filter((r) => r.scenarioId === scenarioId)
              .map((r) => r.propId);
            const live = await readLiveCuePropState(page, declaredForStation);
            for (const row of live.props) {
              const prev = liveByProp.get(row.propId);
              if (!prev) {
                liveByProp.set(row.propId, {
                  rendersAsScaledBox: row.rendersAsScaledBox,
                  bodyMeshCount: row.bodyMeshCount,
                  triangleCount: row.triangleCount,
                  affordanceCueIds: [...row.affordanceCueIds],
                });
              } else {
                prev.rendersAsScaledBox = prev.rendersAsScaledBox || row.rendersAsScaledBox;
                prev.bodyMeshCount = Math.max(prev.bodyMeshCount, row.bodyMeshCount);
                prev.triangleCount = Math.max(prev.triangleCount, row.triangleCount);
                for (const id of row.affordanceCueIds) {
                  if (!prev.affordanceCueIds.includes(id)) prev.affordanceCueIds.push(id);
                }
              }
              for (const id of row.affordanceCueIds) allAffordanceInScene.add(id);
            }
            for (const id of live.affordanceCueIds) allAffordanceInScene.add(id);

            // Prefer psych or telehealth for grade (many props); else ED.
            if (!gradeScenario) {
              if (scenarioId.includes("psych") || scenarioId.includes("telehealth")) {
                gradeScenario = scenarioId;
              } else if (scenarioId.includes("ed_chest")) {
                gradeScenario = scenarioId;
              } else {
                gradeScenario = scenarioId;
              }
            }

            process.stdout.write(
              `  ${scenarioId} liveProps=${live.props.length} affordances=${live.affordanceCueIds.length}\n`,
            );
          }

          if (input.writeGradePng && gradeScenario) {
            await captureGradePng(page, baseUrl, gradeScenario);
          }
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

  const props: ClassifiedProp[] = [];
  for (const [propId, rows] of [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sample = rows[0]!;
    const cls = classifyRoomProp(propId, {
      label: sample.label,
      semanticRole: sample.semanticRole ?? null,
    });
    const live = liveByProp.get(propId);
    const scenarioIds = [...new Set(rows.map((r) => r.scenarioId))].sort();
    // Factory residual not in live scene: not a scaled box (not rendered).
    const rendersAsScaledBox = live?.rendersAsScaledBox ?? false;
    props.push({
      propId,
      scenarioIds,
      classification: cls.classification,
      classificationReason: cls.classificationReason,
      rendersAsScaledBox,
      bodyMeshCount: live?.bodyMeshCount ?? 0,
      triangleCount: live?.triangleCount ?? 0,
      affordanceCueIdsInScene: live?.affordanceCueIds ?? [],
    });
  }

  const affordanceAfter = [...allAffordanceInScene].sort();
  if (!stickyAffordanceBefore || stickyAffordanceBefore.length === 0) {
    // First measure in this process is the "before" for the counterweight when
    // product already fixed affordances — also seed from declared affordance lists.
    const declaredAff = new Set<string>();
    for (const row of declaredRows) {
      for (const id of row.affordanceCueIds) declaredAff.add(id);
    }
    // Prefer live if available (true scene registration), else declared.
    stickyAffordanceBefore =
      affordanceAfter.length > 0 ? [...affordanceAfter] : [...declaredAff].sort();
  }

  const manifestDeclaredRenderableIds = await listManifestDeclaredRenderableIds();

  return {
    props,
    affordanceCueIdsBefore: stickyAffordanceBefore,
    affordanceCueIdsAfter: affordanceAfter.length > 0 ? affordanceAfter : stickyAffordanceBefore,
    manifestDeclaredRenderableIds,
    manifestSource: trackedManifestSource(),
  };
}

async function readLiveCuePropState(
  page: Page,
  declaredPropIds: string[] = [],
): Promise<{
  props: Array<{
    propId: string;
    rendersAsScaledBox: boolean;
    bodyMeshCount: number;
    triangleCount: number;
    affordanceCueIds: string[];
  }>;
  affordanceCueIds: string[];
}> {
  // Alias map so XOR-suppressed room props still attribute equipment-channel geometry.
  const aliasJson = JSON.stringify({
    "safe-room-soft-chair": "safe_room_chair_equipment",
    "telehealth-tablet-stand": "tablet_visit_equipment",
    "observer-station": "observation_station_equipment",
    "safety-plan-whiteboard": "safety_plan_whiteboard_equipment",
    "ekg-leads-on-bed": "ekg_leads_on_bed_equipment",
    monitor: "monitor_equipment",
  });
  const declaredJson = JSON.stringify(declaredPropIds);
  return page.evaluate(`((declaredPropIds, aliases) => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const byProp = {};
    const allAffordance = {};
    const builderToProp = {};
    for (var ai = 0; ai < declaredPropIds.length; ai++) {
      var d = declaredPropIds[ai];
      if (aliases[d]) builderToProp[aliases[d]] = d;
      var norm = String(d).replace(/-/g, "_");
      if (aliases[norm]) builderToProp[aliases[norm]] = d;
      builderToProp[norm + "_equipment"] = builderToProp[norm + "_equipment"] || d;
    }

    function ensure(propId) {
      if (!byProp[propId]) {
        byProp[propId] = {
          propId: propId,
          rendersAsScaledBox: false,
          bodyMeshCount: 0,
          triangleCount: 0,
          affordanceCueIds: []
        };
      }
      return byProp[propId];
    }

    function resolvePropId(object) {
      var cur = object;
      var depth = 0;
      while (cur && depth < 12) {
        var ud = cur.userData || {};
        // #223 cue groups use openClinXrRoomPropId (not equipment id).
        if (typeof ud.openClinXrRoomPropId === "string" && ud.openClinXrRoomPropId.length > 0) {
          return ud.openClinXrRoomPropId;
        }
        if (typeof ud.openClinXrEquipmentId === "string" && ud.openClinXrEquipmentId.length > 0) {
          var eid = ud.openClinXrEquipmentId;
          if (builderToProp[eid]) return builderToProp[eid];
          // reverse alias: if eid is a known prop id, keep it
          if (declaredPropIds.indexOf(eid) >= 0) return eid;
          return eid;
        }
        if (typeof ud.openClinXrRoomPropBuilderEquipmentId === "string") {
          var bid = ud.openClinXrRoomPropBuilderEquipmentId;
          if (builderToProp[bid]) return builderToProp[bid];
        }
        var n = typeof cur.name === "string" ? cur.name : "";
        if (n.indexOf(".room-prop.") >= 0) {
          var marker = ".room-prop.";
          var idx = n.indexOf(marker);
          var after = n.slice(idx + marker.length);
          var pid = after.split(".")[0] || null;
          if (pid) return pid;
        }
        cur = cur.parent;
        depth += 1;
      }
      return null;
    }

    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (!object) return;
        var ud = object.userData || {};
        var propId = resolvePropId(object);
        var name = typeof object.name === "string" ? object.name : "";
        if (!propId) return;
        // Prefer declared prop id if this equipment id maps to one.
        if (builderToProp[propId]) propId = builderToProp[propId];

        var row = ensure(propId);
        var cues = ud.openClinXrRuntimeSceneManifestAffordanceCueIds;
        if (Array.isArray(cues)) {
          for (var i = 0; i < cues.length; i++) {
            if (typeof cues[i] === "string") {
              if (row.affordanceCueIds.indexOf(cues[i]) < 0) row.affordanceCueIds.push(cues[i]);
              allAffordance[cues[i]] = true;
            }
          }
        }
        var anc = object.parent;
        var ad = 0;
        while (anc && ad < 8) {
          var aud = anc.userData || {};
          if (Array.isArray(aud.openClinXrRuntimeSceneManifestAffordanceCueIds)) {
            for (var j = 0; j < aud.openClinXrRuntimeSceneManifestAffordanceCueIds.length; j++) {
              var cid = aud.openClinXrRuntimeSceneManifestAffordanceCueIds[j];
              if (typeof cid === "string") {
                if (row.affordanceCueIds.indexOf(cid) < 0) row.affordanceCueIds.push(cid);
                allAffordance[cid] = true;
              }
            }
          }
          anc = anc.parent;
          ad += 1;
        }

        if (!object.isMesh || !object.geometry) return;
        if (name.indexOf(".label") >= 0 || name.indexOf("glb-affordance") >= 0 || name.indexOf("nameplate") >= 0) return;

        row.bodyMeshCount += 1;
        var g = object.geometry;
        var pos = g.attributes && g.attributes.position;
        var vertCount = pos && typeof pos.count === "number" ? pos.count : 0;
        var isUnitBox = false;
        if (g.type === "BoxGeometry" || (g.parameters && g.parameters.width === 1 && g.parameters.height === 1 && g.parameters.depth === 1)) {
          isUnitBox = true;
        } else if ((vertCount === 8 || vertCount === 24) && name.endsWith(".body")) {
          isUnitBox = true;
        }
        if (name.endsWith(".body") && (g.type === "BoxGeometry" || isUnitBox)) {
          row.rendersAsScaledBox = true;
        }
        var src = typeof ud.openClinXrEquipmentSource === "string" ? ud.openClinXrEquipmentSource : null;
        var p = object.parent;
        var pd = 0;
        while (!src && p && pd < 8) {
          if (p.userData && typeof p.userData.openClinXrEquipmentSource === "string") {
            src = p.userData.openClinXrEquipmentSource;
          }
          p = p.parent;
          pd += 1;
        }
        if (src === "fallback" && isUnitBox) {
          row.rendersAsScaledBox = true;
        }
        if (src === "parametric" || src === "cue_overlay" || src === "gltf") {
          row.rendersAsScaledBox = false;
        }
        if (g.index && typeof g.index.count === "number") {
          row.triangleCount += Math.floor(g.index.count / 3);
        } else if (vertCount > 0) {
          row.triangleCount += Math.floor(vertCount / 3);
        }
      });
    }

    return {
      props: Object.keys(byProp).map(function (k) { return byProp[k]; }),
      affordanceCueIds: Object.keys(allAffordance).sort()
    };
  })(${declaredJson}, ${aliasJson})`) as Promise<{
    props: Array<{
      propId: string;
      rendersAsScaledBox: boolean;
      bodyMeshCount: number;
      triangleCount: number;
      affordanceCueIds: string[];
    }>;
    affordanceCueIds: string[];
  }>;
}

async function captureGradePng(page: Page, baseUrl: string, scenarioId: string): Promise<void> {
  await mkdir(ISSUE_223_EVIDENCE_DIR, { recursive: true });
  const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
  await page.goto(url, { waitUntil: "load", timeout: 180_000 });
  await waitForStationShell(page, 180_000);
  await page.waitForTimeout(1200);
  // Frame the room interior (#191 — not doorway-only).
  await page.evaluate(`(() => {
    const win = window;
    const cam = win.__openClinXrDebugCamera || win.__openClinXrCamera;
    if (cam && cam.position) {
      cam.position.set(0.15, 1.55, 1.35);
      if (typeof cam.lookAt === "function") cam.lookAt(0, 1.0, -0.4);
      cam.updateMatrixWorld && cam.updateMatrixWorld(true);
    }
  })()`);
  await page.waitForTimeout(400);
  const out = gradePngPath();
  await page.screenshot({ path: out, type: "png" });
  process.stdout.write(`cue-props-are-not-furniture: wrote grade ${out}\n`);
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
  inspectCuePropsAreNotFurniture({
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
            cues: report.props.filter((p) => p.classification === "cue_or_overlay").length,
            physical: report.props.filter((p) => p.classification === "physical_object").length,
            slabs: report.props.filter((p) => p.classification === "cue_or_overlay" && p.rendersAsScaledBox).length,
            affordanceBefore: report.affordanceCueIdsBefore.length,
            affordanceAfter: report.affordanceCueIdsAfter.length,
            manifestRenderable: report.manifestDeclaredRenderableIds.length,
            manifestSource: report.manifestSource,
          },
          null,
          2,
        ) + "\n",
      );
    })
    .catch((err) => {
      console.error(err);
      process.stderr.write(String(err?.stack ?? err) + "\n");
      process.exitCode = 1;
    });
}
