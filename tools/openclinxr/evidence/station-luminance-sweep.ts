/**
 * #505 — measure every shipped station's viewport luminance ONCE into the tracked
 * station-luminance-sweep report the contract reads (median per station).
 *
 * One server boot, one screenshot per station over the 3D viewport region the contract pins
 * (y 70:820, x 0:1005 — the HUD starts ~1020px), then greyscale median via
 * `lib/png-region-luminance.js` (same reader as the framing-rejection report). Stations are
 * enumerated dynamically from the shipped bundles (#101), never a frozen id list, so a new
 * scenario joins the sweep the day it ships.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  buildRoomCaptureUrl,
  reframeCameraForRoom,
  shippedStationIds,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATION_LUMINANCE_SWEEP_PATH = path.join(HERE, "station-luminance-sweep.json");

export type StationLuminanceRow = { median: number };
export type StationLuminanceSweep = { stations: Record<string, StationLuminanceRow> };

/** Viewport region the contract pins: y 70:820, x 0:1005 (HUD starts ~1020px). */
const VIEWPORT = { width: 1440, height: 900 };
const REGION = { left: 0, top: 70 / 900, width: 1005 / 1440, height: 750 / 900 };

export async function writeStationLuminanceSweep(): Promise<StationLuminanceSweep> {
  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    readyTimeoutMs: 180_000,
  });
  const stations: Record<string, StationLuminanceRow> = {};
  const browser = await chromium.launch({ headless: true });
  try {
    const ids = shippedStationIds();
    if (ids.length < 14) throw new Error(`sweep enumerated ${ids.length} stations — expected the whole shipped bank (>=14)`);
    for (const scenarioId of ids) {
      const page = await browser.newPage({ viewport: VIEWPORT });
      try {
        const url = buildRoomCaptureUrl(server.url, scenarioId, "scene-overview");
        process.stdout.write(`station-luminance-sweep: goto ${scenarioId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        const live = await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);
        const frameNote = await reframeCameraForRoom(page, live.environmentId);
        // Extra frames after reframe + loads so skinned materials bind before screenshot.
        await page.waitForTimeout(1500);
        const shot = await page.screenshot({ fullPage: false });
        const lum = regionLuminance(shot, REGION);
        if (!lum) throw new Error(`regionLuminance failed to decode ${scenarioId} screenshot`);
        stations[scenarioId] = { median: lum.median };
        process.stdout.write(`station-luminance-sweep: ${scenarioId} median=${lum.median} cam=${frameNote}\n`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await stopPortlessDevServer(server.proc);
  }
  const report: StationLuminanceSweep = { stations };
  writeFileSync(STATION_LUMINANCE_SWEEP_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`station-luminance-sweep: wrote ${STATION_LUMINANCE_SWEEP_PATH}\n`);
  return report;
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("station-luminance-sweep.ts")
    || process.argv[1].endsWith("station-luminance-sweep.js"));

if (isDirectRun) {
  writeStationLuminanceSweep().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
