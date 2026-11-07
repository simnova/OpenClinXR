import type { Browser, Page } from "playwright";
import type { MeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";
import { computeMeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";
import { chromium } from "./lib/slotted-playwright.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
} from "./ui-xr-environment-room-capture.js";

export type StagingAllStationProducerId =
  | "actor-prop-intersection"
  | "actor-floor-contact-all-stations"
  | "actor-furniture-clearance";

const PRODUCER_IDS: readonly StagingAllStationProducerId[] = [
  "actor-prop-intersection",
  "actor-floor-contact-all-stations",
  "actor-furniture-clearance",
];

export type StagingAllStationProducer = {
  id: StagingAllStationProducerId;
  listScenarioIds: () => Promise<string[]>;
  measurePage: (page: Page, scenarioId: string) => Promise<unknown>;
  buildReport: (scenarioIds: string[], rows: unknown[]) => unknown;
  readArtifact: (treeStamp: MeasurementTreeStamp) => Promise<unknown | null>;
  writeArtifact: (report: unknown, treeStamp: MeasurementTreeStamp) => Promise<void>;
};

type PassDependencies = {
  spawnServer: () => Promise<PortlessDevServer>;
  stopServer: (server: PortlessDevServer) => Promise<void>;
  launchBrowser: () => Promise<Browser>;
  buildUrl: (baseUrl: string, scenarioId: string) => string;
  computeTreeStamp: () => MeasurementTreeStamp;
  listScenarioIds: (producer: StagingAllStationProducer) => Promise<string[]>;
  measurePage: (
    producer: StagingAllStationProducer,
    page: Page,
    scenarioId: string,
  ) => Promise<unknown>;
  readArtifact: (
    producer: StagingAllStationProducer,
    treeStamp: MeasurementTreeStamp,
  ) => Promise<unknown | null>;
  writeArtifact: (
    producer: StagingAllStationProducer,
    report: unknown,
    treeStamp: MeasurementTreeStamp,
  ) => Promise<void>;
};

const defaultDependencies: PassDependencies = {
  spawnServer: () =>
    spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    }),
  stopServer: async (server) => {
    await stopPortlessDevServer(server.proc);
  },
  launchBrowser: () => chromium.launch({ headless: true }),
  buildUrl: (baseUrl, scenarioId) =>
    buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE),
  computeTreeStamp: () => computeMeasurementTreeStamp(),
  listScenarioIds: (producer) => producer.listScenarioIds(),
  measurePage: (producer, page, scenarioId) => producer.measurePage(page, scenarioId),
  readArtifact: (producer, treeStamp) => producer.readArtifact(treeStamp),
  writeArtifact: (producer, report, treeStamp) =>
    producer.writeArtifact(report, treeStamp),
};

const producers = new Map<StagingAllStationProducerId, StagingAllStationProducer>();
const cachedReports = new Map<StagingAllStationProducerId, unknown>();
let dependencies: PassDependencies = defaultDependencies;
let combinedPassInFlight: Promise<Map<StagingAllStationProducerId, unknown>> | null = null;

export function registerStagingAllStationProducer(
  producer: StagingAllStationProducer,
): void {
  producers.set(producer.id, producer);
}

async function ensureAllProducersRegistered(): Promise<void> {
  await Promise.all([
    import("./actor-prop-intersection.js"),
    import("./actor-floor-contact-all-stations.js"),
    import("./actor-furniture-clearance.js"),
  ]);
  for (const id of PRODUCER_IDS) {
    if (!producers.has(id)) {
      throw new Error(`staging-all-station-pass: producer ${id} did not register`);
    }
  }
}

function registeredProducer(id: StagingAllStationProducerId): StagingAllStationProducer {
  const producer = producers.get(id);
  if (!producer) throw new Error(`staging-all-station-pass: missing producer ${id}`);
  return producer;
}

async function readCompleteArtifactSet(
  treeStamp: MeasurementTreeStamp,
): Promise<Map<StagingAllStationProducerId, unknown> | null> {
  const reports = new Map<StagingAllStationProducerId, unknown>();
  for (const id of PRODUCER_IDS) {
    const producer = registeredProducer(id);
    const report = await dependencies.readArtifact(producer, treeStamp);
    if (report === null) return null;
    reports.set(id, report);
  }
  return reports;
}

async function runPass(
  activeProducers: StagingAllStationProducer[],
  input?: { baseUrl?: string | undefined; scenarioIds?: string[] | undefined },
): Promise<Map<StagingAllStationProducerId, unknown>> {
  const scenarioIdsByProducer = new Map<StagingAllStationProducerId, string[]>();
  for (const producer of activeProducers) {
    const scenarioIds = input?.scenarioIds?.length
      ? [...input.scenarioIds]
      : await dependencies.listScenarioIds(producer);
    if (scenarioIds.length === 0) {
      throw new Error(`staging-all-station-pass: ${producer.id} returned no scenarios`);
    }
    scenarioIdsByProducer.set(producer.id, scenarioIds);
  }

  const allScenarioIds = [
    ...new Set(activeProducers.flatMap((producer) => scenarioIdsByProducer.get(producer.id) ?? [])),
  ];
  const rowsByProducer = new Map<
    StagingAllStationProducerId,
    Map<string, unknown>
  >();
  for (const producer of activeProducers) rowsByProducer.set(producer.id, new Map());

  let server: PortlessDevServer | undefined;
  try {
    if (!input?.baseUrl) server = await dependencies.spawnServer();
    const baseUrl = input?.baseUrl ?? server?.url;
    if (!baseUrl) throw new Error("staging-all-station-pass: no base URL available");
    const browser = await dependencies.launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        for (const scenarioId of allScenarioIds) {
          process.stdout.write(`staging-all-station-pass: goto ${scenarioId}\n`);
          await page.goto(dependencies.buildUrl(baseUrl, scenarioId), {
            waitUntil: "load",
            timeout: 180_000,
          });
          const producersForScenario = activeProducers.filter((producer) =>
            (scenarioIdsByProducer.get(producer.id) ?? []).includes(scenarioId)
          );
          const measureAndStore = async (producer: StagingAllStationProducer): Promise<void> => {
            const row = await dependencies.measurePage(producer, page, scenarioId);
            const rows = rowsByProducer.get(producer.id);
            if (!rows) throw new Error(`staging-all-station-pass: missing rows for ${producer.id}`);
            rows.set(scenarioId, row);
          };

          // Each producer keeps its own legacy-relative wait/read chain, but all three chains
          // start from this same completed navigation without waiting behind a sibling.
          await Promise.all(producersForScenario.map(measureAndStore));
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (server) await dependencies.stopServer(server).catch(() => undefined);
  }

  const reports = new Map<StagingAllStationProducerId, unknown>();
  for (const producer of activeProducers) {
    const scenarioIds = scenarioIdsByProducer.get(producer.id);
    const rows = rowsByProducer.get(producer.id);
    if (!scenarioIds || !rows) {
      throw new Error(`staging-all-station-pass: incomplete accumulator for ${producer.id}`);
    }
    const orderedRows = scenarioIds.map((scenarioId) => {
      if (!rows.has(scenarioId)) {
        throw new Error(`staging-all-station-pass: ${producer.id} missed ${scenarioId}`);
      }
      return rows.get(scenarioId);
    });
    reports.set(producer.id, producer.buildReport(scenarioIds, orderedRows));
  }
  return reports;
}

async function measureAndPublishCompleteSet(): Promise<Map<StagingAllStationProducerId, unknown>> {
  if (combinedPassInFlight) return combinedPassInFlight;
  combinedPassInFlight = (async () => {
    const activeProducers = PRODUCER_IDS.map(registeredProducer);
    const reports = await runPass(activeProducers);
    const treeStamp = dependencies.computeTreeStamp();
    for (const producer of activeProducers) {
      await dependencies.writeArtifact(producer, reports.get(producer.id), treeStamp);
    }
    for (const [id, report] of reports) cachedReports.set(id, report);
    return reports;
  })();
  try {
    return await combinedPassInFlight;
  } finally {
    combinedPassInFlight = null;
  }
}

export async function readOrMeasureStagingAllStationReport<TReport>(
  id: StagingAllStationProducerId,
): Promise<TReport> {
  await ensureAllProducersRegistered();
  const cached = cachedReports.get(id);
  if (cached !== undefined) return cached as TReport;

  const treeStamp = dependencies.computeTreeStamp();
  const artifacts = await readCompleteArtifactSet(treeStamp);
  if (artifacts) {
    for (const [producerId, report] of artifacts) cachedReports.set(producerId, report);
    return artifacts.get(id) as TReport;
  }

  const measured = await measureAndPublishCompleteSet();
  return measured.get(id) as TReport;
}

export async function runSingleStagingAllStationProducer<TReport>(
  id: StagingAllStationProducerId,
  input?: { baseUrl?: string | undefined; scenarioIds?: string[] | undefined },
): Promise<TReport> {
  await ensureAllProducersRegistered();
  const reports = await runPass([registeredProducer(id)], input);
  return reports.get(id) as TReport;
}

/** Browser-free test seam. Production callers must not replace these dependencies. */
export function setStagingAllStationPassDependenciesForTest(
  overrides: Partial<PassDependencies>,
): void {
  dependencies = { ...defaultDependencies, ...overrides };
  resetStagingAllStationPassRuntimeForTest();
}

export function resetStagingAllStationPassRuntimeForTest(): void {
  cachedReports.clear();
  combinedPassInFlight = null;
}

export function restoreStagingAllStationPassDependenciesForTest(): void {
  dependencies = defaultDependencies;
  resetStagingAllStationPassRuntimeForTest();
}
