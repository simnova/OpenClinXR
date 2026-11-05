import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

const actor = (over: Record<string, unknown> = {}) => ({ id: "a", speaking: false, emotion: "anxious", replyId: "", cueId: "", caption: "", ...over });
const snap = (turnId: number, actors: Record<string, ReturnType<typeof actor>>, stationId = "slot-a") => ({ serverTick: turnId, phase: "encounter", turnId, turnOwner: "actor", actors, learners: {}, stationId });

interface Rig {
  listeners: Array<(snapshot: unknown) => void>;
  sent: Array<[string, unknown]>;
  played: Array<[string, string, string]>;
  payloads: Array<Record<string, unknown>>;
  published: EncounterSyncEvidence[];
  connected: unknown[];
  deps: Parameters<typeof startEncounterSyncFromUrl>[0];
}

function rig(search: string): Rig {
  const r: Rig = { listeners: [], sent: [], played: [], payloads: [], published: [], connected: [], deps: undefined as never };
  r.deps = {
    search,
    actorIds: () => ["p", "q"],
    register: (payload) => {
      r.payloads.push(payload);
      const plan = payload["actorTurnPlan"] as { spokenText: string; dialogueEmotionTo: string };
      return { caption: plan.spokenText, faceEmotion: plan.dialogueEmotionTo };
    },
    play: (actorId, caption, emotion) => { r.played.push([actorId, caption, emotion]); },
    publish: (evidence) => { r.published.push(evidence); },
    nowMs: () => 5,
    connectFn: async (url, options) => {
      r.connected.push({ url, options });
      return {
        sessionId: "s1",
        sendIntent: async (kind: string, payload?: unknown) => { r.sent.push([kind, payload]); return { status: "ack", seq: 1, serverTs: 0, rttMs: 1 }; },
        onState: (cb: (snapshot: unknown) => void) => { r.listeners.push(cb); return () => undefined; },
        leave: async () => undefined,
      } as never;
    },
  };
  return r;
}

const join = async (search = "?encounterSync=ws://127.0.0.1:9") => {
  const r = rig(search);
  const handle = await startEncounterSyncFromUrl(r.deps);
  return { r, handle };
};

describe("the ?encounterSync flag", () => {
  it.each(["", "?encounterSync=", "?encounterSync=http://127.0.0.1:4567", "?encounterSync=javascript:alert(1)"])("does not join for %j", async (search) => {
    const { r, handle } = await join(search);
    expect(handle).toBeNull();
    expect(r.published).toEqual([]);
    expect(r.connected).toEqual([]);
  });
  it.each(["ws://127.0.0.1:4567", "wss://sync.example.test"])("joins for %s with the shell's actor ids", async (url) => {
    const { r, handle } = await join(`?encounterSync=${url}`);
    expect(r.connected).toEqual([{ url, options: { roomOptions: { actors: ["p", "q"] } } }]);
    expect(handle?.sessionId).toBe("s1");
    expect(r.published[0]).toMatchObject({ url, state: "joined", sessionId: "s1" });
  });
});

describe("server turns", () => {
  it("plays one turn per actor turnId on the speaking edge, with the server reply, caption and emotion", async () => {
    const { r, handle } = await join();
    const speaking = snap(1, { p: actor({ id: "p", speaking: true, replyId: "p:opening", caption: "Pat: hello", emotion: "concerned" }) });
    r.listeners[0]?.(snap(0, { p: actor({ id: "p" }) }));
    expect(r.played).toEqual([]);
    r.listeners[0]?.(speaking);
    r.listeners[0]?.(speaking);
    r.listeners[0]?.(snap(1, { p: actor({ id: "p", speaking: false, replyId: "p:opening" }) }));
    expect(r.played).toEqual([["p", "Pat: hello", "concerned"]]);
    expect(handle?.turns).toEqual([{ turnId: 1, actorId: "p", replyId: "p:opening", caption: "Pat: hello", emotion: "concerned" }]);
    expect(r.published[0]?.turns).toEqual([{ turnId: 1, actorId: "p", replyId: "p:opening", caption: "Pat: hello", emotion: "concerned", stationId: "slot-a", faceEmotion: "concerned", planCaption: "Pat: hello", playedAtMs: 5, spoken: true }]);
  });
  it("plays again when the same actor speaks on a later turn, even with an identical replyId", async () => {
    const { r } = await join();
    const at = (turnId: number) => snap(turnId, { p: actor({ id: "p", speaking: true, replyId: "r", caption: "c" }) });
    r.listeners[0]?.(at(1));
    r.listeners[0]?.(at(2));
    expect(r.played).toHaveLength(2);
  });
  it("plays the same actor's turn 1 again in the next station room, where turnId restarts", async () => {
    const { r } = await join();
    const speaks = (stationId: string) => snap(1, { p: actor({ id: "p", speaking: true, replyId: `r-${stationId}`, caption: `c-${stationId}` }) }, stationId);
    r.listeners[0]?.(speaks("slot-a"));
    r.listeners[0]?.(speaks("slot-a"));
    r.listeners[0]?.(speaks("slot-b"));
    expect(r.played.map(([, caption]) => caption)).toEqual(["c-slot-a", "c-slot-b"]);
    expect(r.published[0]?.turns.map((turn) => turn.stationId)).toEqual(["slot-a", "slot-b"]);
  });
  it("plays only the actors that are speaking", async () => {
    const { r } = await join();
    r.listeners[0]?.(snap(1, { p: actor({ id: "p", speaking: true, replyId: "r", caption: "c" }), q: actor({ id: "q" }) }));
    expect(r.played.map(([actorId]) => actorId)).toEqual(["p"]);
  });
  it("tolerates the pre-patch snapshot the SDK replays before the actor map exists", async () => {
    const { r } = await join();
    expect(() => r.listeners[0]?.({ serverTick: 0, phase: "", turnId: 0, turnOwner: "none", learners: {} })).not.toThrow();
    expect(r.played).toEqual([]);
  });
  it("hands the consumer a plan payload: caption as spokenText, server emotion as dialogueEmotionTo, station in planId", async () => {
    const { r } = await join();
    r.listeners[0]?.(snap(3, { p: actor({ id: "p", speaking: true, replyId: "p:seed:s1", caption: "Pat: it hurts", emotion: "anxious" }) }));
    expect(r.payloads[0]?.["actorTurnPlan"]).toMatchObject({ turnId: "3", actorId: "p", spokenText: "Pat: it hurts", spokenTextForTts: "Pat: it hurts", dialogueEmotionTo: "anxious", prosody: { droppedTags: [] } });
    expect(String((r.payloads[0]?.["actorTurnPlan"] as { planId: string }).planId)).toContain("slot-a");
  });
  it("maps an emotion the plan cannot carry to neutral", async () => {
    const { r } = await join();
    r.listeners[0]?.(snap(1, { p: actor({ id: "p", speaking: true, replyId: "r", caption: "c", emotion: "furious" }) }));
    expect(r.played).toEqual([["p", "c", "neutral"]]);
  });
  it("records a captionless fallback turn without playing it", async () => {
    const { r } = await join();
    r.listeners[0]?.(snap(4, { p: actor({ id: "p", speaking: true, replyId: "c3-ack-open", caption: "" }) }));
    expect(r.played).toEqual([]);
    expect(r.published[0]?.turns.map((turn) => turn.spoken)).toEqual([false]);
  });
});

describe("the joined room", () => {
  it("relays learner intents and exposes sendIntent on the published evidence", async () => {
    const { r, handle } = await join();
    expect((await handle?.sendIntent("select-actor", { actorId: "p" }))?.status).toBe("ack");
    expect((await r.published[0]?.sendIntent?.("utterance-start", {}))?.status).toBe("ack");
    expect(r.sent).toEqual([["select-actor", { actorId: "p" }], ["utterance-start", {}]]);
  });
  it("publishes a failed state when the join throws", async () => {
    const r = rig("?encounterSync=ws://127.0.0.1:9");
    const handle = await startEncounterSyncFromUrl({ ...r.deps, connectFn: async () => { throw new Error("refused"); } });
    expect(handle).toBeNull();
    expect(r.published[0]).toMatchObject({ state: "failed" });
    expect(r.published[0]?.error).toContain("refused");
  });
});
