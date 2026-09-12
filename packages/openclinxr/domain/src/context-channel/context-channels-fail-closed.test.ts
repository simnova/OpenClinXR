import { describe, expect, it } from "vitest";
import {
  authoredContextChannelsFromCase,
  availableContextChannelsAt,
  requireAcknowledgeableChannel,
} from "./evaluate.js";

const LEARNER_CHANNELS = [
  {
    channelId: "door_card",
    kind: "doorway",
    audience: "learner",
    opensAtSecond: 0,
    closesAtSecond: 59,
    availableInPhases: ["doorway"],
    modality: "viewed",
    content: { text: "15-year-old with wheeze" },
  },
  {
    channelId: "chart_1",
    kind: "chart-fragment",
    audience: "learner",
    opensAtSecond: 60,
    availableInPhases: ["encounter"],
    modality: "viewed",
    content: { text: "PMH: asthma" },
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
    channelId: "hidden_dx",
    kind: "chart-fragment",
    audience: "learner",
    opensAtSecond: 0,
    modality: "viewed",
    carriesHiddenTruth: true,
    content: { text: "ACS" },
  },
];

describe("case-defined context channels fail closed", () => {
  it("parses authored channels and withholds reviewer-only and hidden truth from availability", () => {
    const authored = authoredContextChannelsFromCase({
      scenarioId: "case_1",
      contextChannels: LEARNER_CHANNELS,
      actors: [{ hiddenFacts: ["ACS"] }],
    });
    expect(authored).toHaveLength(4);
    const open = availableContextChannelsAt({
      channels: authored,
      phase: "doorway",
      atSecond: 10,
      hiddenFacts: ["ACS"],
      scenarioId: "case_1",
    });
    expect(open.map((channel) => channel.channelId)).toEqual(["door_card"]);
  });

  it("refuses reviewer-only, hidden truth, stale identity, and modality mismatch", () => {
    const authored = authoredContextChannelsFromCase({
      scenarioId: "case_1",
      contextChannels: LEARNER_CHANNELS,
    });
    expect(() =>
      requireAcknowledgeableChannel({
        channels: authored,
        channelId: "reviewer_key",
        modality: "viewed",
        phase: "doorway",
        atSecond: 10,
        hiddenFacts: [],
        scenarioId: "case_1",
      }),
    ).toThrow(/reviewer-only context/);
    expect(() =>
      requireAcknowledgeableChannel({
        channels: authored,
        channelId: "hidden_dx",
        modality: "viewed",
        phase: "doorway",
        atSecond: 10,
        hiddenFacts: [],
        scenarioId: "case_1",
      }),
    ).toThrow(/hidden truth/);
    expect(() =>
      requireAcknowledgeableChannel({
        channels: authored,
        channelId: "missing",
        modality: "viewed",
        phase: "doorway",
        atSecond: 10,
        hiddenFacts: [],
        scenarioId: "case_1",
      }),
    ).toThrow(/stale context-channel identity/);
    expect(() =>
      requireAcknowledgeableChannel({
        channels: authored,
        channelId: "door_card",
        modality: "heard",
        phase: "doorway",
        atSecond: 10,
        hiddenFacts: [],
        scenarioId: "case_1",
      }),
    ).toThrow(/modality mismatch/);
  });

  it("refuses a mutated hidden-truth fingerprint and a foreign scenarioId", () => {
    expect(() =>
      authoredContextChannelsFromCase({
        scenarioId: "case_1",
        actors: [{ hiddenFacts: ["secret"] }],
        contextChannels: [
          {
            channelId: "chart_1",
            kind: "chart-fragment",
            audience: "learner",
            opensAtSecond: 0,
            modality: "viewed",
            hiddenTruthFingerprint: "mutated",
            content: { text: "ok" },
          },
        ],
      }),
    ).toThrow(/hidden-truth fingerprint/);
    expect(() =>
      authoredContextChannelsFromCase({
        scenarioId: "case_1",
        contextChannels: [
          {
            channelId: "chart_1",
            kind: "chart-fragment",
            audience: "learner",
            opensAtSecond: 0,
            modality: "viewed",
            scenarioId: "other_case",
            content: { text: "ok" },
          },
        ],
      }),
    ).toThrow(/stale context-channel identity/);
  });
});
