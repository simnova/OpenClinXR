import { GraphQLObjectType } from "graphql";
import { describe, expect, it } from "vitest";
import type { ReviewPacket } from "./generated/resolvers.generated.js";
import { adminGraphqlDocumentByOperationName, buildAdminGraphqlSchema, executeAdminGraphql } from "./index.js";
import { REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE } from "./schema.js";

const STATION = "station_run_review_packet_actor_turn_layers";
const HIDDEN = "HIDDEN_DIAGNOSIS_MODERATE_PERSISTENT_ASTHMA";

const DISMISSIVE_LINE = "The hallway light is on.";
const EMPATHETIC_LINE = "The window latch is closed.";

describe("review packet replay includes actor-turn layers", () => {
  it("exposes plan, execution, emotionalTimeline, and dropped-tag layers on ReviewPacket", () => {
    const schema = buildAdminGraphqlSchema();
    const reviewPacket = schema.getType("ReviewPacket");
    expect(reviewPacket).toBeInstanceOf(GraphQLObjectType);
    const fields = (reviewPacket as GraphQLObjectType).getFields();
    expect(fields).toHaveProperty("actorTurns");
    expect(fields).toHaveProperty("emotionalTimeline");
    expect(fields).toHaveProperty("prosodyNeutralized");
    expect(schema.getType("ReviewPacketDialogueEmotion")).toBeDefined();
    expect(schema.getType("ReviewPacketActorTurnPlan")).toBeDefined();
    expect(schema.getType("ReviewPacketActorTurnExecution")).toBeDefined();
    const emotionEnum = schema.getType("ReviewPacketDialogueEmotion") as { getValues?: () => Array<{ name: string }> };
    expect(emotionEnum.getValues?.().map((value) => value.name)).not.toContain("pain");
  });

  it("returns distinct frozen face/performancePlanId for dismissive vs empathetic keyword-free lines", async () => {
    const document = adminGraphqlDocumentByOperationName("ReviewPacketReplay");
    const result = await executeAdminGraphql(
      {
        query: document.source,
        operationName: "ReviewPacketReplay",
        variables: { stationRunId: STATION },
      },
      {
        reviewPacket: () => fixturePacket() as ReviewPacket,
        clinicalEventReviewSummary: () => stubClinicalSummary(),
        reviewReplayReadinessSummary: () => stubReadiness(),
        traceEvents: () => [],
      },
    );

    expect(result.errors).toBeUndefined();
    const packet = result.data?.["reviewPacket"] as {
      actorTurns: Array<{
        plan: {
          planId: string;
          spokenText: string;
          dialogueEmotionFrom: string;
          dialogueEmotionTo: string;
          performancePlanId: string;
          facePresetId: string;
          eventKind: string;
          droppedTags: string[];
          claimScope: string;
        };
        execution: {
          planId: string;
          truncated: boolean;
          visemeCueCount: number;
          ttsProviderId: string;
          interruptionKind: string;
        };
      }>;
      emotionalTimeline: Array<{ from: string; to: string; trigger?: string; turnIndex?: number }>;
      prosodyNeutralized: boolean;
    };
    expect(packet.actorTurns).toHaveLength(2);

    const dismissive = packet.actorTurns[0];
    const empathetic = packet.actorTurns[1];
    expect(dismissive?.plan.spokenText).toBe(DISMISSIVE_LINE);
    expect(empathetic?.plan.spokenText).toBe(EMPATHETIC_LINE);
    expect(dismissive?.plan.spokenText).not.toMatch(/<soft>|\[breath\]/i);
    expect(empathetic?.plan.spokenText).not.toMatch(/<soft>|\[breath\]/i);
    expect(dismissive?.plan.eventKind).toBe("learner_dismissive");
    expect(empathetic?.plan.eventKind).toBe("learner_empathetic");
    expect(dismissive?.plan.dialogueEmotionTo).toBe("concerned");
    expect(empathetic?.plan.dialogueEmotionTo).toBe("reassured");
    expect(dismissive?.plan.dialogueEmotionTo).not.toBe("pain");
    expect(empathetic?.plan.dialogueEmotionTo).not.toBe("pain");
    expect(dismissive?.plan.performancePlanId).toBe("perf_dismissive_child");
    expect(empathetic?.plan.performancePlanId).toBe("perf_empathetic_child");
    expect(dismissive?.plan.facePresetId).toBe("face_concerned_child");
    expect(empathetic?.plan.facePresetId).toBe("face_reassured_child");
    expect(dismissive?.plan.performancePlanId).not.toBe(empathetic?.plan.performancePlanId);
    expect(dismissive?.plan.facePresetId).not.toBe(empathetic?.plan.facePresetId);
    expect(dismissive?.plan.spokenText.toLowerCase()).not.toContain("perf_");
    expect(empathetic?.plan.spokenText.toLowerCase()).not.toContain("face_");
    expect(dismissive?.plan.droppedTags).toEqual(["[cry]"]);
    expect(dismissive?.plan.claimScope).toBe(REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE);
    expect(empathetic?.plan.claimScope).toBe(REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE);
    expect(dismissive?.execution.truncated).toBe(true);
    expect(dismissive?.execution.interruptionKind).toBe("truncated");
    expect(empathetic?.execution.truncated).toBe(false);
    expect(empathetic?.execution.interruptionKind).toBe("none");
    expect(dismissive?.execution.visemeCueCount).toBe(2);
    expect(empathetic?.execution.visemeCueCount).toBe(5);
    expect(dismissive?.execution.ttsProviderId).toBe("mock-tts");
    expect(packet.emotionalTimeline.map((entry) => entry.to)).toEqual(["concerned", "reassured"]);
    expect(packet.emotionalTimeline[0]?.turnIndex).toBe(0);
    expect(packet.emotionalTimeline[1]?.turnIndex).toBe(1);
    expect(packet.prosodyNeutralized).toBe(true);

    const json = JSON.stringify(packet);
    expect(json).not.toContain(HIDDEN);
    expect(json).not.toContain("hiddenFacts");
    expect(json).not.toContain("hiddenFactRefs");
    expect(json).not.toContain("privateFacts");
    expect(json).not.toContain("serverOnlyNotes");
    expect(json).not.toContain("spokenTextForTts");
  });
});

function fixturePacket(): Record<string, unknown> {
  return {
    stationRunId: STATION,
    scenarioId: "peds_asthma_parent_anxiety_v1",
    observedTraceTags: [],
    missingRequiredTraceTags: [],
    lateTraceTags: [],
    unsafeEvents: [],
    timeline: [],
    traceQuality: {
      eventCount: 0,
      modelGeneratedEventCount: 0,
      modelFailedEventCount: 0,
      voiceAudioEventCount: 0,
      blockedGuardrailCount: 0,
      unsafeEventCount: 0,
      missingRequiredTraceTagCount: 0,
      hasPatientNote: false,
      hasModelProvenance: false,
    },
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "Replay layers only.",
    },
    hiddenFacts: [HIDDEN],
    actorTurnReplays: [
      {
        plan: {
          planId: "plan_dismissive_001",
          spokenText: DISMISSIVE_LINE,
          spokenTextForTts: `<soft>${DISMISSIVE_LINE} [breath]</soft>`,
          dialogueEmotionFrom: "neutral",
          dialogueEmotionTo: "concerned",
          performancePlanId: "perf_dismissive_child",
          facePresetId: "face_concerned_child",
          eventKind: "learner_dismissive",
          claimScope: REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE,
          hiddenFacts: [HIDDEN],
          privateFacts: [HIDDEN],
          prosody: { droppedTags: ["[cry]"], wrapTags: ["<soft>"], inlineTags: ["[breath]"], speed: 0.95 },
        },
        execution: {
          planId: "plan_dismissive_001",
          truncated: true,
          visemeCueCount: 2,
          ttsProviderId: "mock-tts",
          interruption: { kind: "truncated" },
          hiddenFactRefs: [HIDDEN],
          serverOnlyNotes: [HIDDEN],
        },
        droppedTagLog: ["[cry]"],
        prosodyNeutralized: true,
      },
      {
        plan: {
          planId: "plan_empathetic_001",
          spokenText: EMPATHETIC_LINE,
          spokenTextForTts: `<soft>${EMPATHETIC_LINE}</soft>`,
          dialogueEmotionFrom: "concerned",
          dialogueEmotionTo: "reassured",
          performancePlanId: "perf_empathetic_child",
          facePresetId: "face_reassured_child",
          eventKind: "learner_empathetic",
          claimScope: REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE,
          droppedTags: [],
        },
        execution: {
          planId: "plan_empathetic_001",
          truncated: false,
          visemeCueCount: 5,
          ttsProviderId: "mock-tts",
          interruptionKind: "none",
        },
        droppedTagLog: [],
        prosodyNeutralized: true,
      },
    ],
    emotionalTimeline: [
      {
        turnIndex: 1,
        actorId: "patient_maya_johnson_v1",
        from: "concerned",
        to: "reassured",
        trigger: "learner_empathetic",
        atSecond: 24,
      },
      {
        turnIndex: 0,
        actorId: "patient_maya_johnson_v1",
        from: "neutral",
        to: "concerned",
        trigger: "learner_dismissive",
        atSecond: 10,
      },
    ],
    prosodyNeutralized: true,
  };
}

function stubClinicalSummary() {
  return {
    stationRunId: STATION,
    eventCount: 0,
    redactedEventCount: 0,
    clinicalEventKinds: {},
    traceTags: [],
    statusCounts: {},
    latestAtSecond: null,
    durableStore: "database_source_of_truth",
    safeForFacultyReview: true,
  };
}

function stubReadiness() {
  return {
    stationRunId: STATION,
    replayEvidenceReady: true,
    facultyReviewSafe: true,
    timelineEntryCount: 0,
    traceEventCount: 0,
    durableEventCount: 0,
    redactedDurableEventCount: 0,
    missingRequiredBehaviorCount: 0,
    lateBehaviorCount: 0,
    safetySignalCount: 0,
    blockers: [],
    recommendedNextAction: "use_replay_for_scenario_iteration_before_learner_use",
    replayBoundary: "summary_only_no_private_payloads_or_score_use_claims",
    runtimeVisualEvidenceReplayProjection: null,
  };
}
