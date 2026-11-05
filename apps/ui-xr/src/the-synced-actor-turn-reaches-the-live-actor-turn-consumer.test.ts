import { consumeLiveActorTurn, liveActorTurnFromPayload } from "@openclinxr/xr-dialogue";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// C25: a server-authoritative actor turn (replyId, caption, emotion) is read by the shell's
// live actor-turn consumer: caption from plan.spokenText, face from plan.dialogueEmotionTo.
describe("the synced actor turn reaches the live actor-turn consumer", () => {
  it("plays the caption and emotion the plan carries, and publishes the turn", async () => {
    const listeners: Array<(snapshot: unknown) => void> = [];
    const played: Array<[string, string, string]> = [];
    const published: Array<{ state: string; turns: unknown[] }> = [];
    const handle = await startEncounterSyncFromUrl({
      search: "?encounterSync=ws://127.0.0.1:9",
      actorIds: () => ["patient_robert_hayes_v1"],
      register: (payload) => {
        const parsed = liveActorTurnFromPayload(payload);
        if (!parsed) return undefined;
        const consumed = consumeLiveActorTurn(parsed.plan, parsed.execution);
        return { caption: consumed.caption, faceEmotion: consumed.faceEmotion };
      },
      play: (actorId, caption, emotion) => { played.push([actorId, caption, emotion]); },
      publish: (evidence) => { published.push(evidence as never); },
      nowMs: () => 1,
      connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (cb: (snapshot: unknown) => void) => { listeners.push(cb); return () => undefined; }, leave: async () => undefined }) as never,
    });
    expect(handle?.sessionId).toBe("s");
    listeners[0]?.({ serverTick: 1, phase: "encounter", turnId: 1, turnOwner: "actor", learners: {}, stationId: "slot-a", actors: { patient_robert_hayes_v1: { id: "patient_robert_hayes_v1", speaking: true, emotion: "anxious", replyId: "r1", cueId: "", caption: "Robert Hayes: it hurts" } } });
    expect(played).toEqual([["patient_robert_hayes_v1", "Robert Hayes: it hurts", "anxious"]]);
    expect(published[0]?.turns).toHaveLength(1);
  });
});
