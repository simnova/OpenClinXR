import { describe, expect, it } from "vitest";
import { bakeTrackFromJson } from "./cli/live-stt-bake.js";

/** Pins the evidence process boundary to the product bake (no drift). */
describe("live-stt-bake cli", () => {
  it("bakes cues from a JSON input document", () => {
    const sampleRate = 16000;
    const samples = new Float32Array(Math.round(sampleRate * 0.5));
    for (let i = Math.round(sampleRate * 0.1); i < samples.length; i += 1) {
      samples[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const input = JSON.stringify({
      sampleRate,
      samplesB64: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64"),
      sttWords: [{ word: "pain", start: 0.12, end: 0.4 }],
      transcript: "pain",
      pronunciations: { pain: ["P", "EY1", "N"] },
    });
    const result = JSON.parse(bakeTrackFromJson(input)) as {
      cues: Array<{ phone: string; startS: number; endS: number }>;
      mismatches: string[];
      oovWords: string[];
    };
    expect(result.mismatches).toEqual([]);
    expect(result.oovWords).toEqual([]);
    expect(result.cues.map((cue) => cue.phone)).toEqual(["P", "P", "EY1", "N"]);
  });
});
