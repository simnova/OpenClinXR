import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { createEdChestPainLocalLearnerRuntimeAssetBundle, type LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import {
  completeTraceAction,
  buildManualPerformanceEvidencePayload,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceInputEvidence,
  buildReadableVrTextPanelEvidence,
  buildRuntimeFrameStats,
  createInitialRuntimeState,
  createRuntimeStateFromBundle,
  deriveRuntimeTraceActionTags,
  actorResponseTextFromApiResult,
  buildManualPerformanceDraft,
  buildManualPerformanceReproducibility,
  buildRuntimeEvidencePosture,
  buildXrTraceActionHandoffEvidence,
  buildXrTraceInteractionEvidenceSummary,
  buildIwsdkStationMcpSmokePlan,
  eventTypeForTraceTag,
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
  handGestureLocomotionOriginMeters,
  handGestureRelativeOffsetMeters,
  type ReadableVrTextPanelEvidenceSet,
  type SceneAssetEvidence,
  localHandMeshPath,
  remoteActorTurnForTraceTag,
  manualPerformanceMetricsFromFrameStats,
  mapHandGestureLocomotionVector,
  parseBrowserVersionHints,
  stationTraceActionTags,
  summarizeFrameDeltas,
  summarizeTraceReadiness,
  xrExperienceModeEvidence,
  xrExperienceModeContracts,
  type RuntimeInteractionEvidence,
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
    expect(formatStationClock(-5)).toBe("00:00");
    expect(formatStationClock(Number.NaN)).toBe("00:00");
  });

  it("tracks required trace actions for the ED station", () => {
    let state = createInitialRuntimeState();
    state = completeTraceAction(state, "ecg_request");
    state = completeTraceAction(state, "team_communication");

    expect(state.completedTraceTags).toEqual(["ecg_request", "team_communication"]);
    expect(summarizeTraceReadiness(state).observedCount).toBe(2);
    expect(summarizeTraceReadiness(state).missingCount).toBeGreaterThan(0);
  });

  it("summarizes trace readiness from required tags only", () => {
    expect(summarizeTraceReadiness({
      ...createInitialRuntimeState(),
      requiredTraceTags: ["ecg_request", "team_communication"],
      completedTraceTags: ["ecg_request", "ecg_request", "unmapped_runtime_probe"],
    })).toEqual({
      observedCount: 1,
      missingCount: 1,
      missingTraceTags: ["team_communication"],
    });
  });

  it("deduplicates repeated required trace tags in readiness counts", () => {
    expect(summarizeTraceReadiness({
      ...createInitialRuntimeState(),
      requiredTraceTags: ["ecg_request", "ecg_request", "team_communication"],
      completedTraceTags: ["ecg_request"],
    })).toEqual({
      observedCount: 1,
      missingCount: 1,
      missingTraceTags: ["team_communication"],
    });
  });

  it("exposes every required ED trace tag for headset trace controls", () => {
    expect(stationTraceActionTags).toEqual(edChestPainScenario.requiredTraceTags);
  });

  it("derives runtime trace controls from the selected learner bundle dialogue manifest", () => {
    const bundle: LearnerRuntimeAssetBundle = {
      ...createEdChestPainLocalLearnerRuntimeAssetBundle({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      stationId: "peds_asthma_parent_anxiety_station_v1",
      }),
      sceneManifest: {
        ...createEdChestPainLocalLearnerRuntimeAssetBundle().sceneManifest,
        schemaVersion: "openclinxr.runtime-scene-manifest.v1",
        manifestId: "runtime-scene-manifest:peds_asthma_parent_anxiety_v1:test",
        source: "generated_scene_pipeline",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        stationId: "peds_asthma_parent_anxiety_station_v1",
        stationContext: {
          title: "Pediatric Asthma With Parent Anxiety",
          subtitle: "Respiratory distress with worried parent",
          stageAriaLabel: "Pediatric asthma station",
          canvasAriaLabel: "Pediatric asthma WebXR station",
          chiefConcern: "Assess pediatric respiratory distress",
          initialVitals: "HR 128, RR 32, SpO2 91% on room air",
          interruption: "Parent asks whether her child needs oxygen.",
          initialDialogueText: "Parent: She is breathing so fast.",
        },
        roomProps: [],
        actorPlacements: {},
        equipmentPlacements: {},
        dialogueTurns: [
          {
            traceTag: "work_of_breathing_assessment",
            actorId: "patient_maya_johnson_v1",
            text: "Maya: It is hard to breathe.",
            gazeTargetKind: "learner_camera",
            gazeTargetActorId: null,
          },
          {
            traceTag: "oxygen_request",
            actorId: "nurse_kevin_lee_v1",
            text: "Nurse Lee: I will start oxygen now.",
            gazeTargetKind: "actor",
            gazeTargetActorId: "patient_maya_johnson_v1",
          },
          {
            traceTag: "parent_communication",
            actorId: "parent_tara_johnson_v1",
            text: "Tara: Please explain what you are doing.",
            gazeTargetKind: "learner_camera",
            gazeTargetActorId: null,
          },
        ],
      },
    };

    expect(deriveRuntimeTraceActionTags(bundle)).toEqual([
      "work_of_breathing_assessment",
      "oxygen_request",
      "parent_communication",
    ]);
    expect(createRuntimeStateFromBundle(bundle, {
      ...createInitialRuntimeState(),
      completedTraceTags: ["ecg_request", "oxygen_request"],
      elapsedSecond: 42,
    })).toMatchObject({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      title: "Pediatric Asthma With Parent Anxiety",
      elapsedSecond: 42,
      requiredTraceTags: [
        "work_of_breathing_assessment",
        "oxygen_request",
        "parent_communication",
      ],
      completedTraceTags: ["oxygen_request"],
    });
  });

  it("classifies scenario-bank trace tags into review-safe learner event types", () => {
    expect(eventTypeForTraceTag("work_of_breathing_assessment")).toBe("learner.exam");
    expect(eventTypeForTraceTag("inhaler_history")).toBe("learner.history");
    expect(eventTypeForTraceTag("trigger_history")).toBe("learner.history");
    expect(eventTypeForTraceTag("oxygen_request")).toBe("learner.order");
    expect(eventTypeForTraceTag("bronchodilator_plan")).toBe("learner.order");
    expect(eventTypeForTraceTag("urgent_escalation")).toBe("learner.escalation");
    expect(eventTypeForTraceTag("parent_communication")).toBe("learner.family");
    expect(eventTypeForTraceTag("empathy_statement")).toBe("learner.empathy");
    expect(eventTypeForTraceTag("patient_note_submitted")).toBe("learner.note");
  });

  it("builds a review-safe XR trace action handoff with IWSDK sidecar targets", () => {
    const firstState = completeTraceAction(createInitialRuntimeState(), "ecg_request");
    const secondState = completeTraceAction(firstState, "team_communication");

    expect(buildXrTraceActionHandoffEvidence({
      state: secondState,
      generatedAtMs: 1234.567,
      lastTraceLatencyEvidence: {
        lastTraceTag: "team_communication",
        lastSelectLatencyMs: 18.25,
        source: "xr_controller_select",
        measuredAtMs: 1234.56,
        productionControllerLatencySubstitute: false,
      },
      actions: [
        {
          sequence: 1,
          traceTag: "ecg_request",
          source: "dom_click_trace_button",
          eventType: "learner.order",
          actorId: "nurse_maria_alvarez_v1",
          completedAtSecond: 83,
          completedAtMs: 1200,
          selectLatencyMs: 12.5,
        },
        {
          sequence: 2,
          traceTag: "team_communication",
          source: "xr_controller_select",
          eventType: "learner.team",
          actorId: "nurse_maria_alvarez_v1",
          completedAtSecond: 120,
          completedAtMs: 1234.56,
          selectLatencyMs: 18.25,
        },
      ],
    })).toMatchObject({
      source: "window.__openClinXrTraceActionHandoffEvidence",
      scenarioId: "ed_chest_pain_priority_v1",
      generatedAtMs: 1234.57,
      observedRequiredCount: 2,
      requiredCount: edChestPainScenario.requiredTraceTags.length,
      nextTraceTag: "history_opqrst",
      latestAction: {
        traceTag: "team_communication",
        source: "xr_controller_select",
        eventType: "learner.team",
        actorId: "nurse_maria_alvarez_v1",
      },
      iwsdkSidecarHandoff: {
        posture: "sidecar_only_supporting_evidence",
        smokePlanHash: iwsdkStationMcpSmokePlanHash,
        controllerSelectTraceTag: "ecg_request",
        reviewTargets: {
          inputPanel: iwsdkStationSceneObjects.inputPanel,
          controllerGripLeft: iwsdkStationSceneObjects.controllerGripLeft,
          controllerGripRight: iwsdkStationSceneObjects.controllerGripRight,
        },
      },
      notEvidenceFor: [
        "production_quest_readiness",
        "validated_clinical_score_use",
        "live_provider_readiness",
      ],
    });
  });

  it("summarizes XR trace action handoff evidence for faculty review without Quest-readiness claims", () => {
    const state = completeTraceAction(createInitialRuntimeState(), "ecg_request");
    const handoff = buildXrTraceActionHandoffEvidence({
      state,
      generatedAtMs: 1234.567,
      actions: [
        {
          sequence: 1,
          traceTag: "ecg_request",
          source: "dom_click_trace_button",
          eventType: "learner.order",
          actorId: "nurse_maria_alvarez_v1",
          completedAtSecond: 83,
          completedAtMs: 1200,
          selectLatencyMs: 12.5,
        },
      ],
    });

    expect(buildXrTraceInteractionEvidenceSummary(handoff)).toEqual({
      source: "xr_trace_action_handoff_summary",
      scenarioId: "ed_chest_pain_priority_v1",
      latestTraceTag: "ecg_request",
      latestTraceSource: "dom_click_trace_button",
      latestTraceLatencyMs: 12.5,
      observedRequiredCount: 1,
      requiredCount: edChestPainScenario.requiredTraceTags.length,
      nextMissingTraceTag: "history_opqrst",
      sourceClass: "desktop_or_runtime_input",
      reviewSafe: true,
      claimBoundary: "xr_trace_interaction_summary_not_quest_readiness",
      notEvidenceFor: [
        "production_quest_readiness",
        "validated_clinical_score_use",
        "live_provider_readiness",
      ],
    });
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
      "openclinxr.ed-chest-pain.environment-shell",
      "openclinxr.ed-chest-pain.environment-shell.generated-glb",
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.ecg-cart-12-lead",
      "openclinxr.ed-chest-pain.ecg-cart-12-lead.generated-glb",
      "openclinxr.ed-chest-pain.iv-pole-with-pump",
      "openclinxr.ed-chest-pain.iv-pole-with-pump.generated-glb",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
      "openclinxr.ed-chest-pain.patient-robert-hayes.generated-humanoid-glb",
      "openclinxr.ed-chest-pain.nurse-maria-alvarez",
      "openclinxr.ed-chest-pain.nurse-maria-alvarez.generated-humanoid-glb",
      "openclinxr.ed-chest-pain.spouse-anna-hayes",
      "openclinxr.ed-chest-pain.spouse-anna-hayes.generated-humanoid-glb",
      "openclinxr.ed-chest-pain.wall-clock",
      "openclinxr.ed-chest-pain.in-vr-clinical-panel",
      "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
      "openclinxr.ed-chest-pain.in-vr-actor-realism-requirements-panel",
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

  it("maps right-hand pinch motion to forward locomotion without requiring controllers", () => {
    expect(mapHandGestureLocomotionVector({
      handedness: "right",
      relativeOffsetMeters: { x: 0.01, z: -0.12 },
      movementDeadzoneMeters: 0.045,
      turnDeadzoneMeters: 0.055,
      movementSensitivity: 5,
      turnSensitivity: 4,
      turnCoolingDown: false,
    })).toEqual({
      forward: 0.375,
      strafe: 0,
      turn: 0,
      movementCrossedDeadzone: true,
      turnCrossedDeadzone: false,
    });

    expect(mapHandGestureLocomotionVector({
      handedness: "right",
      relativeOffsetMeters: { x: 0.12, z: -0.12 },
      movementDeadzoneMeters: 0.045,
      turnDeadzoneMeters: 0.055,
      movementSensitivity: 5,
      turnSensitivity: 4,
      turnCoolingDown: true,
    })).toEqual({
      forward: 0.375,
      strafe: 0,
      turn: 0,
      movementCrossedDeadzone: true,
      turnCrossedDeadzone: true,
    });

    expect(mapHandGestureLocomotionVector({
      handedness: "right",
      relativeOffsetMeters: { x: 0.01, z: -0.01 },
      movementDeadzoneMeters: 0.045,
      turnDeadzoneMeters: 0.055,
      movementSensitivity: 5,
      turnSensitivity: 4,
      turnCoolingDown: true,
    })).toEqual({
      forward: 0,
      strafe: 0,
      turn: 0,
      movementCrossedDeadzone: false,
      turnCrossedDeadzone: false,
    });
  });

  it("maps whole-hand pinch displacement to forward locomotion when finger-to-wrist pose stays stable", () => {
    const neutralOriginMeters = handGestureLocomotionOriginMeters({
      wrist: { x: 0, z: 0 },
      indexTip: { x: 0.02, z: -0.04 },
      thumbTip: { x: 0.018, z: -0.015 },
    });
    const relativeOffsetMeters = handGestureRelativeOffsetMeters({
      neutralOriginMeters,
      current: {
        wrist: { x: 0, z: -0.12 },
        indexTip: { x: 0.02, z: -0.16 },
        thumbTip: { x: 0.018, z: -0.135 },
      },
    });

    expect(relativeOffsetMeters).toEqual({
      x: 0,
      z: -0.12,
    });
    expect(mapHandGestureLocomotionVector({
      handedness: "right",
      relativeOffsetMeters,
      movementDeadzoneMeters: 0.045,
      turnDeadzoneMeters: 0.055,
      movementSensitivity: 5,
      turnSensitivity: 4,
      turnCoolingDown: false,
    })).toEqual({
      forward: 0.375,
      strafe: 0,
      turn: 0,
      movementCrossedDeadzone: true,
      turnCrossedDeadzone: false,
    });
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

  it("bundles text panel metadata into copied Quest evidence payloads", () => {
    const textPanelEvidence: ReadableVrTextPanelEvidenceSet = {
      source: "window.__openClinXrTextPanelEvidence" as const,
      panelCount: 1,
      panels: [buildReadableVrTextPanelEvidence({
        name: "openclinxr.ed-chest-pain.in-vr-input-panel",
        title: "Input Evidence",
        lines: ["Session: In Full VR"],
        canvasPixels: { width: 1280, height: 640 },
        worldMeters: { width: 1.65, height: 0.72 },
        updatedAtMs: 123.456,
      })],
      limitations: ["metadata_only_requires_foreground_headset_confirmation"],
    };

    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
      textPanelEvidence,
    });

    expect(payload.textPanelEvidence).toBe(textPanelEvidence);
    expect(payload.textPanelEvidence?.panels[0]?.readabilityClaim).toBe(
      "metadata_only_requires_foreground_headset_confirmation",
    );
  });

  it("bundles generated scene asset evidence into copied Quest evidence payloads", () => {
    const sceneAssetEvidence: SceneAssetEvidence = {
      source: "window.__openClinXrSceneAssetEvidence",
      generatedAtMs: 1300,
      expectedAssetCount: 5,
      loadedCount: 5,
      failedCount: 0,
      pendingCount: 0,
      fallbackActiveCount: 0,
      cameraFramingCue: "humanoid_camera_framing_decluttered_three_actor_environment_review",
      visualFidelityCueIds: ["generated_humanoid_front_fidelity_badge"],
      interactionCollisionEvidence: {
        proxyCueCount: 1,
        physicsProbeMode: "runtime_proxy_cues_with_offline_rapier_gate",
        latestProbeReportPath: "docs/openclinxr/humanoid-collision-probe-active-viseme-2026-05-23.json",
        notEvidenceFor: ["production_physics_readiness", "validated_ragdoll_biomechanics"],
      },
      notEvidenceFor: [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
      ],
      productionAssetReadinessClaimed: false,
      assets: [
        {
          assetId: "openclinxr.ed-chest-pain.patient-robert-hayes.generated-humanoid",
          assetPath: "/xr-assets/humanoids/neutral-generated-human.glb",
          sceneObjectName: "patientRobertHayesGeneratedHumanoid",
          status: "loaded",
          fallbackActive: false,
        },
      ],
    };

    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
      textPanelEvidence: null,
      sceneAssetEvidence,
    });

    expect(payload.sceneAssetEvidence).toBe(sceneAssetEvidence);
    expect(payload.sceneAssetEvidence?.productionAssetReadinessClaimed).toBe(false);
    expect(payload.sceneAssetEvidence?.notEvidenceFor).toContain("clinical_validity");
  });

  it("bundles latest runtime interaction evidence into copied Quest payloads", () => {
    const runtimeInteractionEvidence: RuntimeInteractionEvidence = {
      capturedAtMs: 1300,
      activeLocomotionSource: "xr_gamepad",
      locomotionAttempt: "runtime_event_observed",
      locomotionDistanceMeters: 1.4,
      locomotionTurnRadians: 0.25,
      locomotionProbeReadiness: "blocked",
      locomotionProbePrimaryReason: "locomotion_delta_missing",
      locomotionProbeReasonCodes: ["locomotion_delta_missing"],
      handSelectStatus: "fired",
      handSelectDwellMs: 120,
      handSelectFiredCount: 2,
      handSelectBlockedReason: null,
      activeEmotionState: "pain",
      activeExpressionTransitionMs: 420,
      activeExpressionCueCount: 6,
      activeBodyMotionMode: "scenario_dialogue_body_motion_runtime",
      activeBodyMotionIntensity: 0.25,
      activeMouthOpenness: 0.48,
      activeEyeBlinkIntensity: 0.2,
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
    };

    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
      runtimeInteractionEvidence,
    });

    expect(payload.runtimeInteractionEvidence).toEqual(runtimeInteractionEvidence);
  });

  it("bundles review-safe trace interaction summary into copied Quest payloads", () => {
    const state = completeTraceAction(createInitialRuntimeState(), "ecg_request");
    const handoff = buildXrTraceActionHandoffEvidence({
      state,
      generatedAtMs: 1500,
      actions: [
        {
          sequence: 1,
          traceTag: "ecg_request",
          source: "xr_controller_select",
          eventType: "learner.order",
          actorId: "nurse_maria_alvarez_v1",
          completedAtSecond: 60,
          completedAtMs: 1490,
          selectLatencyMs: 22,
        },
      ],
    });
    const traceInteractionEvidenceSummary = buildXrTraceInteractionEvidenceSummary(handoff);
    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1500,
      }),
      traceActionHandoffEvidence: handoff,
      traceInteractionEvidenceSummary,
    });

    expect(payload.traceInteractionEvidenceSummary).toMatchObject({
      latestTraceTag: "ecg_request",
      latestTraceSource: "xr_controller_select",
      sourceClass: "headset_class_input",
      reviewSafe: true,
      claimBoundary: "xr_trace_interaction_summary_not_quest_readiness",
    });
    expect(payload.traceInteractionEvidenceSummary?.notEvidenceFor).toContain("production_quest_readiness");
  });

  it("bundles humanoid speech phoneme and gaze evidence into copied Quest evidence payloads", () => {
    const humanoidSpeechEvidence = {
      source: "local_dialogue_phoneme_viseme_mapping" as const,
      activeActorId: "patient_robert_hayes_v1",
      activeAssetId: "openclinxr.ed-chest-pain.patient-robert-hayes.generated-humanoid",
      lastText: "My chest feels tight.",
      phonemeSequence: ["m", "a", "sil"],
      visemeSequence: ["closed", "open", "rest"],
      activePhoneme: "a",
      activeViseme: "open",
      activeMouthOpenness: 0.42,
      activeEyeBlinkIntensity: 0.61,
      activeEyeMicroSaccadeYaw: 0.018,
      activeEyeMicroSaccadePitch: -0.006,
      activeEmotionState: "pain" as const,
      activeExpressionTransitionMs: 420,
      activeExpressionWeights: {
        mouthOpen: 0.34,
        browConcern: 0.86,
        cheekTension: 0.72,
      },
      activeExpressionCueIds: [
        "visible_runtime_mouth_shape_cue",
        "visible_runtime_eye_focus_cue",
        "visible_runtime_eyebrow_jaw_cheek_cue",
        "emotion_aligned_expression_transition_cue",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
      ],
      activeActorRuntimeRealismRequirement: {
        actorId: "patient_robert_hayes_v1",
        role: "patient",
        baselineMood: ["uncomfortable", "anxious"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactionRequired: true,
        requiredCueIds: [
          "case_definition_driven_expression_selection",
          "dialogue_viseme_and_gaze_mapping",
          "actor_target_gaze_from_trace_intent",
          "scenario_actor_interaction_affordance",
          "scenario_timeline_locomotion_or_posture_change",
        ],
      },
      activeActorRealismLaunchBadge: {
        actorId: "patient_robert_hayes_v1",
        actorRole: "patient",
        status: "realismBlocked" as const,
        blockers: [
          "actor_specific_humanoid_realism_gate_not_attached",
          "runtime_realism_evidence_not_attached_to_actor_badge",
        ],
        claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only" as const,
      },
      gazeTargetKind: "learner_camera" as const,
      gazeTargetActorId: null,
      notEvidenceFor: [
        "clinical_speech_quality",
        "production_lip_sync",
        "production_eye_tracking",
        "scoring_validity",
      ] as const,
    };

    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
      humanoidSpeechEvidence,
      caseDefinedHumanoidPerformanceContractEvidence: {
        source: "case_definition_humanoid_performance_contract",
        scenarioId: "ed_chest_pain_priority_v1",
        claimBoundary: "case_definition_humanoid_performance_metadata_only",
        actorCount: 3,
        locomotionActorRoles: ["family", "nurse", "patient"],
        expressionActorRoles: ["family", "nurse", "patient"],
        gazeActorRoles: ["family", "nurse", "patient"],
        lipSyncActorRoles: ["family", "nurse", "patient"],
        interactiveActorRoles: ["family", "nurse", "patient"],
        emotionStateCount: 9,
        dialogueDrivenVisemeMappingRequired: true,
        gazeTargetingRequired: true,
        locomotionPlanningRequired: true,
        notEvidenceFor: [
          "generated_humanoid_asset_readiness",
          "animation_quality",
          "quest_readiness",
          "runtime_readiness",
          "clinical_validity",
        ],
      },
    });

    expect(payload.humanoidSpeechEvidence).toBe(humanoidSpeechEvidence);
    expect(payload.humanoidSpeechEvidence?.phonemeSequence).toEqual(["m", "a", "sil"]);
    expect(payload.humanoidSpeechEvidence?.activeExpressionCueIds).toContain("dialogue_eye_micro_saccade_blink_cue");
    expect(payload.humanoidSpeechEvidence?.activeMouthOpenness).toBe(0.42);
    expect(payload.humanoidSpeechEvidence?.activeEyeBlinkIntensity).toBe(0.61);
    expect(payload.humanoidSpeechEvidence?.activeEyeMicroSaccadeYaw).toBe(0.018);
    expect(payload.humanoidSpeechEvidence?.activeEyeMicroSaccadePitch).toBe(-0.006);
    expect(payload.humanoidSpeechEvidence?.activeEmotionState).toBe("pain");
    expect(payload.humanoidSpeechEvidence?.activeExpressionTransitionMs).toBe(420);
    expect(payload.humanoidSpeechEvidence?.activeExpressionWeights?.browConcern).toBe(0.86);
    expect(payload.humanoidSpeechEvidence?.activeActorRuntimeRealismRequirement).toMatchObject({
      actorId: "patient_robert_hayes_v1",
      role: "patient",
      locomotionRequired: true,
      expressionRequired: true,
      gazeRequired: true,
      lipSyncRequired: true,
      interactionRequired: true,
    });
    expect(payload.humanoidSpeechEvidence?.activeActorRuntimeRealismRequirement?.requiredCueIds).toContain("actor_target_gaze_from_trace_intent");
    expect(payload.humanoidSpeechEvidence?.activeActorRuntimeRealismRequirement?.baselineMood).toEqual(["uncomfortable", "anxious"]);
    expect(payload.humanoidSpeechEvidence?.activeActorRealismLaunchBadge).toMatchObject({
      actorId: "patient_robert_hayes_v1",
      actorRole: "patient",
      status: "realismBlocked",
      claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
    });
    expect(payload.humanoidSpeechEvidence?.activeActorRealismLaunchBadge?.blockers).toContain("actor_specific_humanoid_realism_gate_not_attached");
    expect(payload.humanoidSpeechEvidence?.gazeTargetKind).toBe("learner_camera");
    expect(payload.humanoidSpeechEvidence?.notEvidenceFor).toContain("production_lip_sync");
    expect(payload.caseDefinedHumanoidPerformanceContractEvidence).toMatchObject({
      source: "case_definition_humanoid_performance_contract",
      claimBoundary: "case_definition_humanoid_performance_metadata_only",
      actorCount: 3,
      dialogueDrivenVisemeMappingRequired: true,
      gazeTargetingRequired: true,
      locomotionPlanningRequired: true,
    });
    expect(payload.caseDefinedHumanoidPerformanceContractEvidence?.notEvidenceFor).toContain("generated_humanoid_asset_readiness");
  });

  it("bundles the selected runtime asset bundle id into copied Quest evidence payloads", () => {
    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      runtimeAssetBundleId: "generated-ed-bundle-001",
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
    });

    expect(payload.runtimeAssetBundleId).toBe("generated-ed-bundle-001");
  });

  it("bundles generated runtime scene manifest evidence into copied Quest evidence payloads", () => {
    const runtimeSceneManifestEvidence = {
      source: "learner_runtime_asset_bundle_scene_manifest" as const,
      manifestId: "ed_chest_pain_runtime_scene_manifest_v1",
      schemaVersion: "openclinxr.runtime-scene-manifest.v1" as const,
      roomPropCount: 30,
      semanticRoomPropCount: 30,
      actorPlacementCount: 3,
      equipmentPlacementCount: 2,
      dialogueTurnCount: 10,
      virtualDeviceActorCount: 0,
      virtualDeviceDialogueRoutedCount: 0,
      generatedBySceneManifestCount: 30,
      propIds: ["oxygen-panel", "monitor-waveform-card"],
      caseDefinedHumanoidRuntimeHandoffCount: 1,
      caseDefinedHumanoidRuntimeHandoffActorRoles: ["patient"],
      caseDefinedHumanoidRuntimeHandoffRequiredSignalIds: [
        "dialogue_viseme_and_gaze_mapping",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
      ],
      caseDefinedHumanoidRuntimeHandoff: [
        {
          claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only" as const,
          actorRole: "patient",
          workOrderIds: ["encounter_assets_ed_chest_pain_executable_v1:patient:role-animation"],
          locomotionRequired: true,
          expressionRequired: true,
          gazeRequired: true,
          lipSyncRequired: true,
          interactiveRequired: true,
          requiredSignalIds: [
            "dialogue_viseme_and_gaze_mapping",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
          ],
          blockers: [
            "runtime_realism_evidence_not_attached_to_encounter_bundle",
            "visual_qa_evidence_not_attached_to_encounter_bundle",
          ],
          notEvidenceFor: [
            "generated_humanoid_asset_readiness",
            "animation_quality",
            "quest_readiness",
            "runtime_readiness",
            "clinical_validity",
            "scoring_validity",
          ] as [
            "generated_humanoid_asset_readiness",
            "animation_quality",
            "quest_readiness",
            "runtime_readiness",
            "clinical_validity",
            "scoring_validity",
          ],
        },
      ],
      storageBackedBundle: true,
      productionReadinessClaimed: false as const,
      notEvidenceFor: [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ] as ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    };
    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      runtimeSceneManifestEvidence,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
    });

    expect(payload.runtimeSceneManifestEvidence).toBe(runtimeSceneManifestEvidence);
    expect(payload.runtimeSceneManifestEvidence?.storageBackedBundle).toBe(true);
    expect(payload.runtimeSceneManifestEvidence?.productionReadinessClaimed).toBe(false);
    expect(payload.runtimeSceneManifestEvidence?.caseDefinedHumanoidRuntimeHandoff[0]).toMatchObject({
      claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
      actorRole: "patient",
      blockers: [
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
      ],
    });
    expect(payload.runtimeSceneManifestEvidence?.caseDefinedHumanoidRuntimeHandoffRequiredSignalIds).toEqual(expect.arrayContaining([
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
    ]));
    expect(payload.runtimeSceneManifestEvidence?.caseDefinedHumanoidRuntimeHandoff[0]?.notEvidenceFor).toEqual(expect.arrayContaining([
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
      "scoring_validity",
    ]));
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
      locomotionPathQuality: null,
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
      handSelectStatus: null,
      handSelectDwellMs: null,
      handSelectFiredCount: null,
      handSelectBlockedReason: null,
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

  it("summarizes locomotion path shape without claiming motion comfort or Quest readiness", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: Array.from({ length: 12 }, () => 13),
      framesObserved: 12,
      latestFrameAtMs: 1300,
      previewFramesObserved: 0,
      immersiveFramesObserved: 12,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      frameStats,
      elapsedSecond: 120,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      immersiveSessionStarted: true,
      inputEvidence: buildManualPerformanceInputEvidence({
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 0,
        rigPosition: { x: 0.4, z: -0.3 },
        keyboardVector: { forward: 1, strafe: 0, turn: 0 },
        xrVector: { forward: 0, strafe: 0, turn: 0 },
        xrInputSources: [],
        now: 1290,
        previousRigPose: { x: 0, z: 0, yawRadians: 0 },
        previousLastInputObservedAtMs: null,
        previousLastLocomotionAtMs: null,
      }),
    });

    expect(buildManualPerformanceCaptureSummary({ draft, frameStats, now: 1310 }).locomotionPathQuality).toEqual({
      claimScope: "path_shape_probe_only",
      sampleCount: 1,
      distanceMeters: 0.5,
      turnRadians: 0,
      straightLineOnly: true,
      pathCueIds: ["runtime_locomotion_delta"],
      blockers: ["multi_sample_path_not_captured", "turn_or_curve_quality_not_captured"],
    });
  });

  it("copies structured examinee locomotion evidence without Quest or comfort claims", () => {
    const examineeLocomotionEvidence = {
      source: "keyboard" as const,
      startPose: { x: 0, z: 0, yawRadians: 0 },
      currentPose: { x: 0.04, z: -0.025, yawRadians: 0.012 },
      distanceMeters: 0.047,
      turnRadians: 0.012,
      sampleCount: 3,
      pathCueIds: ["structured_examinee_locomotion_path_evidence"],
      notEvidenceFor: [
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "motion_comfort_validation",
      ] as [
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "motion_comfort_validation",
      ],
    };
    const payload = buildManualPerformanceEvidencePayload({
      manualPerformanceDraft: null,
      captureSummary: buildManualPerformanceCaptureSummary({
        draft: undefined,
        frameStats: undefined,
        now: 1300,
      }),
      examineeLocomotionEvidence,
    });

    expect(payload.examineeLocomotionEvidence).toMatchObject({
      source: "keyboard",
      sampleCount: 3,
      distanceMeters: 0.047,
      pathCueIds: ["structured_examinee_locomotion_path_evidence"],
    });
    expect(payload.examineeLocomotionEvidence?.notEvidenceFor).toEqual([
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "motion_comfort_validation",
    ]);
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
        xrHandSelectState: {
          status: "fired",
          armed: true,
          dwellMs: 690,
          rightPinch: true,
          firedCount: 1,
          lastFiredAtMs: 600_000,
        },
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
      handSelectStatus: "fired",
      handSelectDwellMs: 690,
      handSelectFiredCount: 1,
      handSelectBlockedReason: null,
      satisfiedConditions: expect.arrayContaining([
        "xr_hand_select_trace_latency_recorded",
        "controller_select_latency_matches_trace_proxy",
      ]),
      blockers: [],
    });
  });

  it("preserves blocked hand-pinch select interaction detail without claiming readiness", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: [16, 17, 16],
      framesObserved: 30,
      latestFrameAtMs: 1500,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 45,
      foregroundPageConfirmed: true,
      traceInteractionPassed: false,
      frameStats,
      traceLatencyEvidence: {
        lastTraceTag: null,
        lastSelectLatencyMs: null,
        source: "xr_hand_select",
        measuredAtMs: 1500,
        productionControllerLatencySubstitute: false,
        interactionDetail: {
          modality: "hand_pinch_select",
          handedness: "right",
          status: "blocked",
          blockedReason: "arming_dwell",
          dwellMs: 180,
          firedCount: 0,
          rightPinch: true,
        },
      },
    });

    expect(draft.station.traceInteractionAttempt).toBe("xr_hand_select_attempted_no_runtime_event");
    expect(draft.traceLatencyProxy).toMatchObject({
      source: "xr_hand_select",
      productionControllerLatencySubstitute: false,
      interactionDetail: {
        modality: "hand_pinch_select",
        handedness: "right",
        status: "blocked",
        blockedReason: "arming_dwell",
        dwellMs: 180,
        firedCount: 0,
        rightPinch: true,
      },
    });
    const summary = buildManualPerformanceCaptureSummary({ draft, frameStats, now: 1700 });
    expect(summary.blockers).toContain("headset_select_trace_hand_select_blocked_arming_dwell");
    expect(summary.technicalGaps).toContain("headset_select_trace_hand_select_blocked_arming_dwell");
  });

  it("surfaces mock, local voice, Quest, and Mixed Reality posture without readiness overclaim", () => {
    const handoffState = completeTraceAction(createInitialRuntimeState(), "ecg_request");
    const traceActionHandoffEvidence = buildXrTraceActionHandoffEvidence({
      state: handoffState,
      generatedAtMs: 1234.567,
      lastTraceLatencyEvidence: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 18.25,
        source: "xr_controller_select",
        measuredAtMs: 1234.56,
        productionControllerLatencySubstitute: false,
      },
      actions: [
        {
          sequence: 1,
          traceTag: "ecg_request",
          source: "xr_controller_select",
          eventType: "learner.order",
          actorId: "nurse_maria_alvarez_v1",
          completedAtSecond: 83,
          completedAtMs: 1234.56,
          selectLatencyMs: 18.25,
        },
      ],
    });
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
        locomotionPathQuality: null,
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
        handSelectStatus: null,
        handSelectDwellMs: null,
        handSelectFiredCount: null,
        handSelectBlockedReason: null,
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
      runtimeInteractionEvidence: {
        capturedAtMs: 900,
        activeLocomotionSource: "xr_gamepad",
        locomotionAttempt: "runtime_event_observed",
        locomotionDistanceMeters: 1.2,
        locomotionTurnRadians: 0.13,
        locomotionProbeReadiness: "blocked",
        locomotionProbePrimaryReason: "locomotion_delta_missing",
        locomotionProbeReasonCodes: ["locomotion_delta_missing"],
        handSelectStatus: "ready",
        handSelectDwellMs: 140,
        handSelectFiredCount: 1,
        handSelectBlockedReason: null,
        activeEmotionState: "pain",
        activeExpressionTransitionMs: 110,
        activeExpressionCueCount: 4,
        activeBodyMotionMode: "scenario_dialogue_body_motion_runtime",
        activeBodyMotionIntensity: 0.22,
        activeMouthOpenness: 0.36,
        activeEyeBlinkIntensity: 0.19,
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
      },
      runtimeNowMs: 1200,
      traceActionHandoffEvidence,
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
        details: expect.objectContaining({
          activeLocomotionSource: "none",
          lastLocomotionAtMs: null,
          locomotionDistanceMeters: null,
          locomotionTurnRadians: null,
          locomotionProbeClaimScope: "runtime_probe_only",
          locomotionProbeReadiness: "blocked",
          locomotionProbePrimaryReason: "locomotion_delta_missing",
          locomotionProbeReasonCodes: ["locomotion_delta_missing"],
          runtimeInteractionEvidenceAtMs: 900,
          runtimeInteractionLocomotionSource: "xr_gamepad",
          runtimeInteractionLocomotionAttempt: "runtime_event_observed",
          runtimeInteractionLocomotionDistanceMeters: 1.2,
          runtimeInteractionLocomotionTurnRadians: 0.13,
          runtimeInteractionHandSelectStatus: "ready",
          runtimeInteractionHandSelectDwellMs: 140,
          runtimeInteractionHandSelectFiredCount: 1,
          runtimeInteractionHandSelectBlockedReason: null,
          runtimeInteractionLocomotionProbeReadiness: "blocked",
          runtimeInteractionLocomotionProbePrimaryReason: "locomotion_delta_missing",
          runtimeInteractionLocomotionProbeReasonCodes: ["locomotion_delta_missing"],
          runtimeInteractionHumanoidEmotionState: "pain",
          runtimeInteractionHumanoidExpressionTransitionMs: 110,
          runtimeInteractionHumanoidExpressionCueCount: 4,
          runtimeInteractionHumanoidBodyMotionMode: "scenario_dialogue_body_motion_runtime",
          runtimeInteractionHumanoidBodyMotionIntensity: 0.22,
          runtimeInteractionHumanoidMouthOpenness: 0.36,
          runtimeInteractionHumanoidEyeBlinkIntensity: 0.19,
          runtimeInteractionHumanoidGazeTargetKind: "learner_camera",
          runtimeInteractionHumanoidGazeTargetActorId: null,
          handSelectStatus: null,
          handSelectDwellMs: null,
          handSelectFiredCount: null,
          handSelectBlockedReason: null,
          traceHandoffObservedRequiredCount: 1,
          traceHandoffRequiredCount: edChestPainScenario.requiredTraceTags.length,
          traceHandoffNextTraceTag: "history_opqrst",
          traceHandoffLatestSource: "xr_controller_select",
          iwsdkSidecarPosture: "sidecar_only_supporting_evidence",
          iwsdkSmokePlanHash: iwsdkStationMcpSmokePlanHash,
        }),
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

  it("ignores stale runtime interaction snapshots beyond freshness window", () => {
    const captureSummary = buildManualPerformanceCaptureSummary({
      draft: undefined,
      frameStats: undefined,
      now: 5000,
    });
    const fresh = buildRuntimeEvidencePosture({
      traceSummary: {
        observedCount: 0,
        missingCount: 1,
        missingTraceTags: ["ecg_request"],
      },
      captureSummary,
      webXrSupport: {
        navigatorXrPresent: true,
        immersiveVrSupported: true,
        immersiveVrSupportCheckedAtMs: 5000,
        immersiveArSupported: true,
        immersiveArSupportCheckedAtMs: 5000,
        supportError: null,
      },
      runtimeInteractionEvidence: {
        capturedAtMs: 4800,
        activeLocomotionSource: "xr_gamepad",
        locomotionAttempt: "runtime_event_observed",
        locomotionDistanceMeters: 1.8,
        locomotionTurnRadians: 0.21,
        locomotionProbeReadiness: "blocked",
        locomotionProbePrimaryReason: "locomotion_delta_missing",
        locomotionProbeReasonCodes: ["locomotion_delta_missing"],
        handSelectStatus: "fired",
        handSelectDwellMs: 220,
        handSelectFiredCount: 3,
        handSelectBlockedReason: null,
        activeEmotionState: "neutral",
        activeExpressionTransitionMs: 140,
        activeExpressionCueCount: 3,
        activeBodyMotionMode: "scenario_dialogue_body_motion_runtime",
        activeBodyMotionIntensity: 0.33,
        activeMouthOpenness: 0.52,
        activeEyeBlinkIntensity: 0.2,
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
      },
      runtimeNowMs: 5200,
    });
    const stale = buildRuntimeEvidencePosture({
      traceSummary: {
        observedCount: 0,
        missingCount: 1,
        missingTraceTags: ["ecg_request"],
      },
      captureSummary,
      webXrSupport: {
        navigatorXrPresent: true,
        immersiveVrSupported: true,
        immersiveVrSupportCheckedAtMs: 5000,
        immersiveArSupported: true,
        immersiveArSupportCheckedAtMs: 5000,
        supportError: null,
      },
      runtimeInteractionEvidence: {
        capturedAtMs: 1000,
        activeLocomotionSource: "xr_gamepad",
        locomotionAttempt: "runtime_event_observed",
        locomotionDistanceMeters: 1.8,
        locomotionTurnRadians: 0.21,
        locomotionProbeReadiness: "blocked",
        locomotionProbePrimaryReason: "locomotion_delta_missing",
        locomotionProbeReasonCodes: ["locomotion_delta_missing"],
        handSelectStatus: "fired",
        handSelectDwellMs: 220,
        handSelectFiredCount: 3,
        handSelectBlockedReason: null,
        activeEmotionState: "neutral",
        activeExpressionTransitionMs: 140,
        activeExpressionCueCount: 3,
        activeBodyMotionMode: "scenario_dialogue_body_motion_runtime",
        activeBodyMotionIntensity: 0.33,
        activeMouthOpenness: 0.52,
        activeEyeBlinkIntensity: 0.2,
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
      },
      runtimeNowMs: 5200,
    });
    const freshQuestDetails = fresh.lanes.find((lane) => lane.id === "quest_foreground")?.details;
    const staleQuestDetails = stale.lanes.find((lane) => lane.id === "quest_foreground")?.details;

    expect(freshQuestDetails?.runtimeInteractionEvidenceAtMs).toBe(4800);
    expect(staleQuestDetails?.runtimeInteractionEvidenceAtMs).toBeNull();
    expect(staleQuestDetails?.runtimeInteractionLocomotionSource).toBeNull();
    expect(staleQuestDetails?.runtimeInteractionHandSelectStatus).toBeNull();
    expect(staleQuestDetails?.runtimeInteractionHumanoidEmotionState).toBeNull();
  });
});

import {
  buildXrRuntimeReadinessDecision,
  type RuntimeEvidencePosture,
} from "./runtime-state.js";

describe("buildXrRuntimeReadinessDecision", () => {
  it("keeps learner launch blocked until full VR, live providers, and IWSDK smoke evidence are ready", () => {
    const posture: RuntimeEvidencePosture = {
      source: "window.__openClinXrRuntimeEvidencePosture",
      summary: "Mock model/voice active; local voice, Quest, and MR remain evidence-gated.",
      notEvidenceFor: [
        "production_quest_readiness",
        "validated_clinical_score_use",
        "local_voice_live_dialog_readiness",
        "mixed_reality_privacy_readiness",
      ],
      lanes: [
        {
          id: "model_dialogue",
          label: "Model dialogue",
          status: "mock_active",
          display: "Mock dialogue active",
          evidencePath: "apps/ui-xr/src/runtime-state.ts",
          blockers: ["local_model_not_enabled_for_station_runtime"],
          details: {},
        },
        {
          id: "voice_synthesis",
          label: "Voice synthesis",
          status: "blocked_with_evidence",
          display: "File-generation only",
          evidencePath: "docs/openclinxr/runtime/voice-runtime-evidence.md",
          blockers: ["webxr_playback_not_observed"],
          details: {},
        },
        {
          id: "quest_foreground",
          label: "Quest foreground",
          status: "blocked_with_evidence",
          display: "Manual capture pending",
          evidencePath: "docs/openclinxr/runtime/quest-manual-performance.md",
          blockers: ["quest_foreground_capture_missing"],
          details: {},
        },
        {
          id: "mixed_reality",
          label: "Mixed reality",
          status: "separate_lane_blocked",
          display: "Separate lane blocked",
          evidencePath: "docs/openclinxr/runtime/mixed-reality-evidence.md",
          blockers: ["mixed_reality_manual_report_missing"],
          details: {},
        },
      ],
    };

    expect(
      buildXrRuntimeReadinessDecision({
        posture,
        iwsdkStationMcpSmokeReady: false,
      }),
    ).toEqual({
      source: "runtime_evidence_posture",
      learnerLaunchReady: false,
      fullVrEvidenceReady: false,
      liveModelAndVoiceReady: false,
      iwsdkStationMcpSmokeReady: false,
      mixedRealityReady: false,
      blockedLaneIds: [
        "model_dialogue",
        "voice_synthesis",
        "quest_foreground",
        "mixed_reality",
      ],
      blockerCount: 4,
      recommendedNextAction: "complete_full_vr_manual_evidence_before_runtime_claim",
      notEvidenceFor: posture.notEvidenceFor,
    });
  });
});
