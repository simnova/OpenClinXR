import { describe, expect, it } from "vitest";
import type { VoiceEngine, VoiceSink, VoiceSlot } from "./headset.js";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C30 RED: startEncounterSyncFromUrl speaks each captioned server turn through deps.voice AFTER the shell's play(),
// and publishes evidence.voice.{records, unlock}. deps.voice = { slotFor, voiceFor, assetBase, engine?, sink? } (engine/sink injectable).

const actor = (over: Record<string, unknown> = {}) => ({ id: "a", speaking: false, emotion: "anxious", replyId: "", cueId: "", caption: "", ...over });
const snap = (turnId: number, actors: Record<string, ReturnType<typeof actor>>, stationId = "slot-a") => ({ serverTick: turnId, phase: "encounter", turnId, turnOwner: "actor", actors, learners: {}, observerCount: 0, stationId, stationIndex: 0, stationCount: 1 });

async function rig() {
  const order: string[] = [];
  const requests: Array<[string, string]> = [];
  let listener: (s: unknown) => void = () => undefined;
  const published: EncounterSyncEvidence[] = [];
  const slot: VoiceSlot = { activeSpeech: { text: "x", startedAtMs: 0, durationMs: 100, phonemeSequence: ["AA"] } };
  const engine: VoiceEngine = { synthesize: async (text, voice, onChunk) => { order.push("synth"); requests.push([text, voice]); onChunk(Float32Array.from({ length: 4800 }, (_, i) => 0.3 * Math.sin(i / 8))); return { audioSeconds: 0.2, computeMs: 4 }; } };
  const sink: VoiceSink = { reset: () => undefined, push: () => undefined, end: () => undefined, onStart: () => undefined, onFinish: () => undefined, positionSeconds: () => null, peakAmplitude: () => 0.3 };
  const handle = await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p", "q"],
    register: (payload: Record<string, unknown>) => { const plan = payload["actorTurnPlan"] as { spokenText: string; dialogueEmotionTo: string }; return { caption: plan.spokenText, faceEmotion: plan.dialogueEmotionTo }; },
    play: () => { order.push("play"); },
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 5,
    voice: { assetBase: "/mesm-tts/", slotFor: () => slot, voiceFor: (id: string) => (id === "p" ? "miles" : undefined), engine, sink },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack", seq: 1, serverTs: 0, rttMs: 1 }), onState: (cb: (s: unknown) => void) => { listener = cb; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  return { order, requests, emit: (s: unknown) => listener(s), evidence: published[0] as EncounterSyncEvidence, handle };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("the shell speaks the server's actor turn (C30)", () => {
  it("speaks the caption after play(), in the voice the scenario authors for that actor", async () => {
    const r = await rig();
    r.emit(snap(1, { p: actor({ id: "p", speaking: true, replyId: "p:opening", caption: "Robert Hayes: It feels heavy." }) }));
    await settle();
    expect(r.order).toEqual(["play", "synth"]);
    expect(r.requests).toEqual([["It feels heavy.", "heart"]]);
    const voice = (r.evidence as unknown as { voice: { records: Array<Record<string, unknown>>; unlock: () => Promise<void> } }).voice;
    expect(voice.records).toHaveLength(1);
    expect(voice.records[0]).toMatchObject({ actorId: "p", turnKey: "1:p", voiceRequested: "miles", voiceUsed: "heart", voiceFallback: true, chars: 15, error: "" });
    expect(typeof voice.unlock).toBe("function");
    expect(JSON.stringify(voice.records)).not.toContain("heavy");
    expect(Object.keys(voice.records[0] as object).every((key) => ["actorId", "attached", "audioClock", "audioSeconds", "chars", "chunks", "computeMs", "cueCount", "error", "firstAudioMs", "firstChunkMs", "nonSilentCues", "peak", "played", "rtf", "turnKey", "underruns", "voiceFallback", "voiceRequested", "voiceUsed", "xRealtime"].includes(key))).toBe(true);
  });
  it("an actor with no authored voice gets Heart with no fallback; a turn with no caption is recorded by play() only and never synthesized", async () => {
    const r = await rig();
    r.emit(snap(1, { q: actor({ id: "q", speaking: true, replyId: "c3-ack-open", caption: "Dr Ng: Hello." }) }));
    await settle();
    r.emit(snap(2, { q: actor({ id: "q", speaking: true, replyId: "c3-ack-onset", caption: "" }) }));
    await settle();
    expect(r.requests).toEqual([["Hello.", "heart"]]);
    const voice = (r.evidence as unknown as { voice: { records: Array<Record<string, unknown>> } }).voice;
    expect(voice.records.map((x) => [x["turnKey"], x["voiceFallback"]])).toEqual([["1:q", false]]);
  });
  it("without deps.voice nothing is spoken and no voice evidence exists", async () => {
    const published: EncounterSyncEvidence[] = [];
    await startEncounterSyncFromUrl({ search: "?encounterSync=ws://127.0.0.1:9", actorIds: () => ["p"], register: () => undefined, play: () => undefined, publish: (e: EncounterSyncEvidence) => { published.push(e); }, nowMs: () => 1, connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: () => () => undefined, leave: async () => undefined }) as never } as never);
    expect((published[0] as unknown as { voice?: unknown }).voice).toBeUndefined();
  });

  it("a Worker that fails to load fails the turn with a recorded error and does not hang the next turn", async () => {
    const holder = globalThis as unknown as { Worker?: unknown };
    const original = holder.Worker;
    let created = 0;
    holder.Worker = class {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: { message?: string }) => void) | null = null;
      terminated = false;
      constructor() { created += 1; }
      postMessage(message: { op: string }) { if (message.op === "load") queueMicrotask(() => this.onerror?.({ message: "import failed" })); }
      terminate() { this.terminated = true; }
    };
    try {
      let listener: (s: unknown) => void = () => undefined;
      const published: EncounterSyncEvidence[] = [];
      await startEncounterSyncFromUrl({
        search: "?encounterSync=ws://127.0.0.1:9",
        actorIds: () => ["p"],
        register: (payload: Record<string, unknown>) => { const plan = payload["actorTurnPlan"] as { spokenText: string; dialogueEmotionTo: string }; return { caption: plan.spokenText, faceEmotion: plan.dialogueEmotionTo }; },
        play: () => undefined,
        publish: (e: EncounterSyncEvidence) => { published.push(e); },
        nowMs: () => 1,
        voice: { assetBase: "/mesm-tts/", slotFor: () => undefined, voiceFor: () => undefined },
        connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (cb: (s: unknown) => void) => { listener = cb; return () => undefined; }, leave: async () => undefined }) as never,
      } as never);
      listener(snap(1, { p: actor({ id: "p", speaking: true, caption: "A: Hello." }) }));
      listener(snap(2, { p: actor({ id: "p", speaking: true, caption: "A: Again." }) }));
      await settle();
      await settle();
      const records = (published[0] as unknown as { voice: { records: Array<Record<string, unknown>> } }).voice.records;
      expect(records.map((r) => r["error"])).toEqual(["voice worker error: import failed", "voice worker error: import failed"]);
      expect(created).toBe(2);
    } finally {
      holder.Worker = original;
    }
  });

  it("a Worker constructor that throws fails each turn alone: no hang, and the next turn tries again", async () => {
    const holder = globalThis as unknown as { Worker?: unknown };
    const original = holder.Worker;
    let attempts = 0;
    holder.Worker = class { constructor() { attempts += 1; throw new Error("worker blocked"); } };
    try {
      let listener: (s: unknown) => void = () => undefined;
      const published: EncounterSyncEvidence[] = [];
      await startEncounterSyncFromUrl({
        search: "?encounterSync=ws://127.0.0.1:9",
        actorIds: () => ["p"],
        register: (payload: Record<string, unknown>) => { const plan = payload["actorTurnPlan"] as { spokenText: string; dialogueEmotionTo: string }; return { caption: plan.spokenText, faceEmotion: plan.dialogueEmotionTo }; },
        play: () => undefined,
        publish: (e: EncounterSyncEvidence) => { published.push(e); },
        nowMs: () => 1,
        voice: { assetBase: "/mesm-tts/", slotFor: () => undefined, voiceFor: () => undefined },
        connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (cb: (s: unknown) => void) => { listener = cb; return () => undefined; }, leave: async () => undefined }) as never,
      } as never);
      listener(snap(1, { p: actor({ id: "p", speaking: true, caption: "A: Hello." }) }));
      listener(snap(2, { p: actor({ id: "p", speaking: true, caption: "A: Again." }) }));
      await settle();
      await settle();
      const records = (published[0] as unknown as { voice: { records: Array<Record<string, unknown>> } }).voice.records;
      expect(records.map((r) => r["error"])).toEqual(["worker blocked", "worker blocked"]);
      expect(attempts).toBe(2);
    } finally {
      holder.Worker = original;
    }
  });
});
