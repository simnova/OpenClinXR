/**
 * #105 — live actor floor contact across every shipped station.
 *
 * One Vite boot, walk every bank scenario, measure skinned-mesh world bounds
 * via readLivePostureGeometryFromPage (ui-xr-environment-room-capture.ts).
 * Stations enumerated from listShippedCastScenarioIds() — never a hardcoded list.
 *
 * #145: the probe must not count #122 unfilled slot placeholders (empty openClinXrActorId,
 * hidden, primitive scaffold at y≈0.95 → y0≈0.93). Product grounding was already correct;
 * the defect was what counted as an actor. See .openclinxr/evidence/issue-145/pre-fix.json.
 *
 * claimScope: lowest skinned-mesh vertex Y vs floor top y=0 across all cast stations.
 * notEvidenceFor: posture quality, wardrobe, clinical plausibility, Quest readiness.
 */
/// <reference path="./browser-dom.d.ts" />

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type MeasurementTreeStamp,
  tryReadStampedArtifact,
  withTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import type { Page } from "./lib/slotted-playwright.js";
import {
  currentPassTreeStampForWrite,
  readOrMeasureStagingAllStationReport,
  registerStagingAllStationProducer,
  runSingleStagingAllStationProducer,
} from "./staging-all-station-pass.js";
import type { SampleRecord } from "./station-subset.js";
import {
  readLivePostureGeometryFromPage,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const FLOOR_CONTACT_DIR = ".openclinxr/evidence/actor-floor-contact";
export const FLOOR_CONTACT_NAME = "actor-floor-contact-all-stations.json";
/** S1: fixed sampled path next to the canonical artifact (key lives in content). */
export const FLOOR_CONTACT_SAMPLED_NAME = "actor-floor-contact-all-stations.json.sampled.json";

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
  /** R6: the selection this report measured (null when it measured everything). */
  sample: SampleRecord | null;
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

function artifactPath(): string {
  return path.join(FLOOR_CONTACT_DIR, FLOOR_CONTACT_NAME);
}

function sampledArtifactPath(): string {
  return path.join(FLOOR_CONTACT_DIR, FLOOR_CONTACT_SAMPLED_NAME);
}

/** S4: a sampled non-shared write goes to the fixed sampled path, never canonical. */
export function floorContactPathForReport(report: ActorFloorContactReport): string {
  return report.sample ? sampledArtifactPath() : artifactPath();
}

async function listFloorContactScenarioIds(): Promise<string[]> {
  const { listShippedCastScenarioIds } = await import(
    "../../../packages/openclinxr/asset-registry/src/actor-casting.js"
  );
  return listShippedCastScenarioIds();
}

/**
 * Measure once into `.openclinxr/evidence/actor-floor-contact/`, assert against it.
 * Subsequent calls in-process return cache / re-read the artifact — one Vite boot.
 */
export async function measureActorFloorContact(input?: {
  baseUrl?: string | undefined;
  force?: boolean;
  label?: string;
  /** Optional subset for local diagnosis; production path always uses full bank. */
  scenarioIds?: string[] | undefined;
}): Promise<ActorFloorContactReport> {
  if (!input?.force && !input?.scenarioIds && !input?.baseUrl) {
    return readOrMeasureStagingAllStationReport("actor-floor-contact-all-stations");
  }

  const report = await measureLiveAllStations({
    baseUrl: input?.baseUrl,
    scenarioIds: input?.scenarioIds,
  });
  // F7: one path via the router — sampled reports land on the sampled path,
  // unset reports resolve to the canonical default exactly as before.
  await writeFloorContactDump(report, {
    outputPath: floorContactPathForReport(report),
    label: input?.label ?? "measure",
    treeStamp: currentPassTreeStampForWrite(),
  });
  return report;
}

async function tryReadArtifact(
  treeStamp?: MeasurementTreeStamp,
): Promise<ActorFloorContactReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null → re-measure). Fresh stamps still serve.
  // R2: shape check only — coverage (coveredIds ⊇ needed) is the READER's guard
  // in the pass, which knows the run's needed ids. Length alone never accepts.
  return tryReadStampedArtifact(artifactPath(), (parsed) => {
    const report = parsed["report"] as ActorFloorContactReport | undefined;
    if (
      report?.scenarios
      && Array.isArray(report.scenarios)
      && Array.isArray(report.actors)
    ) {
      return report;
    }
    return null;
  }, treeStamp ? { currentStamp: treeStamp } : undefined);
}

async function tryReadSampledArtifact(
  treeStamp?: MeasurementTreeStamp,
): Promise<ActorFloorContactReport | null> {
  // Same shape-only contract as the canonical reader; coverage (seed + ids)
  // is the PASS's guard, which knows the run's plan.
  return tryReadStampedArtifact(sampledArtifactPath(), (parsed) => {
    const report = parsed["report"] as ActorFloorContactReport | undefined;
    if (
      report?.scenarios
      && Array.isArray(report.scenarios)
      && Array.isArray(report.actors)
    ) {
      return report;
    }
    return null;
  }, treeStamp ? { currentStamp: treeStamp } : undefined);
}

export async function writeFloorContactDump(
  report: ActorFloorContactReport,
  input?: { outputPath?: string; label?: string; treeStamp?: MeasurementTreeStamp },
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
  }, input?.treeStamp) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`floor-contact: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveAllStations(input: {
  baseUrl?: string | undefined;
  scenarioIds?: string[] | undefined;
}): Promise<ActorFloorContactReport> {
  return runSingleStagingAllStationProducer("actor-floor-contact-all-stations", input);
}

async function measureFloorContactPage(
  page: Page,
  scenarioId: string,
): Promise<ActorFloorContact[]> {
  await waitForStationShell(page, 180_000);
  await waitForHumanoidsAndFrames(page, 8, 180_000);
  await waitForSceneAssetsSettled(page, 60_000);
  await page.waitForTimeout(900);
  const live = await readLivePostureGeometryFromPage(page);
  const sid = live.scenarioId || scenarioId;
  return live.actors.map((actor) => ({
    scenarioId: sid,
    actorId: actor.actorId,
    lowestVertexY: actor.lowestVertexY,
    declaredPosture: String(actor.declaredPosture ?? "unknown"),
    framesAdvanced: actor.framesAdvanced,
  }));
}

export function buildActorFloorContactReport(
  scenarios: string[],
  actorRows: ActorFloorContact[][],
): ActorFloorContactReport {
  return { scenarios: [...scenarios], actors: actorRows.flat(), sample: null };
}

registerStagingAllStationProducer({
  id: "actor-floor-contact-all-stations",
  listScenarioIds: listFloorContactScenarioIds,
  measurePage: measureFloorContactPage,
  buildReport: (scenarioIds, rows) =>
    buildActorFloorContactReport(scenarioIds, rows as ActorFloorContact[][]),
  readArtifact: tryReadArtifact,
  coveredIds: (report) => {
    // R2: the report already carries its measured list (scenarios); the
    // selection record doubles as coverage when a sampled run wrote it.
    const shaped = report as Partial<ActorFloorContactReport> | null | undefined;
    if (!shaped || typeof shaped !== "object") return [];
    if (Array.isArray(shaped.sample?.ids)) return [...shaped.sample.ids];
    return Array.isArray(shaped.scenarios) ? [...shaped.scenarios] : [];
  },
  writeArtifact: async (report, treeStamp) => {
    await writeFloorContactDump(report as ActorFloorContactReport, {
      label: "combined-measure",
      treeStamp,
    });
  },
  readSampledArtifact: tryReadSampledArtifact,
  writeSampledArtifact: async (report, treeStamp) => {
    await writeFloorContactDump(report as ActorFloorContactReport, {
      outputPath: sampledArtifactPath(),
      label: "combined-measure-sampled",
      treeStamp,
    });
  },
});

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

async function waitForSceneAssetsSettled(page: Page, timeoutMs: number): Promise<void> {
  const started = Date.now();
  try {
    await page.waitForFunction(
      () => {
        const win = browserPageWindow as unknown as {
          __openClinXrSceneAssetEvidence?: { pendingCount?: number; assets?: unknown[] };
        };
        const evidence = win.__openClinXrSceneAssetEvidence;
        return Boolean(
          evidence
          && Array.isArray(evidence.assets)
          && evidence.assets.length > 0
          && (evidence.pendingCount ?? 0) === 0,
        );
      },
      {},
      { timeout: Math.min(timeoutMs, 60_000) },
    );
  } catch {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining > 0) await page.waitForTimeout(Math.min(remaining, 30_000));
  }
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
