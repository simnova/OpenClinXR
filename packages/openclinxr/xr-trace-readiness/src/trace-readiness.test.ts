import { describe, expect, it, vi } from "vitest";
import { createTraceSelectLatencyRecorder, formatTraceInteractionEvidenceSummary } from "./trace-panels.js";
import {
  ROOM_ENVIRONMENTAL_REALISM_CUE_IDS,
  formatEnvironmentRoomSummary,
  updateEnvironmentStateForTrace,
} from "./environment-trace.js";
import {
  applyPedsActorPlayerSequenceListenerCues,
  formatActorPlayerRuntimeMetadataSummary,
  listenerEmotionForSequence,
  pedsActorPlayerRuntimeTurns,
  recordPedsActorPlayerRuntimePlaybackEvidence,
} from "./peds-actor-playback.js";
import { formatMaterializationAttachmentSummary, formatRemainingRuntimeBlockerReasons } from "./trace-panels.js";

describe("xr-trace-readiness recorders", () => {
  it("records select latency with a fixed clock", () => {
    const recorder = createTraceSelectLatencyRecorder({ nowMs: () => 1200 });
    expect(recorder.recordLatency(1150, "vitals_review", "dom_click_trace_button")).toBe(50);
    expect(recorder.currentLatencyMs()).toBe(50);
  });

  it("formats the trace interaction summary with review-safe copy", () => {
    expect(
      formatTraceInteractionEvidenceSummary({
        latestTraceTag: "vitals_review",
        latestTraceSource: "xr_controller_select",
        sourceClass: "headset_class_input",
        observedRequiredCount: 1,
        requiredCount: 3,
        nextMissingTraceTag: "ecg_request",
        reviewSafe: true,
        claimBoundary: "xr_trace_interaction_summary_not_quest_readiness",
      }),
    ).toContain("review-safe");
  });

  it("derives oxygen monitor state from trace tags", () => {
    const written: unknown[] = [];
    const evidence = updateEnvironmentStateForTrace(
      {
        previousActiveTraceTags: () => [],
        equipmentIdsForTag: () => [],
        realismCueIds: [...ROOM_ENVIRONMENTAL_REALISM_CUE_IDS],
        applyEnvironmentStateVisuals: () => {},
        applyRuntimeEquipmentTraceVisuals: () => {},
        environmentStateWritten: (record) => {
          written.push(record);
        },
      },
      "oxygen_request",
    );
    expect(evidence.monitorState).toBe("oxygen_started");
    expect(evidence.alarmCueMode).toBe("visual_only_no_audio");
    expect(formatEnvironmentRoomSummary(evidence)).toContain("monitor oxygen_started");
    expect(written).toHaveLength(1);
  });

  it("maps listener emotion from the active turn", () => {
    expect(listenerEmotionForSequence({ emotion: "pain" })).toBe("concerned");
    expect(listenerEmotionForSequence({ emotion: "reassured" })).toBe("reassured");
  });

  it("short-circuits listener cues without a multi-turn sequence", () => {
    const cues = applyPedsActorPlayerSequenceListenerCues(
      {
        actorSlotsByActorId: new Map(),
        animationSlotsByActorId: new Map(),
        orientEyeFocusCue: () => {},
        orientTowardGazeTarget: () => {},
        startEmotionTransition: () => {},
        updateEmotionExpression: () => ({
          targetEmotion: "concerned",
          weights: { mouthOpen: 0, cheekTension: 0, browConcern: 0 },
        }),
        applyMorphTargetCue: () => {},
        createVector: ((x: number, y: number, z: number) => ({ x, y, z })) as never,
      },
      { actorId: "patient_maya_johnson_v1", emotion: "pain" },
      null,
      0,
    );
    expect(cues).toEqual({ actorIds: [], coupledSignalIds: [] });
  });

  it("keeps fallback actor-player turns review-gated", () => {
    const turns = pedsActorPlayerRuntimeTurns();
    expect(turns.map((turn) => turn.turnId)).toContain("turn_1_inhaler_history");
    const written: Record<string, unknown>[] = [];
    recordPedsActorPlayerRuntimePlaybackEvidence(
      {
        dialogueTurnCount: () => 6,
        selectedHumanoidSourceComparator: () => null,
        activeGeneratedActorSlotCount: () => 0,
        activeHumanoidSpeechEvidenceActorId: () => null,
        playbackEvidenceWritten: (record) => {
          written.push(record);
        },
      },
      {
        scheduled: false,
        turns: turns.map((turn) => ({ actorId: turn.actorId })),
        latestTurnIndex: -1,
        latestTurn: null,
        latestTriggerSource: null,
        latestTraceTag: null,
        latestSequence: null,
        latestSequenceStepIndex: -1,
        latestListenerActorIds: [],
        latestCoupledSignalIds: [],
      },
    );
    expect(written[0]?.["claimBoundary"]).toBe("local_actor_player_runtime_preview_not_readiness");
    expect(
      formatActorPlayerRuntimeMetadataSummary(
        {
          executionMode: "local_deterministic_non_scene",
          actorCount: 1,
          projectedTurnCount: 1,
          projectedSampleCount: 1,
          actorSummaries: [
            {
              actorId: "patient_maya_johnson_v1",
              turnCount: 1,
              sampleCount: 1,
              sceneExecutionStatus: "not_scene_executed",
              blockerIds: [],
            },
          ],
          sourceArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
          claimBoundary: "ui_xr_actor_player_metadata_only_not_runtime_execution",
          notEvidenceFor: [],
        },
        null,
      ),
    ).toContain("review-only actor-player metadata");
    expect(formatMaterializationAttachmentSummary(null)).toBe("");
    expect(formatRemainingRuntimeBlockerReasons(null)).toBe("");
    vi.restoreAllMocks();
  });
});
