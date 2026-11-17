import { createHash } from "node:crypto";
import type { MakeDirectoryOptions, PathLike } from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementTreeStamp } from "../../../../../../tools/openclinxr/evidence/lib/measurement-tree-stamp.js";
import type { StagingAllStationProducerId } from "../../../../../../tools/openclinxr/evidence/staging-all-station-pass.js";

/**
 * C2 SAMPLED-PASS-SHARE (follow-up): a sampled combined pass writes one fixed
 * sampled artifact per producer and later file-states (fresh module state, like
 * a new test file) reuse it without measuring.
 *
 * No browser: server/browser/page/list/measure are stubbed like
 * the-three-staging-producers-share-one-browser-pass.test.ts. The pass's
 * read/write dependencies are REAL (the producer file helpers), redirected
 * from `.openclinxr/evidence/...` into a per-test temp root so the repo tree
 * is never touched.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const redirect = (filePath: string): string => {
    const root = (globalThis as unknown as { __sampledPassRedirectRoot?: string })
      .__sampledPassRedirectRoot;
    if (root) {
      const marker = ".openclinxr/evidence";
      const index = filePath.indexOf(marker);
      if (index >= 0) return `${root}/${filePath.slice(index)}`;
    }
    return filePath;
  };
  const redirectPath = (filePath: PathLike | FileHandle): PathLike | FileHandle =>
    typeof filePath === "string" ? redirect(filePath) : filePath;
  return {
    ...actual,
    mkdir: (async (dir: PathLike, options?: MakeDirectoryOptions) =>
      actual.mkdir(
        redirectPath(dir) as string,
        options as { recursive: boolean },
      )) as unknown as typeof actual.mkdir,
    readFile: (async (filePath: PathLike | FileHandle, ...rest: unknown[]) =>
      (actual.readFile as (...args: unknown[]) => Promise<unknown>)(
        redirectPath(filePath),
        ...rest,
      )) as unknown as typeof actual.readFile,
    writeFile: (async (filePath: PathLike | FileHandle, ...rest: unknown[]) =>
      (actual.writeFile as (...args: unknown[]) => Promise<unknown>)(
        redirectPath(filePath),
        ...rest,
      )) as unknown as typeof actual.writeFile,
  };
});

const SAMPLE_ENV = "OPENCLINXR_STATION_SAMPLE";
const SEED_ENV = "OPENCLINXR_STATION_SAMPLE_SEED";

const STUB_STATIONS = ["station-a", "station-b", "station-c", "station-d", "station-e"];

const ISSUE_183_DIR = ".openclinxr/evidence/issue-183";
const ISSUE_169_DIR = ".openclinxr/evidence/issue-169";
const FLOOR_CONTACT_DIR = ".openclinxr/evidence/actor-floor-contact";
const ISSUE_183_CANON = `${ISSUE_183_DIR}/pre-fix.json`;
const ISSUE_183_SAMPLED = `${ISSUE_183_DIR}/pre-fix.json.sampled.json`;
const ISSUE_169_CANON = `${ISSUE_169_DIR}/pre-fix.json`;
const ISSUE_169_SAMPLED = `${ISSUE_169_DIR}/pre-fix.json.sampled.json`;
const FLOOR_CANON = `${FLOOR_CONTACT_DIR}/actor-floor-contact-all-stations.json`;
const FLOOR_SAMPLED = `${FLOOR_CONTACT_DIR}/actor-floor-contact-all-stations.json.sampled.json`;

const CURRENT_STAMP: MeasurementTreeStamp = {
  head: "7a1c9e4b200000000000000000000000000000000",
  fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  algorithm: "git-head+status+diff-sha256",
};
const STALE_STAMP: MeasurementTreeStamp = {
  ...CURRENT_STAMP,
  fingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

type Counters = {
  goto: number;
  serverBoots: number;
  launches: number;
  perProducer: Record<StagingAllStationProducerId, number>;
};

function makeCounters(): Counters {
  return {
    goto: 0,
    serverBoots: 0,
    launches: 0,
    perProducer: {
      "actor-prop-intersection": 0,
      "actor-floor-contact-all-stations": 0,
      "actor-furniture-clearance": 0,
    },
  };
}

async function freshModules() {
  vi.resetModules();
  const pass = await import(
    "../../../../../../tools/openclinxr/evidence/staging-all-station-pass.js"
  );
  const prop = await import(
    "../../../../../../tools/openclinxr/evidence/actor-prop-intersection.js"
  );
  const floor = await import(
    "../../../../../../tools/openclinxr/evidence/actor-floor-contact-all-stations.js"
  );
  const furniture = await import(
    "../../../../../../tools/openclinxr/evidence/actor-furniture-clearance.js"
  );
  const subset = await import(
    "../../../../../../tools/openclinxr/evidence/station-subset.js"
  );
  return { pass, prop, floor, furniture, subset };
}

type Fresh = Awaited<ReturnType<typeof freshModules>>;

function propRow(scenarioId: string, index: number) {
  return {
    scenarioId,
    environmentId: `environment-${index}`,
    propCount: 1,
    actorCount: 1,
    collisions: [{
      scenarioId,
      actorId: `actor-${index}`,
      propId: `prop-${index}`,
      propSource: "fake-page",
      overlapFractionXZ: index === 0 ? 0 : 0.2,
      verticalStraddle: index === 1,
      actorPosture: "standing",
    }],
  };
}

function floorRowsFor(scenarioId: string, index: number) {
  return [{
    scenarioId,
    actorId: `actor-${index}`,
    lowestVertexY: index / 100,
    declaredPosture: "standing",
    framesAdvanced: 8,
  }];
}

function furnitureRow(scenarioId: string, index: number) {
  return {
    scenarioId,
    environmentId: `environment-${index}`,
    hasCeiling: true,
    patientSupportSurfaceCount: 1,
    supportSurfaces: [{
      id: `support-${index}`,
      source: "fake-page",
      footprint: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      deckTopY: 0.5,
    }],
    actors: [{
      scenarioId,
      actorId: `actor-${index}`,
      posture: "standing",
      actorFootprint: { minX: 1, maxX: 2, minZ: 0, maxZ: 1 },
      actorMinY: 0,
      actorMaxY: 1.8,
      nearestSupportId: `support-${index}`,
      nearestSupportSource: "fake-page",
      nearestSupportDeckTopY: 0.5,
      nearestSupportFootprint: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      overlapFractionOfSmaller: 0,
      straddlesDeck: true,
      isInsideFurniture: false,
    }],
  };
}

function stubSharedPass(
  fresh: Fresh,
  stamp: MeasurementTreeStamp,
  counters: Counters,
  hooks?: { gate?: Promise<void> | undefined; onEnter?: (() => void) | undefined },
): void {
  const fakePage = {
    goto: async () => {
      counters.goto += 1;
    },
    close: async () => undefined,
  };
  const fakeBrowser = {
    newPage: async () => fakePage,
    close: async () => undefined,
  };
  fresh.pass.setStagingAllStationPassDependenciesForTest({
    spawnServer: async () => {
      counters.serverBoots += 1;
      return { url: "fake://ui-xr", proc: {} } as never;
    },
    stopServer: async () => undefined,
    launchBrowser: async () => {
      counters.launches += 1;
      return fakeBrowser as never;
    },
    buildUrl: (_baseUrl: string, scenarioId: string) => `fake://ui-xr/${scenarioId}`,
    computeTreeStamp: () => ({ ...stamp }),
    listScenarioIds: async () => [...STUB_STATIONS],
    measurePage: async (producer: { id: string }, _page: unknown, scenarioId: string) => {
      hooks?.onEnter?.();
      if (hooks?.gate) await hooks.gate;
      const id = producer.id as StagingAllStationProducerId;
      counters.perProducer[id] += 1;
      const index = STUB_STATIONS.indexOf(scenarioId);
      if (id === "actor-floor-contact-all-stations") return floorRowsFor(scenarioId, index);
      if (id === "actor-prop-intersection") return propRow(scenarioId, index);
      return furnitureRow(scenarioId, index);
    },
  });
}

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("a sampled pass is shared across test files", () => {
  let redirectRoot = "";
  let savedSample: string | undefined;
  let savedSeed: string | undefined;

  beforeEach(() => {
    savedSample = process.env[SAMPLE_ENV];
    savedSeed = process.env[SEED_ENV];
    redirectRoot = mkdtempSync(join(tmpdir(), "sampled-pass-share-"));
    (globalThis as unknown as { __sampledPassRedirectRoot?: string }).__sampledPassRedirectRoot =
      redirectRoot;
  });

  afterEach(() => {
    if (savedSample === undefined) delete process.env[SAMPLE_ENV];
    else process.env[SAMPLE_ENV] = savedSample;
    if (savedSeed === undefined) delete process.env[SEED_ENV];
    else process.env[SEED_ENV] = savedSeed;
    // F8: leave no trace — drop the temp root and the redirect pointer.
    rmSync(redirectRoot, { recursive: true, force: true });
    delete (globalThis as unknown as { __sampledPassRedirectRoot?: string }).__sampledPassRedirectRoot;
  });

  const under = (rel: string): string => join(redirectRoot, rel);
  const setSampled = (size: string | undefined, seed: string | undefined): void => {
    if (size === undefined) delete process.env[SAMPLE_ENV];
    else process.env[SAMPLE_ENV] = size;
    if (seed === undefined) delete process.env[SEED_ENV];
    else process.env[SEED_ENV] = seed;
  };

  it("T1 sharing: a second file-state reuses the sampled pass without measuring", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    const countersA = makeCounters();
    stubSharedPass(fresh, CURRENT_STAMP, countersA);

    const reportA = await fresh.prop.inspectActorPropIntersection();
    const sampleIds = reportA.sample?.ids ?? [];
    expect(sampleIds.length, "sampled run measured nothing").toBeGreaterThan(0);
    expect(countersA.perProducer["actor-prop-intersection"]).toBe(sampleIds.length);
    expect(countersA.goto).toBe(sampleIds.length);
    expect(countersA.launches).toBe(1);
    expect(existsSync(under(ISSUE_183_SAMPLED)), "sampled pass writes its fixed artifact").toBe(true);
    expect(existsSync(under(ISSUE_169_SAMPLED))).toBe(true);
    expect(existsSync(under(FLOOR_SAMPLED))).toBe(true);

    // Fresh module state = a new test file: in-process cache is gone, so any
    // reuse must come from the sampled artifacts on disk.
    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, CURRENT_STAMP, countersB);
    const reportB = await second.prop.inspectActorPropIntersection();
    expect(countersB.perProducer["actor-prop-intersection"]).toBe(0);
    expect(countersB.goto).toBe(0);
    expect(countersB.launches).toBe(0);
    expect(countersB.serverBoots).toBe(0);
    expect(reportB).toEqual(reportA);
  });

  it("T2 seed change: a new seed re-measures instead of reusing", async () => {
    // s and k2 pick the SAME ids, so only the seed clause can refuse reuse.
    setSampled("2", "s");
    const fresh = await freshModules();
    stubSharedPass(fresh, CURRENT_STAMP, makeCounters());
    const reportA = await fresh.prop.inspectActorPropIntersection();
    expect(reportA.sample?.seed).toBe("s");

    const planS = fresh.subset.selectStationSubset([...STUB_STATIONS].sort(), {
      [SAMPLE_ENV]: "2",
      [SEED_ENV]: "s",
    });
    const planK = fresh.subset.selectStationSubset([...STUB_STATIONS].sort(), {
      [SAMPLE_ENV]: "2",
      [SEED_ENV]: "k2",
    });
    expect(planS.seed).toBe("s");
    expect(planK.seed).toBe("k2");
    expect([...planK.ids].sort(), "test seeds must pick the same ids").toEqual(
      [...planS.ids].sort(),
    );

    setSampled("2", "k2");
    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, CURRENT_STAMP, countersB);
    const reportB = await second.prop.inspectActorPropIntersection();
    expect(countersB.perProducer["actor-prop-intersection"]).toBeGreaterThan(0);
    expect(countersB.goto).toBeGreaterThan(0);
    expect(reportB.sample?.seed).toBe("k2");
  });

  it("T3 stale stamp: a moved tree stamp re-measures instead of reusing", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    stubSharedPass(fresh, CURRENT_STAMP, makeCounters());
    await fresh.prop.inspectActorPropIntersection();

    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, STALE_STAMP, countersB);
    const reportB = await second.prop.inspectActorPropIntersection();
    expect(countersB.perProducer["actor-prop-intersection"]).toBeGreaterThan(0);
    expect(countersB.goto).toBeGreaterThan(0);
    expect(reportB.sample?.seed).toBe("s");
  });

  it("T4 unset never reads sampled: an unset run re-measures and leaves sampled bytes alone", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    stubSharedPass(fresh, CURRENT_STAMP, makeCounters());
    await fresh.prop.inspectActorPropIntersection();
    const sampledBytes = readFileSync(under(ISSUE_183_SAMPLED), "utf8");
    expect(sampledBytes.length).toBeGreaterThan(0);

    setSampled(undefined, undefined);
    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, CURRENT_STAMP, countersB);
    const reportB = await second.prop.inspectActorPropIntersection();
    expect(countersB.perProducer["actor-prop-intersection"]).toBe(STUB_STATIONS.length);
    expect(countersB.goto).toBe(STUB_STATIONS.length);
    expect(reportB.sample).toBeNull();
    expect(reportB.stations).toHaveLength(STUB_STATIONS.length);
    expect(existsSync(under(ISSUE_183_CANON)), "unset run writes the canonical artifact").toBe(true);
    const canonical = JSON.parse(readFileSync(under(ISSUE_183_CANON), "utf8")) as {
      report?: { stations?: unknown[]; sample?: unknown };
    };
    expect(canonical.report?.stations).toHaveLength(STUB_STATIONS.length);
    expect(canonical.report?.sample).toBeNull();
    expect(readFileSync(under(ISSUE_183_SAMPLED), "utf8")).toBe(sampledBytes);
  });

  it("T5 sampled never writes canonical: planted canonical bytes survive sampled work", async () => {
    // F1: plant every producer's canonical artifact with a NON-current stamp,
    // so the sampled run cannot reuse them and must measure.
    setSampled(undefined, undefined);
    const fresh = await freshModules();
    stubSharedPass(fresh, CURRENT_STAMP, makeCounters());
    const fullProp = fresh.prop.buildActorPropIntersectionReport(
      STUB_STATIONS.map((scenarioId, index) => propRow(scenarioId, index)),
    );
    const fullFurniture = fresh.furniture.buildActorFurnitureClearanceReport(
      STUB_STATIONS.map((scenarioId, index) => furnitureRow(scenarioId, index)),
    );
    const fullFloor = fresh.floor.buildActorFloorContactReport(
      [...STUB_STATIONS],
      STUB_STATIONS.map((scenarioId, index) => floorRowsFor(scenarioId, index)),
    );
    await fresh.prop.writePropDump(fullProp, {
      outputPath: ISSUE_183_CANON,
      label: "pre-fix",
      treeStamp: STALE_STAMP,
    });
    await fresh.furniture.writeClearanceDump(fullFurniture, {
      outputPath: ISSUE_169_CANON,
      label: "pre-fix",
      treeStamp: STALE_STAMP,
    });
    await fresh.floor.writeFloorContactDump(fullFloor, {
      outputPath: FLOOR_CANON,
      label: "measure",
      treeStamp: STALE_STAMP,
    });
    const canonPaths = [ISSUE_183_CANON, ISSUE_169_CANON, FLOOR_CANON];
    for (const rel of canonPaths) {
      expect(existsSync(under(rel)), `T5 needs a planted canonical artifact at ${rel}`).toBe(true);
    }
    const shaBefore = new Map(canonPaths.map((rel) => [rel, sha256Hex(readFileSync(under(rel), "utf8"))]));

    setSampled("2", "s");
    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, CURRENT_STAMP, countersB);
    const combined = await second.prop.inspectActorPropIntersection();
    const combinedSampleIds = combined.sample?.ids ?? [];
    expect(combinedSampleIds.length, "stale canonicals must force a sampled measure").toBeGreaterThan(0);
    expect(countersB.perProducer["actor-prop-intersection"]).toBe(combinedSampleIds.length);

    const propCallsBefore = countersB.perProducer["actor-prop-intersection"];
    await second.prop.inspectActorPropIntersection({ writePreFix: true });
    expect(
      countersB.perProducer["actor-prop-intersection"] - propCallsBefore,
      "sampled prop writePreFix measures its own sample",
    ).toBe(combinedSampleIds.length);

    const furnitureCallsBefore = countersB.perProducer["actor-furniture-clearance"];
    await second.furniture.inspectActorFurnitureClearance({ writePreFix: true });
    expect(
      countersB.perProducer["actor-furniture-clearance"] - furnitureCallsBefore,
      "sampled furniture writePreFix measures its own sample",
    ).toBe(combinedSampleIds.length);

    const floorCallsBefore = countersB.perProducer["actor-floor-contact-all-stations"];
    await second.floor.measureActorFloorContact({ baseUrl: "fake://ui-xr" });
    expect(
      countersB.perProducer["actor-floor-contact-all-stations"] - floorCallsBefore,
      "sampled floor non-shared write measures its own sample",
    ).toBe(combinedSampleIds.length);

    expect(existsSync(under(ISSUE_183_SAMPLED)), "sampled prop artifacts land on sampled paths").toBe(true);
    expect(existsSync(under(ISSUE_169_SAMPLED))).toBe(true);
    expect(existsSync(under(FLOOR_SAMPLED))).toBe(true);
    for (const rel of canonPaths) {
      expect(existsSync(under(rel)), `canonical artifact must survive at ${rel}`).toBe(true);
      expect(sha256Hex(readFileSync(under(rel), "utf8")), `canonical bytes changed at ${rel}`).toBe(
        shaBefore.get(rel),
      );
    }
  });

  it("T6 cache key: a sampled call never serves a later unset call in one process", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    const counters = makeCounters();
    stubSharedPass(fresh, CURRENT_STAMP, counters);
    const sampledS = await fresh.prop.inspectActorPropIntersection();
    expect(sampledS.sample?.seed).toBe("s");
    expect(counters.perProducer["actor-prop-intersection"]).toBe(2);

    // Same planned ids (s and k2 coincide), different seed: only a seed-keyed
    // cache refuses this; id-set coverage alone would serve the stale report.
    setSampled("2", "k2");
    const sampledK = await fresh.prop.inspectActorPropIntersection();
    expect(sampledK.sample?.seed).toBe("k2");
    expect(counters.perProducer["actor-prop-intersection"]).toBe(4);

    setSampled(undefined, undefined);
    const full = await fresh.prop.inspectActorPropIntersection();
    expect(full.sample).toBeNull();
    expect(full.stations).toHaveLength(STUB_STATIONS.length);
    expect(counters.perProducer["actor-prop-intersection"]).toBe(9);
  });

  it("T7 retention: one fixed sampled file per producer, overwritten on seed change", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    stubSharedPass(fresh, CURRENT_STAMP, makeCounters());
    await fresh.prop.inspectActorPropIntersection();

    setSampled("2", "t");
    const second = await freshModules();
    stubSharedPass(second, CURRENT_STAMP, makeCounters());
    await second.prop.inspectActorPropIntersection();

    for (const dir of [ISSUE_183_DIR, ISSUE_169_DIR, FLOOR_CONTACT_DIR]) {
      const entries = readdirSync(under(dir));
      expect(entries, `exactly one sampled file survives in ${dir}`).toHaveLength(1);
      const [only] = entries;
      if (typeof only !== "string") throw new Error(`expected one sampled file in ${dir}`);
      expect(only).toMatch(/\.sampled\.json$/);
      const payload = JSON.parse(readFileSync(join(under(dir), only), "utf8")) as {
        report?: { sample?: { seed?: unknown } };
      };
      expect(payload.report?.sample?.seed).toBe("t");
    }
  });

  it("T8 mid-flight key change: an unset caller never joins a sampled pass", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    const counters = makeCounters();
    let entered = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubSharedPass(fresh, CURRENT_STAMP, counters, {
      gate,
      onEnter: () => {
        entered += 1;
      },
    });

    const sampledFlight = fresh.prop.inspectActorPropIntersection();
    await vi.waitFor(() => expect(entered).toBeGreaterThan(0), { timeout: 5000, interval: 5 });

    setSampled(undefined, undefined);
    const unsetFlight = fresh.prop.inspectActorPropIntersection();
    release();
    const [sampledReport, unsetReport] = await Promise.all([sampledFlight, unsetFlight]);
    expect(sampledReport.sample?.seed).toBe("s");
    expect(unsetReport.sample).toBeNull();
    expect(unsetReport.stations).toHaveLength(STUB_STATIONS.length);

    // The sampled flight finished under the unset key, so its store was
    // dropped; the cache serves the full report with no further measuring.
    const callsAfter = counters.perProducer["actor-prop-intersection"];
    const third = await fresh.prop.inspectActorPropIntersection();
    expect(third.sample).toBeNull();
    expect(third.stations).toHaveLength(STUB_STATIONS.length);
    expect(counters.perProducer["actor-prop-intersection"]).toBe(callsAfter);
  });

  it("T9 crafted samples: duplicates and non-strings are refused", async () => {
    setSampled("2", "s");
    const plantCraftedSampled = (sample: unknown): void => {
      const payload = {
        schemaVersion: "openclinxr.actor-prop-intersection.v1",
        kind: "actor_prop_intersection_live",
        label: "crafted",
        generatedAt: new Date().toISOString(),
        treeStamp: CURRENT_STAMP,
        claimScope: ["crafted"],
        notEvidenceFor: ["crafted"],
        report: {
          stations: [],
          sample,
          insideOverlapFractionThreshold: 0.18,
          collisionCount: 0,
          propInclusionPolicy: { included: [], excluded: [] },
        },
      };
      mkdirSync(dirname(under(ISSUE_183_SAMPLED)), { recursive: true });
      writeFileSync(under(ISSUE_183_SAMPLED), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    };

    const fresh = await freshModules();
    const planned = fresh.subset.selectStationSubset([...STUB_STATIONS].sort(), {
      [SAMPLE_ENV]: "2",
      [SEED_ENV]: "s",
    }).ids;
    const [first] = planned;
    if (typeof first !== "string") throw new Error("expected a planned sample");
    const countersA = makeCounters();
    stubSharedPass(fresh, CURRENT_STAMP, countersA);
    plantCraftedSampled({ seed: "s", ids: [first, first] });
    const dupes = await fresh.prop.inspectActorPropIntersection();
    expect(countersA.perProducer["actor-prop-intersection"]).toBe(2);
    expect([...(dupes.sample?.ids ?? [])].sort()).toEqual([...planned].sort());

    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, CURRENT_STAMP, countersB);
    plantCraftedSampled({ seed: "s", ids: [...planned, 123] });
    const mixed = await second.prop.inspectActorPropIntersection();
    expect(countersB.perProducer["actor-prop-intersection"]).toBe(2);
    expect([...(mixed.sample?.ids ?? [])].sort()).toEqual([...planned].sort());
  });

  it("T10 same seed new ids: a bigger sample re-measures", async () => {
    setSampled("2", "s");
    const fresh = await freshModules();
    stubSharedPass(fresh, CURRENT_STAMP, makeCounters());
    const reportA = await fresh.prop.inspectActorPropIntersection();
    expect(reportA.sample?.seed).toBe("s");
    expect(reportA.sample?.ids).toHaveLength(2);

    const sorted = [...STUB_STATIONS].sort();
    const plan2 = fresh.subset.selectStationSubset(sorted, { [SAMPLE_ENV]: "2", [SEED_ENV]: "s" });
    const plan3 = fresh.subset.selectStationSubset(sorted, { [SAMPLE_ENV]: "3", [SEED_ENV]: "s" });
    expect(plan2.seed).toBe("s");
    expect(plan3.seed).toBe("s");
    expect(plan3.ids).toHaveLength(3);
    expect([...plan3.ids].sort(), "growing the sample must change the id set").not.toEqual(
      [...plan2.ids].sort(),
    );

    setSampled("3", "s");
    const second = await freshModules();
    const countersB = makeCounters();
    stubSharedPass(second, CURRENT_STAMP, countersB);
    const reportB = await second.prop.inspectActorPropIntersection();
    expect(countersB.perProducer["actor-prop-intersection"]).toBe(3);
    expect(countersB.goto).toBe(3);
    expect(reportB.sample?.seed).toBe("s");
    expect(reportB.sample?.ids).toHaveLength(3);
  });
});
