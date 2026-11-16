import { afterEach, describe, expect, it } from "vitest";
import {
  MEASUREMENT_TREE_STAMP_ALGORITHM,
  type MeasurementTreeStamp,
} from "../lib/measurement-tree-stamp.js";
import {
  readOrMeasureStagingAllStationReport,
  resetStagingAllStationPassRuntimeForTest,
  restoreStagingAllStationPassDependenciesForTest,
  type StagingAllStationProducerId,
  setStagingAllStationPassDependenciesForTest,
} from "../staging-all-station-pass.js";
import {
  STATION_SAMPLE_ENV,
  STATION_SAMPLE_SEED_ENV,
  selectStationSubset,
} from "../station-subset.js";
import { assertFloorContactCoverage } from "./floor-contact-sample.js";

/** The 15 shipped stations (apps/ui-xr/public/xr-assets/generated), fixed shuffled order. */
const FIFTEEN = [
  "ward_delirium_med_rec_v1",
  "ed_chest_pain_priority_v1",
  "telehealth_diabetes_health_literacy_v1",
  "adult_abdominal_pain_v1",
  "peds_fever_v1",
  "clinic_abdominal_pain_interpreter_v1",
  "oncology_bad_news_family_v1",
  "stepdown_sepsis_nurse_escalation_v1",
  "psych_suicidal_ideation_safety_v1",
  "ed_stroke_alert_handoff_v1",
  "postop_fever_consult_pressure_v1",
  "ob_headache_preeclampsia_triage_v1",
  "ed_chest_pain_priority_v2",
  "primary_care_dyslipidemia_joint_pain_v1",
  "peds_asthma_parent_anxiety_v1",
];

const FIVE = FIFTEEN.slice(0, 5);

function fakeEnv(n: string | undefined, seed: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (n !== undefined) env[STATION_SAMPLE_ENV] = n;
  if (seed !== undefined) env[STATION_SAMPLE_SEED_ENV] = seed;
  return env;
}

afterEach(() => {
  delete process.env[STATION_SAMPLE_ENV];
  delete process.env[STATION_SAMPLE_SEED_ENV];
  restoreStagingAllStationPassDependenciesForTest();
});

describe("selectStationSubset", () => {
  it("T1: unset env measures the full input list, deep-equal, in order", () => {
    for (const env of [fakeEnv(undefined, undefined), fakeEnv("", undefined)]) {
      const subset = selectStationSubset(FIFTEEN, env);
      expect(subset.full).toBe(true);
      expect(subset.seed).toBeNull();
      expect(subset.ids).toEqual(FIFTEEN);
    }
  });

  it("T2: n=2 with a seed picks 2 ids deterministically", () => {
    const first = selectStationSubset(FIFTEEN, fakeEnv("2", "abc"));
    expect(first.full).toBe(false);
    expect(first.ids).toHaveLength(2);
    for (const id of first.ids) expect(FIFTEEN).toContain(id);
    const second = selectStationSubset(FIFTEEN, fakeEnv("2", "abc"));
    expect(second.ids).toEqual(first.ids);
  });

  it("T3: different seeds do not all collapse to one pick", () => {
    const pairs: Array<[string, string]> = [
      ["a", "b"],
      ["seed-1", "seed-2"],
      ["x", "y"],
      ["alpha", "beta"],
      ["one", "two"],
    ];
    const anyDiffers = pairs.some(([s1, s2]) => {
      const a = selectStationSubset(FIFTEEN, fakeEnv("2", s1)).ids.join(",");
      const b = selectStationSubset(FIFTEEN, fakeEnv("2", s2)).ids.join(",");
      return a !== b;
    });
    expect(anyDiffers).toBe(true);
  });

  it("T4: bad sizes and a missing seed throw naming both env vars", () => {
    for (const env of [
      fakeEnv("2", undefined),
      fakeEnv("x", "abc"),
      fakeEnv("0", "abc"),
      fakeEnv("-1", "abc"),
    ]) {
      let message = "";
      try {
        selectStationSubset(FIFTEEN, env);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message, `env ${JSON.stringify(env)}`).toContain(STATION_SAMPLE_ENV);
      expect(message, `env ${JSON.stringify(env)}`).toContain(STATION_SAMPLE_SEED_ENV);
    }
  });

  it("T5: n >= list length is a full run", () => {
    const subset = selectStationSubset(FIFTEEN, fakeEnv("99", "abc"));
    expect(subset.full).toBe(true);
    expect(subset.ids).toEqual(FIFTEEN);
  });
});

describe("staging-all-station-pass sampling (no browser)", () => {
  const stamp: MeasurementTreeStamp = {
    head: "abc123abc123abc123abc123abc123abc123abcd",
    fingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
    algorithm: MEASUREMENT_TREE_STAMP_ALGORITHM,
  };

  function installStubs(options: {
    lists: Record<StagingAllStationProducerId, string[]>;
    onMeasure: (producer: StagingAllStationProducerId, scenarioId: string) => void;
    onWrite: (producer: StagingAllStationProducerId) => void;
    read?: (producer: StagingAllStationProducerId) => unknown | null;
  }): { gotos: string[] } {
    const gotos: string[] = [];
    const fakePage = {
      goto: async (url: string) => {
        gotos.push(url.split("/").at(-1)!);
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
      computeTreeStamp: () => stamp,
      listScenarioIds: async (producer) => [...options.lists[producer.id]],
      measurePage: async (producer, _page, scenarioId) => {
        options.onMeasure(producer.id, scenarioId);
        if (producer.id === "actor-floor-contact-all-stations") {
          return [{
            scenarioId,
            actorId: "fake-actor",
            lowestVertexY: 0,
            declaredPosture: "standing",
            framesAdvanced: 8,
          }];
        }
        if (producer.id === "actor-furniture-clearance") {
          return {
            scenarioId,
            environmentId: "fake-env",
            hasCeiling: true,
            patientSupportSurfaceCount: 0,
            supportSurfaces: [],
            actors: [],
          };
        }
        return {
          scenarioId,
          environmentId: "fake-env",
          propCount: 0,
          actorCount: 1,
          collisions: [],
        };
      },
      readArtifact: async (producer) => options.read?.(producer.id) ?? null,
      writeArtifact: async (producer) => {
        options.onWrite(producer.id);
      },
    });
    return { gotos };
  }

  function captureStdout(): { text: () => string; restore: () => void } {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...args: never[]) => {
      chunks.push(String(chunk));
      return (original as (...a: never[]) => boolean)(chunk as never, ...args);
    }) as typeof process.stdout.write;
    return { text: () => chunks.join(""), restore: () => { process.stdout.write = original; } };
  }

  it("T6: n=2 + seed measures exactly the 2 sampled ids and writes nothing", async () => {
    process.env[STATION_SAMPLE_ENV] = "2";
    process.env[STATION_SAMPLE_SEED_ENV] = "t6-seed";
    resetStagingAllStationPassRuntimeForTest();
    const measured: string[] = [];
    const writes: StagingAllStationProducerId[] = [];
    const { gotos } = installStubs({
      lists: {
        "actor-prop-intersection": [...FIVE],
        "actor-floor-contact-all-stations": [...FIVE],
        "actor-furniture-clearance": [...FIVE],
      },
      onMeasure: (_producer, scenarioId) => { measured.push(scenarioId); },
      onWrite: (producer) => { writes.push(producer); },
    });
    const output = captureStdout();
    try {
      await readOrMeasureStagingAllStationReport("actor-prop-intersection");
    } finally {
      output.restore();
    }
    const expected = selectStationSubset(FIVE).ids;
    expect([...new Set(measured)].sort()).toEqual([...expected].sort());
    expect([...new Set(gotos)].sort()).toEqual([...expected].sort());
    expect(writes).toEqual([]);
    expect(output.text()).toContain(
      `station-subset: seed=t6-seed n=2 ids=${expected.join(",")}`,
    );

    // Unset env: the full union is measured and artifacts are written again.
    delete process.env[STATION_SAMPLE_ENV];
    delete process.env[STATION_SAMPLE_SEED_ENV];
    resetStagingAllStationPassRuntimeForTest();
    measured.length = 0;
    writes.length = 0;
    const { gotos: fullGotos } = installStubs({
      lists: {
        "actor-prop-intersection": [...FIVE],
        "actor-floor-contact-all-stations": [...FIVE],
        "actor-furniture-clearance": [...FIVE],
      },
      onMeasure: (_producer, scenarioId) => { measured.push(scenarioId); },
      onWrite: (producer) => { writes.push(producer); },
    });
    void fullGotos;
    await readOrMeasureStagingAllStationReport("actor-prop-intersection");
    expect([...new Set(measured)].sort()).toEqual([...FIVE].sort());
    expect(writes.sort()).toEqual([
      "actor-floor-contact-all-stations",
      "actor-furniture-clearance",
      "actor-prop-intersection",
    ]);
  });

  it("T7: disjoint producer lists top up a stranded producer and log it", async () => {
    process.env[STATION_SAMPLE_ENV] = "1";
    process.env[STATION_SAMPLE_SEED_ENV] = "t7-seed";
    resetStagingAllStationPassRuntimeForTest();
    const byProducer = new Map<StagingAllStationProducerId, string[]>();
    installStubs({
      lists: {
        "actor-prop-intersection": ["prop-only-station"],
        "actor-floor-contact-all-stations": ["floor-only-station"],
        "actor-furniture-clearance": ["clearance-only-station"],
      },
      onMeasure: (producer, scenarioId) => {
        byProducer.set(producer, [...(byProducer.get(producer) ?? []), scenarioId]);
      },
      onWrite: () => undefined,
    });
    const output = captureStdout();
    try {
      await readOrMeasureStagingAllStationReport("actor-floor-contact-all-stations");
    } finally {
      output.restore();
    }
    const producerIds: StagingAllStationProducerId[] = [
      "actor-prop-intersection",
      "actor-floor-contact-all-stations",
      "actor-furniture-clearance",
    ];
    for (const id of producerIds) {
      expect(byProducer.get(id) ?? [], `${id} measured nothing`).not.toHaveLength(0);
    }
    const topped = producerIds.filter((id) => output.text().includes(
      `station-subset: producer ${id} had no sampled station, added `,
    ));
    expect(topped.length, `expected top-up lines in:\n${output.text()}`).toBeGreaterThan(0);
  });

  it("R1: stranded top-up is a pure seeded pick; one seed line per pass", async () => {
    // 20 shared + 2 disjoint own ids, n=2. Every pass below must strand the own
    // producer (sample misses both own ids) and the pick must rotate by seed.
    const shared = Array.from({ length: 20 }, (_, i) => `shared-${String(i + 1).padStart(2, "0")}`);
    const own = ["c1", "c2"];
    const picked = new Map<string, number>();
    for (const seed of ["r1-a", "r1-b", "r1-c", "r1-d", "r1-e"]) {
      process.env[STATION_SAMPLE_ENV] = "2";
      process.env[STATION_SAMPLE_SEED_ENV] = seed;
      resetStagingAllStationPassRuntimeForTest();
      installStubs({
        lists: {
          "actor-prop-intersection": [...shared],
          "actor-floor-contact-all-stations": [...own],
          "actor-furniture-clearance": [...shared],
        },
        onMeasure: () => undefined,
        onWrite: () => undefined,
      });
      const output = captureStdout();
      try {
        await readOrMeasureStagingAllStationReport("actor-floor-contact-all-stations");
      } finally {
        output.restore();
      }
      const text = output.text();
      expect(text.match(/station-subset: seed=/g) ?? [], `seed ${seed}`).toHaveLength(1);
      const topUp = text.match(
        /station-subset: producer actor-floor-contact-all-stations had no sampled station, added (\S+)/,
      );
      expect(topUp, `seed ${seed} did not strand the producer:\n${text}`).not.toBeNull();
      picked.set(topUp![1]!, (picked.get(topUp![1]!) ?? 0) + 1);
    }
    expect([...picked.keys()].sort()).toEqual(["c1", "c2"]);
  });

  it("R8: inspectIdleArmHang selection is sampled and deterministic (stubbed measure, n=2)", async () => {
    const arm = await import("../idle-arm-hang.js") as Promise<{
      inspectIdleArmHang: (input?: { force?: boolean; label?: string }) => Promise<{
        scenarios: string[];
        arms: unknown[];
      }>;
      setIdleArmHangMeasureLiveForTest: (
        fn: ((input: { scenarioIds: string[] }) => Promise<{ scenarios: string[]; arms: [] }>) | null,
      ) => void;
      resetIdleArmHangTestSeam: () => void;
    }>;
    for (const seed of ["r8-a", "r8-b", "r8-c", "r8-d", "r8-e"]) {
      process.env[STATION_SAMPLE_ENV] = "2";
      process.env[STATION_SAMPLE_SEED_ENV] = seed;
      let measured: string[] = [];
      arm.setIdleArmHangMeasureLiveForTest(async (input) => {
        measured = [...(input.scenarioIds ?? [])];
        return { scenarios: [...(input.scenarioIds ?? [])], arms: [] };
      });
      try {
        const first = await arm.inspectIdleArmHang({ force: true, label: "r8" });
        const second = await arm.inspectIdleArmHang({ force: true, label: "r8" });
        expect(second.scenarios, `seed ${seed} not deterministic`).toEqual(first.scenarios);
        expect(measured, `seed ${seed}`).toHaveLength(2);
        expect(measured).toEqual(first.scenarios);
      } finally {
        arm.resetIdleArmHangTestSeam();
      }
    }
  });
});



describe("R2 one reader contract (RED before fix, unit, no browser)", () => {
  const stamp: MeasurementTreeStamp = {
    head: "abc123abc123abc123abc123abc123abc123abcd",
    fingerprint: "3333333333333333333333333333333333333333333333333333333333333333",
    algorithm: MEASUREMENT_TREE_STAMP_ALGORITHM,
  };

  function installReaderStubs(planted: (producer: StagingAllStationProducerId) => unknown | null): {
    measured: string[];
    writes: StagingAllStationProducerId[];
  } {
    const measured: string[] = [];
    const writes: StagingAllStationProducerId[] = [];
    const gotos: string[] = [];
    const fakePage = {
      goto: async () => { gotos.push("x"); },
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
      computeTreeStamp: () => stamp,
      listScenarioIds: async () => [...FIFTEEN],
      measurePage: async (producer, _page, scenarioId) => {
        measured.push(scenarioId);
        if (producer.id === "actor-floor-contact-all-stations") {
          return [{
            scenarioId,
            actorId: "fake-actor",
            lowestVertexY: 0,
            declaredPosture: "standing",
            framesAdvanced: 8,
          }];
        }
        if (producer.id === "actor-furniture-clearance") {
          return {
            scenarioId,
            environmentId: "fake-env",
            hasCeiling: true,
            patientSupportSurfaceCount: 0,
            supportSurfaces: [],
            actors: [],
          };
        }
        return {
          scenarioId,
          environmentId: "fake-env",
          propCount: 0,
          actorCount: 1,
          collisions: [],
        };
      },
      readArtifact: async (producer) => planted(producer.id),
      writeArtifact: async (producer) => { writes.push(producer.id); },
    });
    return { measured, writes };
  }

  it("RED: a 2-id artifact under the current stamp is refused by the full-run reader", async () => {
    resetStagingAllStationPassRuntimeForTest();
    const plantedIds = ["ward_delirium_med_rec_v1", "ed_chest_pain_priority_v1"];
    const { measured, writes } = installReaderStubs((producer) => {
      if (producer === "actor-floor-contact-all-stations") {
        return { scenarios: [...plantedIds], actors: [] };
      }
      return {
        stations: plantedIds.map((scenarioId) => ({ scenarioId, actors: [] })),
      };
    });
    await readOrMeasureStagingAllStationReport("actor-prop-intersection");
    // Refused -> re-measured live (full run still writes its complete artifact).
    expect(measured.length).toBeGreaterThan(0);
    expect(writes.sort()).toEqual([
      "actor-floor-contact-all-stations",
      "actor-furniture-clearance",
      "actor-prop-intersection",
    ]);
  });

  it("COUNTERWEIGHT: a 15-id artifact under the same stamp is read with no re-measure", async () => {
    resetStagingAllStationPassRuntimeForTest();
    let measures = 0;
    let writes = 0;
    const gotos: string[] = [];
    const fakePage = {
      goto: async () => { gotos.push("x"); },
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
      computeTreeStamp: () => stamp,
      listScenarioIds: async () => [...FIFTEEN],
      measurePage: async () => {
        measures += 1;
        return {};
      },
      readArtifact: async (producer) => {
        if (producer.id === "actor-floor-contact-all-stations") {
          return { scenarios: [...FIFTEEN], actors: [] };
        }
        return {
          stations: FIFTEEN.map((scenarioId) => ({ scenarioId, actors: [] })),
        };
      },
      writeArtifact: async () => { writes += 1; },
    });
    await readOrMeasureStagingAllStationReport("actor-prop-intersection");
    expect(measures).toBe(0);
    expect(writes).toBe(0);
  });
});

describe("S5 floor-contact sample gate (unit, no browser)", () => {
  function plantedFailure(report: Parameters<typeof assertFloorContactCoverage>[0]): string {
    try {
      assertFloorContactCoverage(report);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "(no throw)";
  }

  it("(a) a sampled report with no actors fails", () => {
    const message = plantedFailure({
      scenarios: ["s1", "s2"],
      actors: [],
      sample: { seed: "s5-a", ids: ["s1", "s2"] },
    });
    process.stdout.write(`S5a planted report fails with: ${message}\n`);
    expect(message).toContain("measured no actors");
  });

  it("(b) a sampled report missing a station's actors fails", () => {
    const message = plantedFailure({
      scenarios: ["s1", "s2"],
      actors: [{ scenarioId: "s1" }],
      sample: { seed: "s5-b", ids: ["s1", "s2"] },
    });
    process.stdout.write(`S5b planted report fails with: ${message}\n`);
    expect(message).toContain("s2");
  });

  it("(c) an unset report under 31 actors still fails the floor", () => {
    const message = plantedFailure({
      scenarios: ["s1", "s2"],
      actors: Array.from({ length: 5 }, (_, i) => ({ scenarioId: `s${(i % 2) + 1}` })),
      sample: null,
    });
    process.stdout.write(`S5c planted report fails with: ${message}\n`);
    expect(message).toContain("more than 30");
  });
});
