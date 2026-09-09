/**
 * #179 — inpatient stations stage recumbent patients on existing support surfaces.
 *
 * Boots ui-xr portless once, walks every cast scenario (enumerated from the bank),
 * and reads posture + patient-support count from the LIVE scene graph.
 * Clearance uses the same deck-top metric as supine-patient-on-deck.
 *
 * claimScope: staging posture + support-path count for recumbent inpatient stations.
 * notEvidenceFor: clinical positioning correctness, ward-bed skin, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import { SKINNED_WORLD_SAMPLING_SOURCE } from "./lib/skinned-world-sampling.js";
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";
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

export const ISSUE_179_EVIDENCE_DIR = ".openclinxr/evidence/issue-179";
export const PRE_FIX_NAME = "pre-fix.json";
export const MEASURE_NAME = "inpatient-supine-staging.json";

/**
 * Stations this slice declares should stage a recumbent patient.
 * Keep in lockstep with INPATIENT_RECUMBENT_SCENARIO_MARKERS in actor-posture.ts.
 */
export const DECLARED_INPATIENT_SCENARIO_IDS = [
  "ward_delirium_med_rec_v1",
  "stepdown_sepsis_nurse_escalation_v1",
  "postop_fever_consult_pressure_v1",
] as const;

const DECLARED_SET = new Set<string>(DECLARED_INPATIENT_SCENARIO_IDS);

function isDeclaredInpatient(scenarioId: string): boolean {
  return DECLARED_SET.has(scenarioId);
}

/** Mirrors actor-posture POSTURE_SOURCE_DESCRIPTION for evidence reports. */
const POSTURE_SOURCE =
  "packages/openclinxr/asset-registry/src/actor-posture.ts defaultPostureForEnvironmentSlot "
  + "(scenario-id markers: telehealth seated, ed_chest_pain + INPATIENT_RECUMBENT_SCENARIO_MARKERS supine; "
  + "else standing). resolveActorPosture prefers env/scenario over declared standing.";

export type StationStagingRow = {
  scenarioId: string;
  environmentId: string;
  patientActorId: string;
  posture: string;
  supportSurfaceCount: number;
  supportKind: string | null;
  supportSource: string | null;
  clearanceAboveDeckMeters: number | null;
  notStagedMechanism: string | null;
};

export type InpatientSupineStagingReport = {
  rows: StationStagingRow[];
  declaredInpatientScenarioIds: string[];
  postureSource: string;
  claimScope: string;
  notEvidenceFor: string[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.inpatient-supine-staging.v1";
  kind: "inpatient_supine_staging";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: InpatientSupineStagingReport;
};

type LiveStationReading = {
  scenarioId: string;
  environmentId: string;
  patientActorId: string;
  posture: string;
  supportSurfaceCount: number;
  supportKind: string | null;
  supportSource: string | null;
  clearanceAboveDeckMeters: number | null;
};

let cachedReport: InpatientSupineStagingReport | null = null;
let measureInFlight: Promise<InpatientSupineStagingReport> | null = null;

function preFixPath(): string {
  return path.join(ISSUE_179_EVIDENCE_DIR, PRE_FIX_NAME);
}

function measurePath(): string {
  return path.join(ISSUE_179_EVIDENCE_DIR, MEASURE_NAME);
}

function environmentIdForScenario(scenarioId: string): string {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  return scenario?.environment?.environmentId ?? "";
}

/**
 * Contract entry: measure once (or re-read stamped cache) across the full cast bank.
 */
export async function inspectInpatientSupineStaging(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
}): Promise<InpatientSupineStagingReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      const fromDisk = await tryReadArtifact(measurePath());
      if (fromDisk) {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLive({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });
    await writeDump(report, {
      outputPath: measurePath(),
      label: input?.label ?? "measure",
    });
    if (input?.writePreFix) {
      await writeDump(report, {
        outputPath: preFixPath(),
        label: "pre-fix",
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

async function tryReadArtifact(filePath: string): Promise<InpatientSupineStagingReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as InpatientSupineStagingReport | undefined;
    if (report?.rows && Array.isArray(report.rows) && report.rows.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writeDump(
  report: InpatientSupineStagingReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? measurePath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.inpatient-supine-staging.v1" as const,
    kind: "inpatient_supine_staging" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "inpatient_primary_patient_posture_from_live_userData",
      "patient_support_surface_count_fixture_plus_equipment",
      "clearance_above_deck_same_metric_as_supine_patient_on_deck",
    ],
    notEvidenceFor: [
      "clinical_positioning_correctness",
      "ward_bed_skin_or_articulation_beyond_flat_deck",
      "quest_readiness",
      "clinical_validity",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`inpatient-supine-staging: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLive(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<InpatientSupineStagingReport> {
  const all = listShippedCastScenarioIds();
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : all;

  if (scenarios.length === 0) {
    throw new Error("inspectInpatientSupineStaging: listShippedCastScenarioIds returned empty");
  }

  const declaredInpatientScenarioIds = scenarios.filter((id) => isDeclaredInpatient(id));

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
        const rows: StationStagingRow[] = [];

        for (const scenarioId of scenarios) {
          process.stdout.write(`inpatient-supine: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 6, 180_000);
          // #574: sampling-instant race (same class as #259/#446) — waitForHumanoidsAndFrames
          // returns on the FIRST skinned mesh + 6 frames, but sibling cast GLBs (15 MB) may
          // still be loading, so the primary_patient root is unregistered at read time and
          // the row records posture="standing" patient="unknown". Which station loses moves
          // run to run. Wait for the runtime's settle signal before sampling; a failed asset
          // counts as settled, so a broken load still reports instead of masking.
          await waitForSceneAssetsSettled(page, 60_000);
          await page.waitForTimeout(900);

          const live = await readLiveStationFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const envId = live.environmentId || environmentIdForScenario(sid);
          const isTarget = isDeclaredInpatient(sid);
          const posture = live.posture || "standing";
          const onSupport =
            posture === "supine"
            && live.supportSurfaceCount === 1
            && live.clearanceAboveDeckMeters !== null;

          let notStagedMechanism: string | null = null;
          if (isTarget && !onSupport) {
            if (posture !== "supine") {
              notStagedMechanism =
                `posture="${posture}" — defaultPostureForEnvironmentSlot still standing for this scenario`;
            } else if (live.supportSurfaceCount === 0) {
              notStagedMechanism = "supine but no patient support surface in scene";
            } else if (live.supportSurfaceCount > 1) {
              notStagedMechanism =
                `supine but supportSurfaceCount=${live.supportSurfaceCount} (double-bed)`;
            } else if (live.clearanceAboveDeckMeters === null) {
              notStagedMechanism =
                "supine but clearance not measured (deck/stretcher not found for primary_patient)";
            }
          } else if (!isTarget && posture === "standing" && live.supportSurfaceCount === 1) {
            notStagedMechanism =
              "standing beside support (ambient ambulatory staging — intentional for non-targets)";
          }

          const row: StationStagingRow = {
            scenarioId: sid,
            environmentId: envId,
            patientActorId: live.patientActorId || "unknown",
            posture,
            supportSurfaceCount: live.supportSurfaceCount,
            supportKind: live.supportKind,
            supportSource: live.supportSource,
            clearanceAboveDeckMeters: live.clearanceAboveDeckMeters,
            notStagedMechanism,
          };
          rows.push(row);
          process.stdout.write(
            `  ${sid} posture=${posture} support=${live.supportSurfaceCount}`
            + ` src=${live.supportSource ?? "null"} kind=${live.supportKind ?? "null"}`
            + ` clear=${
              live.clearanceAboveDeckMeters === null
                ? "null"
                : live.clearanceAboveDeckMeters.toFixed(3)
            }\n`,
          );
        }

        return {
          rows,
          declaredInpatientScenarioIds,
          postureSource: POSTURE_SOURCE,
          claimScope:
            "staging posture and support-path count for declared inpatient recumbent stations",
          notEvidenceFor: [
            "clinical_positioning_correctness",
            "clinical_validity",
            "quest_readiness",
            "ward_bed_skin",
          ],
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

async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = browserPageWindow as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: {
            userData?: Record<string, unknown>;
            isSkinnedMesh?: boolean;
          }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return false;
      let skinned = 0;
      scene.traverse((o) => {
        if (o.isSkinnedMesh) skinned += 1;
      });
      return skinned > 0;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

/**
 * Full live probe. String IIFE so tsx cannot inject __name.
 * Support count mirrors station-room-not-empty (fixture + equipment support ids).
 * Clearance mirrors supine-patient-on-deck (body minY − deck top when primary + stretcher).
 */
async function readLiveStationFromPage(page: Page): Promise<LiveStationReading> {
  return page.evaluate(`(() => {
    const win = browserPageWindow;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(browserPageWindow.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    let environmentId = "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment) {
      const meta = scene.userData.openClinXrStationEnvironment;
      if (typeof meta.scenarioId === "string" && meta.scenarioId) scenarioId = meta.scenarioId;
      if (typeof meta.environmentId === "string") environmentId = meta.environmentId;
    }
    if (!scene || typeof scene.traverse !== "function") {
      return {
        scenarioId: scenarioId,
        environmentId: environmentId,
        patientActorId: "",
        posture: "standing",
        supportSurfaceCount: 0,
        supportKind: null,
        supportSource: null,
        clearanceAboveDeckMeters: null
      };
    }

${SKINNED_WORLD_SAMPLING_SOURCE}

    // Shell fixture supports
    let shell = null;
    scene.traverse(function (o) {
      if (o && o.name === "openclinxr.station-environment-shell") shell = o;
    });
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
        // #209: family seats are not patient supports; bed-class wins over chairs.
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
            source: "fixture",
            kind: slotId,
          });
        }
      }
    }

    const PATIENT_SUPPORT_EQ = {
      post_op_bed_equipment: true,
      pediatric_stretcher_equipment: true,
      exam_table_equipment: true,
      chairs_equipment: true
    };
    const equipmentSupportRoots = [];
    scene.traverse(function (object) {
      if (!object || !object.userData) return;
      const id = object.userData.openClinXrEquipmentId;
      if (typeof id !== "string" || !id) return;
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
      if (PATIENT_SUPPORT_EQ[id]) {
        equipmentSupportRoots.push({
          root: object,
          bedClass: id.indexOf("chair") < 0,
          chairClass: id.indexOf("chair") >= 0,
          source: "equipment",
          kind: id,
        });
      }
    });

    const candidates = [];
    const seen = [];
    function addC(e) {
      if (seen.indexOf(e.root) >= 0) return;
      seen.push(e.root);
      candidates.push(e);
    }
    for (let i = 0; i < fixtureSupportRoots.length; i++) addC(fixtureSupportRoots[i]);
    for (let i = 0; i < equipmentSupportRoots.length; i++) addC(equipmentSupportRoots[i]);
    const hasBed = candidates.some(function (c) { return c.bedClass; });
    const patientSupports = candidates.filter(function (c) {
      if (hasBed) return c.bedClass;
      return c.bedClass || c.chairClass;
    });
    const supportSurfaceCount = patientSupports.length;
    let supportKind = null;
    let supportSource = null;
    let supportRoot = null;
    if (patientSupports.length > 0) {
      supportRoot = patientSupports[0].root;
      supportSource = patientSupports[0].source;
      supportKind = patientSupports[0].kind;
    }

    // Deck top for clearance
    let stretcherRoot = null;
    let deckTopY = null;
    scene.traverse(function (obj) {
      const ud = obj.userData || {};
      if (ud.openClinXrStretcherKind === "procedural_patient_stretcher" || ud.fixtureSlotId === "stretcher") {
        if (!stretcherRoot) stretcherRoot = obj;
        if (typeof ud.deckTopYMeters === "number") deckTopY = ud.deckTopYMeters;
      }
    });
    if (deckTopY === null && supportRoot && typeof supportRoot.userData.deckTopYMeters === "number") {
      deckTopY = supportRoot.userData.deckTopYMeters;
    }
    if (deckTopY === null) deckTopY = 0.55;

    // Primary patient posture + body minY
    let patientActorId = "";
    let posture = "standing";
    let bodyMinY = null;
    const humanoidRoots = [];
    scene.traverse(function (obj) {
      if (!obj.isSkinnedMesh) return;
      let root = obj;
      let depth = 0;
      while (root.parent && depth < 12) {
        const p = root.parent;
        if (p === scene) break;
        root = p;
        depth++;
      }
      if (humanoidRoots.indexOf(root) < 0) humanoidRoots.push(root);
    });

    for (let r = 0; r < humanoidRoots.length; r++) {
      const root = humanoidRoots[r];
      let slotKind = "unknown";
      let actorId = "";
      let post = "standing";
      let node = root;
      let d = 0;
      while (node && d < 8) {
        if (node.userData) {
          if (typeof node.userData.openClinXrSlotKind === "string" && node.userData.openClinXrSlotKind) {
            slotKind = node.userData.openClinXrSlotKind;
          }
          if (typeof node.userData.openClinXrActorId === "string" && node.userData.openClinXrActorId) {
            actorId = node.userData.openClinXrActorId;
          }
          if (typeof node.userData.openClinXrActorPosture === "string" && node.userData.openClinXrActorPosture) {
            post = node.userData.openClinXrActorPosture;
          }
        }
        node = node.parent;
        d++;
      }
      if (slotKind !== "primary_patient") continue;
      patientActorId = actorId || patientActorId;
      posture = post;
      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
      let minY = Infinity;
      let any = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (object) {
          if (!object.isSkinnedMesh) return;
          const b = skinnedWorldAabb(object);
          if (!b) return;
          any = true;
          if (b.min.y < minY) minY = b.min.y;
        });
      }
      if (any && Number.isFinite(minY)) bodyMinY = minY;
      break;
    }

    let clearanceAboveDeckMeters = null;
    if (posture === "supine" && bodyMinY !== null && stretcherRoot) {
      clearanceAboveDeckMeters = bodyMinY - deckTopY;
    }

    return {
      scenarioId: scenarioId,
      environmentId: environmentId,
      patientActorId: patientActorId,
      posture: posture,
      supportSurfaceCount: supportSurfaceCount,
      supportKind: supportKind,
      supportSource: supportSource,
      clearanceAboveDeckMeters: clearanceAboveDeckMeters
    };
  })()`) as Promise<LiveStationReading>;
}

// CLI: pnpm exec tsx tools/openclinxr/evidence/inpatient-supine-staging.ts [--pre-fix]
const isMain =
  typeof process !== "undefined"
  && Array.isArray(process.argv)
  && process.argv[1]
  && process.argv[1].replace(/\\/g, "/").endsWith("inpatient-supine-staging.ts");

if (isMain) {
  const preFix = process.argv.includes("--pre-fix");
  inspectInpatientSupineStaging({ force: true, writePreFix: preFix, label: preFix ? "pre-fix" : "measure" })
    .then((report) => {
      process.stdout.write(
        `inpatient-supine-staging: done rows=${report.rows.length} declared=${report.declaredInpatientScenarioIds.join(",")}\n`,
      );
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

