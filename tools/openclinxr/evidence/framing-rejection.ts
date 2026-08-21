/**
 * #503 — measure the capture framing's occlusion rejection and write the tracked
 * framing-rejection report the contract reads.
 *
 * Measures ONCE per station into the report (single server boot, one screenshot per
 * station, then greyscale over the 3D viewport region y70:820 x0:1005) — never per
 * test case (§7b). The occlusion verdict comes from `reframeCameraForRoom`, which
 * stores `openClinXrRejectedViewpoints` on the camera userData; the panel presence
 * is read from the loaded room's `shader_dark_art` material, not restated from the GLB.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  buildRoomCaptureUrl,
  readInfinigenRoomLiveFacts,
  reframeCameraForRoom,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FRAMING_REJECTION_REPORT_PATH = path.join(HERE, "framing-rejection-report.json");

export const FRAMING_REJECTION_STATIONS = ["ward_delirium_med_rec_v1", "ed_stroke_alert_handoff_v1"] as const;

export type FramingRejectionRow = {
  median: number;
  p90: number;
  cameraInsideInterior: boolean;
  darkPanelPresentAndVisible: boolean;
  rejectedViewpoints: string[];
};

export type FramingRejectionReport = {
  stations: Record<string, FramingRejectionRow>;
};

/** Viewport region the contract pins: y 70:820, x 0:1005 (HUD starts ~1020px). */
const VIEWPORT = { width: 1440, height: 900 };
const REGION = { left: 0, top: 70 / 900, width: 1005 / 1440, height: 750 / 900 };

async function readRejectedViewpoints(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return [];
    let camera = null;
    scene.traverse(function (object) {
      if (camera) return;
      if (object.isPerspectiveCamera || object.type === "PerspectiveCamera") camera = object;
    });
    if (!camera || !camera.userData) return [];
    const v = camera.userData.openClinXrRejectedViewpoints;
    return Array.isArray(v) ? v : [];
  })()`) as Promise<string[]>;
}

async function readDarkPanelPresentAndVisible(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return false;
    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    if (!roomRoot || typeof roomRoot.traverse !== "function") return false;
    const effectivelyVisible = function (obj) {
      let cur = obj;
      while (cur && cur !== scene) { if (cur.visible === false) return false; cur = cur.parent; }
      return true;
    };
    let present = false;
    let visible = false;
    roomRoot.traverse(function (o) {
      if (!(o.isMesh === true || o.isSkinnedMesh === true)) return;
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (m && typeof m.name === "string" && /dark_art/i.test(m.name)) {
          present = true;
          if (effectivelyVisible(o)) visible = true;
        }
      }
    });
    return present && visible;
  })()`) as Promise<boolean>;
}

export async function writeFramingRejectionReport(): Promise<FramingRejectionReport> {
  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    readyTimeoutMs: 180_000,
  });
  const stations: Record<string, FramingRejectionRow> = {};
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenarioId of FRAMING_REJECTION_STATIONS) {
      const page = await browser.newPage({ viewport: VIEWPORT });
      try {
        const url = buildRoomCaptureUrl(server.url, scenarioId, "scene-overview");
        process.stdout.write(`framing-rejection: goto ${scenarioId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        const live = await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);
        const frameNote = await reframeCameraForRoom(page, live.environmentId);
        process.stdout.write(`framing-rejection: ${scenarioId} cam=${frameNote}\n`);
        // Extra frames after reframe + loads so skinned materials bind before screenshot.
        await page.waitForTimeout(1500);
        const shot = await page.screenshot({ fullPage: false });
        const lum = regionLuminance(shot, REGION);
        if (!lum) throw new Error(`regionLuminance failed to decode ${scenarioId} screenshot`);
        const room = await readInfinigenRoomLiveFacts(page);
        const rejected = await readRejectedViewpoints(page);
        const panel = await readDarkPanelPresentAndVisible(page);
        stations[scenarioId] = {
          median: lum.median,
          p90: lum.p90,
          cameraInsideInterior: room.cameraInsideRoom,
          darkPanelPresentAndVisible: panel,
          rejectedViewpoints: rejected,
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await stopPortlessDevServer(server.proc);
  }
  const report: FramingRejectionReport = { stations };
  writeFileSync(FRAMING_REJECTION_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`framing-rejection: wrote ${FRAMING_REJECTION_REPORT_PATH}\n`);
  return report;
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("framing-rejection.ts")
    || process.argv[1].endsWith("framing-rejection.js"));

if (isDirectRun) {
  writeFramingRejectionReport().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
