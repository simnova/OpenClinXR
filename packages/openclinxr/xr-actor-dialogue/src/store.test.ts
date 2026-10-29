import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { phonemesForText, resolveLiveActorTurnForTrace } from "@openclinxr/xr-dialogue/package-actor-turn";
import {
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
  humanoidDialogueDurationMs,
} from "@openclinxr/xr-humanoid-animation";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import { Group, Line, Mesh } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActorDialogueStore } from "./index.js";
import type { ActorDialogueStoreOptions } from "./store.js";
import type { ActorDialogueAdaptiveEvidence, ActorDialogueSequence, ActorDialogueTurn } from "./types.js";

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

function genuineSlot(actorId: string): GeneratedHumanoidAnimationSlot {
  const root = new Group();
  const actorSlot = new Group();
  actorSlot.add(root);
  return {
    actorId,
    assetId: `${actorId}-asset`,
    root,
    actorSlot,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: new Mesh(),
    gazeCue: new Line(),
    eyeFocusCue: new Group(),
    expressionCue: new Group(),
    emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    sourceComparatorFreezeEnabled: false,
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

  it("latest direct sequence play invalidates earlier queued continuations", () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let now = 1000;
      const base = stubOptions({
        nowMs: () => now,
        scheduleTimeout: (callback, delayMs) => {
          setTimeout(callback, delayMs);
        },
        setDialogueLineText: (text) => {
          lines.push(text);
        },
      });
      const store = createActorDialogueStore(base);
      const turns = base.fallbackTurns();
      const first: ActorDialogueSequence = {
        sequenceId: "seq_inhaler_history",
        traceTag: "inhaler_history",
        source: "single_runtime_turn",
        turns: [turns[0]!, turns[2]!],
      };
      const second: ActorDialogueSequence = {
        sequenceId: "seq_parent_communication",
        traceTag: "parent_communication",
        source: "single_runtime_turn",
        turns: [turns[1]!],
      };
      store.playPedsActorPlayerRuntimeSequence(first, turns);
      store.playPedsActorPlayerRuntimeSequence(second, turns);
      now += 60000;
      vi.advanceTimersByTime(60000);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => !line.includes("watching her breathing"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("two-actor sequence holds the second actor until the first utterance ends", () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let now = 1000;
      const parentCaption =
        "Tara: She was up half the night coughing and I am really worried about her breathing right now.";
      const base = stubOptions({
        nowMs: () => now,
        scheduleTimeout: (callback, delayMs) => {
          setTimeout(callback, delayMs);
        },
        setDialogueLineText: (text) => {
          lines.push(text);
        },
        liveTurnForTrace: () => undefined,
      });
      const parentDuration = humanoidDialogueDurationMs(phonemesForText(parentCaption).length, false);
      expect(parentDuration).toBeGreaterThan(1150);
      const store = createActorDialogueStore(base);
      const turns = base.fallbackTurns();
      const longParent: ActorDialogueTurn = { ...turns[1]!, text: parentCaption };
      const sequence: ActorDialogueSequence = {
        sequenceId: "seq_parent_then_nurse",
        traceTag: "parent_communication",
        source: "single_runtime_turn",
        turns: [longParent, turns[2]!],
      };
      store.playPedsActorPlayerRuntimeSequence(sequence, turns);
      vi.advanceTimersByTime(0);
      expect(lines.length).toBe(1);
      now += 1150;
      vi.advanceTimersByTime(1150);
      expect(lines.length).toBe(1);
      now = 1000 + parentDuration;
      vi.advanceTimersByTime(parentDuration - 1150);
      expect(lines.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("divergent actor clock holds the second actor until the actor clock ends", () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const parentCaption =
        "Tara: She was up half the night coughing and I am really worried about her breathing right now.";
      let wallNow = 2000;
      const parentSlot = genuineSlot("parent_tara_johnson_v1");
      const nurseSlot = genuineSlot("nurse_kevin_lee_v1");
      parentSlot.root.userData["openClinXrSpeechNowMs"] = 1000;
      nurseSlot.root.userData["openClinXrSpeechNowMs"] = 1000;
      const base = stubOptions({
        nowMs: () => wallNow,
        scheduleTimeout: (callback, delayMs) => {
          setTimeout(callback, delayMs);
        },
        setDialogueLineText: (text) => {
          lines.push(text);
        },
        liveTurnForTrace: () => undefined,
        animationSlots: () => [parentSlot, nurseSlot],
        animationSlotForActor: (actorId) =>
          actorId === parentSlot.actorId ? parentSlot : actorId === nurseSlot.actorId ? nurseSlot : undefined,
      });
      const store = createActorDialogueStore(base);
      const turns = base.fallbackTurns();
      const longParent: ActorDialogueTurn = { ...turns[1]!, text: parentCaption };
      const sequence: ActorDialogueSequence = {
        sequenceId: "seq_divergent_actor_clock",
        traceTag: "parent_communication",
        source: "single_runtime_turn",
        turns: [longParent, turns[2]!],
      };
      store.playPedsActorPlayerRuntimeSequence(sequence, turns);
      vi.advanceTimersByTime(0);
      expect(lines.length).toBe(1);
      const firstSpeech = parentSlot.activeSpeech;
      expect(firstSpeech).toBeDefined();
      const startedAt = firstSpeech!.startedAtMs;
      const duration = firstSpeech!.durationMs;
      expect(startedAt).toBe(1000);
      expect(duration).toBeGreaterThan(1150);
      const actualEnd = startedAt + duration;
      wallNow = actualEnd + 1000;
      parentSlot.root.userData["openClinXrSpeechNowMs"] = actualEnd - 416.3;
      vi.advanceTimersByTime(duration);
      expect(lines.length).toBe(1);
      parentSlot.root.userData["openClinXrSpeechNowMs"] = actualEnd;
      delete parentSlot.activeSpeech;
      vi.advanceTimersByTime(416.3 + 1);
      expect(lines.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("missing actor callback cancels the queued continuation", () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let now = 1000;
      const base = stubOptions({
        nowMs: () => now,
        scheduleTimeout: (callback, delayMs) => {
          setTimeout(callback, delayMs);
        },
        setDialogueLineText: (text) => {
          lines.push(text);
        },
        slotHasActor: () => false,
      });
      const store = createActorDialogueStore(base);
      const turns = base.fallbackTurns();
      const sequence: ActorDialogueSequence = {
        sequenceId: "seq_missing_actor",
        traceTag: "parent_communication",
        source: "single_runtime_turn",
        turns: [turns[1]!, turns[2]!],
      };
      store.playPedsActorPlayerRuntimeSequence(sequence, turns);
      now += 60000;
      vi.advanceTimersByTime(60000);
      expect(lines.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
