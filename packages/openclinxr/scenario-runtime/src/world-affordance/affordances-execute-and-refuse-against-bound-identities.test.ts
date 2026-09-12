/**
 * Execution is appended at world-affordance/runtime.ts (`world_affordance.attempted` then
 * `world_affordance.executed` / `world_affordance.refused`); existing cases without a graph
 * stay empty via startSession (scenario-runtime.ts).
 */
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultScenarioRuntime } from "../index.js";

const STATION = edChestPainScenario.scenarioId;
const BUNDLE = "bdl_ed_chest_pain_opaque_v1";
const ACTOR = "patient_robert_hayes_v1";
const EQUIPMENT = "12_lead_ecg_machine_equipment";

function scenarioWithAffordances(overrides: Record<string, unknown> = {}) {
  return {
    ...edChestPainScenario,
    worldAffordances: [
      {
        affordanceId: "inspect_ecg",
        kind: "inspect",
        stationId: STATION,
        bundleId: BUNDLE,
        equipmentId: EQUIPMENT,
        opensAtSecond: 0,
        availableInPhases: ["doorway", "encounter"],
        consequence: {
          eventType: "equipment.inspected",
          traceTag: "ecg_inspect",
          detail: "leads seated on chest",
        },
      },
      {
        affordanceId: "use_stretcher",
        kind: "use",
        stationId: STATION,
        bundleId: BUNDLE,
        actorId: ACTOR,
        equipmentId: "stretcher_equipment",
        opensAtSecond: 60,
        availableInPhases: ["encounter"],
        consequence: {
          eventType: "equipment.used",
          traceTag: "stretcher_raise",
          detail: "head of bed raised",
        },
      },
      {
        affordanceId: "move_to_bedside",
        kind: "move",
        stationId: STATION,
        bundleId: BUNDLE,
        actorId: ACTOR,
        opensAtSecond: 60,
        availableInPhases: ["encounter"],
        consequence: {
          eventType: "actor.moved",
          traceTag: "bedside_approach",
          detail: "learner at right bedside",
        },
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
        consequence: {
          eventType: "exam.requested",
          traceTag: "ecg_request",
          detail: "12-lead ordered",
        },
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
        consequence: {
          eventType: "exam.result_observed",
          traceTag: "ecg_result",
          detail: "st-elevation tracing shown",
        },
      },
    ],
    ...overrides,
  };
}

describe("world affordances execute and refuse against bound identities", () => {
  beforeEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["OPENCLINXR_LOCAL_LLAMA_BASE_URL"];
  });

  it("leaves existing authored cases without a graph", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    expect(session.phase).toBe("doorway");
    expect(runtime.availableWorldAffordances(session.stationRunId, 10)).toEqual([]);
    expect(() =>
      runtime.executeWorldAffordance(session.stationRunId, {
        affordanceId: "inspect_ecg",
        kind: "inspect",
        atSecond: 10,
        stationId: STATION,
        bundleId: BUNDLE,
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/stale affordance identity/);
  });

  it("executes inspect, use, move, request-exam, and observe-result with deterministic followed traces", async () => {
    const runtime = createDefaultScenarioRuntime({ scenario: scenarioWithAffordances() });
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    expect(runtime.availableWorldAffordances(session.stationRunId, 10).map((row) => row.affordanceId)).toEqual([
      "inspect_ecg",
    ]);

    const inspected = runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "inspect_ecg",
      kind: "inspect",
      atSecond: 10,
      stationId: STATION,
      bundleId: BUNDLE,
      equipmentId: EQUIPMENT,
    });
    expect(inspected.eventType).toBe("world_affordance.executed");
    expect(Object.isFrozen(inspected)).toBe(true);
    expect(Object.isFrozen(inspected.payload)).toBe(true);
    expect(inspected.payload).toMatchObject({
      affordanceId: "inspect_ecg",
      kind: "inspect",
      attempted: { stationId: STATION, bundleId: BUNDLE, equipmentId: EQUIPMENT },
      followed: { eventType: "equipment.inspected", traceTag: "ecg_inspect", detail: "leads seated on chest" },
      claimScope: "case_defined_world_affordance",
    });
    expect(runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "inspect_ecg",
      kind: "inspect",
      atSecond: 11,
      stationId: STATION,
      bundleId: BUNDLE,
      equipmentId: EQUIPMENT,
    })).toEqual(inspected);

    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    const used = runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "use_stretcher",
      kind: "use",
      atSecond: 60,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
      equipmentId: "stretcher_equipment",
    });
    expect(used.payload["followed"]).toMatchObject({ eventType: "equipment.used", traceTag: "stretcher_raise" });

    const moved = runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "move_to_bedside",
      kind: "move",
      atSecond: 61,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
    });
    expect(moved.payload["followed"]).toMatchObject({ eventType: "actor.moved", traceTag: "bedside_approach" });

    const requested = runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "request_ecg",
      kind: "request-exam",
      atSecond: 62,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
      equipmentId: EQUIPMENT,
    });
    expect(requested.payload["followed"]).toMatchObject({ eventType: "exam.requested", traceTag: "ecg_request" });

    const observed = runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "observe_ecg",
      kind: "observe-result",
      atSecond: 63,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
      equipmentId: EQUIPMENT,
    });
    expect(observed.payload["followed"]).toMatchObject({
      eventType: "exam.result_observed",
      traceTag: "ecg_result",
    });

    const events = runtime.traceEvents(session.stationRunId);
    expect(events.filter((event) => event.eventType === "world_affordance.attempted")).toHaveLength(5);
    expect(events.filter((event) => event.eventType === "world_affordance.executed")).toHaveLength(5);
  });

  it("refuses stale identities, unavailable observe-before-request, one-shot replay, and unreviewed clinical consequences", async () => {
    const runtime = createDefaultScenarioRuntime({ scenario: scenarioWithAffordances() });
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    expect(() =>
      runtime.executeWorldAffordance(session.stationRunId, {
        affordanceId: "request_ecg",
        kind: "request-exam",
        atSecond: 60,
        stationId: STATION,
        bundleId: "bdl_stale",
        actorId: ACTOR,
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/stale affordance identity/);
    expect(() =>
      runtime.executeWorldAffordance(session.stationRunId, {
        affordanceId: "request_ecg",
        kind: "request-exam",
        atSecond: 60,
        stationId: "other_station",
        bundleId: BUNDLE,
        actorId: ACTOR,
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/stale affordance identity/);
    expect(() =>
      runtime.executeWorldAffordance(session.stationRunId, {
        affordanceId: "request_ecg",
        kind: "request-exam",
        atSecond: 60,
        stationId: STATION,
        bundleId: BUNDLE,
        actorId: "nurse_maria_alvarez_v1",
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/stale affordance identity/);
    expect(() =>
      runtime.executeWorldAffordance(session.stationRunId, {
        affordanceId: "observe_ecg",
        kind: "observe-result",
        atSecond: 60,
        stationId: STATION,
        bundleId: BUNDLE,
        actorId: ACTOR,
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/affordance is not available/);

    runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "request_ecg",
      kind: "request-exam",
      atSecond: 60,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
      equipmentId: EQUIPMENT,
    });
    expect(() =>
      runtime.executeWorldAffordance(session.stationRunId, {
        affordanceId: "request_ecg",
        kind: "request-exam",
        atSecond: 61,
        stationId: STATION,
        bundleId: BUNDLE,
        actorId: ACTOR,
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/affordance is not available/);

    const events = runtime.traceEvents(session.stationRunId);
    const refused = events.filter((event) => event.eventType === "world_affordance.refused");
    expect(refused).toHaveLength(5);
    expect(refused.map((event) => event.payload["followed"])).toEqual([
      { refused: true, reason: "stale affordance identity" },
      { refused: true, reason: "stale affordance identity" },
      { refused: true, reason: "stale affordance identity" },
      { refused: true, reason: "affordance is not available" },
      { refused: true, reason: "affordance is not available" },
    ]);
    for (const event of refused) {
      const prior = events.find((row) => row.sequence === event.sequence - 1);
      expect(prior?.eventType).toBe("world_affordance.attempted");
      expect(prior?.payload["affordanceId"]).toBe(event.payload["affordanceId"]);
      expect(
        events.filter(
          (row) =>
            row.eventType === "world_affordance.executed" &&
            row.payload["affordanceId"] === event.payload["affordanceId"] &&
            row.sequence === event.sequence,
        ),
      ).toHaveLength(0);
    }
    expect(events.filter((event) => event.eventType === "world_affordance.executed")).toHaveLength(1);

    const unreviewedRuntime = createDefaultScenarioRuntime({
      scenario: scenarioWithAffordances({ status: "draft" }),
    });
    const unreviewed = await unreviewedRuntime.startSession({ learnerId: "learner_002", consentAccepted: true });
    unreviewedRuntime.startEncounter(unreviewed.stationRunId, { atSecond: 60 });
    expect(unreviewedRuntime.availableWorldAffordances(unreviewed.stationRunId, 60)).toEqual([]);
    expect(() =>
      unreviewedRuntime.executeWorldAffordance(unreviewed.stationRunId, {
        affordanceId: "request_ecg",
        kind: "request-exam",
        atSecond: 60,
        stationId: STATION,
        bundleId: BUNDLE,
        actorId: ACTOR,
        equipmentId: EQUIPMENT,
      }),
    ).toThrow(/unreviewed clinical consequence/);
    const unreviewedEvents = unreviewedRuntime.traceEvents(unreviewed.stationRunId);
    expect(unreviewedEvents.filter((event) => event.eventType === "world_affordance.refused")).toHaveLength(1);
    expect(unreviewedEvents.filter((event) => event.eventType === "world_affordance.executed")).toHaveLength(0);
  });

  it("observe-result followed is only the case-authored consequence and never hidden truth", async () => {
    const hiddenFact = "Father died of myocardial infarction at 54";
    const authored = {
      eventType: "exam.result_observed",
      traceTag: "rhythm_strip_shown",
      detail: "rhythm strip shown",
    };
    const runtime = createDefaultScenarioRuntime({
      scenario: scenarioWithAffordances({
        worldAffordances: [
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
            consequence: { ...authored, hiddenDiagnosis: "STEMI", resultPayload: { stElevation: true, hiddenFact } },
          },
        ],
      }),
    });
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "request_ecg",
      kind: "request-exam",
      atSecond: 60,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
      equipmentId: EQUIPMENT,
    });
    const observed = runtime.executeWorldAffordance(session.stationRunId, {
      affordanceId: "observe_ecg",
      kind: "observe-result",
      atSecond: 61,
      stationId: STATION,
      bundleId: BUNDLE,
      actorId: ACTOR,
      equipmentId: EQUIPMENT,
    });
    expect(observed.payload["followed"]).toEqual(authored);
    expect(Object.keys(observed.payload["followed"] as object).sort()).toEqual(["detail", "eventType", "traceTag"]);
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain(hiddenFact);
    expect(serialized).not.toContain("STEMI");
    expect(serialized).not.toContain("stElevation");
    expect(serialized).not.toContain("resultPayload");
    expect(serialized).not.toContain("hiddenDiagnosis");
    expect(serialized).not.toContain("myocardial");
    for (const actor of edChestPainScenario.actors) {
      for (const fact of actor.hiddenFacts ?? []) {
        expect(serialized).not.toContain(fact);
      }
    }
  });
});
