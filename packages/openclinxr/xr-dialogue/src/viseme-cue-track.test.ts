import { describe, expect, it } from "vitest";
import { mapArpabetTrack, mapPollyTrack, mapRhubarbTrack, visemeCueMappings } from "./viseme-cue-track.js";
import { createJawDynamicsSampler, createLipDynamicsSampler, jawTargetForCue, lipDynamicsConstants } from "./viseme-jaw-dynamics.js";
import { contactEnvelope } from "./contact-envelope.js";
import { driveVisemeTimeline } from "./viseme-timeline-drive.js";

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
  it("holds PP target zero through the gate without a snap step", () => {
    // The jaw snap is retired: the spring targets shut over [s-A, e] and the
    // prepared-path envelope seals the output. The raw sampler never steps.
    const sampler = createJawDynamicsSampler(track);
    expect(sampler.sample(0.23).target).toBe(0);
    const at30 = run(30);
    for (let index = 1; index < at30.length; index += 1) {
      expect(Math.abs((at30[index] ?? 0) - (at30[index - 1] ?? 0))).toBeLessThanOrEqual(0.25);
    }
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

const lipCues = [{ phoneme: "aa", atSecond: 0, durationSeconds: 0.2 }, { phoneme: "DD", atSecond: 0.2, durationSeconds: 0.2 }, { phoneme: "PP", atSecond: 0.4, durationSeconds: 0.08 }] as const;
const lipFrames = lipCues.map((cue) => ({ ...cue, weights: { viseme_aa: cue.phoneme === "aa" ? 1 : 0, viseme_DD: cue.phoneme === "DD" ? 1 : 0, viseme_PP: cue.phoneme === "PP" ? 1 : 0 } }));
describe("canonical lip follower", () => {
  it("is deterministic", () => {
    const run = () => Array.from({ length: 30 }, (_, index) => createLipDynamicsSampler(lipCues, lipFrames).sample(index / 60).weights.viseme_aa ?? 0);
    expect(new Uint8Array(new Float64Array(run()).buffer)).toEqual(new Uint8Array(new Float64Array(run()).buffer));
  });
  it("is frame-rate independent within one fixed substep", () => {
    const at30 = createLipDynamicsSampler(lipCues, lipFrames); const at60 = createLipDynamicsSampler(lipCues, lipFrames);
    for (let frame = 0; frame <= 14; frame += 1) expect(Math.abs((at30.sample(frame / 30).weights.viseme_DD ?? 0) - (at60.sample(frame / 30).weights.viseme_DD ?? 0))).toBeLessThanOrEqual(lipDynamicsConstants.fixedStepS + 1e-9);
  });
  it("leaves PP closure to the envelope layer: the raw follower never snaps", () => {
    // hardClosure still marks a bilabial cue past its midpoint; the applied
    // peak comes from the anticipatory envelope in the prepared path, so the
    // raw mid-cue weight stays inside one bounded frame step of its neighbours.
    const at = (timeS: number) => createLipDynamicsSampler(lipCues, lipFrames).sample(timeS);
    expect(at(0.45).hardClosure).toBe(true);
    expect(at(0.45).weights.viseme_PP ?? NaN).toBeLessThanOrEqual(0.25);
    const step = Math.abs((at(0.45).weights.viseme_PP ?? 0) - (at(0.45 - 1 / 30).weights.viseme_PP ?? 0));
    expect(step).toBeLessThanOrEqual(0.25);
  });
  it("has no single-frame weight change above 0.25 at 30 fps, contacts included", () => {
    const sampler = createLipDynamicsSampler(lipCues, lipFrames); let previous = sampler.sample(0).weights;
    for (let frame = 1; frame <= 11; frame += 1) {
      const timeS = frame / 30; const next = sampler.sample(timeS).weights;
      for (const key of Object.keys(next)) expect(Math.abs((next[key] ?? 0) - (previous[key] ?? 0))).toBeLessThanOrEqual(0.25);
      previous = next;
    }
  });
});

const contactAvail = ["viseme_DD", "viseme_FF", "viseme_TH", "viseme_PP", "viseme_E", "viseme_aa"];
function contactSampler(phoneme: string, durationS: number, intensity: number) {
  const cues = [
    { phoneme: "DD", atSecond: 0, durationSeconds: 0.3, intensity: 1 },
    { phoneme, atSecond: 0.3, durationSeconds: durationS, intensity },
    { phoneme: "E", atSecond: 0.3 + durationS, durationSeconds: 0.3, intensity: 1 },
  ];
  const { frames } = driveVisemeTimeline({ phonemes: cues, availableTargets: contactAvail });
  return createLipDynamicsSampler(cues, frames);
}

describe("contact viseme envelope dynamics", () => {
  it("drives faint and full FF identically through the follower; the envelope sets the peak", () => {
    const faint = contactSampler("FF", 0.07, 0.05).sample(0.335).weights.viseme_FF ?? NaN;
    const full = contactSampler("FF", 0.07, 1).sample(0.335).weights.viseme_FF ?? NaN;
    expect(faint).toBe(full);
  });
  it("holds the envelope at full target through short contacts: 70 ms FF ends at 1", () => {
    expect(contactEnvelope(0.37, 0.3, 0.37)).toBe(1);
  });
  it("reaches envelope 1 at the cue centre for contact durations 60-200 ms", () => {
    for (const durationS of [0.06, 0.07, 0.1, 0.2]) {
      expect(contactEnvelope(0.3 + durationS / 2, 0.3, 0.3 + durationS)).toBe(1);
    }
  });
  it("leaves vowels unchanged: short E keeps its coarticulated centre weight", () => {
    const cues = [
      { phoneme: "DD", atSecond: 0, durationSeconds: 0.2, intensity: 1 },
      { phoneme: "E", atSecond: 0.2, durationSeconds: 0.06, intensity: 1 },
      { phoneme: "DD", atSecond: 0.26, durationSeconds: 0.2, intensity: 1 },
    ];
    const { frames } = driveVisemeTimeline({ phonemes: cues, availableTargets: contactAvail });
    expect(createLipDynamicsSampler(cues, frames).sample(0.23).weights.viseme_E).toBeCloseTo(0.048505, 6);
  });
  it("brings faint short PP onto the envelope within one frame of cue onset", () => {
    // The raw follower stays bounded; the applied peak (>= 0.9 within one
    // frame of onset) is pinned on the prepared path in viseme-runtime-wire.
    const sample = contactSampler("PP", 0.06, 0.09).sample(0.33);
    expect(sample.weights.viseme_PP ?? NaN).toBeLessThanOrEqual(0.25);
    expect(sample.hardClosure).toBe(true);
  });
});
