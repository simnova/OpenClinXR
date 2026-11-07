import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@openclinxr/scenario-fixtures", () => ({
  authoredStagingCameraForScenario: () => undefined,
}));
vi.mock("@openclinxr/compute-slots/slots", () => ({
  withComputeSlot: async (_kind: string, _options: unknown, run: () => Promise<unknown>) => run(),
}));

import {
  type ActorFloorContact,
  buildActorFloorContactReport,
  measureActorFloorContact,
} from "../../../../../../tools/openclinxr/evidence/actor-floor-contact-all-stations.js";
import {
  buildActorFurnitureClearanceReport,
  inspectActorFurnitureClearance,
  type StationClearance,
} from "../../../../../../tools/openclinxr/evidence/actor-furniture-clearance.js";
import {
  buildActorPropIntersectionReport,
  inspectActorPropIntersection,
  type StationPropIntersection,
} from "../../../../../../tools/openclinxr/evidence/actor-prop-intersection.js";
import {
  MEASUREMENT_TREE_STAMP_ALGORITHM,
  type MeasurementTreeStamp,
  stampsMatch,
} from "../../../../../../tools/openclinxr/evidence/lib/measurement-tree-stamp.js";
import {
  resetStagingAllStationPassRuntimeForTest,
  restoreStagingAllStationPassDependenciesForTest,
  type StagingAllStationProducerId,
  setStagingAllStationPassDependenciesForTest,
} from "../../../../../../tools/openclinxr/evidence/staging-all-station-pass.js";

const EVIDENCE_TOOLS_DIR = fileURLToPath(new URL("../../../../../../tools/openclinxr/evidence/", import.meta.url));

const scenarios = ["station-a", "station-b"];
const floorScenarios = ["station-b", "station-a"];
const currentStamp: MeasurementTreeStamp = {
  head: "192734d6f0000000000000000000000000000000",
  fingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
  algorithm: MEASUREMENT_TREE_STAMP_ALGORITHM,
};
const staleStamp: MeasurementTreeStamp = {
  ...currentStamp,
  fingerprint: "2222222222222222222222222222222222222222222222222222222222222222",
};

const propRows: StationPropIntersection[] = scenarios.map((scenarioId, index) => ({
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
}));

const floorRows: ActorFloorContact[][] = scenarios.map((scenarioId, index) => [{
  scenarioId,
  actorId: `actor-${index}`,
  lowestVertexY: index / 100,
  declaredPosture: "standing",
  framesAdvanced: 8,
}]);
const floorRowsInProducerOrder = [floorRows[1] ?? [], floorRows[0] ?? []];

const furnitureRows: StationClearance[] = scenarios.map((scenarioId, index) => ({
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
}));

const fakePageRows: Record<StagingAllStationProducerId, unknown[]> = {
  "actor-prop-intersection": propRows,
  "actor-floor-contact-all-stations": floorRows,
  "actor-furniture-clearance": furnitureRows,
};

type StoredArtifact = { treeStamp: MeasurementTreeStamp; report: unknown };

describe("the three staging producers share one browser pass", () => {
  afterAll(() => restoreStagingAllStationPassDependenciesForTest());

  it("starts every producer chain from the shared goto without waiting behind a sibling", async () => {
    const producerIds: StagingAllStationProducerId[] = [
      "actor-prop-intersection",
      "actor-floor-contact-all-stations",
      "actor-furniture-clearance",
    ];
    const started: StagingAllStationProducerId[] = [];
    const reads: StagingAllStationProducerId[] = [];
    const releaseRead = new Map<StagingAllStationProducerId, () => void>();
    const legacyReadPoint = new Map(
      producerIds.map((producerId) => {
        let release: () => void = () => undefined;
        const reached = new Promise<void>((complete) => {
          release = complete;
        });
        releaseRead.set(producerId, release);
        return [producerId, reached] as const;
      }),
    );
    let gotoCount = 0;
    const fakePage = {
      goto: async () => {
        gotoCount += 1;
      },
      close: async () => undefined,
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: async () => undefined,
    };
    setStagingAllStationPassDependenciesForTest({
      spawnServer: async () => ({ url: "fake://ui-xr", proc: {} }) as never,
      stopServer: async () => undefined,
      launchBrowser: async () => fakeBrowser as never,
      buildUrl: (_baseUrl, scenarioId) => `fake://ui-xr/${scenarioId}`,
      computeTreeStamp: () => currentStamp,
      listScenarioIds: async () => ["station-a"],
      readArtifact: async () => null,
      writeArtifact: async () => undefined,
      measurePage: async (producer) => {
        started.push(producer.id);
        await legacyReadPoint.get(producer.id);
        reads.push(producer.id);
        if (producer.id === "actor-prop-intersection") {
          return propRows[0]!;
        }
        if (producer.id === "actor-floor-contact-all-stations") {
          return floorRows[0]!;
        }
        return furnitureRows[0]!;
      },
    });

    const measurement = measureActorFloorContact();
    let startFailure: unknown;
    try {
      await vi.waitFor(() => expect(started).toHaveLength(producerIds.length), {
        timeout: 1_000,
        interval: 1,
      });
    } catch (error) {
      startFailure = error;
    }

    expect(gotoCount).toBe(1);
    if (startFailure) {
      for (const release of releaseRead.values()) release();
      await measurement;
      throw startFailure;
    }
    for (const producerId of [
      "actor-furniture-clearance",
      "actor-prop-intersection",
      "actor-floor-contact-all-stations",
    ] as const) {
      releaseRead.get(producerId)?.();
      await vi.waitFor(() => expect(reads).toContain(producerId));
    }
    await measurement;
    expect([...started].sort()).toEqual([...producerIds].sort());
    expect(reads).toEqual([
      "actor-furniture-clearance",
      "actor-prop-intersection",
      "actor-floor-contact-all-stations",
    ]);
  });

  it("shares cold work, validates sibling stamps, and preserves every report", async () => {
    const producerSources = await Promise.all([
      "actor-prop-intersection.ts",
      "actor-floor-contact-all-stations.ts",
      "actor-furniture-clearance.ts",
    ].map((name) => readFile(resolve(EVIDENCE_TOOLS_DIR, name), "utf8")));
    const entryPoints = [
      ["export async function inspectActorPropIntersection", "async function tryReadArtifact"],
      ["export async function measureActorFloorContact", "async function tryReadArtifact"],
      ["export async function inspectActorFurnitureClearance", "async function tryReadArtifact"],
    ] as const;
    for (const [index, [start, end]] of entryPoints.entries()) {
      const source = producerSources[index]!;
      expect(source.slice(source.indexOf(start), source.indexOf(end))).not.toContain("chromium.launch");
    }

    const artifacts = new Map<StagingAllStationProducerId, StoredArtifact>();
    let serverBoots = 0;
    let launches = 0;
    let gotoCount = 0;
    let currentScenario = "";
    const fakePage = {
      goto: async (url: string) => {
        gotoCount += 1;
        currentScenario = url.split("/").at(-1)!;
      },
      close: async () => undefined,
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: async () => undefined,
    };

    setStagingAllStationPassDependenciesForTest({
      spawnServer: async () => {
        serverBoots += 1;
        return { url: "fake://ui-xr", proc: {} } as never;
      },
      stopServer: async () => undefined,
      launchBrowser: async () => {
        launches += 1;
        return fakeBrowser as never;
      },
      buildUrl: (_baseUrl, scenarioId) => `fake://ui-xr/${scenarioId}`,
      computeTreeStamp: () => currentStamp,
      listScenarioIds: async (producer) =>
        producer.id === "actor-floor-contact-all-stations" ? floorScenarios : scenarios,
      measurePage: async (producer, page, scenarioId) => {
        expect(page).toBe(fakePage);
        expect(currentScenario).toBe(scenarioId);
        return fakePageRows[producer.id][scenarios.indexOf(scenarioId)];
      },
      readArtifact: async (producer, treeStamp) => {
        const artifact = artifacts.get(producer.id);
        return artifact && stampsMatch(artifact.treeStamp, treeStamp) ? artifact.report : null;
      },
      writeArtifact: async (producer, report, treeStamp) => {
        artifacts.set(producer.id, { report, treeStamp });
      },
    });

    artifacts.clear();
    const firstProp = await inspectActorPropIntersection();
    const firstFloor = await measureActorFloorContact();
    const firstFurniture = await inspectActorFurnitureClearance();
    expect({ launches, serverBoots, gotoCount }).toEqual({
      launches: 1,
      serverBoots: 1,
      gotoCount: scenarios.length,
    });
    expect([...artifacts.keys()].sort()).toEqual([...Object.keys(fakePageRows)].sort());
    expect(new Set([...artifacts.values()].map((artifact) => artifact.treeStamp))).toEqual(
      new Set([currentStamp]),
    );

    expect(firstProp).toEqual(buildActorPropIntersectionReport(propRows));
    expect(firstFloor).toEqual(buildActorFloorContactReport(floorScenarios, floorRowsInProducerOrder));
    expect(firstFurniture).toEqual(buildActorFurnitureClearanceReport(furnitureRows));

    resetStagingAllStationPassRuntimeForTest();
    serverBoots = 0;
    launches = 0;
    gotoCount = 0;
    await inspectActorPropIntersection();
    await measureActorFloorContact();
    await inspectActorFurnitureClearance();
    expect({ launches, serverBoots, gotoCount }).toEqual({ launches: 0, serverBoots: 0, gotoCount: 0 });

    artifacts.set("actor-floor-contact-all-stations", {
      treeStamp: currentStamp,
      report: { scenarios: ["stale-sibling-was-served"], actors: [] },
    });
    artifacts.set("actor-furniture-clearance", {
      treeStamp: staleStamp,
      report: buildActorFurnitureClearanceReport(furnitureRows),
    });
    resetStagingAllStationPassRuntimeForTest();
    serverBoots = 0;
    launches = 0;
    gotoCount = 0;
    const refreshedFloor = await measureActorFloorContact();
    expect(refreshedFloor).toEqual(
      buildActorFloorContactReport(floorScenarios, floorRowsInProducerOrder),
    );
    expect(refreshedFloor.scenarios).not.toContain("stale-sibling-was-served");
    expect({ launches, serverBoots, gotoCount }).toEqual({
      launches: 1,
      serverBoots: 1,
      gotoCount: scenarios.length,
    });
    expect([...artifacts.values()].every((artifact) => stampsMatch(artifact.treeStamp, currentStamp))).toBe(true);
  });
});
