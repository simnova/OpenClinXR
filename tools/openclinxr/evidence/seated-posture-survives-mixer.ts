/**
 * #83 — live posture geometry from the running ui-xr scene after the mixer/frame loop.
 *
 * Extends the room-capture probe (ui-xr-environment-room-capture.ts) — does NOT invent a
 * fourth page.evaluate harness. Numbers come from skinned-mesh world bounds on the live
 * page; never from openClinXr* markers or applyPosturePose return values.
 *
 * claimScope: seated vs standing mesh height / floor contact in the running scene.
 * notEvidenceFor: natural sit appearance, clinical posture appropriateness, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  readLivePostureGeometryFromPage,
  waitForStationShell,
  type LivePostureGeometryReport,
} from "./ui-xr-environment-room-capture.js";
// #446: sample after the heavy cast GLB settles — frame-19 sampling on a fresh boot
// measured the patient's primitive scaffold (h≈1.43) before the 12 MB GLB arrived.
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";

export const POSTURE_MEASUREMENTS_DIR = ".openclinxr/evidence/seated-posture";
export const POSTURE_MEASUREMENTS_NAME = "posture-measurements.json";

/** Telehealth has seated patient + standing family — both required by the contracts. */
const DEFAULT_POSTURE_SCENARIO = "telehealth_diabetes_health_literacy_v1";

export type { LivePostureGeometryReport };

/**
 * Load the real ui-xr page, wait for frames to advance, measure skinned-mesh posture geometry.
 * Signature consumed by seated-posture-survives-mixer.test.ts.
 */
export async function measureLivePostureGeometry(input?: {
  scenarioId?: string;
  baseUrl?: string;
  captureMode?: string;
  /** Min framesObserved before measuring (must be > 0 for mixer survival). */
  minFrames?: number;
}): Promise<LivePostureGeometryReport> {
  const scenarioId = input?.scenarioId ?? DEFAULT_POSTURE_SCENARIO;
  const captureMode = input?.captureMode ?? ROOM_CAPTURE_MODE;
  const minFrames = input?.minFrames ?? 8;

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
        const url = buildRoomCaptureUrl(baseUrl, scenarioId, captureMode);
        process.stdout.write(`posture-measure: goto ${scenarioId} mode=${captureMode}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidsAndFrames(page, minFrames, 180_000);
        await waitForSceneAssetsSettled(page, 60_000);
        // Extra settle so mixer + re-seat have run several times after load.
        await page.waitForTimeout(900);
        const report = await readLivePostureGeometryFromPage(page);
        if (report.actors.length === 0) {
          throw new Error(
            "measureLivePostureGeometry: no actors with openClinXrActorPosture / skinned humanoid roots found",
          );
        }
        process.stdout.write(
          `posture-measure: ${report.actors.length} actors frames=${report.actors[0]?.framesAdvanced ?? 0} scenario=${report.scenarioId}\n`,
        );
        for (const a of report.actors) {
          process.stdout.write(
            `  ${a.actorId} posture=${a.declaredPosture} h=${a.meshHeightMeters.toFixed(3)} y0=${a.lowestVertexY.toFixed(3)} y1=${a.highestVertexY.toFixed(3)}\n`,
          );
        }
        return report;
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
          traverse?: (cb: (o: { userData?: Record<string, unknown>; isSkinnedMesh?: boolean }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      let postureTagged = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
        const p = object.userData?.openClinXrActorPosture;
        if (p === "standing" || p === "seated" || p === "supine") postureTagged += 1;
      });
      return skinned >= 1 && postureTagged >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

/** Write calibration dump (baseline or post-fix). */
export async function writePostureMeasurementsDump(
  report: LivePostureGeometryReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath =
    input?.outputPath
    ?? path.join(POSTURE_MEASUREMENTS_DIR, POSTURE_MEASUREMENTS_NAME);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    schemaVersion: "openclinxr.seated-posture-measurements.v1",
    kind: "seated_posture_live_geometry",
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_skinned_mesh_world_bounds_after_frame_loop",
      "declared_posture_from_runtime_userData",
    ],
    notEvidenceFor: [
      "natural_sit_appearance",
      "clinical_posture_appropriateness",
      "quest_readiness",
    ],
    report,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`posture-measure: wrote ${outputPath}\n`);
  return outputPath;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let label = "cli";
  let scenarioId = DEFAULT_POSTURE_SCENARIO;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--label" && args[i + 1]) label = args[++i]!;
    else if (arg === "--scenario" && args[i + 1]) scenarioId = args[++i]!;
  }
  const report = await measureLivePostureGeometry({ scenarioId });
  await writePostureMeasurementsDump(report, { label });
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("seated-posture-survives-mixer.ts")
    || process.argv[1].endsWith("seated-posture-survives-mixer.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
