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
      const win = window as unknown as {
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
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
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

    function mulMat4Vec3(e, x, y, z) {
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
      return [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
      ];
    }

    function mulMat4(ae, be) {
      const te = new Float64Array(16);
      const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
      const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
      const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
      const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
      const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
      const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
      const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
      const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
      te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
      te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
      te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
      te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
      te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
      te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
      te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
      te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
      te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
      te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
      te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
      te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
      te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
      te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
      te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
      te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
      return te;
    }

    function skinnedWorldAabb(mesh) {
      if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
      if (mesh.skeleton && typeof mesh.skeleton.update === "function") mesh.skeleton.update();
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos || pos.count === 0) return null;
      const skinIndex = mesh.geometry.attributes.skinIndex;
      const skinWeight = mesh.geometry.attributes.skinWeight;
      const skeleton = mesh.skeleton;
      const bindMatrix = mesh.bindMatrix && mesh.bindMatrix.elements;
      const bindMatrixInverse = mesh.bindMatrixInverse && mesh.bindMatrixInverse.elements;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const stride = Math.max(1, Math.floor(pos.count / 4000));
      function acc(x, y, z) {
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }
      if (skinIndex && skinWeight && skeleton && skeleton.bones && skeleton.bones.length && bindMatrix && bindMatrixInverse) {
        const bones = skeleton.bones;
        const inverses = skeleton.boneInverses;
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const bound = mulMat4Vec3(bindMatrix, vx, vy, vz);
          let sx = 0, sy = 0, sz = 0;
          for (let k = 0; k < 4; k++) {
            const weight = k === 0 ? skinWeight.getX(i) : k === 1 ? skinWeight.getY(i) : k === 2 ? skinWeight.getZ(i) : (skinWeight.getW ? skinWeight.getW(i) : 0);
            if (weight === 0) continue;
            const boneIdx = k === 0 ? skinIndex.getX(i) : k === 1 ? skinIndex.getY(i) : k === 2 ? skinIndex.getZ(i) : (skinIndex.getW ? skinIndex.getW(i) : 0);
            const bone = bones[boneIdx];
            const inv = inverses[boneIdx];
            if (!bone || !bone.matrixWorld || !bone.matrixWorld.elements || !inv || !inv.elements) continue;
            const boneMat = mulMat4(bone.matrixWorld.elements, inv.elements);
            const p = mulMat4Vec3(boneMat, bound[0], bound[1], bound[2]);
            sx += p[0] * weight; sy += p[1] * weight; sz += p[2] * weight;
          }
          const invP = mulMat4Vec3(bindMatrixInverse, sx, sy, sz);
          const weightSum = skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + (skinWeight.getW ? skinWeight.getW(i) : 0);
          let fx, fy, fz;
          if (weightSum > 1e-6) {
            const w = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, invP[0], invP[1], invP[2])
              : invP;
            fx = w[0]; fy = w[1]; fz = w[2];
          } else {
            const w = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
              : [vx, vy, vz];
            fx = w[0]; fy = w[1]; fz = w[2];
          }
          acc(fx, fy, fz);
        }
      } else {
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const w = mesh.matrixWorld && mesh.matrixWorld.elements
            ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
            : [vx, vy, vz];
          acc(w[0], w[1], w[2]);
        }
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
    }

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

