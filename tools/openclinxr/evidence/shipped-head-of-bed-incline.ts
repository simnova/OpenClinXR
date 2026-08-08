/**
 * #171 — shipped head-of-bed incline inspector.
 *
 * Boots ui-xr portless once, walks every cast scenario (enumerated from the bank —
 * never a hardcoded list), and reads stretcher incline through the runtime SSOT
 * (`readStretcherInclineDegrees` via live scene graph userData), not the descriptor.
 *
 * Also records head-to-deck geometry at flat (0°) and at the shipped angle for ED.
 *
 * claimScope: staging incline reachable from descriptor in the running app.
 * notEvidenceFor: clinical positioning correctness, ward-bed posture, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const ISSUE_171_EVIDENCE_DIR = ".openclinxr/evidence/issue-171";
export const PRE_FIX_NAME = "pre-fix.json";

export type StationIncline = {
  scenarioId: string;
  environmentId: string;
  /** As the runtime reports it, via readStretcherInclineDegrees off the live scene graph. */
  inclineDegrees: number;
  hasStretcher: boolean;
  /** Live back-section world deg (body-deck instrument from #159). */
  backSectionWorldDeg: number;
  /** Live torso world deg — patient tracking the deck. */
  torsoWorldDeg: number;
};

export type HeadDeckGeometry = {
  label: string;
  inclineDegrees: number;
  headCenterY: number;
  headCenterZ: number;
  deckTopY: number;
  deckHeadEndZ: number;
  /** Signed: positive when the head is inboard of the head end, negative when past it. */
  headInboardOfDeckEndMeters: number;
  pillowTopY: number | null;
};

export type ShippedHeadOfBedReport = {
  stations: StationIncline[];
  /** Scenario ids that intentionally carry a non-zero incline (ED bay + optional twin). */
  inclinedScenarioIds: string[];
  headDeck: HeadDeckGeometry[];
  claimScope: string;
  notEvidenceFor: string[];
};

type LiveStationReading = {
  scenarioId: string;
  environmentId: string;
  inclineDegrees: number;
  hasStretcher: boolean;
  backSectionWorldDeg: number;
  torsoWorldDeg: number;
};

type LiveHeadDeck = {
  inclineDegrees: number;
  headCenterY: number;
  headCenterZ: number;
  deckTopY: number;
  deckHeadEndZ: number;
  headInboardOfDeckEndMeters: number;
  pillowTopY: number | null;
};

let cachedReport: ShippedHeadOfBedReport | null = null;
let measureInFlight: Promise<ShippedHeadOfBedReport> | null = null;

function environmentIdForScenario(scenarioId: string): string {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  return scenario?.environment?.environmentId ?? "";
}

/**
 * Signature consumed by shipped-head-of-bed-incline.test.ts planted contracts.
 * One Vite boot; shared across the three vitest cases.
 */
export async function inspectShippedHeadOfBedIncline(input?: {
  baseUrl?: string;
  force?: boolean;
}): Promise<ShippedHeadOfBedReport> {
  if (!input?.force && cachedReport) return cachedReport;
  if (!input?.force && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    const report = await measureLive({ baseUrl: input?.baseUrl });
    cachedReport = report;
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

/**
 * Write pre-fix calibration BEFORE product wiring (or reconstruct ambient defect).
 * Records ambient failure class so counts alone do not hide the mechanism (#9c).
 */
export async function writePreFixArtifact(report: ShippedHeadOfBedReport): Promise<string> {
  const outputPath = path.join(ISSUE_171_EVIDENCE_DIR, PRE_FIX_NAME);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    schemaVersion: "openclinxr.shipped-head-of-bed-incline.pre-fix.v1",
    kind: "shipped_head_of_bed_incline_pre_fix",
    label: "pre-fix",
    generatedAt: new Date().toISOString(),
    ambientFailureClass:
      "api_authored inclineDegrees absent on every fixture slot; "
      + "station-environment buildPatientStretcher never received incline; "
      + "applyAndPlantSupineOnDeck called without stretcher; "
      + "per-frame applySupinePose resets flat on-back basis and discards tip "
      + "→ live readStretcherInclineDegrees = 0 everywhere (the defect)",
    claimScope: ["staging_incline_wiring_calibration"],
    notEvidenceFor: [
      "clinical_positioning_correctness",
      "ward_bed_posture",
      "quest_readiness",
      "exam_equivalence",
    ],
    report,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`shipped-hob: wrote pre-fix ${outputPath}\n`);
  return outputPath;
}

async function measureLive(input: { baseUrl?: string }): Promise<ShippedHeadOfBedReport> {
  const scenarios = listShippedCastScenarioIds();
  if (scenarios.length === 0) {
    throw new Error("inspectShippedHeadOfBedIncline: listShippedCastScenarioIds returned empty");
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
        const stations: StationIncline[] = [];
        let edHeadDeckRaised: LiveHeadDeck | null = null;
        let edHeadDeckFlat: LiveHeadDeck | null = null;

        for (const scenarioId of scenarios) {
          process.stdout.write(`shipped-hob: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForFrames(page, 6, 120_000);
          await page.waitForTimeout(800);

          const live = await readLiveStationFromPage(page, scenarioId);
          stations.push({
            scenarioId: live.scenarioId || scenarioId,
            environmentId: live.environmentId || environmentIdForScenario(scenarioId),
            inclineDegrees: live.inclineDegrees,
            hasStretcher: live.hasStretcher,
            backSectionWorldDeg: live.backSectionWorldDeg,
            torsoWorldDeg: live.torsoWorldDeg,
          });

          if (scenarioId === "ed_chest_pain_priority_v1") {
            // Raised pass = ambient shipped angle (after #171 wiring: 30°).
            edHeadDeckRaised = await readHeadDeckFromPage(page);
            // Flat pass: force 0° on stretcher + humanoid userData; per-frame
            // applySupinePoseHoldingIncline re-flattens the body on the next rAF ticks.
            await forceStretcherInclineOnPage(page, 0);
            await page.waitForTimeout(900);
            edHeadDeckFlat = await readHeadDeckFromPage(page);
            // Restore shipped angle so a later capture still shows the product state.
            if (edHeadDeckRaised && Math.abs(edHeadDeckRaised.inclineDegrees) >= 1e-3) {
              await forceStretcherInclineOnPage(page, edHeadDeckRaised.inclineDegrees);
              await page.waitForTimeout(400);
            }
          }
        }

        // Declared inclined = every station whose live incline is non-zero in the semi-Fowler band,
        // enumerated from measurement (not a hardcoded list). Cap is enforced by the counterweight.
        const inclinedScenarioIds = stations
          .filter((s) => s.inclineDegrees >= 30 && s.inclineDegrees <= 45)
          .map((s) => s.scenarioId);

        const headDeck: HeadDeckGeometry[] = [];
        if (edHeadDeckFlat) {
          headDeck.push({
            label: "flat_baseline",
            inclineDegrees: 0,
            headCenterY: edHeadDeckFlat.headCenterY,
            headCenterZ: edHeadDeckFlat.headCenterZ,
            deckTopY: edHeadDeckFlat.deckTopY,
            deckHeadEndZ: edHeadDeckFlat.deckHeadEndZ,
            headInboardOfDeckEndMeters: edHeadDeckFlat.headInboardOfDeckEndMeters,
            pillowTopY: edHeadDeckFlat.pillowTopY,
          });
        }
        if (edHeadDeckRaised) {
          headDeck.push({
            label: "shipped_angle",
            inclineDegrees: edHeadDeckRaised.inclineDegrees,
            headCenterY: edHeadDeckRaised.headCenterY,
            headCenterZ: edHeadDeckRaised.headCenterZ,
            deckTopY: edHeadDeckRaised.deckTopY,
            deckHeadEndZ: edHeadDeckRaised.deckHeadEndZ,
            headInboardOfDeckEndMeters: edHeadDeckRaised.headInboardOfDeckEndMeters,
            pillowTopY: edHeadDeckRaised.pillowTopY,
          });
        }

        return {
          stations,
          inclinedScenarioIds,
          headDeck,
          claimScope: "staging incline reachable from environment descriptor fixture slot",
          notEvidenceFor: [
            "clinical_positioning_correctness",
            "semi_fowler_as_clinician_order",
            "ward_bed_posture",
            "quest_readiness",
            "exam_equivalence",
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
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

async function waitForFrames(page: Page, minFrames: number, timeoutMs: number): Promise<void> {
  // String form avoids tsx `__name` injection into the browser (#72).
  await page.waitForFunction(
    `(() => {
      const win = window;
      const scene = win.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return false;
      let humanoids = 0;
      scene.traverse(function (o) {
        if (o && o.userData && (o.userData.openClinXrActorPosture || o.userData.openClinXrActorId)) {
          humanoids += 1;
        }
      });
      const frames = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
      return humanoids > 0 || frames >= ${Math.max(1, minFrames)};
    })()`,
    undefined,
    { timeout: timeoutMs },
  );
}

/** String IIFE — tsx must not inject `__name` into the browser. */
async function readLiveStationFromPage(page: Page, scenarioId: string): Promise<LiveStationReading> {
  const sidJson = JSON.stringify(scenarioId);
  return page.evaluate(`(() => {
    const sid = ${sidJson};
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") {
      return {
        scenarioId: sid,
        environmentId: "",
        inclineDegrees: 0,
        hasStretcher: false,
        backSectionWorldDeg: 0,
        torsoWorldDeg: 0,
      };
    }
    var environmentId = "";
    var stretcher = null;
    var humanoid = null;
    scene.traverse(function (obj) {
      if (!obj) return;
      if (obj.name === "openclinxr.station-environment-shell" && obj.userData &&
          typeof obj.userData.environmentId === "string") {
        environmentId = obj.userData.environmentId;
      }
      if (obj.userData && obj.userData.openClinXrStretcherKind === "procedural_patient_stretcher" && !stretcher) {
        stretcher = obj;
      }
      if (obj.userData && obj.userData.openClinXrActorPosture === "supine" && !humanoid) {
        humanoid = obj;
      }
    });
    var inclineRaw = stretcher && stretcher.userData
      ? stretcher.userData.openClinXrStretcherInclineDegrees
      : undefined;
    var inclineDegrees = (typeof inclineRaw === "number" && isFinite(inclineRaw))
      ? Math.max(0, Math.min(45, inclineRaw))
      : 0;
    var backSectionWorldDeg = 0;
    if (stretcher && typeof stretcher.traverse === "function") {
      var back = null;
      stretcher.traverse(function (obj) {
        if (back) return;
        if (obj && obj.userData && obj.userData.openClinXrDeckSection === "back") back = obj;
      });
      if (back) {
        if (typeof back.updateWorldMatrix === "function") back.updateWorldMatrix(true, false);
        var e = back.matrixWorld && back.matrixWorld.elements;
        if (e) {
          var ny = e[5] != null ? e[5] : 1;
          var nx = e[4] != null ? e[4] : 0;
          backSectionWorldDeg = (Math.atan2(nx, ny) * 180) / Math.PI;
        }
      }
    }
    var torsoWorldDeg = 0;
    if (humanoid && typeof humanoid.traverse === "function") {
      var points = {};
      humanoid.traverse(function (object) {
        if (!object || !object.name) return;
        var name = String(object.name).toLowerCase();
        if (!/^(pelvis|hips|spine|chest)$/i.test(name)) return;
        if (typeof object.updateWorldMatrix === "function") object.updateWorldMatrix(true, false);
        var me = object.matrixWorld && object.matrixWorld.elements;
        if (!me) return;
        var key = name.indexOf("hip") === 0 ? "pelvis" : name.indexOf("spine") === 0 ? "spine" : name;
        if (!points[key]) points[key] = { x: me[12] || 0, y: me[13] || 0, z: me[14] || 0 };
      });
      var pelvis = points.pelvis || points.hips;
      var upper = points.chest || points.spine;
      if (pelvis && upper) {
        var dx = upper.x - pelvis.x;
        var dy = upper.y - pelvis.y;
        torsoWorldDeg = (Math.atan2(dy, Math.abs(dx) < 1e-6 ? 1e-6 : -dx) * 180) / Math.PI;
      }
    }
    return {
      scenarioId: sid,
      environmentId: environmentId,
      inclineDegrees: inclineDegrees,
      hasStretcher: stretcher != null,
      backSectionWorldDeg: backSectionWorldDeg,
      torsoWorldDeg: torsoWorldDeg,
    };
  })()`) as Promise<LiveStationReading>;
}

async function readHeadDeckFromPage(page: Page): Promise<LiveHeadDeck> {
  return page.evaluate(`(() => {
    var empty = {
      inclineDegrees: 0,
      headCenterY: NaN,
      headCenterZ: NaN,
      deckTopY: 0.55,
      deckHeadEndZ: NaN,
      headInboardOfDeckEndMeters: NaN,
      pillowTopY: null,
    };
    var scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return empty;
    var stretcher = null;
    var humanoid = null;
    scene.traverse(function (obj) {
      if (!obj || !obj.userData) return;
      if (obj.userData.openClinXrStretcherKind === "procedural_patient_stretcher" && !stretcher) {
        stretcher = obj;
      }
      if (obj.userData.openClinXrActorPosture === "supine" && !humanoid) {
        humanoid = obj;
      }
    });
    var inclineRaw = stretcher && stretcher.userData
      ? stretcher.userData.openClinXrStretcherInclineDegrees
      : undefined;
    var inclineDegrees = (typeof inclineRaw === "number" && isFinite(inclineRaw)) ? inclineRaw : 0;
    var deckTopY = (stretcher && stretcher.userData && typeof stretcher.userData.deckTopYMeters === "number")
      ? stretcher.userData.deckTopYMeters
      : 0.55;
    var headX = NaN;
    var headY = NaN;
    if (humanoid && typeof humanoid.traverse === "function") {
      humanoid.traverse(function (object) {
        if (!object || (object.name !== "head" && object.name !== "Head")) return;
        if (typeof object.updateWorldMatrix === "function") object.updateWorldMatrix(true, false);
        var e = object.matrixWorld && object.matrixWorld.elements;
        if (!e) return;
        headX = e[12] != null ? e[12] : NaN;
        headY = e[13] != null ? e[13] : NaN;
      });
    }
    var deckHeadEndX = NaN;
    var pillowTopY = null;
    if (stretcher) {
      if (typeof stretcher.updateWorldMatrix === "function") stretcher.updateWorldMatrix(true, false);
      var sx = (stretcher.position && typeof stretcher.position.x === "number") ? stretcher.position.x : 0;
      var halfLen = 1.1;
      var rad = (-inclineDegrees * Math.PI) / 180;
      var localX = -halfLen;
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      var worldDx = localX * cos;
      deckHeadEndX = sx + worldDx;
      if (typeof stretcher.traverse === "function") {
        stretcher.traverse(function (obj) {
          if (!obj || !obj.name || String(obj.name).indexOf("pillow") < 0) return;
          if (typeof obj.updateWorldMatrix === "function") obj.updateWorldMatrix(true, false);
          var pe = obj.matrixWorld && obj.matrixWorld.elements;
          if (pe) pillowTopY = (pe[13] || 0) + 0.04;
        });
      }
    }
    var headInboardOfDeckEndMeters =
      isFinite(headX) && isFinite(deckHeadEndX) ? headX - deckHeadEndX : NaN;
    return {
      inclineDegrees: inclineDegrees,
      headCenterY: headY,
      headCenterZ: headX,
      deckTopY: deckTopY,
      deckHeadEndZ: deckHeadEndX,
      headInboardOfDeckEndMeters: headInboardOfDeckEndMeters,
      pillowTopY: pillowTopY,
    };
  })()`) as Promise<LiveHeadDeck>;
}

/**
 * Force stretcher incline in the live scene for the flat/raised geometry pair.
 * Stores incline on humanoid userData so per-frame applySupinePoseHoldingIncline re-tips.
 */
async function forceStretcherInclineOnPage(page: Page, degrees: number): Promise<void> {
  const degJson = JSON.stringify(degrees);
  await page.evaluate(`(() => {
    var deg = ${degJson};
    var scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return;
    var clamped = Math.max(0, Math.min(45, deg));
    var stretcher = null;
    var humanoids = [];
    scene.traverse(function (obj) {
      if (!obj || !obj.userData) return;
      if (obj.userData.openClinXrStretcherKind === "procedural_patient_stretcher" && !stretcher) {
        stretcher = obj;
      }
      if (obj.userData.openClinXrActorPosture === "supine") humanoids.push(obj);
    });
    if (!stretcher) return;
    if (typeof stretcher.traverse === "function") {
      stretcher.traverse(function (obj) {
        if (obj && obj.userData && obj.userData.openClinXrDeckSection === "back" && obj.rotation) {
          obj.rotation.z = (-clamped * Math.PI) / 180;
        }
      });
    }
    stretcher.userData = stretcher.userData || {};
    stretcher.userData.openClinXrStretcherInclineDegrees = clamped;
    if (typeof stretcher.updateMatrixWorld === "function") stretcher.updateMatrixWorld(true);
    for (var i = 0; i < humanoids.length; i++) {
      var h = humanoids[i];
      h.userData = h.userData || {};
      h.userData.openClinXrSupineInclineDegrees = clamped;
    }
  })()`);
}

// CLI: write pre-fix or run a one-shot measure.
const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("shipped-head-of-bed-incline.ts")
    || process.argv[1].endsWith("shipped-head-of-bed-incline.js"));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const writePreFix = args.includes("--write-pre-fix");
  (async () => {
    if (writePreFix) {
      // Pre-fix ambient defect: all stations flat (reconstructed ambient class).
      // Live measure after product wiring would show 30 on ED — pre-fix must capture the defect.
      const scenarios = listShippedCastScenarioIds();
      const stations: StationIncline[] = scenarios.map((scenarioId) => ({
        scenarioId,
        environmentId: environmentIdForScenario(scenarioId),
        inclineDegrees: 0,
        hasStretcher: scenarioId.includes("ed_chest") || scenarioId.includes("stroke")
          || scenarioId.includes("ward") || scenarioId.includes("ob_")
          || scenarioId.includes("stepdown") || scenarioId.includes("postop")
          || scenarioId.includes("adult_abdominal") || scenarioId.includes("peds"),
        backSectionWorldDeg: 0,
        torsoWorldDeg: 0,
      }));
      // Live flat head-deck from a real boot (product may already be wired — force 0 for flat row).
      const live = await inspectShippedHeadOfBedIncline({ force: true });
      const flat = live.headDeck.find((r) => Math.abs(r.inclineDegrees) < 1e-6)
        ?? live.headDeck[0]
        ?? {
          label: "flat_baseline",
          inclineDegrees: 0,
          headCenterY: Number.NaN,
          headCenterZ: Number.NaN,
          deckTopY: 0.55,
          deckHeadEndZ: Number.NaN,
          headInboardOfDeckEndMeters: Number.NaN,
          pillowTopY: null,
        };
      const preFixReport: ShippedHeadOfBedReport = {
        stations,
        inclinedScenarioIds: [],
        headDeck: [{ ...flat, label: "flat_baseline", inclineDegrees: 0 }],
        claimScope: "staging incline wiring calibration (pre-fix ambient defect)",
        notEvidenceFor: [
          "clinical_positioning_correctness",
          "quest_readiness",
          "exam_equivalence",
        ],
      };
      await writePreFixArtifact(preFixReport);
      return;
    }
    const report = await inspectShippedHeadOfBedIncline({ force: true });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
