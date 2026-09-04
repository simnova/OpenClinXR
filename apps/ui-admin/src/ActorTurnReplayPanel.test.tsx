import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTOR_TURN_REPLAY_CLAIM_BOUNDARY,
  ACTOR_TURN_REPLAY_NOT_EVIDENCE_FOR,
  ActorTurnReplayPanel,
} from "./ActorTurnReplayPanel.js";

const HIDDEN = "HIDDEN_DIAGNOSIS_MODERATE_PERSISTENT_ASTHMA";
const DISMISSIVE_LINE = "The hallway light is on.";
const EMPATHETIC_LINE = "The window latch is closed.";

describe("ActorTurnReplayPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders GraphQL plan versus execution as an inspectable multimodal timeline", () => {
    render(<ActorTurnReplayPanel packet={fixturePacket()} />);

    const panel = screen.getByLabelText("Actor turn plan versus execution replay");
    expect(within(panel).getByRole("heading", { name: "Actor Turn Replay" })).toBeInTheDocument();
    expect(within(panel).getByLabelText("Prosody neutralization state")).toHaveTextContent("prosody neutralized");
    expect(within(panel).getByLabelText("Actor turn replay claim boundary")).toHaveTextContent(
      ACTOR_TURN_REPLAY_CLAIM_BOUNDARY,
    );
    const notEvidence = within(panel).getByLabelText("Actor turn replay not evidence for");
    for (const item of ACTOR_TURN_REPLAY_NOT_EVIDENCE_FOR) {
      expect(notEvidence).toHaveTextContent(item);
    }
    expect(panel).toHaveTextContent("examEquivalenceGate false");
    expect(panel).toHaveTextContent("claimScope simulated_actor_behavior");

    const emotions = within(panel).getByLabelText("Emotional timeline entries");
    expect(emotions).toHaveTextContent("neutral → concerned");
    expect(emotions).toHaveTextContent("concerned → reassured");
    expect(emotions).toHaveTextContent("learner_dismissive");
    expect(emotions).toHaveTextContent("learner_empathetic");

    const timeline = within(panel).getByLabelText("Actor turn plan versus execution timeline");
    const dismissivePlan = within(timeline).getByLabelText("Frozen plan plan_dismissive_001");
    const dismissiveExecution = within(timeline).getByLabelText("Rendered execution plan_dismissive_001");
    expect(dismissivePlan).toHaveTextContent(DISMISSIVE_LINE);
    expect(dismissivePlan).toHaveTextContent("emotion neutral → concerned");
    expect(dismissivePlan).toHaveTextContent("event learner_dismissive");
    expect(dismissivePlan).toHaveTextContent("performance perf_dismissive_child");
    expect(dismissivePlan).toHaveTextContent("face face_concerned_child");
    expect(within(dismissivePlan).getByLabelText("Dropped provider tags")).toHaveTextContent("[cry]");
    expect(dismissiveExecution).toHaveTextContent("truncated");
    expect(dismissiveExecution).toHaveTextContent("viseme cues 2");
    expect(dismissiveExecution).toHaveTextContent("tts provider mock-tts");
    expect(dismissivePlan).not.toHaveTextContent("truncated");
    expect(dismissivePlan.textContent).not.toContain("<soft>");
    expect(dismissivePlan.textContent).not.toContain("[breath]");

    const empatheticPlan = within(timeline).getByLabelText("Frozen plan plan_empathetic_001");
    const empatheticExecution = within(timeline).getByLabelText("Rendered execution plan_empathetic_001");
    expect(empatheticPlan).toHaveTextContent(EMPATHETIC_LINE);
    expect(empatheticPlan).toHaveTextContent("event learner_empathetic");
    expect(empatheticExecution).toHaveTextContent("uninterrupted");
    expect(empatheticExecution).not.toHaveTextContent("truncated");

    const bargePlan = within(timeline).getByLabelText("Frozen plan plan_barge_001");
    const bargeExecution = within(timeline).getByLabelText("Rendered execution plan_barge_001");
    expect(bargePlan).toHaveTextContent("The curtain is drawn.");
    expect(bargeExecution).toHaveTextContent("barge-in replaced");
    expect(bargePlan).not.toHaveTextContent("barge-in");

    expect(panel.textContent).not.toContain(HIDDEN);
    expect(panel.textContent).not.toContain("spokenTextForTts");
    expect(panel.textContent).not.toContain("<soft>");
    expect(panel.textContent).not.toContain("rawAudio");
    expect(within(panel).getByLabelText("Private payload posture")).toHaveTextContent("privatePayloadRedacted=true");
  });

  it("shows an empty plan/execution state when GraphQL layers are absent", () => {
    render(
      <ActorTurnReplayPanel
        packet={{
          stationRunId: "run_empty",
          scenarioId: "ed_chest_pain_priority_v1",
        }}
      />,
    );

    const panel = screen.getByLabelText("Actor turn plan versus execution replay");
    expect(panel).toHaveTextContent("No actor-turn plan/execution layers on this review packet.");
    expect(panel).toHaveTextContent("No emotion transitions on this packet.");
    expect(within(panel).getByLabelText("Prosody neutralization state")).toHaveTextContent("prosody rendered");
  });
});

function fixturePacket(): Record<string, unknown> {
  return {
    stationRunId: "station_run_review_packet_actor_turn_layers",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    hiddenFacts: [HIDDEN],
    spokenTextForTts: `<soft>${DISMISSIVE_LINE} [breath]</soft>`,
    rawAudio: "UklGRiQAAABXQVZF",
    actorTurns: [
      {
        plan: {
          planId: "plan_dismissive_001",
          spokenText: DISMISSIVE_LINE,
          dialogueEmotionFrom: "neutral",
          dialogueEmotionTo: "concerned",
          performancePlanId: "perf_dismissive_child",
          facePresetId: "face_concerned_child",
          eventKind: "learner_dismissive",
          droppedTags: ["[cry]"],
          claimScope: "simulated_actor_behavior",
        },
        execution: {
          planId: "plan_dismissive_001",
          truncated: true,
          visemeCueCount: 2,
          ttsProviderId: "mock-tts",
          interruptionKind: "truncated",
        },
      },
      {
        plan: {
          planId: "plan_empathetic_001",
          spokenText: EMPATHETIC_LINE,
          dialogueEmotionFrom: "concerned",
          dialogueEmotionTo: "reassured",
          performancePlanId: "perf_empathetic_child",
          facePresetId: "face_reassured_child",
          eventKind: "learner_empathetic",
          droppedTags: [],
          claimScope: "simulated_actor_behavior",
        },
        execution: {
          planId: "plan_empathetic_001",
          truncated: false,
          visemeCueCount: 5,
          ttsProviderId: "mock-tts",
          interruptionKind: "none",
        },
      },
      {
        plan: {
          planId: "plan_barge_001",
          spokenText: "The curtain is drawn.",
          dialogueEmotionFrom: "reassured",
          dialogueEmotionTo: "anxious",
          performancePlanId: "perf_interrupted_child",
          facePresetId: "face_anxious_child",
          eventKind: "learner_interruption",
          droppedTags: [],
          claimScope: "simulated_actor_behavior",
        },
        execution: {
          planId: "plan_barge_001",
          truncated: false,
          visemeCueCount: 1,
          ttsProviderId: "mock-tts",
          interruptionKind: "replaced",
        },
      },
    ],
    emotionalTimeline: [
      {
        turnIndex: 0,
        actorId: "patient_maya_johnson_v1",
        from: "neutral",
        to: "concerned",
        trigger: "learner_dismissive",
        planId: "plan_dismissive_001",
        atSecond: 12,
      },
      {
        turnIndex: 1,
        actorId: "patient_maya_johnson_v1",
        from: "concerned",
        to: "reassured",
        trigger: "learner_empathetic",
        planId: "plan_empathetic_001",
        atSecond: 24,
      },
    ],
    prosodyNeutralized: true,
  };
}
