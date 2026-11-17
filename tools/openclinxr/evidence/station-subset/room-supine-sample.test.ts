import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DECLARED_INPATIENT_SCENARIO_IDS,
  inspectInpatientSupineStaging,
  listFullSupineBankScenarioIds,
  resetSupineStagingTestSeam,
  selectSupineStagingScenarioIds,
  setSupineStagingMeasureLiveForTest,
  supineMeasurePathForReport,
  supinePreFixPathForReport,
  writeDump as writeSupineDump,
} from "../inpatient-supine-staging.js";
import {
  inspectStationRoomNotEmpty,
  listShippedScenarioManifestIds,
  resetStationRoomTestSeam,
  selectStationRoomScenarioIds,
  setStationRoomMeasureLiveForTest,
  stationRoomLatestPathForReport,
  stationRoomPreFixPathForReport,
  writeRoomDump,
} from "../station-room-not-empty.js";
import { STATION_SAMPLE_ENV, STATION_SAMPLE_SEED_ENV, selectStationSubset } from "../station-subset.js";
import {
  assertStationRoomSampleCoverage,
  assertSupineStagingSampleCoverage,
  explicitSelectionCacheKey,
  isUsableSampledDiskReport,
  selectionCacheKey,
} from "./room-supine-sample.js";

afterEach(() => {
  delete process.env[STATION_SAMPLE_ENV];
  delete process.env[STATION_SAMPLE_SEED_ENV];
  resetStationRoomTestSeam();
  resetSupineStagingTestSeam();
});

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

describe("CW1 room list selection (unit, no browser)", () => {
  it("unset selects the full shipped manifest bank, live", async () => {
    const all = await listShippedScenarioManifestIds();
    expect(all.length).toBeGreaterThan(3);
    const sel = selectStationRoomScenarioIds(all, {});
    expect(sel.sample).toBeNull();
    expect(sel.ids).toHaveLength(all.length);
    expect(sel.ids).toEqual(all);
  });

  it("SAMPLE=2 SEED=x equals selectStationSubset(all)", async () => {
    const all = await listShippedScenarioManifestIds();
    const env = { [STATION_SAMPLE_ENV]: "2", [STATION_SAMPLE_SEED_ENV]: "cw1-room" };
    const expected = selectStationSubset(all, env as NodeJS.ProcessEnv);
    const sel = selectStationRoomScenarioIds(all, env as NodeJS.ProcessEnv);
    expect(sel.sample).not.toBeNull();
    expect(sel.ids).toEqual(expected.ids);
    expect(sel.sample).toEqual({ seed: "cw1-room", ids: expected.ids });
  });
});

describe("CW1 supine list selection (unit, no browser)", () => {
  it("unset selects the full cast bank, live", () => {
    const all = listFullSupineBankScenarioIds();
    expect(all.length).toBeGreaterThanOrEqual(14);
    const sel = selectSupineStagingScenarioIds(all, {});
    expect(sel.sample).toBeNull();
    expect(sel.ids).toEqual(all);
  });

  it("SAMPLE=2 SEED=x equals selectStationSubset(all) union TARGETS", () => {
    const all = listFullSupineBankScenarioIds();
    const env = { [STATION_SAMPLE_ENV]: "2", [STATION_SAMPLE_SEED_ENV]: "cw1-supine" };
    const expected = selectStationSubset(all, env as NodeJS.ProcessEnv);
    const sel = selectSupineStagingScenarioIds(all, env as NodeJS.ProcessEnv);
    expect(sel.sample).toEqual({ seed: "cw1-supine", ids: expected.ids });
    const targetsInBank = [...DECLARED_INPATIENT_SCENARIO_IDS].filter((id) => all.includes(id));
    expect(new Set(sel.ids)).toEqual(new Set([...expected.ids, ...targetsInBank]));
  });
});

describe("CW2 canonical untouched (unit, temp dir)", () => {
  it("room: sampled writes go to *.sampled.json; canonical sha unchanged", async () => {
    process.env[STATION_SAMPLE_SEED_ENV] = "cw2-seed";
    const dir = mkdtempSync(join(tmpdir(), "room-cw2-"));
    const canonicalPath = join(dir, "pre-fix.json");
    writeFileSync(canonicalPath, JSON.stringify({ rooms: ["a", "b", "c"] }));
    const before = sha256File(canonicalPath);

    // Path routing: full -> canonical, sampled -> fixed sampled sibling.
    expect(stationRoomPreFixPathForReport({ rooms: [], sample: null })).toMatch(/pre-fix\.json$/);
    expect(stationRoomPreFixPathForReport({ rooms: [], sample: null })).not.toContain(".sampled.json");
    const sampledPreFix = stationRoomPreFixPathForReport({
      rooms: [],
      sample: { seed: "cw2-seed", ids: ["a"] },
    });
    expect(sampledPreFix).toContain(".sampled.json");
    expect(stationRoomLatestPathForReport({ rooms: [], sample: { seed: "cw2-seed", ids: ["a"] } })).toContain(
      ".sampled.json",
    );

    // Simulated sampled run writes only the sampled sibling (temp dir stand-in).
    const sampledPath = join(dir, "pre-fix.json.sampled.json");
    await writeRoomDump(
      {
        rooms: [
          {
            scenarioId: "a",
            environmentId: "e",
            declaredSlotIds: [],
            builtSlotIds: [],
            markerCubeSlotIds: [],
            mountedEquipmentIds: [],
            hasCeiling: true,
            shellTriangles: 1,
            patientSupportSurfaceCount: 1,
            actorsIntersectingFurniture: [],
            castExpectedHumanoids: 1,
            liveObservedHumanoids: 1,
          },
        ],
        sample: { seed: "cw2-seed", ids: ["a"] },
      },
      { outputPath: sampledPath, label: "cw2" },
    );
    expect(sha256File(canonicalPath)).toBe(before);
    const parsed = JSON.parse(readFileSync(sampledPath, "utf8")) as {
      report?: { sample?: { seed?: string } };
    };
    expect(parsed.report?.sample?.seed).toBe("cw2-seed");
  });

  it("supine: sampled writes go to *.sampled.json; canonical sha unchanged", async () => {
    process.env[STATION_SAMPLE_SEED_ENV] = "cw2-seed";
    const dir = mkdtempSync(join(tmpdir(), "supine-cw2-"));
    const canonicalPath = join(dir, "inpatient-supine-staging.json");
    writeFileSync(canonicalPath, JSON.stringify({ rows: ["a", "b"] }));
    const before = sha256File(canonicalPath);

    expect(supineMeasurePathForReport({ rows: [], declaredInpatientScenarioIds: [], postureSource: "", claimScope: "", notEvidenceFor: [], sample: null })).not.toContain(
      ".sampled.json",
    );
    expect(
      supineMeasurePathForReport({ rows: [], declaredInpatientScenarioIds: [], postureSource: "", claimScope: "", notEvidenceFor: [], sample: { seed: "cw2-seed", ids: ["a"] } }),
    ).toContain(".sampled.json");
    expect(
      supinePreFixPathForReport({ rows: [], declaredInpatientScenarioIds: [], postureSource: "", claimScope: "", notEvidenceFor: [], sample: { seed: "cw2-seed", ids: ["a"] } }),
    ).toContain(".sampled.json");

    const sampledPath = join(dir, "inpatient-supine-staging.json.sampled.json");
    await writeSupineDump(
      {
        rows: [
          {
            scenarioId: "a",
            environmentId: "e",
            patientActorId: "p",
            posture: "supine",
            supportSurfaceCount: 1,
            supportKind: "stretcher",
            supportSource: "fixture",
            clearanceAboveDeckMeters: 0.01,
            notStagedMechanism: null,
          },
        ],
        declaredInpatientScenarioIds: [],
        postureSource: "cw2",
        claimScope: "staging",
        notEvidenceFor: ["clinical"],
        sample: { seed: "cw2-seed", ids: ["a"] },
      },
      { outputPath: sampledPath, label: "cw2" },
    );
    expect(sha256File(canonicalPath)).toBe(before);
    const parsed = JSON.parse(readFileSync(sampledPath, "utf8")) as {
      report?: { sample?: { seed?: string } };
    };
    expect(parsed.report?.sample?.seed).toBe("cw2-seed");
  });
});

describe("CW3 coverage clause is not vacuous (unit, no browser)", () => {  it("room: dropping one sampled station fails naming it; present passes", () => {
    const sample = { seed: "cw3", ids: ["s1", "s2"] };
    let message = "";
    try {
      assertStationRoomSampleCoverage({ rooms: [{ scenarioId: "s1" }], sample });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("s2");
    expect(() =>
      assertStationRoomSampleCoverage({ rooms: [{ scenarioId: "s1" }, { scenarioId: "s2" }], sample }),
    ).not.toThrow();
  });

  it("supine: dropping one union station fails naming it; present passes", () => {
    const sample = { seed: "cw3", ids: ["s1"] };
    const targets = ["t1", "t2"];
    let message = "";
    try {
      assertSupineStagingSampleCoverage(
        { rows: [{ scenarioId: "s1" }, { scenarioId: "t2" }], sample },
        targets,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("t1");
    expect(() =>
      assertSupineStagingSampleCoverage(
        { rows: [{ scenarioId: "s1" }, { scenarioId: "t1" }, { scenarioId: "t2" }], sample },
        targets,
      ),
    ).not.toThrow();
  });
});

function fakeRoom(scenarioId: string) {
  return {
    scenarioId,
    environmentId: "e",
    declaredSlotIds: [],
    builtSlotIds: [],
    markerCubeSlotIds: [],
    mountedEquipmentIds: [],
    hasCeiling: true,
    shellTriangles: 1,
    patientSupportSurfaceCount: 1,
    actorsIntersectingFurniture: [],
    castExpectedHumanoids: 1,
    liveObservedHumanoids: 1,
  };
}

function fakeSupineRow(scenarioId: string) {
  return {
    scenarioId,
    environmentId: "e",
    patientActorId: "p",
    posture: "supine",
    supportSurfaceCount: 1,
    supportKind: "stretcher",
    supportSource: "fixture",
    clearanceAboveDeckMeters: 0.01,
    notStagedMechanism: null,
  };
}

describe("F1 writer defaults route sampled reports (unit, temp evidence root)", () => {
  it("room: writeRoomDump(sampled) with NO outputPath writes the sampled sibling only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-f1-"));
    const report = { rooms: [fakeRoom("a")], sample: { seed: "f1-seed", ids: ["a"] } };
    const written = await writeRoomDump(report, { label: "f1", evidenceRoot: dir });
    expect(written).toContain(".sampled.json");
    expect(existsSync(join(dir, ".openclinxr/evidence/issue-133/pre-fix.json"))).toBe(false);
    expect(
      existsSync(join(dir, ".openclinxr/evidence/issue-133/pre-fix.json.sampled.json")),
    ).toBe(true);
    const parsed = JSON.parse(readFileSync(written, "utf8")) as {
      report?: { sample?: { seed?: string } };
    };
    expect(parsed.report?.sample?.seed).toBe("f1-seed");
  });

  it("supine: writeDump(sampled) with NO outputPath writes the sampled sibling only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-f1-"));
    const report = {
      rows: [fakeSupineRow("a")],
      declaredInpatientScenarioIds: [],
      postureSource: "f1",
      claimScope: "staging",
      notEvidenceFor: ["clinical"],
      sample: { seed: "f1-seed", ids: ["a"] },
    };
    const written = await writeSupineDump(report, { label: "f1", evidenceRoot: dir });
    expect(written).toContain(".sampled.json");
    expect(
      existsSync(join(dir, ".openclinxr/evidence/issue-179/inpatient-supine-staging.json")),
    ).toBe(false);
    expect(
      existsSync(
        join(dir, ".openclinxr/evidence/issue-179/inpatient-supine-staging.json.sampled.json"),
      ),
    ).toBe(true);
    const parsed = JSON.parse(readFileSync(written, "utf8")) as {
      report?: { sample?: { seed?: string } };
    };
    expect(parsed.report?.sample?.seed).toBe("f1-seed");
  });
});

describe("F2 cache identity (unit, stubbed measure, temp evidence root)", () => {
  it("room: a cached full report is not reused by a sampled call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-f2-"));
    let calls = 0;
    setStationRoomMeasureLiveForTest(async (input) => {
      calls += 1;
      return { rooms: (input.scenarioIds ?? []).map(fakeRoom) };
    });
    const full = await inspectStationRoomNotEmpty({ evidenceRoot: dir });
    expect(full.sample).toBeNull();
    expect(calls).toBe(1);
    process.env[STATION_SAMPLE_ENV] = "2";
    process.env[STATION_SAMPLE_SEED_ENV] = "f2-a";
    const sampled = await inspectStationRoomNotEmpty({ evidenceRoot: dir });
    expect(calls).toBe(2);
    expect(sampled.sample?.seed).toBe("f2-a");
  });

  it("supine: seed A cached, then seed B re-measures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-f2-"));
    let calls = 0;
    setSupineStagingMeasureLiveForTest(async (input) => {
      calls += 1;
      return {
        rows: (input.scenarioIds ?? []).map(fakeSupineRow),
        declaredInpatientScenarioIds: [],
        postureSource: "f2",
        claimScope: "staging",
        notEvidenceFor: ["clinical"],
      };
    });
    process.env[STATION_SAMPLE_ENV] = "2";
    process.env[STATION_SAMPLE_SEED_ENV] = "f2-seed-a";
    const first = await inspectInpatientSupineStaging({ evidenceRoot: dir });
    expect(first.sample?.seed).toBe("f2-seed-a");
    expect(calls).toBe(1);
    process.env[STATION_SAMPLE_SEED_ENV] = "f2-seed-b";
    const second = await inspectInpatientSupineStaging({ evidenceRoot: dir });
    expect(calls).toBe(2);
    expect(second.sample?.seed).toBe("f2-seed-b");
  });

  it("room: an in-flight sampled promise is not returned to a full call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-f2flight-"));
    let calls = 0;
    const pending: Array<{ resolve: (v: { rooms: ReturnType<typeof fakeRoom>[] }) => void; ids: string[] }> = [];
    setStationRoomMeasureLiveForTest((input) => {
      calls += 1;
      const ids = [...(input.scenarioIds ?? [])];
      return new Promise((resolve) => {
        pending.push({ resolve, ids });
      });
    });
    process.env[STATION_SAMPLE_ENV] = "2";
    process.env[STATION_SAMPLE_SEED_ENV] = "f2-flight";
    const sampledPromise = inspectStationRoomNotEmpty({ evidenceRoot: dir });
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
    delete process.env[STATION_SAMPLE_ENV];
    delete process.env[STATION_SAMPLE_SEED_ENV];
    const fullPromise = inspectStationRoomNotEmpty({ evidenceRoot: dir });
    await new Promise((r) => setTimeout(r, 100));
    expect(fullPromise).not.toBe(sampledPromise);
    expect(calls).toBe(2);
    for (const p of pending) p.resolve({ rooms: p.ids.map(fakeRoom) });
    const [sampledReport, fullReport] = await Promise.all([sampledPromise, fullPromise]);
    expect(sampledReport.sample?.seed).toBe("f2-flight");
    expect(fullReport.sample).toBeNull();
  });
});

describe("F3 sampled disk reuse (unit)", () => {
  it("different seed, same ids -> refused", () => {
    expect(
      isUsableSampledDiskReport({
        reportSample: { seed: "seed-a", ids: ["s1", "s2"] },
        measuredScenarioIds: ["s1", "s2"],
        requestedSeed: "seed-b",
        requestedSampleIds: ["s1", "s2"],
        neededIds: ["s1", "s2"],
      }),
    ).toBe(false);
  });

  it("same seed but rooms missing one id -> refused", () => {
    expect(
      isUsableSampledDiskReport({
        reportSample: { seed: "seed-a", ids: ["s1", "s2"] },
        measuredScenarioIds: ["s1"],
        requestedSeed: "seed-a",
        requestedSampleIds: ["s1", "s2"],
        neededIds: ["s1", "s2"],
      }),
    ).toBe(false);
  });

  it("exact seed + ids + covering rows -> accepted", () => {
    expect(
      isUsableSampledDiskReport({
        reportSample: { seed: "seed-a", ids: ["s2", "s1"] },
        measuredScenarioIds: ["s1", "s2"],
        requestedSeed: "seed-a",
        requestedSampleIds: ["s1", "s2"],
        neededIds: ["s1", "s2"],
      }),
    ).toBe(true);
  });

  it("null recorded sample -> refused", () => {
    expect(
      isUsableSampledDiskReport({
        reportSample: null,
        measuredScenarioIds: ["s1", "s2"],
        requestedSeed: "seed-a",
        requestedSampleIds: ["s1", "s2"],
        neededIds: ["s1", "s2"],
      }),
    ).toBe(false);
  });
});

describe("F4 empties and duplicates (unit, no browser)", () => {
  it("room: empty sample throws", () => {
    expect(() =>
      assertStationRoomSampleCoverage({ rooms: [{ scenarioId: "s1" }], sample: { seed: "f4", ids: [] } }),
    ).toThrow(/empty sample/);
  });

  it("room: duplicate row throws naming the id", () => {
    let message = "";
    try {
      assertStationRoomSampleCoverage({
        rooms: [{ scenarioId: "s1" }, { scenarioId: "s1" }],
        sample: { seed: "f4", ids: ["s1", "s1"] },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("s1");
    expect(message).toMatch(/duplicate/i);
  });

  it("room: duplicate sample id throws naming the id", () => {
    let message = "";
    try {
      assertStationRoomSampleCoverage({
        rooms: [{ scenarioId: "s1" }, { scenarioId: "s2" }],
        sample: { seed: "f4", ids: ["s1", "s1"] },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("s1");
    expect(message).toMatch(/duplicate/i);
  });

  it("supine: empty sample throws", () => {
    expect(() =>
      assertSupineStagingSampleCoverage({ rows: [{ scenarioId: "t1" }], sample: { seed: "f4", ids: [] } }, ["t1"]),
    ).toThrow(/empty sample/);
  });

  it("supine: duplicate row throws naming the id", () => {
    let message = "";
    try {
      assertSupineStagingSampleCoverage(
        {
          rows: [{ scenarioId: "s1" }, { scenarioId: "s1" }, { scenarioId: "t1" }],
          sample: { seed: "f4", ids: ["s1"] },
        },
        ["t1"],
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("s1");
    expect(message).toMatch(/duplicate/i);
  });

  it("supine: duplicate sample id throws naming the id", () => {
    let message = "";
    try {
      assertSupineStagingSampleCoverage(
        {
          rows: [{ scenarioId: "s1" }, { scenarioId: "t1" }],
          sample: { seed: "f4", ids: ["s1", "s1"] },
        },
        ["t1"],
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("s1");
    expect(message).toMatch(/duplicate/i);
  });
});

describe("F5 one target declaration (unit, no browser)", () => {
  it("exports exactly the three declared inpatient stations", () => {
    expect([...DECLARED_INPATIENT_SCENARIO_IDS].sort()).toEqual([
      "postop_fever_consult_pressure_v1",
      "stepdown_sepsis_nurse_escalation_v1",
      "ward_delirium_med_rec_v1",
    ]);
  });
});

describe("R3-F1 explicit selections get their own cache key (unit, stubbed measure)", () => {
  it("explicit keys are distinct from full and order-insensitive", () => {
    expect(explicitSelectionCacheKey(["s2", "s1"])).toBe(explicitSelectionCacheKey(["s1", "s2"]));
    expect(explicitSelectionCacheKey(["s1"])).not.toBe("full");
    expect(explicitSelectionCacheKey(["s1"])).not.toBe(
      selectionCacheKey({ seed: "explicit", ids: ["s1"] }),
    );
  });

  it("room (a): explicit in flight is not served to a full call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-r3f1a-"));
    let calls = 0;
    const pending: Array<{
      resolve: (v: { rooms: ReturnType<typeof fakeRoom>[] }) => void;
      ids: string[];
    }> = [];
    setStationRoomMeasureLiveForTest((input) => {
      calls += 1;
      const ids = [...(input.scenarioIds ?? [])];
      return new Promise((resolve) => {
        pending.push({ resolve, ids });
      });
    });
    const explicitPromise = inspectStationRoomNotEmpty({
      scenarioIds: ["s1", "s2", "s3", "s4"],
      evidenceRoot: dir,
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
    const fullPromise = inspectStationRoomNotEmpty({ evidenceRoot: dir });
    await new Promise((r) => setTimeout(r, 100));
    expect(fullPromise).not.toBe(explicitPromise);
    expect(calls).toBe(2);
    for (const p of pending) p.resolve({ rooms: p.ids.map(fakeRoom) });
    const [explicitReport, fullReport] = await Promise.all([explicitPromise, fullPromise]);
    expect(explicitReport.rooms.map((r) => r.scenarioId).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(fullReport.sample).toBeNull();
    expect(fullReport.rooms.length).toBeGreaterThan(3);
  });

  it("room (b): full cached, then explicit ids re-measure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-r3f1b-"));
    let calls = 0;
    setStationRoomMeasureLiveForTest(async (input) => {
      calls += 1;
      return { rooms: (input.scenarioIds ?? []).map(fakeRoom) };
    });
    const full = await inspectStationRoomNotEmpty({ evidenceRoot: dir });
    expect(full.sample).toBeNull();
    expect(calls).toBe(1);
    const explicit = await inspectStationRoomNotEmpty({
      scenarioIds: ["s2", "s1"],
      evidenceRoot: dir,
    });
    expect(calls).toBe(2);
    expect(explicit.rooms.map((r) => r.scenarioId).sort()).toEqual(["s1", "s2"]);
  });

  it("room (c): same explicit ids twice are reused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-r3f1c-"));
    let calls = 0;
    setStationRoomMeasureLiveForTest(async (input) => {
      calls += 1;
      return { rooms: (input.scenarioIds ?? []).map(fakeRoom) };
    });
    const first = await inspectStationRoomNotEmpty({
      scenarioIds: ["s1", "s2"],
      evidenceRoot: dir,
    });
    const second = await inspectStationRoomNotEmpty({
      scenarioIds: ["s2", "s1"],
      evidenceRoot: dir,
    });
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("supine (a): explicit in flight is not served to a full call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-r3f1a-"));
    let calls = 0;
    const pending: Array<{
      resolve: (v: {
        rows: ReturnType<typeof fakeSupineRow>[];
        declaredInpatientScenarioIds: string[];
        postureSource: string;
        claimScope: string;
        notEvidenceFor: string[];
      }) => void;
      ids: string[];
    }> = [];
    setSupineStagingMeasureLiveForTest((input) => {
      calls += 1;
      const ids = [...(input.scenarioIds ?? [])];
      return new Promise((resolve) => {
        pending.push({ resolve, ids });
      });
    });
    const explicitPromise = inspectInpatientSupineStaging({
      scenarioIds: ["s1", "s2", "s3", "s4"],
      evidenceRoot: dir,
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
    const fullPromise = inspectInpatientSupineStaging({ evidenceRoot: dir });
    await new Promise((r) => setTimeout(r, 100));
    expect(fullPromise).not.toBe(explicitPromise);
    expect(calls).toBe(2);
    for (const p of pending) {
      p.resolve({
        rows: p.ids.map(fakeSupineRow),
        declaredInpatientScenarioIds: [],
        postureSource: "r3-f1",
        claimScope: "staging",
        notEvidenceFor: ["clinical"],
      });
    }
    const [explicitReport, fullReport] = await Promise.all([explicitPromise, fullPromise]);
    expect(explicitReport.rows.map((r) => r.scenarioId).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(fullReport.sample).toBeNull();
    expect(fullReport.rows.length).toBeGreaterThan(3);
  });

  it("supine (b): full cached, then explicit ids re-measure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-r3f1b-"));
    let calls = 0;
    setSupineStagingMeasureLiveForTest(async (input) => {
      calls += 1;
      return {
        rows: (input.scenarioIds ?? []).map(fakeSupineRow),
        declaredInpatientScenarioIds: [],
        postureSource: "r3-f1",
        claimScope: "staging",
        notEvidenceFor: ["clinical"],
      };
    });
    const full = await inspectInpatientSupineStaging({ evidenceRoot: dir });
    expect(full.sample).toBeNull();
    expect(calls).toBe(1);
    const explicit = await inspectInpatientSupineStaging({
      scenarioIds: ["s2", "s1"],
      evidenceRoot: dir,
    });
    expect(calls).toBe(2);
    expect(explicit.rows.map((r) => r.scenarioId).sort()).toEqual(["s1", "s2"]);
  });

  it("supine (c): same explicit ids twice are reused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-r3f1c-"));
    let calls = 0;
    setSupineStagingMeasureLiveForTest(async (input) => {
      calls += 1;
      return {
        rows: (input.scenarioIds ?? []).map(fakeSupineRow),
        declaredInpatientScenarioIds: [],
        postureSource: "r3-f1",
        claimScope: "staging",
        notEvidenceFor: ["clinical"],
      };
    });
    const first = await inspectInpatientSupineStaging({
      scenarioIds: ["s1", "s2"],
      evidenceRoot: dir,
    });
    const second = await inspectInpatientSupineStaging({
      scenarioIds: ["s2", "s1"],
      evidenceRoot: dir,
    });
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });
});

describe("R3-F3 canonical only by a full run (unit, temp evidence root)", () => {
  it("room: sampled report + explicit canonical outputPath throws, canonical unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-r3f3-"));
    const canonicalRel = ".openclinxr/evidence/issue-133/pre-fix.json";
    const before = existsSync(canonicalRel) ? sha256File(canonicalRel) : null;
    const report = { rooms: [fakeRoom("a")], sample: { seed: "r3-f3", ids: ["a"] } };
    await expect(
      writeRoomDump(report, {
        outputPath: canonicalRel,
        evidenceRoot: dir,
        label: "r3-f3",
      }),
    ).rejects.toThrow(/canonical/);
    expect(existsSync(canonicalRel) ? sha256File(canonicalRel) : null).toBe(before);
    expect(existsSync(join(dir, canonicalRel))).toBe(false);
  });

  it("supine: sampled report + explicit canonical outputPath throws, canonical unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-r3f3-"));
    const canonicalRel = ".openclinxr/evidence/issue-179/inpatient-supine-staging.json";
    const before = existsSync(canonicalRel) ? sha256File(canonicalRel) : null;
    const report = {
      rows: [fakeSupineRow("a")],
      declaredInpatientScenarioIds: [],
      postureSource: "r3-f3",
      claimScope: "staging",
      notEvidenceFor: ["clinical"],
      sample: { seed: "r3-f3", ids: ["a"] },
    };
    await expect(
      writeSupineDump(report, {
        outputPath: canonicalRel,
        evidenceRoot: dir,
        label: "r3-f3",
      }),
    ).rejects.toThrow(/canonical/);
    expect(existsSync(canonicalRel) ? sha256File(canonicalRel) : null).toBe(before);
    expect(existsSync(join(dir, canonicalRel))).toBe(false);
  });

  it("room: canonical file carrying a sampled report is refused by a full call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "room-r3f3disk-"));
    const planted = { rooms: [fakeRoom("a")], sample: { seed: "planted", ids: ["a"] } };
    await writeRoomDump(planted, { evidenceRoot: dir, label: "plant" });
    copyFileSync(
      join(dir, ".openclinxr/evidence/issue-133/pre-fix.json.sampled.json"),
      join(dir, ".openclinxr/evidence/issue-133/pre-fix.json"),
    );
    process.env["OPENCLINXR_STATION_ROOM_USE_DISK"] = "1";
    try {
      let calls = 0;
      setStationRoomMeasureLiveForTest(async (input) => {
        calls += 1;
        return { rooms: (input.scenarioIds ?? []).map(fakeRoom) };
      });
      const report = await inspectStationRoomNotEmpty({ evidenceRoot: dir });
      expect(calls).toBe(1);
      expect(report.sample).toBeNull();
      expect(report.rooms.length).toBeGreaterThan(3);
    } finally {
      delete process.env["OPENCLINXR_STATION_ROOM_USE_DISK"];
    }
  });

  it("supine: canonical file carrying a sampled report is refused by a full call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supine-r3f3disk-"));
    const planted = {
      rows: [fakeSupineRow("a")],
      declaredInpatientScenarioIds: [],
      postureSource: "plant",
      claimScope: "staging",
      notEvidenceFor: ["clinical"],
      sample: { seed: "planted", ids: ["a"] },
    };
    await writeSupineDump(planted, { evidenceRoot: dir, label: "plant" });
    copyFileSync(
      join(dir, ".openclinxr/evidence/issue-179/inpatient-supine-staging.json.sampled.json"),
      join(dir, ".openclinxr/evidence/issue-179/inpatient-supine-staging.json"),
    );
    let calls = 0;
    setSupineStagingMeasureLiveForTest(async (input) => {
      calls += 1;
      return {
        rows: (input.scenarioIds ?? []).map(fakeSupineRow),
        declaredInpatientScenarioIds: [],
        postureSource: "r3-f3",
        claimScope: "staging",
        notEvidenceFor: ["clinical"],
      };
    });
    const report = await inspectInpatientSupineStaging({ evidenceRoot: dir });
    expect(calls).toBe(1);
    expect(report.sample).toBeNull();
    expect(report.rows.length).toBeGreaterThan(3);
  });
});
