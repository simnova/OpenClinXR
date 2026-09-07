import { describe, it, expect, vi, beforeEach } from "vitest";
import { createXrActorDialogueStore } from "./store.js";
import type { XrActorDialogueDependencies, PedsActorPlayerRuntimeTurn, PedsAdaptiveDialogueBranchResolution } from "./types.js";
import type { HumanoidExpressionEmotion, GeneratedHumanoidAnimationSlot } from "./types.js";
import type { EncounterRuntimeDialogueTurn } from "@openclinxr/asset-registry";
import type { Group, Vector3 } from "three";

describe("xr-actor-dialogue store factory", () => {
  let deps: XrActorDialogueDependencies;
  let store: ReturnType<typeof createXrActorDialogueStore>;

  const createMockSlot = (actorId: string): GeneratedHumanoidAnimationSlot => ({
    assetId: `asset_${actorId}`,
    actorId,
    root: { userData: {} } as Group,
    actorSlot: {} as Group,
    baseY: 0,
    baseX: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    baseZ: 0,
    phaseOffsetMs: 0,
    mouthCue: { visible: true } as any,
    gazeCue: { visible: true } as any,
    eyeFocusCue: {} as Group,
    expressionCue: { visible: true } as Group,
    emotionExpression: {
      currentEmotion: "neutral",
      targetEmotion: "neutral",
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      transitionStartedAtMs: 0,
      transitionDurationMs: 0,
    },
    sourceComparatorFreezeEnabled: false,
  });

  const createMockVector = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

  beforeEach(() => {
    const mockBundle = {
      sceneManifest: {
        dialogueTurns: [] as EncounterRuntimeDialogueTurn[],
        stationContext: { initialDialogueText: "Hello, I'm the patient." },
      },
      scenarioId: "peds_asthma_parent_anxiety_v1",
    };

    const mockSlots = new Map<string, GeneratedHumanoidAnimationSlot>();
    const mockActorSlots = new Map<string, Group>();
    const mockVirtualDeviceSlots = new Map<string, Group>();
    const mockVirtualDeviceSpeech = new Map();

    deps = {
      encounterRuntimeAssetBundle: () => mockBundle,
      initialDialogueText: () => "Initial dialogue text",
      selectedScenarioId: () => "peds_asthma_parent_anxiety_v1",
      generatedHumanoidAnimationSlotsByActorId: () => mockSlots,
      generatedHumanoidAnimationSlots: () => Array.from(mockSlots.values()),
      generatedHumanoidActorSlotsByActorId: () => mockActorSlots,
      virtualDeviceActorSlotsByActorId: () => mockVirtualDeviceSlots,
      activeVirtualDeviceSpeechByActorId: () => mockVirtualDeviceSpeech,
      runtimePatientActorId: () => "patient_maya_johnson_v1",
      runtimeFamilyActorId: () => "parent_tara_johnson_v1",
      runtimeClinicalTeamActorId: () => "nurse_kevin_lee_v1",
      humanoidDialogueDurationMs: (phonemeCount: number) => phonemeCount * 100,
      isPediatricAsthmaRuntimeScenario: () => true,
      isHumanoidMouthGazePoseReviewCaptureMode: () => false,
      isDeterministicCaptureClock: () => false,
      selectedHumanoidSourceComparator: () => "peds_anny_real_garment_patient",
      buildHumanoidSpeechEvidence: vi.fn().mockReturnValue({}),
      recordBootPhase: vi.fn(),
      startHumanoidEmotionTransition: vi.fn(),
      attachBakedCuesToSpeech: vi.fn(),
      phonemesForText: (text: string) => text.split(" "),
      visemesForText: (text: string) => text.split(" "),
      orientHumanoidEyeFocusCue: vi.fn(),
      orientHumanoidTowardGazeTarget: vi.fn(),
      updateHumanoidEmotionExpression: vi.fn().mockReturnValue({
        currentEmotion: "neutral",
        targetEmotion: "neutral",
        weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
        targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
        transitionStartedAtMs: 0,
        transitionDurationMs: 0,
      }),
      applyHumanoidMorphTargetCue: vi.fn(),
      applyPackagePedsActorPlayerSequenceListenerCues: vi.fn().mockReturnValue({ actorIds: [], coupledSignalIds: [] }),
      listenerPackageEmotionForSequence: (activeTurn: { emotion: string }) => activeTurn.emotion as HumanoidExpressionEmotion,
      recordPackagePedsActorPlayerRuntimePlaybackEvidence: vi.fn(),
      initialDialogueTextForScenario: vi.fn().mockReturnValue("Patient: Hello"),
      resolveLiveActorTurnForTrace: vi.fn().mockReturnValue(undefined),
      actorIdForTraceTag: vi.fn().mockReturnValue(undefined),
      playLiveFrozenActorTurn: vi.fn().mockReturnValue(false),
      playOneShotResponseClip: vi.fn(),
      createHumanoidEmotionExpressionState: vi.fn().mockReturnValue({
        currentEmotion: "neutral",
        targetEmotion: "neutral",
        weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
        targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
        transitionStartedAtMs: 0,
        transitionDurationMs: 0,
      }),
      startPackageHumanoidEmotionTransition: vi.fn(),
      updatePackageHumanoidEmotionExpression: vi.fn().mockReturnValue({
        currentEmotion: "neutral",
        targetEmotion: "neutral",
        weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
        targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
        transitionStartedAtMs: 0,
        transitionDurationMs: 0,
      }),
      scenarioBank: () => [{
        scenarioId: "peds_asthma_parent_anxiety_v1",
        actors: [{
          actorId: "patient_maya_johnson_v1",
          communicationProfile: { baselineMood: ["anxious"] },
        }],
      }],
      runtimeActorEmbodimentImpl: vi.fn().mockReturnValue("generated"),
      pedsActorPlayerRuntimeTurns: () => [],
      pedsActorPlayerBundleDialogueTurns: () => [],
      pedsActorPlayerTurnFromRuntimeBundleTrace: vi.fn().mockReturnValue(undefined),
      pedsActorPlayerTurnForTraceTag: vi.fn().mockReturnValue(undefined),
      pedsActorPlayerRuntimeSequenceForTrace: vi.fn().mockReturnValue(undefined),
      dedupePedsActorPlayerRuntimeTurns: (turns: PedsActorPlayerRuntimeTurn[]) => turns,
      playPedsActorPlayerRuntimeTurn: vi.fn(),
      playPedsActorPlayerRuntimeSequence: vi.fn(),
      pedsActorListenerCuePanelContext: vi.fn().mockReturnValue({
        actorSlotsByActorId: mockActorSlots,
        animationSlotsByActorId: mockSlots,
        orientEyeFocusCue: vi.fn(),
        orientTowardGazeTarget: vi.fn(),
        startEmotionTransition: vi.fn(),
        updateEmotionExpression: vi.fn().mockReturnValue({
          targetEmotion: "neutral",
          weights: { mouthOpen: 0, cheekTension: 0, browConcern: 0 },
        }),
        applyMorphTargetCue: vi.fn(),
        createVector: createMockVector,
      }),
      applyPedsActorPlayerSequenceListenerCues: vi.fn().mockReturnValue({ actorIds: [], coupledSignalIds: [] }),
      pedsActorPlayerPlaybackPanelContext: vi.fn().mockReturnValue({
        dialogueTurnCount: () => 0,
        selectedHumanoidSourceComparator: () => "peds_anny_real_garment_patient",
        activeGeneratedActorSlotCount: () => 0,
        activeHumanoidSpeechEvidenceActorId: () => null,
        playbackEvidenceWritten: vi.fn(),
      }),
      recordPedsActorPlayerRuntimePlaybackEvidence: vi.fn(),
      localDialogueActorIdForTraceTag: vi.fn().mockReturnValue(undefined),
      localDialogueGazeTargetForTraceTag: vi.fn().mockReturnValue({ kind: "learner_camera", actorId: null }),
      runtimeDialogueTurnForTraceTag: vi.fn().mockReturnValue(undefined),
      scenarioDialogueEmotionContext: vi.fn().mockReturnValue({
        emotion: "neutral",
        source: "plan_missing",
        baselineMood: [],
        cueIds: [],
      }),
      triggerHumanoidDialogue: vi.fn(),
      triggerHumanoidDialogueForTrace: vi.fn(),
    };

    store = createXrActorDialogueStore(deps);
  });

  it("should construct store with initial private state", () => {
    expect(store.pedsActorPlayerRuntimePlaybackScheduled).toBe(false);
    expect(store.pedsActorPlayerRuntimePlaybackLastTraceAtMs).toBe(0);
    expect(store.pedsActorPlayerRuntimeSequenceActiveUntilMs).toBe(0);
  });

  it("should return initial dialogue text for selected scenario", () => {
    const text = store.initialDialogueTextForSelectedScenario();
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("should schedule peds actor player runtime playback when ready", () => {
    const mockSlot = createMockSlot("patient_maya_johnson_v1");
    deps.generatedHumanoidAnimationSlotsByActorId().set("patient_maya_johnson_v1", mockSlot);
    deps.generatedHumanoidAnimationSlotsByActorId().set("parent_tara_johnson_v1", createMockSlot("parent_tara_johnson_v1"));
    deps.generatedHumanoidAnimationSlotsByActorId().set("nurse_kevin_lee_v1", createMockSlot("nurse_kevin_lee_v1"));

    const mockTurns: PedsActorPlayerRuntimeTurn[] = [
      {
        actorId: "patient_maya_johnson_v1",
        turnId: "turn_1_inhaler_history",
        cue: "inhaler_history",
        text: "Maya: It feels tight when I breathe.",
        emotion: "pain",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        roleAnimationClipName: "openclinxr_role_patient_asthma_breathing_effort",
        source: "actor_player_sample_fallback",
      },
    ];
    deps.pedsActorPlayerRuntimeTurns = () => mockTurns;

    store.schedulePedsActorPlayerRuntimePlaybackIfReady();
    expect(store.pedsActorPlayerRuntimePlaybackScheduled).toBe(true);
  });

  it("should dedupe peds actor player runtime turns", () => {
    const turns: PedsActorPlayerRuntimeTurn[] = [
      {
        actorId: "patient_maya_johnson_v1",
        turnId: "turn_1_inhaler_history",
        cue: "inhaler_history",
        text: "Maya: It feels tight when I breathe.",
        emotion: "pain",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        roleAnimationClipName: "openclinxr_role_patient_asthma_breathing_effort",
        source: "actor_player_sample_fallback",
      },
      {
        actorId: "patient_maya_johnson_v1",
        turnId: "turn_1_inhaler_history",
        cue: "inhaler_history",
        text: "Maya: It feels tight when I breathe.",
        emotion: "pain",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        roleAnimationClipName: "openclinxr_role_patient_asthma_breathing_effort",
        source: "actor_player_sample_fallback",
      },
    ];

    const deduped = store.dedupePedsActorPlayerRuntimeTurns(turns);
    expect(deduped.length).toBe(1);
  });

  it("should normalize peds actor player emotion", () => {
    expect(store.normalizePedsActorPlayerEmotion("pain")).toBe("pain");
    expect(store.normalizePedsActorPlayerEmotion("frightened")).toBe("pain");
    expect(store.normalizePedsActorPlayerEmotion("anxious")).toBe("anxious");
    expect(store.normalizePedsActorPlayerEmotion("concerned")).toBe("concerned");
    expect(store.normalizePedsActorPlayerEmotion("reassured")).toBe("reassured");
    expect(store.normalizePedsActorPlayerEmotion("unknown")).toBe("neutral");
  });

  it("should trigger peds adaptive dialogue branch", () => {
    const branch: PedsAdaptiveDialogueBranchResolution = {
      policyTrigger: "ignored_breathing",
      branchType: "escalation",
      requestedTraceTag: "inhaler_history",
      adaptiveTraceTags: ["urgent_escalation", "parent_communication"],
      emotionTransition: { from: "frightened", to: "anxious" },
      mappingMode: "deterministic_case_escalation_policy",
      reviewSafeMetadata: { source: "bundle_dialogue_adaptive_branch", notEvidenceFor: [] },
    };

    const result = store.triggerPedsAdaptiveDialogueBranch(branch, "trace_action");
    expect(typeof result).toBe("boolean");
  });

  it("should trigger peds actor player runtime turn for trace", () => {
    const result = store.triggerPedsActorPlayerRuntimeTurnForTrace("inhaler_history");
    expect(typeof result).toBe("boolean");
  });

  it("should return peds actor player bundle dialogue turns", () => {
    const turns = store.pedsActorPlayerBundleDialogueTurns();
    expect(Array.isArray(turns)).toBe(true);
  });

  it("should return peds actor player runtime turns", () => {
    const turns = store.pedsActorPlayerRuntimeTurns();
    expect(Array.isArray(turns)).toBe(true);
  });

  it("should return humanoid dialogue duration", () => {
    const duration = store.humanoidDialogueDurationMs(5);
    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("should return scenario dialogue emotion context", () => {
    const context = store.scenarioDialogueEmotionContext("patient_maya_johnson_v1", "Hello", "anxious", "runtime_affect_timeline");
    expect(context).toHaveProperty("emotion");
    expect(context).toHaveProperty("source");
    expect(context).toHaveProperty("baselineMood");
    expect(context).toHaveProperty("cueIds");
  });

  it("should return local dialogue actor ID for trace tag", () => {
    const actorId = store.localDialogueActorIdForTraceTag("history_opqrst");
    expect(typeof actorId === "string" || actorId === undefined).toBe(true);
  });

  it("should return local dialogue gaze target for trace tag", () => {
    const gazeTarget = store.localDialogueGazeTargetForTraceTag("team_communication");
    expect(gazeTarget).toHaveProperty("kind");
    expect(gazeTarget).toHaveProperty("actorId");
  });

  it("should return runtime dialogue turn for trace tag", () => {
    const turn = store.runtimeDialogueTurnForTraceTag("inhaler_history");
    expect(turn === undefined || (turn && typeof turn === "object")).toBe(true);
  });

  it("should drive a playback schedule and assert state transition", () => {
    // Verify initial state
    expect(store.pedsActorPlayerRuntimePlaybackScheduled).toBe(false);
    expect(store.pedsActorPlayerRuntimePlaybackLastTraceAtMs).toBe(0);
    expect(store.pedsActorPlayerRuntimeSequenceActiveUntilMs).toBe(0);

    // Set up slots and turns
    const mockSlot = createMockSlot("patient_maya_johnson_v1");
    deps.generatedHumanoidAnimationSlotsByActorId().set("patient_maya_johnson_v1", mockSlot);
    deps.generatedHumanoidAnimationSlotsByActorId().set("parent_tara_johnson_v1", createMockSlot("parent_tara_johnson_v1"));
    deps.generatedHumanoidAnimationSlotsByActorId().set("nurse_kevin_lee_v1", createMockSlot("nurse_kevin_lee_v1"));

    const mockTurns: PedsActorPlayerRuntimeTurn[] = [
      {
        actorId: "patient_maya_johnson_v1",
        turnId: "turn_1_inhaler_history",
        cue: "inhaler_history",
        text: "Maya: It feels tight when I breathe.",
        emotion: "pain",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        roleAnimationClipName: "openclinxr_role_patient_asthma_breathing_effort",
        source: "actor_player_sample_fallback",
      },
    ];
    deps.pedsActorPlayerRuntimeTurns = () => mockTurns;

    // Schedule playback
    store.schedulePedsActorPlayerRuntimePlaybackIfReady();

    // Verify state transition
    expect(store.pedsActorPlayerRuntimePlaybackScheduled).toBe(true);
    expect(store.pedsActorPlayerRuntimePlaybackLastTraceAtMs).toBe(0); // Not yet updated until first turn plays
    expect(store.pedsActorPlayerRuntimeSequenceActiveUntilMs).toBe(0); // Not yet updated until sequence plays
  });
});