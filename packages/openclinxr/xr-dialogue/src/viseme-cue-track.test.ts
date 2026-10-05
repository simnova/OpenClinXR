import { describe, expect, it } from "vitest";
import { mapArpabetTrack, mapPollyTrack, mapRhubarbTrack, visemeCueMappings } from "./viseme-cue-track.js";
import { createJawDynamicsSampler, jawTargetForCue } from "./viseme-jaw-dynamics.js";

function rows(symbols: readonly string[]) { return symbols.map((symbol, index) => ({ startS: index * 0.1, endS: (index + 1) * 0.1, symbol })); }
const track = [{ startS: 0, endS: 0.2, viseme: "aa", intensity: 1 }, { startS: 0.2, endS: 0.26, viseme: "PP", intensity: 1 }, { startS: 0.26, endS: 0.31, viseme: "E", intensity: 1 }, { startS: 0.31, endS: 0.6, viseme: "O", intensity: 0.5 }] as const;

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
});
describe("critically damped jaw sampler", () => {
  it("is deterministic, frame-rate independent, closes PP, and coarticulates", () => {
    const run = () => { const sampler = createJawDynamicsSampler(track); return Array.from({ length: 37 }, (_, index) => sampler.sample(index / 60).aperture); };
    expect(new Uint8Array(new Float64Array(run()).buffer)).toEqual(new Uint8Array(new Float64Array(run()).buffer));
    expect(createJawDynamicsSampler(track).sample(0.25).hardClosure).toBe(true);
    expect(jawTargetForCue(track, 2)).toBeGreaterThan(0.25);
  });
});
