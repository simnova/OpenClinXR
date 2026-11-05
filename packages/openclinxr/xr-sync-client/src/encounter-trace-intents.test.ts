import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

type Sent = [string, unknown];

async function joined(results: Array<"ack" | "reject" | "throw"> = []) {
  const sent: Sent[] = [];
  const published: EncounterSyncEvidence[] = [];
  let call = 0;
  const handle = await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (evidence) => { published.push(evidence); },
    nowMs: () => 1,
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload?: unknown) => {
        sent.push([kind, payload]);
        const mode = results[call++] ?? "ack";
        if (mode === "throw") throw new Error("intent timeout");
        return mode === "ack" ? { status: "ack", seq: call, serverTs: 0, rttMs: 1 } : { status: "reject", seq: call, reason: "not_your_turn" };
      },
      onState: () => () => undefined,
      leave: async () => undefined,
    }) as never,
  });
  return { sent, evidence: published[0] as EncounterSyncEvidence, handle };
}

describe("learner trace actions over the room (C26)", () => {
  it("sends select-actor, utterance-start, utterance-end with the topic tag, in order", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendTraceAction?.("p", "ask_onset");
    expect(sent).toEqual([["select-actor", { actorId: "p" }], ["utterance-start", {}], ["utterance-end", { topicTag: "ask_onset" }]]);
  });
  it("records each send with its per-intent statuses on the evidence", async () => {
    const { evidence } = await joined();
    await evidence.sendTraceAction?.("p", "ask_onset");
    expect(evidence.intents).toEqual([{ actorId: "p", topicTag: "ask_onset", statuses: ["ack", "ack", "ack"] }]);
  });
  it("stops at the first rejected intent and records it, without throwing", async () => {
    const { sent, evidence } = await joined(["reject"]);
    await expect(evidence.sendTraceAction?.("p", "ask_onset")).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(evidence.intents).toEqual([{ actorId: "p", topicTag: "ask_onset", statuses: ["reject"] }]);
  });
  it("records a thrown intent as error without throwing", async () => {
    const { evidence } = await joined(["ack", "throw"]);
    await expect(evidence.sendTraceAction?.("p", "ask_onset")).resolves.toBeUndefined();
    expect(evidence.intents?.[0]?.statuses).toEqual(["ack", "error"]);
  });
  it("sends nothing for a trace tag with no actor", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendTraceAction?.(undefined, "hand_hygiene");
    expect(sent).toEqual([]);
    expect(evidence.intents).toEqual([]);
  });
  it("the handle exposes the same send", async () => {
    const { sent, handle } = await joined();
    await handle?.sendTraceAction("p", "ask_onset");
    expect(sent.map(([kind]) => kind)).toEqual(["select-actor", "utterance-start", "utterance-end"]);
  });
  it("serializes overlapping trace actions: the second waits for the first's three intents", async () => {
    const sent: Sent[] = [];
    let handle: Awaited<ReturnType<typeof startEncounterSyncFromUrl>> = null;
    handle = await startEncounterSyncFromUrl({
      search: "?encounterSync=ws://127.0.0.1:9",
      actorIds: () => ["p", "q"],
      register: () => undefined,
      play: () => undefined,
      publish: () => undefined,
      nowMs: () => 1,
      connectFn: async () => ({
        sessionId: "s",
        sendIntent: async (kind: string, payload?: unknown) => {
          sent.push([kind, payload]);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { status: "ack", seq: sent.length, serverTs: 0, rttMs: 1 };
        },
        onState: () => () => undefined,
        leave: async () => undefined,
      }) as never,
    });
    await Promise.all([handle?.sendTraceAction("p", "t1"), handle?.sendTraceAction("q", "t2")]);
    expect(sent.map(([kind, payload]) => `${kind}:${JSON.stringify(payload)}`)).toEqual([
      'select-actor:{"actorId":"p"}', "utterance-start:{}", 'utterance-end:{"topicTag":"t1"}',
      'select-actor:{"actorId":"q"}', "utterance-start:{}", 'utterance-end:{"topicTag":"t2"}',
    ]);
  });
});
