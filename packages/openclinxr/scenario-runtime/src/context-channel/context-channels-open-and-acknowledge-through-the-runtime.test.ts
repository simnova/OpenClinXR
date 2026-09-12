/**
 * Acknowledgement is appended at context-channel/runtime.ts:100 (`appendTrace` `context_channel.acknowledged`); doorway phase for authored cases without channels is proven at this file:96 via `startSession` `phase` (scenario-runtime.ts:129).
 */
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultScenarioRuntime } from "../index.js";

const HIDDEN_FACT = "Father died of myocardial infarction at 54";

function scenarioWithChannels() {
  return {
    ...edChestPainScenario,
    contextChannels: [
      {
        channelId: "door_card",
        kind: "doorway",
        audience: "learner",
        opensAtSecond: 0,
        closesAtSecond: 59,
        availableInPhases: ["doorway"],
        modality: "viewed",
        content: { text: "52-year-old with chest pain" },
      },
      {
        channelId: "chart_1",
        kind: "chart-fragment",
        audience: "learner",
        opensAtSecond: 60,
        availableInPhases: ["encounter"],
        modality: "viewed",
        content: { text: "PMH: hypertension" },
      },
      {
        channelId: "ems_1",
        kind: "ems-handoff",
        audience: "learner",
        opensAtSecond: 60,
        availableInPhases: ["encounter"],
        modality: "heard",
        content: { text: "Pain began on the stairs" },
      },
      {
        channelId: "whisper_1",
        kind: "nurse-whisper",
        audience: "learner",
        opensAtSecond: 90,
        availableInPhases: ["encounter"],
        modality: "heard",
        content: { text: "Spouse is in the hall" },
      },
      {
        channelId: "vitals_1",
        kind: "vital-stream",
        audience: "learner",
        opensAtSecond: 60,
        availableInPhases: ["encounter"],
        modality: "viewed",
        content: { text: "BP 168/94" },
      },
      {
        channelId: "reviewer_key",
        kind: "chart-fragment",
        audience: "reviewer",
        opensAtSecond: 0,
        modality: "viewed",
        content: { text: "faculty diagnosis key" },
      },
      {
        channelId: "hidden_flag",
        kind: "chart-fragment",
        audience: "learner",
        opensAtSecond: 0,
        modality: "viewed",
        carriesHiddenTruth: true,
        content: { text: "withheld diagnosis" },
      },
      {
        channelId: "hidden_overlap",
        kind: "chart-fragment",
        audience: "learner",
        opensAtSecond: 0,
        modality: "viewed",
        content: { text: HIDDEN_FACT },
      },
    ],
  };
}

describe("context channels open and acknowledge through the runtime", () => {
  beforeEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["OPENCLINXR_LOCAL_LLAMA_BASE_URL"];
  });

  it("leaves existing authored cases without channels, and keeps the doorway phase", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    expect(session.phase).toBe("doorway");
    expect(runtime.availableContextChannels(session.stationRunId, 10)).toEqual([]);
  });

  it("exposes only channels whose availability and timing allow", async () => {
    const runtime = createDefaultScenarioRuntime({ scenario: scenarioWithChannels() });
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    expect(session.phase).toBe("doorway");
    expect(runtime.availableContextChannels(session.stationRunId, 10).map((channel) => channel.channelId)).toEqual([
      "door_card",
    ]);

    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    expect(runtime.availableContextChannels(session.stationRunId, 60).map((channel) => channel.channelId)).toEqual([
      "chart_1",
      "ems_1",
      "vitals_1",
    ]);
    expect(runtime.availableContextChannels(session.stationRunId, 90).map((channel) => channel.channelId)).toEqual([
      "chart_1",
      "ems_1",
      "whisper_1",
      "vitals_1",
    ]);
  });

  it("appends an immutable viewed/heard acknowledgement to the station trace", async () => {
    const runtime = createDefaultScenarioRuntime({ scenario: scenarioWithChannels() });
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    const viewed = runtime.acknowledgeContextChannel(session.stationRunId, {
      channelId: "door_card",
      modality: "viewed",
      atSecond: 10,
    });
    expect(viewed.eventType).toBe("context_channel.acknowledged");
    expect(viewed.source).toBe("learner");
    expect(viewed.payload).toMatchObject({
      channelId: "door_card",
      kind: "doorway",
      modality: "viewed",
      claimScope: "case_defined_context_channel",
    });
    expect(Object.isFrozen(viewed)).toBe(true);
    expect(Object.isFrozen(viewed.payload)).toBe(true);
    expect(() => {
      (viewed.payload as { modality: string }).modality = "heard";
    }).toThrow();
    const viewedAgain = runtime.acknowledgeContextChannel(session.stationRunId, {
      channelId: "door_card",
      modality: "viewed",
      atSecond: 11,
    });
    expect(viewedAgain).toEqual(viewed);
    expect(
      runtime.traceEvents(session.stationRunId).filter(
        (event) => event.eventType === "context_channel.acknowledged" && event.payload["channelId"] === "door_card",
      ),
    ).toHaveLength(1);

    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    const heard = runtime.acknowledgeContextChannel(session.stationRunId, {
      channelId: "ems_1",
      modality: "heard",
      atSecond: 60,
    });
    expect(heard.payload["modality"]).toBe("heard");
    expect(runtime.traceEvents(session.stationRunId).filter((event) => event.eventType === "context_channel.acknowledged")).toHaveLength(
      2,
    );
  });

  it("fails closed on hidden truth, reviewer-only context, stale identity, and modality mismatch", async () => {
    const runtime = createDefaultScenarioRuntime({ scenario: scenarioWithChannels() });
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    const openIds = runtime.availableContextChannels(session.stationRunId, 10).map((channel) => channel.channelId);
    expect(openIds).not.toContain("reviewer_key");
    expect(openIds).not.toContain("hidden_flag");
    expect(openIds).not.toContain("hidden_overlap");

    expect(() =>
      runtime.acknowledgeContextChannel(session.stationRunId, {
        channelId: "reviewer_key",
        modality: "viewed",
        atSecond: 10,
      }),
    ).toThrow(/reviewer-only context/);
    expect(() =>
      runtime.acknowledgeContextChannel(session.stationRunId, {
        channelId: "hidden_flag",
        modality: "viewed",
        atSecond: 10,
      }),
    ).toThrow(/hidden truth/);
    expect(() =>
      runtime.acknowledgeContextChannel(session.stationRunId, {
        channelId: "hidden_overlap",
        modality: "viewed",
        atSecond: 10,
      }),
    ).toThrow(/hidden truth/);
    expect(() =>
      runtime.acknowledgeContextChannel(session.stationRunId, {
        channelId: "not_authored",
        modality: "viewed",
        atSecond: 10,
      }),
    ).toThrow(/stale context-channel identity/);
    expect(() =>
      runtime.acknowledgeContextChannel(session.stationRunId, {
        channelId: "door_card",
        modality: "heard",
        atSecond: 10,
      }),
    ).toThrow(/modality mismatch/);
  });
});
