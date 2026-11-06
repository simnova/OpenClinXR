import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C33 RED (planted by lane manager, 2026-11-06): the room recognizes learner audio through a server-injected recognizer.
// Contract (names are the spec):
//   EncounterServerOptions.speechRecognizer?: (audio: { pcm: Int16Array; sampleRate: 16000 }) => Promise<{ text: string; confidence: number }>
//   Intent kind "speech-audio", payload { pcm: Uint8Array (little-endian int16 bytes), sampleRate: 16000 }.
//   Accepted: sampleRate === 16000, even byte length, 3200 <= bytes <= 480000 (0.1 s..15 s). Else reject "bad-audio".
//   No recognizer configured -> reject "speech-recognizer-unavailable". Recognizer throws, or returns text that is not a string,
//   or confidence not a finite number in [0,1] -> reject "speech-recognition-failed".
//   Success -> ack carrying transcript { text, confidence } (client AckResult.transcript). The recognizer receives the samples exactly.
//   A second speech-audio from the same learner while one is in flight -> reject "speech-busy".
//   Recognition is not an utterance: no trace event, no actor turn, serverTick/state unchanged apart from the learner cursor;
//   neither the audio nor the recognized text appears in getStateJSON() or getConversationTrace().
const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});
const bootServer = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function join(options: Record<string, unknown>): Promise<{ server: EncounterServer; learner: SyncConnection }> {
  const server = await bootServer(options);
  servers.push(server);
  const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => learner.leave());
  return { server, learner };
}
const pcmBytes = (samples: number, value = 1000): Uint8Array => {
  const out = new Int16Array(samples).fill(value);
  return new Uint8Array(out.buffer);
};
type Ack = { status: string; reason?: string; transcript?: { text: string; confidence: number } };
const sendAudio = (learner: SyncConnection, payload: Record<string, unknown>) => learner.sendIntent("speech-audio" as never, payload) as Promise<Ack>;

describe("xr-sync-server C33 speech-audio intake", () => {
  it("recognizes the audio and acks the transcript, handing the recognizer the exact samples", async () => {
    const seen: Array<{ n: number; first: number; rate: number }> = [];
    const { server, learner } = await join({ speechRecognizer: async (audio: { pcm: Int16Array; sampleRate: number }) => { seen.push({ n: audio.pcm.length, first: audio.pcm[0] ?? -1, rate: audio.sampleRate }); return { text: "when did it start", confidence: 0.83 }; } });
    const before = server.getConversationTrace().events.length;
    const ack = await sendAudio(learner, { pcm: pcmBytes(16000, 1234), sampleRate: 16000 });
    expect(ack).toMatchObject({ status: "ack", transcript: { text: "when did it start", confidence: 0.83 } });
    expect(seen).toEqual([{ n: 16000, first: 1234, rate: 16000 }]);
    expect(server.getConversationTrace().events.length).toBe(before);
    expect(server.getStateJSON()).not.toContain("when did it start");
    expect(JSON.stringify(server.getConversationTrace())).not.toContain("when did it start");
  }, 20000);

  it("rejects bad audio payloads before the recognizer runs", async () => {
    let calls = 0;
    const { learner } = await join({ speechRecognizer: async () => { calls += 1; return { text: "x", confidence: 0.5 }; } });
    const bad: Array<Record<string, unknown>> = [
      {}, { pcm: pcmBytes(16000) }, { pcm: pcmBytes(16000), sampleRate: 48000 }, { pcm: "AAAA", sampleRate: 16000 },
      { pcm: pcmBytes(1000), sampleRate: 16000 }, { pcm: pcmBytes(240001), sampleRate: 16000 },
      { pcm: new Uint8Array(3201), sampleRate: 16000 },
    ];
    for (const payload of bad) expect(await sendAudio(learner, payload), JSON.stringify(Object.keys(payload))).toMatchObject({ status: "reject", reason: "bad-audio" });
    expect(calls).toBe(0);
    expect(await sendAudio(learner, { pcm: pcmBytes(1600), sampleRate: 16000 })).toMatchObject({ status: "ack" });
    expect(await sendAudio(learner, { pcm: pcmBytes(240000), sampleRate: 16000 })).toMatchObject({ status: "ack" });
  }, 20000);

  it("rejects when no recognizer is configured", async () => {
    const { learner } = await join({});
    expect(await sendAudio(learner, { pcm: pcmBytes(16000), sampleRate: 16000 })).toMatchObject({ status: "reject", reason: "speech-recognizer-unavailable" });
  }, 20000);

  it("rejects a throwing recognizer and a malformed result as speech-recognition-failed, and the learner can retry", async () => {
    const results: unknown[] = [new Error("sidecar died"), { text: 5, confidence: 0.5 }, { text: "ok", confidence: 1.5 }, { text: "ok", confidence: Number.NaN }, { text: "fine", confidence: 0.4 }];
    const { learner } = await join({ speechRecognizer: async () => { const next = results.shift(); if (next instanceof Error) throw next; return next; } });
    for (let i = 0; i < 4; i += 1) expect(await sendAudio(learner, { pcm: pcmBytes(16000), sampleRate: 16000 })).toMatchObject({ status: "reject", reason: "speech-recognition-failed" });
    expect(await sendAudio(learner, { pcm: pcmBytes(16000), sampleRate: 16000 })).toMatchObject({ status: "ack", transcript: { text: "fine", confidence: 0.4 } });
  }, 20000);

  it("rejects a second speech-audio while one is in flight (speech-busy)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { learner } = await join({ speechRecognizer: async () => { await gate; return { text: "slow", confidence: 0.9 }; } });
    const first = sendAudio(learner, { pcm: pcmBytes(16000), sampleRate: 16000 });
    const second = await sendAudio(learner, { pcm: pcmBytes(16000), sampleRate: 16000 });
    expect(second).toMatchObject({ status: "reject", reason: "speech-busy" });
    release();
    expect(await first).toMatchObject({ status: "ack", transcript: { text: "slow" } });
  }, 20000);
});
