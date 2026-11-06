import { describe, expect, it } from "vitest";
import { createActorVoice, createEnvelopeCueBuilder, MESM_VOICE_IDS, resolveActorVoice, speechTextFromCaption, type VoiceEngine, type VoiceSink, type VoiceSlot } from "./headset.js";

// C30 RED (lane manager, 2026-11-05): pure contract of the on-device actor voice (mesm-tts Heart in the shell).
// Names are the spec. Cue shape matches the shell's PhonemeCue: { phoneme, atSecond, durationSeconds }.

const RATE = 24000;
const tone = (hz: number, seconds: number, amp: number): Float32Array => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));
const noise = (seconds: number, amp: number): Float32Array => { let s = 12345; return Float32Array.from({ length: Math.round(seconds * RATE) }, () => { s = (s * 1664525 + 1013904223) >>> 0; return amp * ((s / 2 ** 32) * 2 - 1); }); };
const silence = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * RATE));
const concat = (...parts: Float32Array[]): Float32Array => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
// The shell's rule verbatim (viseme-runtime-wire bakedCuesAdmissible): strict, no tolerance.
const admissible = (cues: readonly { atSecond: number; durationSeconds: number }[]): boolean => { let end = -Infinity; for (const c of cues) { if (!(c.durationSeconds > 0) || c.atSecond < 0 || c.atSecond < end) return false; end = c.atSecond + c.durationSeconds; } return true; };
const build = (samples: Float32Array, chunk = samples.length) => { const b = createEnvelopeCueBuilder(RATE); for (let i = 0; i < samples.length; i += chunk) b.push(samples.slice(i, i + chunk)); b.finish(); return b; };

describe("voice ids and caption text", () => {
  it("lists the ten mesm-tts voices, Heart first", () => {
    expect([...MESM_VOICE_IDS]).toEqual(["heart", "wren", "everly", "hadley", "bryony", "maeve", "miles", "trevor", "edwin", "hugh"]);
  });
  it("defaults to Heart; a listed voice the shell does not wire falls back to Heart and says so; an unknown id too", () => {
    expect(resolveActorVoice(undefined)).toEqual({ requested: "heart", used: "heart", fallback: false });
    expect(resolveActorVoice("heart")).toEqual({ requested: "heart", used: "heart", fallback: false });
    expect(resolveActorVoice("miles")).toEqual({ requested: "miles", used: "heart", fallback: true });
    expect(resolveActorVoice("zzz")).toEqual({ requested: "zzz", used: "heart", fallback: true });
  });
  it("speaks the line without the caption's '<Name>: ' prefix and trims", () => {
    expect(speechTextFromCaption("Robert Hayes: It feels heavy.")).toBe("It feels heavy.");
    expect(speechTextFromCaption("  Dr. Ng: Hello: how are you?  ")).toBe("Hello: how are you?");
    expect(speechTextFromCaption("No prefix here")).toBe("No prefix here");
    expect(speechTextFromCaption("")).toBe("");
    expect(speechTextFromCaption("Robert Hayes:")).toBe("");
  });
});

describe("envelope cue builder", () => {
  it("silence gives only sil cues that cover the audio", () => {
    const b = build(silence(0.5));
    expect(b.cues.length).toBeGreaterThan(0);
    expect(b.cues.every((c) => c.phoneme === "sil")).toBe(true);
    expect(admissible(b.cues)).toBe(true);
    const last = b.cues.at(-1)!;
    expect(last.atSecond + last.durationSeconds).toBeCloseTo(0.5, 1);
  });
  it("a low loud tone opens the mouth (AA/E/OH), noise hisses (SS), both end at the audio end", () => {
    const vowel = build(tone(200, 0.5, 0.4));
    expect(vowel.cues.some((c) => c.phoneme !== "sil")).toBe(true);
    expect(vowel.cues.filter((c) => c.phoneme !== "sil").every((c) => ["AA", "E", "OH"].includes(c.phoneme))).toBe(true);
    const hiss = build(noise(0.5, 0.3));
    expect(hiss.cues.some((c) => c.phoneme === "SS")).toBe(true);
    for (const b of [vowel, hiss]) {
      expect(admissible(b.cues)).toBe(true);
      const last = b.cues.at(-1)!;
      expect(last.atSecond + last.durationSeconds).toBeCloseTo(0.5, 1);
    }
  });
  it("counterweight: a tone, a gap, a tone yields a closed-mouth cue between two open ones", () => {
    const b = build(concat(tone(200, 0.25, 0.4), silence(0.25), tone(200, 0.25, 0.4)));
    const phonemes = b.cues.map((c) => c.phoneme);
    const first = phonemes.findIndex((p) => p !== "sil");
    const gap = phonemes.findIndex((p, i) => i > first && p === "sil");
    const second = phonemes.findIndex((p, i) => i > gap && p !== "sil");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(gap).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(gap);
    const gapCue = b.cues[gap]!;
    expect(gapCue.atSecond).toBeGreaterThan(0.2);
    expect(gapCue.atSecond + gapCue.durationSeconds).toBeLessThan(0.55);
  });
  it("pushing in odd-sized chunks gives the same cues as one push, and the array identity is stable while it grows", () => {
    const audio = concat(tone(200, 0.2, 0.4), noise(0.15, 0.3), silence(0.1), tone(300, 0.2, 0.3));
    const whole = build(audio);
    const streamed = createEnvelopeCueBuilder(RATE);
    const identity = streamed.cues;
    for (let i = 0; i < audio.length; i += 777) streamed.push(audio.slice(i, i + 777));
    streamed.finish();
    expect(streamed.cues).toBe(identity);
    expect(streamed.cues).toEqual(whole.cues);
    expect(admissible(streamed.cues)).toBe(true);
  });
  it("every stream length from 1 sample to 2000 yields strictly admissible cues (a partial last frame included)", () => {
    for (let n = 1; n <= 2000; n += 1) {
      const wave = Float32Array.from({ length: n }, (_, i) => (i % 60 < 30 ? 0.3 : 0.001) * Math.sin(i / 3));
      const b = build(wave);
      expect(admissible(b.cues), `length ${n}`).toBe(true);
      expect(b.cues.length, `length ${n}`).toBeGreaterThan(0);
    }
    const tail = build(concat(tone(200, 0.3, 0.4), new Float32Array(1)));
    expect(admissible(tail.cues)).toBe(true);
    expect(build(new Float32Array(961)).cues.every((c) => c.durationSeconds > 0)).toBe(true);
  });
  it("no cue is shorter than 40 ms except the last, and seconds counts the audio pushed", () => {
    const b = build(concat(tone(200, 0.03, 0.4), silence(0.03), tone(200, 0.3, 0.4), noise(0.02, 0.3), silence(0.2)));
    for (const c of b.cues.slice(0, -1)) expect(c.durationSeconds).toBeGreaterThanOrEqual(0.04 - 0.001);
    expect(b.seconds).toBeCloseTo(0.58, 2);
  });
});

function fakes() {
  const calls: string[] = [];
  const pushed: Float32Array[] = [];
  let startCb = (): void => undefined;
  let finishCb: (info: { played: number; underruns: number }) => void = () => undefined;
  let position: number | null = null;
  const sink: VoiceSink = {
    reset: () => { calls.push("sink.reset"); position = null; },
    push: (samples) => { calls.push("sink.push"); pushed.push(samples.slice()); samples.fill(0); if (calls.filter((c) => c === "sink.push").length === 1) { position = 0; startCb(); } },
    end: () => { calls.push("sink.end"); },
    onStart: (cb) => { startCb = cb; },
    onFinish: (cb) => { finishCb = cb; },
    positionSeconds: () => position,
    peakAmplitude: () => 0.4,
  };
  const engine: VoiceEngine & { requests: Array<[string, string]> } = {
    requests: [],
    async synthesize(text, voice, onChunk) {
      this.requests.push([text, voice]);
      calls.push("engine.synthesize");
      for (const chunk of [tone(200, 0.2, 0.4), noise(0.1, 0.3), tone(250, 0.2, 0.4)]) onChunk(chunk);
      return { audioSeconds: 0.5, computeMs: 5 };
    },
  };
  return { sink, engine, calls, pushed, finish: (info: { played: number; underruns: number }) => finishCb(info) };
}
const slotWithSpeech = (): VoiceSlot & { activeSpeech: NonNullable<VoiceSlot["activeSpeech"]> } => ({ activeSpeech: { text: "x", startedAtMs: 1000, durationMs: 400, phonemeSequence: ["AA"] } });

describe("actor voice turn", () => {
  it("synthesizes the caption text in the actor's voice, feeds the mouth-cue path from the audio, and measures first audio and real-time factor", async () => {
    const f = fakes();
    const slot = slotWithSpeech();
    const original = slot.activeSpeech;
    let now = 1000;
    const voice = createActorVoice({ engine: f.engine, sink: f.sink, slotFor: () => slot, voiceFor: () => "miles", nowMs: () => { now += 7; return now; } });
    const record = await voice.speakTurn({ actorId: "p", caption: "Robert Hayes: It feels heavy.", turnKey: "1:p" });
    expect(f.engine.requests).toEqual([["It feels heavy.", "heart"]]);
    expect(f.calls[0]).toBe("sink.reset");
    expect(f.calls.indexOf("sink.end")).toBeGreaterThan(f.calls.lastIndexOf("sink.push"));
    expect(record).toMatchObject({ actorId: "p", turnKey: "1:p", voiceRequested: "miles", voiceUsed: "heart", voiceFallback: true, chars: 15, audioSeconds: 0.5, computeMs: 5, chunks: 3, error: "" });
    expect(record.firstAudioMs).toBeGreaterThan(0);
    expect(record.firstChunkMs).toBeGreaterThan(0);
    expect(record.firstChunkMs).toBeLessThanOrEqual(record.firstAudioMs as number);
    expect(record.rtf).toBeCloseTo(0.01, 5);
    expect(record.xRealtime).toBeCloseTo(100, 3);
    expect(record.cueCount).toBeGreaterThan(0);
    expect(record.nonSilentCues).toBeGreaterThan(0);
    expect(record.peak).toBe(0.4);
    expect(JSON.stringify(record)).not.toContain("heavy");
    expect(slot.activeSpeech).toBe(original);
    expect(slot.activeSpeech.bakedCues?.length).toBe(record.cueCount);
    expect(slot.activeSpeech.bakedCues?.some((c) => c.phoneme !== "sil")).toBe(true);
    expect(slot.activeSpeech.durationMs).toBeGreaterThanOrEqual(500);
    expect(typeof slot.mediaPositionSeconds).toBe("function");
    expect(slot.mediaPositionSeconds?.()).toBe(0);
    f.finish({ played: 12000, underruns: 0 });
    expect(slot.mediaPositionSeconds).toBeUndefined();
    expect(slot.activeSpeech).toBeUndefined();
    expect(record).toMatchObject({ played: 12000, underruns: 0 });
    expect(Object.keys(record).sort()).toEqual(["actorId", "attached", "audioClock", "audioSeconds", "chars", "chunks", "computeMs", "cueCount", "error", "firstAudioMs", "firstChunkMs", "nonSilentCues", "peak", "played", "rtf", "turnKey", "underruns", "voiceFallback", "voiceRequested", "voiceUsed", "xRealtime"]);
    expect(voice.records).toEqual([record]);
  });
  it("the cue builder reads each chunk before the sink takes it (the sink may detach the buffer)", async () => {
    const f = fakes();
    const slot = slotWithSpeech();
    const voice = createActorVoice({ engine: f.engine, sink: f.sink, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => 1 });
    const record = await voice.speakTurn({ actorId: "p", caption: "A: Hello.", turnKey: "k" });
    expect(record.voiceFallback).toBe(false);
    expect(record.nonSilentCues).toBeGreaterThan(0);
  });
  it("when the output never starts, the mouth falls back to wall time after 1.5 s and the record says so", async () => {
    const f = fakes();
    const never: VoiceSink = { ...f.sink, push: (samples) => { samples.fill(0); }, positionSeconds: () => null };
    const slot = slotWithSpeech();
    let now = 0;
    const voice = createActorVoice({ engine: f.engine, sink: never, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => now });
    const record = await voice.speakTurn({ actorId: "p", caption: "A: Hello there.", turnKey: "k" });
    expect(record.firstAudioMs).toBeNull();
    expect(slot.mediaPositionSeconds?.()).toBeNull();
    now = 1400;
    expect(slot.mediaPositionSeconds?.()).toBeNull();
    now = 2000;
    expect(slot.mediaPositionSeconds?.()).toBeCloseTo(0.5, 3);
    now = 2200;
    expect(slot.mediaPositionSeconds?.()).toBeCloseTo(0.7, 3);
    expect(record.audioClock).toBe("wall");
    now = 60000;
    expect(slot.mediaPositionSeconds?.()).toBeNull();
  });
  it("with a working output the record says the audio clock ran", async () => {
    const f = fakes();
    const voice = createActorVoice({ engine: f.engine, sink: f.sink, slotFor: () => slotWithSpeech(), voiceFor: () => undefined, nowMs: () => 1 });
    expect((await voice.speakTurn({ actorId: "p", caption: "A: Hello.", turnKey: "k" })).audioClock).toBe("audio");
  });
  it("a caption with no spoken text makes no engine call and no record error", async () => {
    const f = fakes();
    const voice = createActorVoice({ engine: f.engine, sink: f.sink, slotFor: () => slotWithSpeech(), voiceFor: () => undefined, nowMs: () => 1 });
    const record = await voice.speakTurn({ actorId: "p", caption: "", turnKey: "k" });
    expect(f.engine.requests).toEqual([]);
    expect(record).toMatchObject({ chars: 0, error: "", chunks: 0, firstAudioMs: null });
  });
  it("an engine failure is recorded, ends the sink, never throws and leaves the slot's text-driven speech alone", async () => {
    const f = fakes();
    const slot = slotWithSpeech();
    const failing: VoiceEngine = { synthesize: async () => { throw new Error("word outside the lexicon"); } };
    const voice = createActorVoice({ engine: failing, sink: f.sink, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => 1 });
    const record = await voice.speakTurn({ actorId: "p", caption: "A: Zyxqwv.", turnKey: "k" });
    expect(record.error).toContain("outside the lexicon");
    expect(record.firstAudioMs).toBeNull();
    expect(f.calls).toContain("sink.end");
    expect(slot.activeSpeech.bakedCues).toBeUndefined();
    expect(slot.mediaPositionSeconds).toBeUndefined();
  });
  it("the record carries an error category, never the engine's message (a short caption quoted by the engine cannot leak)", async () => {
    const f = fakes();
    const make = (message: string) => createActorVoice({ engine: { synthesize: async () => { throw new Error(message); } }, sink: f.sink, slotFor: () => undefined, voiceFor: () => undefined, nowMs: () => 1 });
    const cases: Array<[string, string]> = [
      ["word outside the lexicon: Hi there", "word outside the lexicon"],
      ["voice worker error: import failed", "voice worker failure"],
      ["voice worker load timed out", "voice worker load timed out"],
      ["Hi there exploded", "voice synthesis failed"],
    ];
    for (const [message, category] of cases) {
      const record = await make(message).speakTurn({ actorId: "p", caption: "A: Hi there.", turnKey: "k" });
      expect(record.error).toBe(category);
    }
  });
  it("when a newer speech takes the slot during playback, the old audio clock is removed instead of driving it", async () => {
    const f = fakes();
    const slot = slotWithSpeech();
    const voice = createActorVoice({ engine: f.engine, sink: f.sink, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => 1 });
    await voice.speakTurn({ actorId: "p", caption: "A: Hello there.", turnKey: "k" });
    const clock = slot.mediaPositionSeconds;
    expect(typeof clock).toBe("function");
    slot.activeSpeech = { text: "newer", startedAtMs: 5, durationMs: 100, phonemeSequence: ["E"] };
    expect(clock?.()).toBeNull();
    expect(slot.mediaPositionSeconds).toBeUndefined();
  });
  it("counterweight: a newer speech on the slot is never touched by an older turn's audio", async () => {
    const f = fakes();
    const slot = slotWithSpeech();
    const newer = { text: "newer", startedAtMs: 5, durationMs: 100, phonemeSequence: ["E"] };
    const engine: VoiceEngine = { synthesize: async (_text, _voice, onChunk) => { slot.activeSpeech = newer; onChunk(tone(200, 0.2, 0.4)); return { audioSeconds: 0.2, computeMs: 2 }; } };
    const voice = createActorVoice({ engine, sink: f.sink, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => 1 });
    await voice.speakTurn({ actorId: "p", caption: "A: Hi there.", turnKey: "k" });
    expect(slot.activeSpeech).toBe(newer);
    expect((newer as { bakedCues?: unknown }).bakedCues).toBeUndefined();
    expect(newer.durationMs).toBe(100);
  });
  it("turns are spoken one at a time in arrival order", async () => {
    const order: string[] = [];
    const f = fakes();
    const engine: VoiceEngine = { synthesize: async (text, _voice, onChunk) => { order.push(`start ${text}`); await new Promise((r) => setTimeout(r, 15)); onChunk(tone(200, 0.1, 0.4)); order.push(`end ${text}`); return { audioSeconds: 0.1, computeMs: 1 }; } };
    const voice = createActorVoice({ engine, sink: f.sink, slotFor: () => undefined, voiceFor: () => undefined, nowMs: () => 1 });
    await Promise.all([voice.speakTurn({ actorId: "p", caption: "A: One.", turnKey: "1" }), voice.speakTurn({ actorId: "q", caption: "B: Two.", turnKey: "2" })]);
    expect(order).toEqual(["start One.", "end One.", "start Two.", "end Two."]);
    expect(voice.records.map((r) => r.turnKey)).toEqual(["1", "2"]);
  });

  it("the next turn waits for the previous turn's audio to end, so one sink never serves two turns at once", async () => {
    const f = fakes();
    const log: string[] = [];
    const engine: VoiceEngine = { synthesize: async (text, _voice, onChunk) => { log.push(`synth ${text}`); onChunk(tone(200, 0.1, 0.4)); return { audioSeconds: 0.1, computeMs: 1 }; } };
    const voice = createActorVoice({ engine, sink: f.sink, slotFor: () => undefined, voiceFor: () => undefined, nowMs: () => 1 });
    const first = voice.speakTurn({ actorId: "p", caption: "A: One.", turnKey: "1" });
    const second = voice.speakTurn({ actorId: "q", caption: "B: Two.", turnKey: "2" });
    await first;
    await new Promise((r) => setTimeout(r, 30));
    expect(log).toEqual(["synth One."]);
    f.finish({ played: 2400, underruns: 0 });
    await second;
    expect(log).toEqual(["synth One.", "synth Two."]);
  });
  it("a turn queued behind another never attaches to a speech that replaced its own (the slot is read when the turn arrives)", async () => {
    const f = fakes();
    const slot = slotWithSpeech();
    const first = slot.activeSpeech;
    const second = { text: "second", startedAtMs: 9, durationMs: 100, phonemeSequence: ["E"] };
    const voice = createActorVoice({ engine: f.engine, sink: f.sink, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => 1 });
    const one = voice.speakTurn({ actorId: "p", caption: "A: One.", turnKey: "1" });
    slot.activeSpeech = second;
    const two = voice.speakTurn({ actorId: "p", caption: "A: Two.", turnKey: "2" });
    await one;
    expect((first as { bakedCues?: unknown }).bakedCues).toBeUndefined();
    expect((second as { bakedCues?: unknown }).bakedCues).toBeUndefined();
    f.finish({ played: 1, underruns: 0 });
    await two;
    expect((second as { bakedCues?: unknown }).bakedCues).toBeDefined();
  });
  it("when the output never starts, the speech and the media clock are released once the wall-clock mouth has finished", async () => {
    const f = fakes();
    const never: VoiceSink = { ...f.sink, push: (samples) => { samples.fill(0); }, positionSeconds: () => null };
    const slot = slotWithSpeech();
    let now = 0;
    const voice = createActorVoice({ engine: f.engine, sink: never, slotFor: () => slot, voiceFor: () => undefined, nowMs: () => now });
    await voice.speakTurn({ actorId: "p", caption: "A: Hello there.", turnKey: "k" });
    now = 60000;
    expect(slot.mediaPositionSeconds?.()).toBeNull();
    expect(slot.mediaPositionSeconds).toBeUndefined();
    expect(slot.activeSpeech).toBeUndefined();
  });
});
