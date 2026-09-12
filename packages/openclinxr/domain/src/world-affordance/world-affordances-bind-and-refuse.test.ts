import { describe, expect, it } from "vitest";
import {
  authoredWorldAffordanceGraphFromCase,
  availableWorldAffordancesAt,
  requireExecutableAffordance,
} from "./evaluate.js";

const ACTOR = "patient_robert_hayes_v1";
const EQUIPMENT = "12_lead_ecg_machine_equipment";
const STATION = "ed_chest_pain_priority_v1";
const BUNDLE = "bdl_ed_chest_pain_opaque_v1";

const REVIEWED = {
  scenarioId: STATION,
  status: "approved" as const,
  review: {
    clinical: "approved",
    psychometric: "approved",
    legal: "approved",
    simulationQa: "approved",
  },
  actors: [{ actorId: ACTOR }],
  equipment: ["12-lead ECG machine"],
  assetNeeds: [{ assetId: EQUIPMENT, assetType: "equipment" }],
};

const AFFORDANCES = [
  {
    affordanceId: "inspect_monitor",
    kind: "inspect",
    stationId: STATION,
    bundleId: BUNDLE,
    equipmentId: EQUIPMENT,
    opensAtSecond: 0,
    availableInPhases: ["doorway", "encounter"],
    consequence: { eventType: "equipment.inspected", traceTag: "ecg_inspect", detail: "leads seated" },
  },
  {
    affordanceId: "request_ecg",
    kind: "request-exam",
    stationId: STATION,
    bundleId: BUNDLE,
    actorId: ACTOR,
    equipmentId: EQUIPMENT,
    opensAtSecond: 60,
    availableInPhases: ["encounter"],
    consequence: { eventType: "exam.requested", traceTag: "ecg_request", detail: "12-lead ordered" },
  },
  {
    affordanceId: "observe_ecg",
    kind: "observe-result",
    stationId: STATION,
    bundleId: BUNDLE,
    actorId: ACTOR,
    equipmentId: EQUIPMENT,
    opensAtSecond: 60,
    availableInPhases: ["encounter"],
    requiresPriorAffordanceIds: ["request_ecg"],
    consequence: { eventType: "exam.result_observed", traceTag: "ecg_result", detail: "st-elevation tracing shown" },
  },
];

describe("world affordance graph binds identities and refuses stale actions", () => {
  it("yields bound inspect/request/observe rows from a reviewed case", () => {
    const graph = authoredWorldAffordanceGraphFromCase({ ...REVIEWED, worldAffordances: AFFORDANCES });
    expect(graph.reviewed).toBe(true);
    expect(graph.stationId).toBe(STATION);
    expect(graph.affordances.map((row) => row.affordanceId)).toEqual([
      "inspect_monitor",
      "request_ecg",
      "observe_ecg",
    ]);
    const open = availableWorldAffordancesAt({
      graph,
      phase: "doorway",
      atSecond: 10,
      executedIds: new Set(),
      bound: { scenarioId: STATION, stationId: STATION, phase: "doorway" },
    });
    expect(open.map((row) => row.affordanceId)).toEqual(["inspect_monitor"]);
  });

  it("refuses stale identity, unavailable observe-before-request, and unreviewed clinical consequences", () => {
    const graph = authoredWorldAffordanceGraphFromCase({ ...REVIEWED, worldAffordances: AFFORDANCES });
    const bound = { scenarioId: STATION, stationId: STATION, phase: "encounter" as const };
    expect(() =>
      requireExecutableAffordance({
        graph,
        action: {
          affordanceId: "missing",
          kind: "inspect",
          atSecond: 60,
          stationId: STATION,
          bundleId: BUNDLE,
        },
        phase: "encounter",
        executedIds: new Set(),
        bound,
      }),
    ).toThrow(/stale affordance identity/);
    expect(() =>
      requireExecutableAffordance({
        graph,
        action: {
          affordanceId: "request_ecg",
          kind: "request-exam",
          atSecond: 60,
          stationId: STATION,
          bundleId: "bdl_other",
          actorId: ACTOR,
          equipmentId: EQUIPMENT,
        },
        phase: "encounter",
        executedIds: new Set(),
        bound,
      }),
    ).toThrow(/stale affordance identity/);
    expect(() =>
      requireExecutableAffordance({
        graph,
        action: {
          affordanceId: "observe_ecg",
          kind: "observe-result",
          atSecond: 60,
          stationId: STATION,
          bundleId: BUNDLE,
          actorId: ACTOR,
          equipmentId: EQUIPMENT,
        },
        phase: "encounter",
        executedIds: new Set(),
        bound,
      }),
    ).toThrow(/affordance is not available/);
    const unreviewed = authoredWorldAffordanceGraphFromCase({
      ...REVIEWED,
      status: "draft",
      worldAffordances: AFFORDANCES,
    });
    expect(() =>
      requireExecutableAffordance({
        graph: unreviewed,
        action: {
          affordanceId: "request_ecg",
          kind: "request-exam",
          atSecond: 60,
          stationId: STATION,
          bundleId: BUNDLE,
          actorId: ACTOR,
          equipmentId: EQUIPMENT,
        },
        phase: "encounter",
        executedIds: new Set(),
        bound,
      }),
    ).toThrow(/unreviewed clinical consequence/);
  });

  it("refuses a foreign scenarioId and an unknown actor or equipment at compile", () => {
    expect(() =>
      authoredWorldAffordanceGraphFromCase({
        ...REVIEWED,
        worldAffordances: [{ ...AFFORDANCES[0], scenarioId: "other_case" }],
      }),
    ).toThrow(/stale affordance identity/);
    expect(() =>
      authoredWorldAffordanceGraphFromCase({
        ...REVIEWED,
        worldAffordances: [{ ...AFFORDANCES[1], actorId: "actor_unknown" }],
      }),
    ).toThrow(/stale affordance identity/);
  });
});
