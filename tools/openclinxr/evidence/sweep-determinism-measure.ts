/**
 * #507 — focused re-measure of the primary_care luminance disagreement between two landed
 * instruments, using the SAME helpers each instrument imports. Runs N capture attempts per
 * instrument and records, per attempt: the region median, the camera frame note (whose prefix
 * `roomCam(derived)=` vs `roomCam=` reveals whether the generated Infinigen room had loaded
 * before the camera was framed), and the room facts read from the running scene.
 *
 * This is the reproducible instrument behind `sweep-determinism-report.json`. It deliberately
 * writes NOTHING to the tracked `station-luminance-sweep.json` (#505's input) — it only emits
 * this module's own samples, so measuring cannot move the gate it is measuring.
 *
 * claimScope: whether a station's luminance varies across repeated captures, and whether the
 *   variation correlates with the camera falling back to the parametric doorway frame.
 * notEvidenceFor: that either instrument is correct, or that any station's luminance is right.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
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
export const SAMPLES_PATH = path.join(HERE, "sweep-determinism-samples.json");

const DEFAULT_STATION = "primary_care_dyslipidemia_joint_pain_v1";
const VIEWPORT = { width: 1440, height: 900 };
const REGION = { left: 0, top: 70 / 900, width: 1005 / 1440, height: 750 / 900 };

type Sample = {
  instrument: "sweep" | "per-station";
  run: number;
  median: number;
  frameNote: string;
  roomPresentAtReframe: boolean;
  roomPresentAtScreenshot: boolean | null;
  cameraInsideRoom: boolean | null;
  /** true when the per-station fail-closed check would have thrown (room loaded, camera outside). */
  wouldThrowCameraOutside: boolean;
};

function argValue(flag: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`${flag}=`))?.split("=").slice(1).join("=");
}

async function captureOnce(
  instrument: "sweep" | "per-station",
  station: string,
  serverUrl: string,
  run: number,
): Promise<Sample> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    const url = buildRoomCaptureUrl(serverUrl, station, "scene-overview");
    await page.goto(url, { waitUntil: "load", timeout: 180_000 });
    const live = await waitForStationShell(page, 180_000);
    // Per-station path reads the generated room BEFORE the humanoid wait (extra page round-trip);
    // the sweep path does not. This is the only ordering difference between the two bodies.
    if (instrument === "per-station") {
      await readInfinigenRoomLiveFacts(page);
      if (live.shellVisible === false) {
        throw new Error(`shell hidden for ${station}`);
      }
    }
    await waitForHumanoidAssetsLoaded(page, 180_000);
    const frameNote = await reframeCameraForRoom(page, live.environmentId);
    await page.waitForTimeout(1500);
    const shot = await page.screenshot({ fullPage: false });
    const lum = regionLuminance(shot, REGION);
    if (!lum) throw new Error("regionLuminance failed to decode screenshot");
    let roomPresentAtScreenshot: boolean | null = null;
    let cameraInsideRoom: boolean | null = null;
    let wouldThrowCameraOutside = false;
    if (instrument === "per-station") {
      const roomFacts = await readInfinigenRoomLiveFacts(page);
      roomPresentAtScreenshot = roomFacts.present;
      cameraInsideRoom = roomFacts.present ? roomFacts.cameraInsideRoom : null;
      wouldThrowCameraOutside = roomFacts.present && !roomFacts.effectivelyVisible
        ? true
        : roomFacts.present && !roomFacts.cameraInsideRoom;
    }
    return {
      instrument,
      run,
      median: lum.median,
      frameNote,
      roomPresentAtReframe: frameNote.startsWith("roomCam(derived)="),
      roomPresentAtScreenshot,
      cameraInsideRoom,
      wouldThrowCameraOutside,
    };
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const station = argValue("--station") ?? DEFAULT_STATION;
  const instrument = argValue("--instrument") ?? "both";
  const out = argValue("--out") ?? SAMPLES_PATH;
  const n = Number(argValue("--runs") ?? "4");
  const sweepSamples: Sample[] = [];
  const perStationSamples: Sample[] = [];

  if (instrument === "sweep" || instrument === "both") {
    const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    try {
      for (let i = 0; i < n; i++) {
        const s = await captureOnce("sweep", station, server.url, i + 1);
        sweepSamples.push(s);
        process.stdout.write(`SWEEP run=${s.run} median=${s.median} roomAtReframe=${s.roomPresentAtReframe} cam=${s.frameNote.slice(0, 72)}\n`);
      }
    } finally {
      await stopPortlessDevServer(server.proc);
    }
  }

  if (instrument === "per-station" || instrument === "both") {
    for (let i = 0; i < n; i++) {
      const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
      try {
        const s = await captureOnce("per-station", station, server.url, i + 1);
        perStationSamples.push(s);
        process.stdout.write(`PER run=${s.run} median=${s.median} roomAtReframe=${s.roomPresentAtReframe} roomAtShot=${s.roomPresentAtScreenshot} inside=${s.cameraInsideRoom} wouldThrow=${s.wouldThrowCameraOutside} cam=${s.frameNote.slice(0, 72)}\n`);
      } finally {
        await stopPortlessDevServer(server.proc);
      }
    }
  }

  const report = { generatedAt: new Date().toISOString(), station, sweepSamples, perStationSamples };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${out}\n`);
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("sweep-determinism-measure.ts")
    || process.argv[1].endsWith("sweep-determinism-measure.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
