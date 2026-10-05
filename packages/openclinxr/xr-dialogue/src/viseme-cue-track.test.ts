import { describe, expect, it } from "vitest";
import { mapArpabetTrack, mapPollyTrack, mapRhubarbTrack, visemeCueMappings } from "./viseme-cue-track.js";
import { createJawDynamicsSampler, jawTargetForCue } from "./viseme-jaw-dynamics.js";

function rows(symbols: readonly string[]) { return symbols.map((symbol, index) => ({ startS: index * 0.1, endS: (index + 1) * 0.1, symbol })); }
const track = [{ startS: 0, endS: 0.2, viseme: "aa", intensity: 1 }, { startS: 0.2, endS: 0.26, viseme: "PP", intensity: 1 }, { startS: 0.26, endS: 0.31, viseme: "E", intensity: 1 }, { startS: 0.31, endS: 0.6, viseme: "O", intensity: 0.5 }] as const;

function pcm16Wav(samples: readonly number[], sampleRate = 100): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(bytes);
  view.setUint32(0, 0x52494646, false); view.setUint32(4, 36 + samples.length * 2, true); view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => { view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true); });
  return bytes;
}

describe("canonical OVR cue intake", () => {
  it("maps every Rhubarb, ARPAbet, and Polly table row", () => {
    const rhubarb = rows(Object.keys(visemeCueMappings.rhubarb));
    expect(mapRhubarbTrack({ mouthCues: rhubarb.map((cue) => ({ start: cue.startS, end: cue.endS, value: cue.symbol })) }).map((cue) => cue.viseme)).toEqual(Object.values(visemeCueMappings.rhubarb));
    const arpabet = rows(Object.keys(visemeCueMappings.arpabet));
    expect(mapArpabetTrack(arpabet.map((cue) => ({ ...cue, phone: cue.symbol }))).map((cue) => cue.viseme)).toEqual(Object.values(visemeCueMappings.arpabet));
    const polly = rows(Object.keys(visemeCueMappings.polly));
    expect(mapPollyTrack(polly.map((cue) => ({ ...cue, viseme: cue.symbol }))).map((cue) => cue.viseme)).toEqual(Object.values(visemeCueMappings.polly));
  });
  it("fails loudly for unknown symbols", () => {
    expect(() => mapRhubarbTrack({ mouthCues: [{ start: 0, end: 0.1, value: "Q" }] })).toThrow("unknown-rhubarb-symbol:Q");
    expect(() => mapArpabetTrack([{ startS: 0, endS: 0.1, phone: "Q" }])).toThrow("unknown-arpabet-symbol:Q");
    expect(() => mapPollyTrack([{ startS: 0, endS: 0.1, viseme: "x" }])).toThrow("unknown-polly-symbol:x");
  });
  it("uses cue-window RMS normalized to the loudest cue", () => {
    const wav = pcm16Wav([...Array(10).fill(0.25), ...Array(10).fill(1)]);
    const cues = mapRhubarbTrack({ mouthCues: [{ start: 0, end: 0.1, value: "D" }, { start: 0.1, end: 0.2, value: "E" }] }, wav);
    expect(cues[0]?.intensity).toBeCloseTo(0.25, 4); expect(cues[1]?.intensity).toBe(1);
  });
});
describe("critically damped jaw sampler", () => {
  const run = (frameRate: number) => { const sampler = createJawDynamicsSampler(track); return Array.from({ length: Math.ceil(0.6 * frameRate) + 1 }, (_, index) => sampler.sample(index / frameRate).aperture); };
  it("is deterministic", () => {
    expect(new Uint8Array(new Float64Array(run(60)).buffer)).toEqual(new Uint8Array(new Float64Array(run(60)).buffer));
  });
  it("is frame-rate independent within one fixed dynamics substep", () => {
    const at30 = run(30); const at60 = run(60);
    for (let index = 0; index < at30.length; index += 1) expect(Math.abs((at30[index] ?? 0) - (at60[index * 2] ?? 0))).toBeLessThanOrEqual(1 / 240 + 1e-9);
  });
  it("closes PP by the cue midpoint", () => {
    expect(createJawDynamicsSampler(track).sample(0.25).hardClosure).toBe(true);
  });
  it("coarticulates sub-100 ms vowels", () => {
    expect(jawTargetForCue(track, 2)).toBeGreaterThan(0.25);
  });
  it("keeps mild vowels less open than emphasized vowels", () => {
    const mild = jawTargetForCue([{ startS: 0, endS: 0.2, viseme: "aa", intensity: 0.5 }], 0);
    const emphasized = jawTargetForCue([{ startS: 0, endS: 0.2, viseme: "aa", intensity: 1 }], 0);
    expect(mild).toBeCloseTo(0.5); expect(emphasized).toBeCloseTo(1); expect(mild).toBeLessThan(emphasized);
  });
});
