import { chromium } from "playwright";
import {
  buildRoomCaptureUrl, reframeCameraForRoom, waitForHumanoidAssetsLoaded, waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

/**
 * Repeat the room-camera derivation for a station and report where the eye landed each time.
 *
 * `reframeCameraForRoom` derives an eye position from the shell width and the door constants (#398).
 * A derivation is a pure function of the scene, so repeating it in one process must return the same
 * point. Where it does not, every capture-derived number for that station - luminance, framing,
 * occlusion - is sampling a different viewpoint each run.
 *
 * WHAT THIS CANNOT SEE: it repeats the derivation against separately loaded pages, so a difference
 * could in principle come from the scene rather than the derivation. The control station is what
 * separates those: same process, same loop, same loader. If one station varies while another is
 * identical, the scene-load hypothesis has to explain why it applies to only one of them.
 */

export interface CameraLanding {
  readonly scenarioId: string;
  readonly environmentId: string;
  /** Eye position, rounded to 2 dp - the same precision the capture note prints. */
  readonly eye: readonly [number, number, number];
  readonly rejectedCandidateCount: number;
}

const EYE = /roomCam\(derived\)=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/u;
const REJECTED = /rejected=([^\s]*(?:\s[-\d][^\s]*)*)/u;

export async function measureRoomCameraLandings(
  scenarioIds: readonly string[], repeats = 3,
): Promise<CameraLanding[]> {
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const browser = await chromium.launch({ headless: true });
  const landings: CameraLanding[] = [];
  try {
    for (let run = 0; run < repeats; run += 1) {
      for (const scenarioId of scenarioIds) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await page.goto(buildRoomCaptureUrl(server.url, scenarioId, "scene-overview"),
            { waitUntil: "load", timeout: 180_000 });
          const live = await waitForStationShell(page, 180_000);
          await waitForHumanoidAssetsLoaded(page, 180_000);
          const note = await reframeCameraForRoom(page, live.environmentId);
          const m = EYE.exec(note);
          if (!m) throw new Error(`no derived camera in note for ${scenarioId}: ${note}`);
          const rejected = REJECTED.exec(note)?.[1]?.trim() ?? "";
          landings.push({
            scenarioId,
            environmentId: live.environmentId,
            eye: [Number(m[1]), Number(m[2]), Number(m[3])],
            rejectedCandidateCount: rejected.length === 0 ? 0 : rejected.split(/\s+/u).length,
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await stopPortlessDevServer(server.proc);
  }
  return landings;
}

/** Largest absolute spread on any axis across one station's landings. */
export function eyeSpreadMeters(landings: readonly CameraLanding[]): number {
  let worst = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const vals = landings.map((l) => l.eye[axis]!);
    worst = Math.max(worst, Math.max(...vals) - Math.min(...vals));
  }
  return worst;
}
