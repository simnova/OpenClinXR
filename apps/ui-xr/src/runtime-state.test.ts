import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import {
  completeTraceAction,
  createInitialRuntimeState,
  actorResponseTextFromApiResult,
  buildManualPerformanceDraft,
  buildIwsdkStationMcpSmokePlan,
  evaluateIwsdkStationMcpSmokeEvidence,
  formatStationClock,
  iwsdkStationMcpSmokePlanHash,
  iwsdkStationMcpSmokeToolOrder,
  iwsdkStationSceneObjectNames,
  iwsdkStationSceneObjects,
  remoteActorTurnForTraceTag,
  manualPerformanceMetricsFromFrameStats,
  stationTraceActionTags,
  summarizeFrameDeltas,
  summarizeTraceReadiness,
  xrExperienceModeEvidence,
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

  it("states that the current headset runtime is full VR, not mixed reality passthrough", () => {
    expect(xrExperienceModeEvidence).toEqual({
      phaseLabel: "Phase 1 VR",
      requestedSessionMode: "immersive-vr",
      mixedRealityPassthroughImplemented: false,
      handTrackingPosture: "optional_feature_with_primitive_hand_model",
      locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
    });
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

  it("defines named scene hierarchy targets for IWSDK MCP inspection", () => {
    expect(iwsdkStationSceneObjectNames).toEqual([
      "openclinxr.ed-chest-pain.station-root",
      "openclinxr.ed-chest-pain.ambient-light",
      "openclinxr.ed-chest-pain.key-light",
      "openclinxr.ed-chest-pain.floor",
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
      "openclinxr.ed-chest-pain.nurse-maria-alvarez",
      "openclinxr.ed-chest-pain.spouse-anna-hayes",
      "openclinxr.ed-chest-pain.wall-clock",
    ]);
    expect(new Set(iwsdkStationSceneObjectNames).size).toBe(iwsdkStationSceneObjectNames.length);
    expect(iwsdkStationSceneObjects.patientRobertHayes).toContain("patient-robert-hayes");
  });

  it("builds an IWSDK MCP smoke plan around the current station shell without installing IWSDK", () => {
    const plan = buildIwsdkStationMcpSmokePlan();

    expect(plan).toMatchObject({
      mode: "agent",
      smokePlanHash: iwsdkStationMcpSmokePlanHash,
      scenarioId: edChestPainScenario.scenarioId,
      scenarioVersion: edChestPainScenario.version,
      scenarioTitle: edChestPainScenario.title,
      controllerSelectTraceTag: "ecg_request",
      mcpToolOrder: iwsdkStationMcpSmokeToolOrder,
      blockedUntil: [
        "apps_ui_xr_iwsdk_sidecar_exists_with_exact_iwsdk_versions",
        "iwsdk_agent_tooling_evidence_records_32_tool_inventory",
        "physical_quest3_foreground_frame_pacing_still_required_for_production",
      ],
    });
    expect(plan.steps.map((step) => step.toolName)).toEqual([
      "xr_get_session_status",
      "xr_accept_session",
      "browser_screenshot",
      "scene_get_hierarchy",
      "xr_select",
      "browser_get_console_logs",
    ]);
    expect(plan.steps.find((step) => step.id === "scene-hierarchy")?.requiredSceneObjects).toEqual(iwsdkStationSceneObjectNames);
    expect(plan.steps.find((step) => step.id === "controller-select-trace")?.traceTag).toBe("ecg_request");
  });

  it("scores IWSDK MCP smoke evidence against scene names and controller trace semantics", () => {
    expect(evaluateIwsdkStationMcpSmokeEvidence({
      objectNames: [...iwsdkStationSceneObjectNames],
      traceActionTags: ["ecg_request"],
    })).toEqual({
      ready: true,
      blockers: [],
    });

    expect(evaluateIwsdkStationMcpSmokeEvidence({
      objectNames: iwsdkStationSceneObjectNames.filter((name) => name !== iwsdkStationSceneObjects.monitor),
      traceActionTags: ["history_opqrst"],
    })).toEqual({
      ready: false,
      blockers: [
        `missing_scene_object:${iwsdkStationSceneObjects.monitor}`,
        "missing_controller_select_trace_tag:ecg_request",
      ],
    });
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
      controllerSelectLatencyMs: null,
      source: "window.__openClinXrFrameStats",
      framesObserved: 4,
      sampleWindowSize: 3,
    });
  });

  it("builds a Quest manual performance draft with explicit human-completion placeholders", () => {
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 92,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      controllerSelectLatencyMs: 87.5,
      frameStats: {
        sampleCount: 3,
        avgFrameMs: 16.7,
        p95FrameMs: 18,
        maxFrameMs: 22,
        approxFps: 59.9,
        framesObserved: 4,
        sampleWindowSize: 3,
        latestFrameAtMs: 1234.56,
      },
    });

    expect(draft).toEqual({
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "",
        durationMinutes: 1.53,
        notes: "Complete this during a foreground in-headset Quest Browser run.",
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: false,
        extraBrowserWindowsClosed: false,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: false,
        consoleErrors: [],
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 4,
        sampleWindowSize: 3,
        avgFps: 59.9,
        p95FrameMs: 18,
        minimumObservedFps: 45.5,
        controllerSelectLatencyMs: 87.5,
      },
      comfort: {
        motionComfort: "not_run",
        heatConcern: null,
        batteryDropPercent: null,
      },
    });
  });
});
