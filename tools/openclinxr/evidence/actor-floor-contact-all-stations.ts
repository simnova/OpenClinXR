/**
 * #105 — live actor floor contact across every shipped station.
 *
 * One Vite boot, walk every bank scenario, measure skinned-mesh world bounds
 * via readLivePostureGeometryFromPage (ui-xr-environment-room-capture.ts).
 * Stations enumerated from listShippedCastScenarioIds() — never a hardcoded list.
 *
 * claimScope: lowest skinned-mesh vertex Y vs floor top y=0 across all cast stations.
 * notEvidenceFor: posture quality, wardrobe, clinical plausibility, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  readLivePostureGeometryFromPage,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const FLOOR_CONTACT_DIR = ".openclinxr/evidence/actor-floor-contact";
export const FLOOR_CONTACT_NAME = "actor-floor-contact-all-stations.json";

export type ActorFloorContact = {
  scenarioId: string;
  actorId: string;
  /** Lowest skinned-mesh vertex in world space. Floor top is y = 0. */
  lowestVertexY: number;
  declaredPosture: string;
  framesAdvanced: number;
};

export type ActorFloorContactReport = {
  scenarios: string[];
  actors: ActorFloorContact[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.actor-floor-contact-all-stations.v1";
  kind: "actor_floor_contact_all_stations";
  label: string;
  generatedAt: string;
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: ActorFloorContactReport;
};

/** In-process cache so three vitest cases share one measure pass. */
let cachedReport: ActorFloorContactReport | null = null;
let measureInFlight: Promise<ActorFloorContactReport> | null = null;

function artifactPath(): string {
  return path.join(FLOOR_CONTACT_DIR, FLOOR_CONTACT_NAME);
}

/**
 * Measure once into `.openclinxr/evidence/actor-floor-contact/`, assert against it.
 * Subsequent calls in-process return cache / re-read the artifact — one Vite boot.
 */
export async function measureActorFloorContact(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  /** Optional subset for local diagnosis; production path always uses full bank. */
  scenarioIds?: string[];
}): Promise<ActorFloorContactReport> {
  if (!input?.force && cachedReport) return cachedReport;
  if (!input?.force && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.scenarioIds) {
      const fromDisk = await tryReadArtifact();
      if (fromDisk) {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLiveAllStations({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });
    await writeFloorContactDump(report, { label: input?.label ?? "measure" });
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

async function tryReadArtifact(): Promise<ActorFloorContactReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null → re-measure). Fresh stamps still serve.
  return tryReadStampedArtifact(artifactPath(), (parsed) => {
    const report = parsed.report as ActorFloorContactReport | undefined;
    if (
      report?.scenarios
      && Array.isArray(report.scenarios)
      && report.scenarios.length > 0
      && Array.isArray(report.actors)
      && report.actors.length > 0
    ) {
      return report;
    }
    return null;
  });
}

export async function writeFloorContactDump(
  report: ActorFloorContactReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? artifactPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.actor-floor-contact-all-stations.v1" as const,
    kind: "actor_floor_contact_all_stations" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_skinned_mesh_world_bounds_lowest_vertex_y",
      "every_shipped_cast_station_enumerated_from_scenario_bank",
    ],
    notEvidenceFor: [
      "posture_quality",
      "wardrobe",
      "clinical_plausibility",
      "quest_readiness",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`floor-contact: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveAllStations(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<ActorFloorContactReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : listShippedCastScenarioIds();

  if (scenarios.length === 0) {
    throw new Error("measureActorFloorContact: listShippedCastScenarioIds returned empty");
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
        const actors: ActorFloorContact[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`floor-contact: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          await page.waitForTimeout(900);
          const live = await readLivePostureGeometryFromPage(page);
          // Prefer URL scenario id if the page report is empty/wrong.
          const sid = live.scenarioId || scenarioId;
          for (const a of live.actors) {
            const row: ActorFloorContact = {
              scenarioId: sid,
              actorId: a.actorId,
              lowestVertexY: a.lowestVertexY,
              declaredPosture: String(a.declaredPosture ?? "unknown"),
              framesAdvanced: a.framesAdvanced,
            };
            actors.push(row);
            process.stdout.write(
              `  ${row.scenarioId}/${row.actorId} posture=${row.declaredPosture} y0=${row.lowestVertexY.toFixed(3)} frames=${row.framesAdvanced}\n`,
            );
          }
          if (live.actors.length === 0) {
            process.stdout.write(`  WARN: no actors measured for ${scenarioId}\n`);
          }
        }
        return { scenarios: [...scenarios], actors };
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
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
      });
      return skinned >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let label = "cli";
  let scenarioFilter: string[] | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--label" && args[i + 1]) label = args[++i]!;
    else if (arg === "--scenario" && args[i + 1]) {
      scenarioFilter = (scenarioFilter ?? []).concat(args[++i]!);
    }
  }
  const report = await measureActorFloorContact({
    force: true,
    label,
    scenarioIds: scenarioFilter,
  });
  process.stdout.write(
    `floor-contact: ${report.scenarios.length} stations, ${report.actors.length} actors\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("actor-floor-contact-all-stations.ts")
    || process.argv[1].endsWith("actor-floor-contact-all-stations.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
