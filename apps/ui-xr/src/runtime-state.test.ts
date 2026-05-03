import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import {
  completeTraceAction,
  createInitialRuntimeState,
  actorResponseTextFromApiResult,
  formatStationClock,
  remoteActorTurnForTraceTag,
  manualPerformanceMetricsFromFrameStats,
  stationTraceActionTags,
  summarizeFrameDeltas,
  summarizeTraceReadiness,
} from "./runtime-state.js";

describe("XR runtime state", () => {
  it("formats station time without viewport-dependent sizing", () => {
    expect(formatStationClock(0)).toBe("00:00");
    expect(formatStationClock(65)).toBe("01:05");
    expect(formatStationClock(960)).toBe("16:00");
  });

  it("tracks required trace actions for the ED station", () => {
    let state = createInitialRuntimeState();
    state = completeTraceAction(state, "ecg_request");
    state = completeTraceAction(state, "team_communication");

    expect(state.completedTraceTags).toEqual(["ecg_request", "team_communication"]);
    expect(summarizeTraceReadiness(state).observedCount).toBe(2);
    expect(summarizeTraceReadiness(state).missingCount).toBeGreaterThan(0);
  });

  it("exposes every required ED trace tag for headset trace controls", () => {
    expect(stationTraceActionTags).toEqual(edChestPainScenario.requiredTraceTags);
  });

  it("plans remote actor turns without embedding hidden scenario facts", () => {
    expect(remoteActorTurnForTraceTag("risk_factor_question")).toEqual({
      actorId: "patient_robert_hayes_v1",
      voiceId: "mock-robert-hayes",
      learnerUtterance: "Do you have any heart risk factors or family history I should know about?",
      traceContextTags: ["risk_factor_question"],
    });
    expect(remoteActorTurnForTraceTag("family_communication")).toEqual({
      actorId: "spouse_anna_hayes_v1",
      voiceId: "mock-anna-hayes",
      learnerUtterance: "Anna, I know this is frightening. I will explain what we are doing and keep you updated.",
      traceContextTags: ["family_communication"],
    });

    const plannedTurns = stationTraceActionTags.map((tag) => remoteActorTurnForTraceTag(tag)).filter(Boolean);
    const serializedPlans = JSON.stringify(plannedTurns);
    expect(serializedPlans).not.toContain("walking upstairs");
    expect(serializedPlans).not.toContain("Father died");
    expect(serializedPlans).not.toContain("skipped blood pressure medication");
  });

  it("does not request remote dialogue for note submission", () => {
    expect(remoteActorTurnForTraceTag("patient_note_submitted")).toBeUndefined();
  });

  it("extracts actor response text from the API result before voice synthesis", () => {
    expect(actorResponseTextFromApiResult({ response: { text: "I feel pressure in my chest." } })).toBe("I feel pressure in my chest.");
    expect(actorResponseTextFromApiResult({ response: { text: "" } })).toBeUndefined();
    expect(actorResponseTextFromApiResult({ response: { text: 123 } })).toBeUndefined();
  });

  it("summarizes rolling frame deltas for headset smoke evidence", () => {
    expect(summarizeFrameDeltas([])).toEqual({
      sampleCount: 0,
      avgFrameMs: null,
      p95FrameMs: null,
      maxFrameMs: null,
      approxFps: null,
    });

    expect(summarizeFrameDeltas([16, 17, 33])).toEqual({
      sampleCount: 3,
      avgFrameMs: 22,
      p95FrameMs: 33,
      maxFrameMs: 33,
      approxFps: 45.5,
    });
  });

  it("derives manual Quest performance metrics from rolling frame stats", () => {
    expect(manualPerformanceMetricsFromFrameStats({
      sampleCount: 3,
      avgFrameMs: 22,
      p95FrameMs: 33,
      maxFrameMs: 40,
      approxFps: 45.5,
      framesObserved: 4,
      sampleWindowSize: 3,
      latestFrameAtMs: 1234.56,
    })).toEqual({
      avgFps: 45.5,
      p95FrameMs: 33,
      minimumObservedFps: 25,
      source: "window.__openClinXrFrameStats",
      framesObserved: 4,
      sampleWindowSize: 3,
    });
  });
});
