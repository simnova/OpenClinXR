import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import {
  completeTraceAction,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceInputEvidence,
  buildReadableVrTextPanelEvidence,
  buildRuntimeFrameStats,
  createInitialRuntimeState,
  actorResponseTextFromApiResult,
  buildManualPerformanceDraft,
  buildManualPerformanceReproducibility,
  buildRuntimeEvidencePosture,
  buildIwsdkStationMcpSmokePlan,
  evaluateIwsdkStationMcpSmokeEvidence,
  evaluateXrExperienceModeReadiness,
  findXrExperienceModeContract,
  formatManualEvidenceCopyStatus,
  formatStationClock,
  iwsdkStationMcpSmokePlanHash,
  iwsdkStationMcpSmokeToolOrder,
  iwsdkStationSceneObjectNames,
  iwsdkStationSceneObjects,
  isImmersiveFrameEvidenceActive,
  primitiveHandModelProfile,
  primitiveHandRepresentationKind,
  meshHandModelProfile,
  meshHandRepresentationKind,
  localHandMeshPath,
  remoteActorTurnForTraceTag,
  manualPerformanceMetricsFromFrameStats,
  parseBrowserVersionHints,
  stationTraceActionTags,
  summarizeFrameDeltas,
  summarizeTraceReadiness,
  xrExperienceModeEvidence,
  xrExperienceModeContracts,
} from "./runtime-state.js";

describe("XR runtime state", () => {
  it("treats renderer presentation or an active session as immersive frame evidence", () => {
    expect(isImmersiveFrameEvidenceActive({
      rendererPresenting: false,
      activeXrSession: false,
      immersiveSessionActive: false,
    })).toBe(false);
    expect(isImmersiveFrameEvidenceActive({
      rendererPresenting: true,
      activeXrSession: false,
      immersiveSessionActive: false,
    })).toBe(true);
    expect(isImmersiveFrameEvidenceActive({
      rendererPresenting: false,
      activeXrSession: true,
      immersiveSessionActive: true,
    })).toBe(true);
    expect(isImmersiveFrameEvidenceActive({
      rendererPresenting: false,
      activeXrSession: true,
      immersiveSessionActive: false,
    })).toBe(false);
  });

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

  it("builds audit-only browser reproducibility metadata for copied Quest evidence", () => {
    const userAgent = "Mozilla/5.0 Quest 3 OculusBrowser/146.0.0.19.27.942135376 Chrome/146.0.7680.177";

    expect(parseBrowserVersionHints(userAgent)).toEqual({
      oculusBrowser: "146.0.0.19.27.942135376",
      chrome: "146.0.7680.177",
    });
    expect(buildManualPerformanceReproducibility({
      url: "http://localhost:5173/",
      userAgent,
      app: {
        packageName: "@openclinxr/ui-xr",
        version: "0.1.0",
        gitCommit: "abcdef123456",
        buildTime: "2026-05-04T00:00:00.000Z",
        mode: "development",
      },
      webXr: {
        navigatorXrPresent: true,
        immersiveVrSupported: true,
        immersiveVrSupportCheckedAtMs: 1234.56,
        immersiveArSupported: null,
        immersiveArSupportCheckedAtMs: null,
        supportError: null,
      },
      display: {
        viewportWidth: 859.6,
        viewportHeight: 774.2,
        screenWidth: 2064,
        screenHeight: 2208,
        devicePixelRatio: 1.5004,
        visibilityState: "visible",
      },
    })).toEqual({
      source: "browser_runtime",
      url: "http://localhost:5173/",
      userAgent,
      browserVersionHints: {
        oculusBrowser: "146.0.0.19.27.942135376",
        chrome: "146.0.7680.177",
      },
      app: {
        packageName: "@openclinxr/ui-xr",
        version: "0.1.0",
        gitCommit: "abcdef123456",
        buildTime: "2026-05-04T00:00:00.000Z",
        mode: "development",
      },
      webXr: {
        navigatorXrPresent: true,
        immersiveVrSupported: true,
        immersiveVrSupportCheckedAtMs: 1234.56,
        immersiveArSupported: null,
        immersiveArSupportCheckedAtMs: null,
        supportError: null,
      },
      display: {
        viewportWidth: 860,
        viewportHeight: 774,
        screenWidth: 2064,
        screenHeight: 2208,
        devicePixelRatio: 1.5,
        visibilityState: "visible",
      },
      limitations: [
        "browser_reported_metadata_not_device_firmware_proof",
        "display_refresh_rate_inferred_from_frame_cadence",
      ],
    });
  });

  it("states that the current headset runtime is full VR, not mixed reality passthrough", () => {
    expect(xrExperienceModeEvidence).toEqual({
      modeId: "full_vr",
      phaseLabel: "Phase 1 Full VR",
      requestedSessionMode: "immersive-vr",
      mixedRealityPassthroughImplemented: false,
      handTrackingPosture: "optional_feature_with_local_mesh_hand_model_and_primitive_fallback",
      locomotionPosture: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
    });
  });

  it("keeps mixed reality as a separate approved lane with its own evidence contract", () => {
    expect(xrExperienceModeContracts.map((contract) => contract.modeId)).toEqual([
      "full_vr",
      "mixed_reality_passthrough",
    ]);

    expect(findXrExperienceModeContract("mixed_reality_passthrough")).toEqual({
      modeId: "mixed_reality_passthrough",
      phaseLabel: "Phase 1 Mixed Reality",
      requestedSessionMode: "immersive-ar",
      entryButtonLabel: "Enter Mixed Reality",
      sharesScenarioTraceContract: true,
      evidenceLane: "mixed_reality_manual_report",
      privacySafetyReviewRequired: true,
      requiredEvidence: [
        "immersive_ar_session_started",
        "passthrough_visibility_observed",
        "foreground_quest_mr_manual_report",
        "privacy_safety_review_completed",
        "room_boundary_and_occlusion_comfort_reported",
      ],
      prohibitedClaimsUntilReady: [
        "replacement_for_full_vr",
        "production_quest_readiness",
        "passthrough_privacy_readiness",
        "clinical_room_safety_readiness",
      ],
    });
  });

  it("scores Full VR and mixed reality readiness independently", () => {
    expect(evaluateXrExperienceModeReadiness({
      modeId: "full_vr",
      requestedSessionMode: "immersive-vr",
      manualReportModeId: "full_vr",
      sharesScenarioTraceContract: true,
    })).toEqual({
      ready: true,
      blockers: [],
    });

    expect(evaluateXrExperienceModeReadiness({
      modeId: "mixed_reality_passthrough",
      requestedSessionMode: "immersive-ar",
      manualReportModeId: "full_vr",
      passthroughObserved: false,
      privacySafetyReviewed: false,
      sharesScenarioTraceContract: true,
    })).toEqual({
      ready: false,
      blockers: [
        "missing_mixed_reality_manual_report",
        "missing_passthrough_observation",
        "missing_privacy_safety_review",
      ],
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
      "openclinxr.ed-chest-pain.in-vr-clinical-panel",
      "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
      "openclinxr.ed-chest-pain.in-vr-input-panel",
      "openclinxr.ed-chest-pain.controller-grip-left",
      "openclinxr.ed-chest-pain.controller-grip-right",
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

  it("builds frame-quality evidence with render-loop posture and long-frame ratios", () => {
    expect(buildRuntimeFrameStats({
      frameDeltasMs: [16, 20, 40],
      framesObserved: 4,
      firstFrameAtMs: 1000,
      latestFrameAtMs: 1111.126,
      previewFramesObserved: 1,
      immersiveFramesObserved: 3,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    })).toEqual({
      sampleCount: 3,
      avgFrameMs: 25.33,
      p95FrameMs: 40,
      maxFrameMs: 40,
      approxFps: 39.5,
      framesObserved: 4,
      firstFrameAtMs: 1000,
      latestFrameAtMs: 1111.13,
      sampleWindowSize: 3,
      latestFrameDeltaMs: 40,
      sampleWindowMs: 76,
      longFrameCountOver33Ms: 1,
      longFrameRatio: 0.33,
      previewFramesObserved: 1,
      immersiveFramesObserved: 3,
      qualitySource: "webxr_animation_loop",
      renderLoopMode: "webxr_animation_loop_with_preview_fallback",
      isPresenting: true,
      visibilityState: "visible",
    });
  });

  it("builds richer manual input evidence and distinguishes deliberate hand-gesture locomotion", () => {
    expect(primitiveHandModelProfile).toBe("spheres");
    expect(primitiveHandRepresentationKind).toBe("primitive_spheres");
    expect(meshHandModelProfile).toBe("mesh");
    expect(meshHandRepresentationKind).toBe("mesh");
    expect(localHandMeshPath).toBe("/xr-hands/generic-hand/");

    expect(buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      activeHandRepresentationKind: "mesh",
      handInputsObserved: 2,
      keyboardVector: { forward: 1, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0.5, turn: 0 },
      xrHandGestureState: {
        armed: false,
        dwellMs: 0,
        leftPinch: false,
        rightPinch: false,
        gestureDeadzoneMeters: 0.045,
        turnCooldownMs: 450,
        blockedReason: "not_pinching",
      },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: true, axisCount: 4 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 456.789,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: null,
      previousRigPose: { x: 0.1, z: -0.1, yawRadians: 0.2 },
      rigPosition: { x: 0.2, z: -0.3 },
      rigYawRadians: 0.24,
    })).toEqual({
      handModelCount: 2,
      handModelStatus: "installed",
      handRepresentationKind: "mesh",
      handInputsObserved: 2,
      locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
      locomotionAttempt: "runtime_event_observed",
      lastInputObservedAtMs: 456.79,
      lastLocomotionAtMs: 456.79,
      activeLocomotionSource: "mixed",
      inputSourceCount: 2,
      inputSourceKinds: ["keyboard", "xr_gamepad", "xr_hand"],
      keyboardVector: { forward: 1, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0.5, turn: 0 },
      xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureState: {
        armed: false,
        dwellMs: 0,
        leftPinch: false,
        rightPinch: false,
        gestureDeadzoneMeters: 0.045,
        turnCooldownMs: 450,
        blockedReason: "not_pinching",
      },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: true, axisCount: 4 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      rigPosition: { x: 0.2, z: -0.3 },
      locomotionDelta: {
        from: { x: 0.1, z: -0.1, yawRadians: 0.2 },
        to: { x: 0.2, z: -0.3, yawRadians: 0.24 },
        delta: { x: 0.1, z: -0.2, yawRadians: 0.04 },
        distanceMeters: 0.224,
        turnRadians: 0.04,
      },
    });

    expect(buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureVector: { forward: 0.4, strafe: -0.2, turn: 0.15 },
      xrHandGestureState: {
        armed: true,
        dwellMs: 520,
        leftPinch: true,
        rightPinch: true,
        gestureDeadzoneMeters: 0.045,
        turnCooldownMs: 450,
      },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: false, axisCount: 0 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 567.891,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: null,
      previousRigPose: { x: 0, z: 0, yawRadians: 0 },
      rigPosition: { x: 0.08, z: -0.12 },
      rigYawRadians: 0.15,
    })).toMatchObject({
      lastInputObservedAtMs: 567.89,
      lastLocomotionAtMs: 567.89,
      activeLocomotionSource: "xr_hand_gesture",
      inputSourceKinds: ["xr_hand", "xr_hand_gesture"],
      xrHandGestureVector: { forward: 0.4, strafe: -0.2, turn: 0.15 },
      locomotionDelta: {
        from: { x: 0, z: 0, yawRadians: 0 },
        to: { x: 0.08, z: -0.12, yawRadians: 0.15 },
        delta: { x: 0.08, z: -0.12, yawRadians: 0.15 },
        distanceMeters: 0.144,
        turnRadians: 0.15,
      },
      xrHandGestureState: expect.objectContaining({
        armed: true,
        dwellMs: 520,
        leftPinch: true,
        rightPinch: true,
      }),
    });

    expect(buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureVector: { forward: 0.5, strafe: 0, turn: 0 },
      xrHandGestureState: {
        armed: false,
        dwellMs: 180,
        leftPinch: true,
        rightPinch: false,
        gestureDeadzoneMeters: 0.045,
        turnCooldownMs: 450,
        blockedReason: "arming_dwell",
      },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: false, axisCount: 0 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 789.123,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: 222.22,
      previousRigPose: { x: 0, z: 0, yawRadians: 0 },
      rigPosition: { x: 0, z: 0 },
      rigYawRadians: 0,
    })).toMatchObject({
      lastInputObservedAtMs: 789.12,
      lastLocomotionAtMs: 222.22,
      activeLocomotionSource: "none",
      inputSourceKinds: ["xr_hand"],
      xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureState: expect.objectContaining({
        armed: false,
        dwellMs: 180,
        blockedReason: "arming_dwell",
      }),
    });
  });

  it("keeps primitive spheres as the explicit fallback while mesh hands are loading or failed", () => {
    const baseInput = {
      handModelCount: 2,
      handModelStatus: "installed" as const,
      handInputsObserved: 2,
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: false, axisCount: 0 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 123,
      previousLastInputObservedAtMs: null,
      previousLastLocomotionAtMs: null,
      rigPosition: { x: 0, z: 0 },
    };

    expect(buildManualPerformanceInputEvidence(baseInput).handRepresentationKind).toBe("primitive_spheres");
    expect(buildManualPerformanceInputEvidence({
      ...baseInput,
      activeHandRepresentationKind: "primitive_spheres",
    }).handRepresentationKind).toBe("primitive_spheres");
    expect(buildManualPerformanceInputEvidence({
      ...baseInput,
      handModelStatus: "failed",
      activeHandRepresentationKind: "primitive_spheres",
      handAssetLoadErrors: ["/xr-hands/generic-hand/left.glb"],
    })).toMatchObject({
      handRepresentationKind: "primitive_spheres",
      handAssetLoadErrors: ["/xr-hands/generic-hand/left.glb"],
    });
  });

  it("does not stamp locomotion when an active source produces no rig movement delta", () => {
    const evidence = buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 1, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
      xrInputSources: [],
      now: 999.123,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: 222.22,
      previousRigPose: { x: 0, z: 0, yawRadians: 0 },
      rigPosition: { x: 0, z: 0 },
      rigYawRadians: 0,
      locomotionDiagnostics: {
        claimScope: "attempt_diagnostics_only",
        gamepadDeadzone: 0.18,
        handPinchThresholdMeters: 0.035,
        handGestureDeadzoneMeters: 0.045,
        handGestureTurnDeadzoneMeters: 0.055,
        gamepadSources: [
          {
            handedness: "left",
            rawAxes: [0.1012, -0.2209, 0.176, -0.188],
            selectedXAxisIndex: 2,
            selectedYAxisIndex: 3,
            xAxisAfterDeadzone: 0,
            yAxisAfterDeadzone: -0.188,
            activeAfterDeadzone: true,
            contribution: "move",
          },
        ],
        handGestureHands: [
          {
            handedness: "left",
            jointsVisible: {
              wrist: true,
              indexTip: true,
              thumbTip: true,
            },
            pinchDistanceMeters: 0.0416,
            pinching: false,
            armed: false,
            dwellMs: 0,
            relativeOffsetMeters: null,
            movementCrossedDeadzone: false,
            blockedReason: "not_pinching",
          },
        ],
      },
    });

    expect(evidence).toMatchObject({
      activeLocomotionSource: "keyboard",
      locomotionAttempt: "keyboard_attempted_no_runtime_event",
      lastInputObservedAtMs: 999.12,
      lastLocomotionAtMs: 222.22,
      rigPosition: { x: 0, z: 0 },
      locomotionDiagnostics: {
        claimScope: "attempt_diagnostics_only",
        gamepadDeadzone: 0.18,
        handPinchThresholdMeters: 0.035,
        handGestureDeadzoneMeters: 0.045,
        handGestureTurnDeadzoneMeters: 0.055,
        gamepadSources: [
          {
            handedness: "left",
            rawAxes: [0.101, -0.221, 0.176, -0.188],
            selectedXAxisIndex: 2,
            selectedYAxisIndex: 3,
            xAxisAfterDeadzone: 0,
            yAxisAfterDeadzone: -0.188,
            activeAfterDeadzone: true,
            contribution: "move",
          },
        ],
        handGestureHands: [
          {
            handedness: "left",
            jointsVisible: {
              wrist: true,
              indexTip: true,
              thumbTip: true,
            },
            pinchDistanceMeters: 0.042,
            pinching: false,
            armed: false,
            dwellMs: 0,
            relativeOffsetMeters: null,
            movementCrossedDeadzone: false,
            blockedReason: "not_pinching",
          },
        ],
      },
    });
    expect(evidence).not.toHaveProperty("locomotionDelta");
  });

  it("treats measured room-scale headset movement as locomotion evidence", () => {
    const evidence = buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: false, axisCount: 0 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 1001.234,
      previousLastInputObservedAtMs: 900,
      previousLastLocomotionAtMs: null,
      previousRigPose: { x: 0, z: 0, yawRadians: 0 },
      rigPosition: { x: 0, z: 0 },
      rigYawRadians: 0,
      previousRoomScalePose: { x: 0.1, z: -0.1, yawRadians: 0 },
      roomScalePose: { x: 0.42, z: -0.24, yawRadians: 0 },
    });

    expect(evidence).toMatchObject({
      activeLocomotionSource: "xr_room_scale",
      locomotionAttempt: "runtime_event_observed",
      lastInputObservedAtMs: 1001.23,
      lastLocomotionAtMs: 1001.23,
      inputSourceKinds: ["xr_hand", "xr_room_scale"],
      roomScalePose: { x: 0.42, z: -0.24, yawRadians: 0 },
      locomotionDelta: {
        from: { x: 0.1, z: -0.1, yawRadians: 0 },
        to: { x: 0.42, z: -0.24, yawRadians: 0 },
        delta: { x: 0.32, z: -0.14, yawRadians: 0 },
        distanceMeters: 0.349,
        turnRadians: 0,
      },
    });
    expect(evidence.roomScaleDelta).toEqual(evidence.locomotionDelta);
  });

  it("builds metadata evidence for in-VR text panels without claiming headset readability", () => {
    const evidence = buildReadableVrTextPanelEvidence({
      name: "openclinxr.ed-chest-pain.in-vr-input-panel",
      title: "Input Evidence",
      lines: ["Session: In Full VR", "Hands: installed; observed 2"],
      canvasPixels: { width: 1280, height: 640 },
      worldMeters: { width: 1.65, height: 0.72 },
      updatedAtMs: 123.456,
    });

    expect(evidence).toMatchObject({
      name: "openclinxr.ed-chest-pain.in-vr-input-panel",
      title: "Input Evidence",
      source: "canvas_texture_metadata",
      canvasPixels: { width: 1280, height: 640 },
      worldMeters: { width: 1.65, height: 0.72 },
      lineCount: 2,
      previewLines: ["Session: In Full VR", "Hands: installed; observed 2"],
      lastUpdatedAtMs: 123.46,
      readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
    });
    expect(evidence.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("derives manual Quest performance metrics from rolling frame stats", () => {
    expect(manualPerformanceMetricsFromFrameStats({
      sampleCount: 3,
      avgFrameMs: 22,
      p95FrameMs: 33,
      maxFrameMs: 40,
      approxFps: 45.5,
      framesObserved: 4,
      firstFrameAtMs: 1000,
      sampleWindowSize: 3,
      previewFramesObserved: 1,
      immersiveFramesObserved: 3,
      latestFrameAtMs: 1234.56,
    })).toEqual({
      avgFps: 45.5,
      p95FrameMs: 33,
      minimumObservedFps: 25,
      controllerSelectLatencyMs: null,
      source: "window.__openClinXrFrameStats",
      framesObserved: 4,
      sampleWindowSize: 3,
      firstFrameAtMs: 1000,
      previewFramesObserved: 1,
      immersiveFramesObserved: 3,
    });
  });

  it("builds a Quest manual performance draft with explicit human-completion placeholders", () => {
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 92,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      controllerSelectLatencyMs: 87.5,
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        lastLocomotionAtMs: 1234.56,
        rigPosition: { x: 0.1, z: -0.2 },
        locomotionDelta: {
          from: { x: 0, z: 0, yawRadians: 0 },
          to: { x: 0.1, z: -0.2, yawRadians: 0 },
          delta: { x: 0.1, z: -0.2, yawRadians: 0 },
          distanceMeters: 0.224,
          turnRadians: 0,
        },
      },
      traceLatencyEvidence: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 87.5,
        source: "xr_controller_select",
        measuredAtMs: 1288.4,
        productionControllerLatencySubstitute: false,
      },
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
        traceInteractionAttempt: "runtime_event_observed",
        textReadable: true,
        immersiveSessionStarted: false,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
        handTrackingPosture: "optional_feature_with_local_mesh_hand_model_and_primitive_fallback",
        locomotionPosture: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
      },
      input: {
        handModelCount: 2,
        handModelStatus: "installed",
        handRepresentationKind: "primitive_spheres",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        locomotionAttempt: "runtime_event_observed",
        lastLocomotionAtMs: 1234.56,
        rigPosition: { x: 0.1, z: -0.2 },
        locomotionDelta: {
          from: { x: 0, z: 0, yawRadians: 0 },
          to: { x: 0.1, z: -0.2, yawRadians: 0 },
          delta: { x: 0.1, z: -0.2, yawRadians: 0 },
          distanceMeters: 0.224,
          turnRadians: 0,
        },
      },
      traceLatencyProxy: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 87.5,
        source: "xr_controller_select",
        measuredAtMs: 1288.4,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 4,
        sampleWindowSize: 3,
        firstFrameAtMs: null,
        previewFramesObserved: 0,
        immersiveFramesObserved: 0,
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

  it("summarizes the live manual performance capture as an ingest draft with validation blockers", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: [11, 12, 18],
      framesObserved: 4,
      latestFrameAtMs: 1234.56,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 90,
      foregroundPageConfirmed: true,
      traceInteractionPassed: false,
      frameStats,
      immersiveSessionStarted: true,
      traceLatencyEvidence: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 24,
        source: "xr_controller_select",
        measuredAtMs: 1300,
        productionControllerLatencySubstitute: false,
      },
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        lastInputObservedAtMs: 1234.56,
        lastLocomotionAtMs: null,
        activeLocomotionSource: "none",
        inputSourceKinds: ["xr_hand"],
        locomotionDiagnostics: {
          claimScope: "attempt_diagnostics_only",
          gamepadDeadzone: 0.18,
          handPinchThresholdMeters: 0.035,
          handGestureDeadzoneMeters: 0.045,
          handGestureTurnDeadzoneMeters: 0.055,
          gamepadSources: [
            {
              handedness: "left",
              rawAxes: [0.1, 0.2, 0.01, -0.16],
              selectedXAxisIndex: 2,
              selectedYAxisIndex: 3,
              xAxisAfterDeadzone: 0,
              yAxisAfterDeadzone: 0,
              activeAfterDeadzone: false,
              contribution: "move",
            },
          ],
          handGestureHands: [
            {
              handedness: "left",
              jointsVisible: {
                wrist: true,
                indexTip: true,
                thumbTip: true,
              },
              pinchDistanceMeters: 0.04,
              pinching: false,
              armed: false,
              dwellMs: 0,
              relativeOffsetMeters: null,
              movementCrossedDeadzone: false,
              blockedReason: "not_pinching",
            },
          ],
        },
        rigPosition: { x: 0, z: 0 },
      },
    });

    expect(buildManualPerformanceCaptureSummary({ draft, frameStats, now: 1300 })).toEqual({
      source: "window.__openClinXrManualPerformanceDraft",
      generatedAt: "2026-05-04T00:00:00.000Z",
      framesObserved: 4,
      firstFrameAtMs: null,
      latestFrameAtMs: 1234.56,
      frameStatsAgeMs: 65.44,
      frameStatsFresh: true,
      sampleWindowSize: 3,
      previewFramesObserved: 0,
      immersiveFramesObserved: 4,
      isPresenting: true,
      visibilityState: "visible",
      qualitySource: "webxr_animation_loop",
      handInputsObserved: 2,
      handModelStatus: "installed",
      handRepresentationKind: "primitive_spheres",
      handAssetLoadErrors: [],
      activeLocomotionSource: "none",
      inputSourceKinds: ["xr_hand"],
      lastLocomotionAtMs: null,
      locomotionAttempt: "not_attempted",
      locomotionDistanceMeters: null,
      locomotionTurnRadians: null,
      locomotionDiagnosticSummary: {
        claimScope: "attempt_diagnostics_only",
        gamepadSourceCount: 1,
        activeGamepadSourceCount: 0,
        handGestureHandCount: 1,
        pinchingHandCount: 0,
        movementCrossedDeadzoneHandCount: 0,
        handGestureBlockedReasons: ["not_pinching"],
      },
      locomotionProbeSummary: {
        claimScope: "runtime_probe_only",
        readiness: "blocked",
        primaryReason: "gamepad_axes_below_deadzone",
        reasonCodes: ["gamepad_axes_below_deadzone", "hand_not_pinching"],
        activeVectorWithoutRigDelta: false,
        controllerSources: {
          total: 1,
          activeAfterDeadzone: 0,
        },
        handGesture: {
          handsObserved: 1,
          pinching: 0,
          armed: 0,
          movementCrossedDeadzone: 0,
        },
      },
      traceLatencySource: "xr_controller_select",
      traceInteractionAttempt: "xr_controller_select_attempted_no_runtime_event",
      lastTraceTag: "ecg_request",
      lastTraceLatencyMs: 24,
      immersiveFrameEvidenceReady: false,
      headsetSelectLatencyReady: false,
      locomotionEvidenceReady: false,
      technicalGaps: [
        "immersive_frame_sample_not_ready",
        "headset_select_trace_latency_missing",
        "locomotion_delta_missing",
      ],
      draftAvailable: true,
      manualValidationReady: false,
      satisfiedConditions: [
        "generated_at_valid",
        "foreground_page_confirmed",
        "station_shell_loaded",
        "text_readability_confirmed",
        "immersive_session_started",
        "experience_mode_full_vr_recorded",
        "hand_or_controller_input_observed",
        "console_errors_empty",
        "performance_source_openclinxr_frame_stats",
        "average_fps_72_or_higher",
        "p95_frame_ms_25_or_lower",
        "xr_controller_select_trace_latency_recorded",
      ],
      blockers: [
        "performed_by_missing",
        "devtools_screencast_not_disabled",
        "extra_browser_windows_not_closed",
        "duration_under_10_minutes",
        "trace_interaction_not_confirmed",
        "locomotion_not_observed",
        "frame_sample_under_600_or_missing",
        "immersive_frame_sample_under_600_or_missing",
        "rolling_frame_window_under_120_or_missing",
        "minimum_fps_below_60_or_missing",
        "controller_select_latency_ms_above_150_or_missing",
        "motion_comfort_not_confirmed",
        "heat_concern_not_cleared",
        "battery_drop_not_recorded",
      ],
    });
    expect(buildManualPerformanceCaptureSummary({
      draft: undefined,
      frameStats: undefined,
      now: 1300,
    })).toMatchObject({
      draftAvailable: false,
      latestFrameAtMs: null,
      frameStatsAgeMs: null,
      frameStatsFresh: null,
      manualValidationReady: false,
      blockers: ["missing_manual_performance_draft", "missing_frame_stats"],
    });
  });

  it("labels copied Quest evidence as ready or draft with blocker counts", () => {
    const missingSummary = buildManualPerformanceCaptureSummary({
      draft: undefined,
      frameStats: undefined,
      now: 1300,
    });

    expect(formatManualEvidenceCopyStatus(missingSummary, "not_copied")).toBe("Not copied: draft; 2 blockers");
    expect(formatManualEvidenceCopyStatus({
      ...missingSummary,
      manualValidationReady: true,
      blockers: [],
    }, "copied")).toBe("Copied: ready; no blockers");
    expect(formatManualEvidenceCopyStatus({
      ...missingSummary,
      blockers: ["frame_stats_stale_or_unsampled"],
    }, "copy_blocked")).toBe("Copy blocked: draft; 1 blocker");
    expect(formatManualEvidenceCopyStatus(missingSummary, "clipboard_unavailable")).toBe("Clipboard unavailable: draft; 2 blockers");
  });

  it("summarizes why hand-tracking-only locomotion did not move the rig", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: [12, 13, 14],
      framesObserved: 180,
      latestFrameAtMs: 3200,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:02:00.000Z",
      elapsedSecond: 120,
      foregroundPageConfirmed: true,
      traceInteractionPassed: false,
      frameStats,
      immersiveSessionStarted: true,
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        lastInputObservedAtMs: 3188,
        lastLocomotionAtMs: null,
        activeLocomotionSource: "none",
        inputSourceKinds: ["xr_hand"],
        locomotionDiagnostics: {
          claimScope: "attempt_diagnostics_only",
          gamepadDeadzone: 0.18,
          handPinchThresholdMeters: 0.035,
          handGestureDeadzoneMeters: 0.045,
          handGestureTurnDeadzoneMeters: 0.055,
          gamepadSources: [],
          handGestureHands: [
            {
              handedness: "left",
              jointsVisible: {
                wrist: true,
                indexTip: true,
                thumbTip: true,
              },
              pinchDistanceMeters: 0.052,
              pinching: false,
              armed: false,
              dwellMs: 0,
              relativeOffsetMeters: null,
              movementCrossedDeadzone: false,
              blockedReason: "not_pinching",
            },
            {
              handedness: "right",
              jointsVisible: {
                wrist: true,
                indexTip: true,
                thumbTip: true,
              },
              pinchDistanceMeters: 0.029,
              pinching: true,
              armed: false,
              dwellMs: 120,
              relativeOffsetMeters: { x: 0.01, z: 0.012 },
              movementCrossedDeadzone: false,
              blockedReason: "arming_dwell",
            },
          ],
        },
        rigPosition: { x: 0, z: 0 },
      },
    });

    expect(buildManualPerformanceCaptureSummary({ draft, frameStats, now: 3300 }).locomotionProbeSummary).toEqual({
      claimScope: "runtime_probe_only",
      readiness: "blocked",
      primaryReason: "no_gamepad_sources",
      reasonCodes: ["no_gamepad_sources", "hand_not_pinching", "hand_arming_dwell"],
      activeVectorWithoutRigDelta: false,
      controllerSources: {
        total: 0,
        activeAfterDeadzone: 0,
      },
      handGesture: {
        handsObserved: 2,
        pinching: 1,
        armed: 0,
        movementCrossedDeadzone: 0,
      },
    });
  });

  it("reports manual validation readiness for a complete ten-minute capture preview", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: Array.from({ length: 180 }, () => 13),
      framesObserved: 1200,
      latestFrameAtMs: 600_000,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 600,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      frameStats,
      controllerSelectLatencyMs: 87.5,
      immersiveSessionStarted: true,
      traceLatencyEvidence: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 87.5,
        source: "xr_controller_select",
        measuredAtMs: 600_000,
        productionControllerLatencySubstitute: false,
      },
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        lastInputObservedAtMs: 1234.56,
        lastLocomotionAtMs: 1240,
        activeLocomotionSource: "xr_gamepad",
        inputSourceKinds: ["xr_gamepad", "xr_hand"],
        rigPosition: { x: 0.25, z: -0.3 },
        locomotionDelta: {
          from: { x: 0, z: 0, yawRadians: 0 },
          to: { x: 0.25, z: -0.3, yawRadians: 0 },
          delta: { x: 0.25, z: -0.3, yawRadians: 0 },
          distanceMeters: 0.391,
          turnRadians: 0,
        },
      },
    });
    const completeDraft = {
      ...draft,
      runContext: {
        ...draft.runContext,
        performedBy: "Patrick Gidich",
      },
      setup: {
        ...draft.setup,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      comfort: {
        motionComfort: "good" as const,
        heatConcern: false,
        batteryDropPercent: 4,
      },
    };

    expect(buildManualPerformanceCaptureSummary({ draft: completeDraft, frameStats })).toMatchObject({
      draftAvailable: true,
      manualValidationReady: true,
      satisfiedConditions: expect.arrayContaining(["motion_comfort_confirmed"]),
      blockers: [],
    });
    expect(buildManualPerformanceCaptureSummary({
      draft: completeDraft,
      frameStats,
      now: 603_500,
    })).toMatchObject({
      draftAvailable: true,
      latestFrameAtMs: 600_000,
      frameStatsAgeMs: 3500,
      frameStatsFresh: false,
      manualValidationReady: false,
      blockers: ["frame_stats_stale_or_unsampled"],
    });

    const handFailureSummary = buildManualPerformanceCaptureSummary({
      draft: {
        ...completeDraft,
        input: completeDraft.input
          ? {
            ...completeDraft.input,
            handModelStatus: "failed",
            handAssetLoadErrors: ["/xr-hands/generic-hand/left.glb"],
          }
          : null,
      },
      frameStats,
    });

    expect(handFailureSummary).toMatchObject({
      handModelStatus: "failed",
      handAssetLoadErrors: ["/xr-hands/generic-hand/left.glb"],
      manualValidationReady: false,
      technicalGaps: expect.arrayContaining(["hand_mesh_asset_load_failed"]),
      blockers: expect.arrayContaining(["hand_mesh_asset_load_failed"]),
    });
  });

  it("flags an immersive session whose copied payload still has empty frame stats", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: [],
      framesObserved: 0,
      latestFrameAtMs: 1234,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 120,
      foregroundPageConfirmed: true,
      traceInteractionPassed: false,
      frameStats,
      immersiveSessionStarted: true,
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        lastInputObservedAtMs: 1234,
        lastLocomotionAtMs: null,
        activeLocomotionSource: "none",
        inputSourceKinds: ["xr_hand"],
        rigPosition: { x: 0, z: 0 },
      },
    });

    expect(buildManualPerformanceCaptureSummary({ draft, frameStats, now: 1250 })).toMatchObject({
      draftAvailable: true,
      framesObserved: 0,
      immersiveFramesObserved: 0,
      immersiveFrameEvidenceReady: false,
      technicalGaps: expect.arrayContaining(["immersive_session_started_without_frame_samples"]),
      manualValidationReady: false,
      blockers: expect.arrayContaining([
        "immersive_session_started_but_frame_stats_empty",
        "frame_sample_under_600_or_missing",
      ]),
    });
  });

  it("accepts deliberate hand-select trace latency for a hand-tracking-only capture preview", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: Array.from({ length: 180 }, () => 13),
      framesObserved: 1200,
      latestFrameAtMs: 600_000,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 600,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      frameStats,
      controllerSelectLatencyMs: 88,
      immersiveSessionStarted: true,
      traceLatencyEvidence: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 88,
        source: "xr_hand_select",
        measuredAtMs: 600_000,
        productionControllerLatencySubstitute: false,
      },
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
        lastInputObservedAtMs: 1234.56,
        lastLocomotionAtMs: 1240,
        activeLocomotionSource: "xr_hand_gesture",
        inputSourceKinds: ["xr_hand", "xr_hand_gesture"],
        rigPosition: { x: 0.25, z: -0.3 },
        locomotionDelta: {
          from: { x: 0, z: 0, yawRadians: 0 },
          to: { x: 0.25, z: -0.3, yawRadians: 0 },
          delta: { x: 0.25, z: -0.3, yawRadians: 0 },
          distanceMeters: 0.391,
          turnRadians: 0,
        },
      },
    });
    const completeDraft = {
      ...draft,
      runContext: {
        ...draft.runContext,
        performedBy: "Patrick Gidich",
      },
      setup: {
        ...draft.setup,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      comfort: {
        motionComfort: "good" as const,
        heatConcern: false,
        batteryDropPercent: 4,
      },
    };

    expect(buildManualPerformanceCaptureSummary({ draft: completeDraft, frameStats })).toMatchObject({
      manualValidationReady: true,
      traceLatencySource: "xr_hand_select",
      satisfiedConditions: expect.arrayContaining([
        "xr_hand_select_trace_latency_recorded",
        "controller_select_latency_matches_trace_proxy",
      ]),
      blockers: [],
    });
  });

  it("surfaces mock, local voice, Quest, and Mixed Reality posture without readiness overclaim", () => {
    const posture = buildRuntimeEvidencePosture({
      traceSummary: {
        observedCount: 2,
        missingCount: 4,
        missingTraceTags: ["ecg_request", "urgent_escalation", "team_communication", "patient_note_submitted"],
      },
      captureSummary: {
        source: "window.__openClinXrManualPerformanceDraft",
        generatedAt: "2026-05-04T20:36:00.000Z",
        framesObserved: 0,
        firstFrameAtMs: null,
        latestFrameAtMs: null,
        frameStatsAgeMs: null,
        frameStatsFresh: null,
        sampleWindowSize: 0,
        previewFramesObserved: 0,
        immersiveFramesObserved: 0,
        isPresenting: true,
        visibilityState: "visible",
        qualitySource: "webxr_animation_loop",
        handInputsObserved: 2,
        handModelStatus: "installed",
        handRepresentationKind: "primitive_spheres",
        handAssetLoadErrors: [],
        activeLocomotionSource: "none",
        inputSourceKinds: ["xr_hand"],
        lastLocomotionAtMs: null,
        locomotionAttempt: "not_attempted",
        locomotionDistanceMeters: null,
        locomotionTurnRadians: null,
        locomotionDiagnosticSummary: null,
        locomotionProbeSummary: {
          claimScope: "runtime_probe_only",
          readiness: "blocked",
          primaryReason: "locomotion_delta_missing",
          reasonCodes: ["locomotion_delta_missing"],
          activeVectorWithoutRigDelta: false,
          controllerSources: {
            total: 0,
            activeAfterDeadzone: 0,
          },
          handGesture: {
            handsObserved: 0,
            pinching: 0,
            armed: 0,
            movementCrossedDeadzone: 0,
          },
        },
        traceLatencySource: "dom_click_trace_button",
        traceInteractionAttempt: "dom_click_attempted_no_runtime_event",
        lastTraceTag: null,
        lastTraceLatencyMs: null,
        immersiveFrameEvidenceReady: false,
        headsetSelectLatencyReady: false,
        locomotionEvidenceReady: false,
        technicalGaps: [
          "immersive_session_started_without_frame_samples",
          "headset_select_trace_latency_missing",
          "locomotion_delta_missing",
        ],
        draftAvailable: true,
        manualValidationReady: false,
        satisfiedConditions: ["immersive_session_started", "text_readability_confirmed"],
        blockers: ["immersive_frame_count_zero_or_missing", "controller_select_trace_source_not_xr_controller_select"],
      },
      webXrSupport: {
        navigatorXrPresent: true,
        immersiveVrSupported: true,
        immersiveVrSupportCheckedAtMs: 100,
        immersiveArSupported: false,
        immersiveArSupportCheckedAtMs: 110,
        supportError: null,
      },
    });

    expect(posture.lanes).toEqual([
      expect.objectContaining({
        id: "model_dialogue",
        status: "mock_active",
        display: "mock-model active; local model gated",
        blockers: ["local_model_not_enabled_for_station_runtime"],
      }),
      expect.objectContaining({
        id: "voice_synthesis",
        status: "blocked_with_evidence",
        display: "mock-voice active; VibeVoice RTF 5.24x",
        blockers: expect.arrayContaining([
          "runtime_file_generation_only",
          "real_time_factor_above_1",
          "real_local_voice_stream_benchmark_missing",
          "webxr_playback_not_observed",
        ]),
      }),
      expect.objectContaining({
        id: "quest_foreground",
        status: "blocked_with_evidence",
        display: "Full VR evidence blocked",
        blockers: ["immersive_frame_count_zero_or_missing", "controller_select_trace_source_not_xr_controller_select"],
      }),
      expect.objectContaining({
        id: "mixed_reality",
        status: "separate_lane_blocked",
        display: "MR separate lane; immersive-ar unsupported",
        blockers: ["mixed_reality_manual_report_missing", "immersive_ar_not_supported_or_unverified"],
      }),
    ]);
    expect(posture.summary).toBe("Mock model/voice active; local voice, Quest, and MR remain evidence-gated.");
    expect(posture.notEvidenceFor).toContain("production_quest_readiness");
  });
});
