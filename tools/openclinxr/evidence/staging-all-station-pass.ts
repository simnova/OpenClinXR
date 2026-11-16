import type { Browser, Page } from "playwright";
import type { MeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";
import { computeMeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";
import { chromium } from "./lib/slotted-playwright.js";
import type { SampleRecord } from "./station-subset.js";
import { hashSeedFNV1a, selectStationSubset } from "./station-subset.js";
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
  /** Scenario ids the report's rows cover (R2 reader contract; [] when unknown). */
  coveredIds: (report: unknown) => string[];
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

/** R2: an artifact (or cached report) is usable only if it covers every needed id. */
function reportCoversIds(
  producer: StagingAllStationProducer,
  report: unknown,
  neededIds: string[],
): boolean {
  const covered = new Set(producer.coveredIds(report));
  return neededIds.every((scenarioId) => covered.has(scenarioId));
}

async function readCompleteArtifactSet(
  treeStamp: MeasurementTreeStamp,
  neededByProducer: Map<StagingAllStationProducerId, string[]>,
): Promise<Map<StagingAllStationProducerId, unknown> | null> {
  const reports = new Map<StagingAllStationProducerId, unknown>();
  for (const id of PRODUCER_IDS) {
    const producer = registeredProducer(id);
    const report = await dependencies.readArtifact(producer, treeStamp);
    const needed = neededByProducer.get(id) ?? [];
    // R2 reader guard: shape-valid is not enough — a partial artifact (e.g. a
    // 2-id write) under the current stamp is refused and re-measured.
    if (report === null || !reportCoversIds(producer, report, needed)) {
      if (report !== null) {
        const covered = producer.coveredIds(report).length;
        process.stdout.write(
          `staging-all-station-pass: refused ${id} artifact (covers ${covered} of ${needed.length} needed)\n`,
        );
      }
      return null;
    }
    reports.set(id, report);
  }
  return reports;
}

type StationPlan = {
  effectiveByProducer: Map<StagingAllStationProducerId, string[]>;
  sampled: boolean;
  sampleByProducer: Map<StagingAllStationProducerId, SampleRecord | null>;
};

async function planStations(
  activeProducers: StagingAllStationProducer[],
  input?: { baseUrl?: string | undefined; scenarioIds?: string[] | undefined },
): Promise<StationPlan> {
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

  // C1: per-push runs measure a seeded sample of the union, not the union itself.
  // Explicit scenarioIds (tests, one-off probes) bypass sampling entirely.
  let effectiveByProducer = scenarioIdsByProducer;
  let sampled = false;
  let seed: string | null = null;
  if (!input?.scenarioIds?.length) {
    const subset = selectStationSubset(allScenarioIds);
    if (!subset.full) {
      sampled = true;
      seed = subset.seed;
      const picked = new Set(subset.ids);
      const effective = new Map<StagingAllStationProducerId, string[]>();
      for (const producer of activeProducers) {
        const own = scenarioIdsByProducer.get(producer.id) ?? [];
        let ids = own.filter((scenarioId) => picked.has(scenarioId));
        if (ids.length === 0) {
          // R1/A1: producer lists differ, so a union sample can strand a producer
          // with nothing to measure. Pure seeded pick into its own list — it
          // rotates even when own.length <= n, unlike the old first-element
          // fallback. Exactly one log line; no second seed line.
          const topUp = own[hashSeedFNV1a(seed ?? "") % own.length]!;
          process.stdout.write(
            `station-subset: producer ${producer.id} had no sampled station, added ${topUp}\n`,
          );
          ids = [topUp];
        }
        effective.set(producer.id, ids);
      }
      effectiveByProducer = effective;
    }
  }

  // R6: each report records its own selection (null when the run measured everything).
  const sampleByProducer = new Map<StagingAllStationProducerId, SampleRecord | null>();
  for (const producer of activeProducers) {
    sampleByProducer.set(
      producer.id,
      sampled && seed !== null
        ? { seed, ids: [...(effectiveByProducer.get(producer.id) ?? [])] }
        : null,
    );
  }
  return { effectiveByProducer, sampled, sampleByProducer };
}

async function runPass(
  activeProducers: StagingAllStationProducer[],
  input?: { baseUrl?: string | undefined; scenarioIds?: string[] | undefined },
  plan?: StationPlan,
): Promise<{ reports: Map<StagingAllStationProducerId, unknown>; sampled: boolean }> {
  const usePlan = plan ?? await planStations(activeProducers, input);
  const { effectiveByProducer, sampled, sampleByProducer } = usePlan;

  const measuredScenarioIds = [
    ...new Set(activeProducers.flatMap((producer) => effectiveByProducer.get(producer.id) ?? [])),
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
        for (const scenarioId of measuredScenarioIds) {
          process.stdout.write(`staging-all-station-pass: goto ${scenarioId}\n`);
          await page.goto(dependencies.buildUrl(baseUrl, scenarioId), {
            waitUntil: "load",
            timeout: 180_000,
          });
          const producersForScenario = activeProducers.filter((producer) =>
            (effectiveByProducer.get(producer.id) ?? []).includes(scenarioId)
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
    const scenarioIds = effectiveByProducer.get(producer.id);
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
    // R6: the measured report records its own selection (null on full runs).
    const built = producer.buildReport(scenarioIds, orderedRows);
    const sample = sampleByProducer.get(producer.id) ?? null;
    reports.set(
      producer.id,
      built !== null && typeof built === "object" ? { ...(built as Record<string, unknown>), sample } : built,
    );
  }
  return { reports, sampled };
}

async function measureAndPublishCompleteSet(plan?: StationPlan): Promise<Map<StagingAllStationProducerId, unknown>> {
  if (combinedPassInFlight) return combinedPassInFlight;
  combinedPassInFlight = (async () => {
    const activeProducers = PRODUCER_IDS.map(registeredProducer);
    const usePlan = plan ?? await planStations(activeProducers);
    const { reports, sampled } = await runPass(activeProducers, undefined, usePlan);
    if (sampled) {
      // S2 CACHE: a sampled run must never WRITE an artifact — a later full run on
      // the same tree stamp would read the partial set as complete (see
      // readOrMeasureStagingAllStationReport above, which may READ a complete
      // full-set artifact for the same stamp). Sampled runs only warm the
      // in-process cache below.
      process.stdout.write("staging-all-station-pass: sampled run, skipping artifact writes\n");
    } else {
      const treeStamp = dependencies.computeTreeStamp();
      for (const producer of activeProducers) {
        await dependencies.writeArtifact(producer, reports.get(producer.id), treeStamp);
      }
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
  const activeProducers = PRODUCER_IDS.map(registeredProducer);
  // R2/R6: one selection per call, threaded to the cache check, the reader and
  // the measure below — so exactly one `station-subset: seed=` line is printed.
  const plan = await planStations(activeProducers);
  const producer = registeredProducer(id);
  const needed = plan.effectiveByProducer.get(id) ?? [];
  const cached = cachedReports.get(id);
  // R2: a sampled cached report is never returned to a full caller (or to a
  // run whose subset it does not cover) — same superset rule as the reader.
  if (cached !== undefined && reportCoversIds(producer, cached, needed)) {
    return cached as TReport;
  }

  const treeStamp = dependencies.computeTreeStamp();
  const artifacts = await readCompleteArtifactSet(treeStamp, plan.effectiveByProducer);
  if (artifacts) {
    for (const [producerId, report] of artifacts) cachedReports.set(producerId, report);
    return artifacts.get(id) as TReport;
  }

  const measured = await measureAndPublishCompleteSet(plan);
  return measured.get(id) as TReport;
}

export async function runSingleStagingAllStationProducer<TReport>(
  id: StagingAllStationProducerId,
  input?: { baseUrl?: string | undefined; scenarioIds?: string[] | undefined },
): Promise<TReport> {
  await ensureAllProducersRegistered();
  const activeProducers = [registeredProducer(id)];
  const plan = await planStations(activeProducers, input);
  const { reports } = await runPass(activeProducers, input, plan);
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
