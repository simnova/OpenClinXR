import { describe, expect, it } from "vitest";
import {
  createActorTurnExecutionRepository,
  MemoryActorTurnExecutionRepository,
} from "./actor-turn-execution-repository.js";
import {
  actorTurnExecutionClaimScope,
  type ActorTurnExecutionRecord,
} from "./records.js";

const STATION = "station_run_actor_turn_exec_001";

function execution(
  overrides: Partial<ActorTurnExecutionRecord> = {},
): ActorTurnExecutionRecord {
  return {
    stationRunId: STATION,
    planId: "plan_maya_wob_001",
    turnId: "turn_maya_wob_001",
    actorId: "patient_maya_johnson_v1",
    spokenText: "It feels tight when I breathe.",
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "anxious",
    performancePlanId: "perf_anxious_child_mid",
    visemeCueCount: 4,
    ttsProviderId: "mock-tts",
    truncated: true,
    interruptionKind: "truncated",
    droppedTags: ["[cry]"],
    prosodyNeutralized: false,
    atSecond: 22,
    durableStore: "database_source_of_truth",
    rawAudioStored: false,
    claimScope: actorTurnExecutionClaimScope,
    ...overrides,
  };
}

describe("ActorTurnExecutionRepository", () => {
  it("uses an honest in-memory backend when no Mongo db is provided", async () => {
    const repository = createActorTurnExecutionRepository();
    expect(repository.backend).toBe("memory");
    expect(repository).toBeInstanceOf(MemoryActorTurnExecutionRepository);
    await repository.ensureIndexes();
  });

  it("keeps the first insert when a duplicate planId is saved", async () => {
    const repository = createActorTurnExecutionRepository();
    const first = execution({
      planId: "plan_append_only_001",
      turnId: "turn_append_only_001",
      spokenText: "original spoken text",
      visemeCueCount: 2,
      atSecond: 10,
    });
    await repository.save(first);
    await repository.save({
      ...first,
      spokenText: "mutated spoken text must not overwrite",
      visemeCueCount: 99,
      ttsProviderId: "other-tts",
      truncated: false,
    });

    const listed = await repository.listByStationRunId(STATION);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(first);
  });

  it("restores two turns in time order with a two-step emotionalTimeline from stored from/to/atSecond", async () => {
    const repository = createActorTurnExecutionRepository();
    const later = execution({
      planId: "plan_maya_wob_later",
      turnId: "turn_maya_wob_later",
      spokenText: "It is a little better now.",
      dialogueEmotionFrom: "anxious",
      dialogueEmotionTo: "reassured",
      visemeCueCount: 3,
      truncated: false,
      interruptionKind: "none",
      droppedTags: [],
      atSecond: 40,
    });
    const earlier = execution({
      planId: "plan_maya_wob_earlier",
      turnId: "turn_maya_wob_earlier",
      atSecond: 8,
    });
    await repository.save(later);
    await repository.save(earlier);

    const replay = await repository.restoreReplay(STATION);
    expect(replay.turns.map((turn) => turn.planId)).toEqual([earlier.planId, later.planId]);
    expect(replay.emotionalTimeline).toEqual([
      {
        planId: earlier.planId,
        actorId: earlier.actorId,
        from: earlier.dialogueEmotionFrom,
        to: earlier.dialogueEmotionTo,
        atSecond: earlier.atSecond,
      },
      {
        planId: later.planId,
        actorId: later.actorId,
        from: later.dialogueEmotionFrom,
        to: later.dialogueEmotionTo,
        atSecond: later.atSecond,
      },
    ]);
  });

  it("refuses to persist raw learner audio", async () => {
    const repository = createActorTurnExecutionRepository();
    await expect(
      repository.save({
        ...execution({ planId: "plan_raw_audio_flag" }),
        rawAudioStored: true,
      } as unknown as ActorTurnExecutionRecord),
    ).rejects.toThrow(/must not store raw audio/);

    await expect(
      repository.save({
        ...execution({ planId: "plan_raw_audio_payload" }),
        rawAudio: "UklGRg==",
      } as unknown as ActorTurnExecutionRecord),
    ).rejects.toThrow(/must not store raw audio/);

    const listed = await repository.listByStationRunId(STATION);
    expect(listed).toEqual([]);
  });
});
