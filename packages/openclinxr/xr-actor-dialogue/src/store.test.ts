import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { resolveLiveActorTurnForTrace } from "@openclinxr/xr-dialogue";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import { createActorDialogueStore } from "./index.js";
import type { ActorDialogueStoreOptions } from "./store.js";
import type { ActorDialogueAdaptiveEvidence, ActorDialogueTurn } from "./types.js";

function stubOptions(overrides: Partial<ActorDialogueStoreOptions> = {}): ActorDialogueStoreOptions {
  const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
  const written: HumanoidSpeechEvidence[] = [];
  const adaptive: ActorDialogueAdaptiveEvidence[] = [];
  const timeouts: Array<() => void> = [];
  return {
    encounterBundle: () => bundle,
    initialDialogueText: () => "initial",
    isPediatricAsthmaRuntimeScenario: () => true,
    isSelectedScenarioRuntimeBundleMismatch: () => false,
    selectedScenarioId: () => "peds_asthma_parent_anxiety_v1",
    selectedHumanoidSourceComparator: () => null,
    runtimePatientActorId: () => "patient_maya_johnson_v1",
    runtimeClinicalTeamActorId: () => "nurse_kevin_lee_v1",
    runtimeFamilyActorId: () => "parent_tara_johnson_v1",
    actorIdForTraceTag: () => undefined,
    recordBootPhase: () => {},
    nowMs: () => 1000,
    scheduleTimeout: (callback) => {
      timeouts.push(callback);
    },
    scheduleInterval: () => {},
    setDialogueLineText: () => {},
    speechEvidence: () => undefined,
    writeSpeechEvidence: (evidence) => {
      written.push(evidence);
    },
    ensureMissingActorSpeechEvidence: () => {},
    writeAdaptiveEvidence: (evidence) => {
      adaptive.push(evidence);
    },
    fallbackTurns: () => [
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
        actorId: "parent_tara_johnson_v1",
        turnId: "turn_6_parent_communication",
        cue: "parent_communication",
        text: "Tara: I am worried.",
        emotion: "anxious",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        roleAnimationClipName: "openclinxr_role_parent_anxious_fidget_guard",
        source: "actor_player_sample_fallback",
      },
      {
        actorId: "nurse_kevin_lee_v1",
        turnId: "turn_0_work_of_breathing_assessment",
        cue: "work_of_breathing_assessment",
        text: "Kevin: I am watching her breathing.",
        emotion: "concerned",
        gazeTargetKind: "actor",
        gazeTargetActorId: "patient_maya_johnson_v1",
        roleAnimationClipName: "openclinxr_role_nurse_clinical_check_reassure",
        source: "actor_player_sample_fallback",
      },
    ],
    liveTurnForTrace: (tag) => resolveLiveActorTurnForTrace(tag),
    liveFaceEmotionForCue: () => undefined,
    animationSlots: () => [],
    animationSlotForActor: () => undefined,
    slotHasActor: () => true,
    roleClipNameForActor: () => "openclinxr_clinical_idle_breathing",
    listenerCueContext: () =>
      ({
        actorSlotsByActorId: new Map(),
        animationSlotsByActorId: new Map(),
        orientEyeFocusCue: () => {},
        orientTowardGazeTarget: () => {},
        startEmotionTransition: () => {},
        updateEmotionExpression: () => ({ targetEmotion: "concerned", weights: { mouthOpen: 0, cheekTension: 0, browConcern: 0 } }),
        applyMorphTargetCue: () => {},
        createVector: (x: number, y: number, z: number) => ({ x, y, z }) as never,
      }) as never,
    playbackPanelContext: () => ({
      dialogueTurnCount: () => 0,
      selectedHumanoidSourceComparator: () => null,
      activeGeneratedActorSlotCount: () => 3,
      activeHumanoidSpeechEvidenceActorId: () => null,
      playbackEvidenceWritten: () => {},
    }),
    virtualDeviceSpeechByActorId: () => new Map(),
    runtimeEmbodimentForActor: () => undefined,
    reviewCaptureMode: () => false,
    responseClipNames: () => [],
    playClip: () => false,
    playFrozenTurn: () => ({}) as never,
    startFaceTransition: () => {},
    ...overrides,
  };
}

describe("actor dialogue store", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("schedules playback once and flips the scheduled flag", () => {
    const store = createActorDialogueStore(stubOptions());
    expect(store.playbackScheduled()).toBe(false);
    store.schedulePedsActorPlayerRuntimePlaybackIfReady();
    expect(store.playbackScheduled()).toBe(true);
    store.schedulePedsActorPlayerRuntimePlaybackIfReady();
    expect(store.playbackScheduled()).toBe(true);
  });

  it("records a trace playback window after a trace turn", () => {
    const store = createActorDialogueStore(stubOptions());
    const handled = store.triggerPedsActorPlayerRuntimeTurnForTrace("inhaler_history");
    expect(handled).toBe(true);
    expect(store.playbackLastTraceAtMs()).toBe(1000);
    expect(store.playbackSequenceActiveUntilMs()).toBeGreaterThan(1000);
  });

  it("dedupes bundle turns by actor, turn, and cue", () => {
    const store = createActorDialogueStore(stubOptions());
    const turn: ActorDialogueTurn = {
      actorId: "patient_maya_johnson_v1",
      turnId: "turn_1_inhaler_history",
      cue: "inhaler_history",
      text: "Maya: tight.",
      emotion: "pain",
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
      roleAnimationClipName: "clip",
      source: "bundle_dialogue_turn",
    };
    expect(store.dedupePedsActorPlayerRuntimeTurns([turn, { ...turn }])).toHaveLength(1);
  });

  it("normalizes live emotion labels to expression emotions", () => {
    const store = createActorDialogueStore(stubOptions());
    expect(store.normalizePedsActorPlayerEmotion("Frightened")).toBe("pain");
    expect(store.normalizePedsActorPlayerEmotion("anxious")).toBe("anxious");
    expect(store.normalizePedsActorPlayerEmotion("unknown")).toBe("neutral");
  });

  it("resolves the fallback actor for a legacy trace tag", () => {
    const store = createActorDialogueStore(stubOptions({ isPediatricAsthmaRuntimeScenario: () => false }));
    expect(store.localDialogueActorIdForTraceTag("history_opqrst")).toBe("patient_robert_hayes_v1");
    expect(store.localDialogueGazeTargetForTraceTag("team_communication")).toEqual({
      kind: "actor",
      actorId: "nurse_maria_alvarez_v1",
    });
    expect(store.localDialogueGazeTargetForTraceTag("history_opqrst")).toEqual({
      kind: "learner_camera",
      actorId: null,
    });
  });
});
