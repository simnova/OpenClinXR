import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyNamedSpeechVisemes } from "./viseme-runtime-wire.js";

type Cue = { phoneme: string; atSecond: number; durationSeconds: number; intensity: number };

const step3Cues: Cue[] = (() => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../docs/openclinxr/mouth-dynamics/step3/metrics.json",
  );
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    canonicalTrack: { startS: number; endS: number; viseme: string; intensity: number }[];
  };
  return raw.canonicalTrack.map((cue) => ({
    phoneme: cue.viseme,
    atSecond: cue.startS,
    durationSeconds: cue.endS - cue.startS,
    intensity: cue.intensity,
  }));
})();

const thCues: Cue[] = [
  { phoneme: "sil", atSecond: 0, durationSeconds: 0.5, intensity: 0.4 },
  { phoneme: "E", atSecond: 0.5, durationSeconds: 0.5, intensity: 0.8 },
  { phoneme: "TH", atSecond: 1.0, durationSeconds: 0.0625, intensity: 0.1 },
  { phoneme: "E", atSecond: 1.0625, durationSeconds: 0.5, intensity: 0.8 },
  { phoneme: "sil", atSecond: 1.5625, durationSeconds: 0.5, intensity: 0.01 },
];

const vowelCues: Cue[] = [
  { phoneme: "sil", atSecond: 0, durationSeconds: 0.5, intensity: 0.4 },
  { phoneme: "aa", atSecond: 0.5, durationSeconds: 0.5, intensity: 0.77 },
  { phoneme: "E", atSecond: 1.0, durationSeconds: 0.5, intensity: 0.68 },
  { phoneme: "O", atSecond: 1.5, durationSeconds: 0.5, intensity: 0.82 },
];

function frameMediaS(n: number): number {
  return (n + 0.5) / 30;
}

function step3MeshLike() {
  const names = [
    "basis_neutral",
    "viseme_silence",
    "viseme_sil",
    "viseme_aa",
    "viseme_DD",
    "viseme_nn",
    "viseme_E",
    "viseme_PP",
    "viseme_FF",
    "viseme_O",
    "viseme_SS",
    "viseme_TH",
  ];
  return {
    name: "Body",
    morphTargetDictionary: Object.fromEntries(names.map((name, index) => [name, index])),
    morphTargetInfluences: names.map(() => 0),
  };
}

function driveTrackAt(cues: Cue[], mediaS: number, durationMs: number) {
  const mesh = step3MeshLike();
  const jaw = { name: "jaw", isBone: true, rotation: { x: 0 }, userData: {} as Record<string, unknown> };
  const root = {
    userData: {} as Record<string, unknown>,
    traverse(callback: (object: unknown) => void) {
      callback(mesh);
      callback(jaw);
    },
  };
  applyNamedSpeechVisemes({
    root,
    activeSpeech: { phonemeSequence: ["sil"], startedAtMs: 0, durationMs, bakedCues: cues },
    mediaPositionSeconds: () => mediaS,
  });
  const tag = root.userData.openClinXrNamedVisemeDrive as
    | { weights?: Record<string, number>; jawFraction?: number }
    | undefined;
  return { weights: { ...(tag?.weights ?? {}) }, jawFraction: tag?.jawFraction ?? NaN };
}

function driveAt(mediaS: number) {
  return driveTrackAt(step3Cues, mediaS, 4130);
}

function step3Cue(phoneme: string): Cue {
  const cue = step3Cues.find((entry) => entry.phoneme === phoneme);
  if (!cue) throw new Error(`step3 track has no ${phoneme} cue`);
  return cue;
}

describe("pp seal neighbour suppression (headless weight proxy for the 0.5mm lip-gap gate)", () => {
  it("seals every frame inside the PP cue: PP=1 with vowel neighbours at 0 and jaw shut", () => {
    const pp = step3Cue("PP");
    const endS = pp.atSecond + (pp.durationSeconds ?? 0);
    const inside: number[] = [];
    for (let n = 0; n < 124; n += 1) {
      const mediaS = frameMediaS(n);
      if (mediaS >= pp.atSecond && mediaS < endS) inside.push(n);
    }
    expect(inside.length).toBeGreaterThan(0);
    for (const n of inside) {
      const driven = driveAt(frameMediaS(n));
      expect(driven.weights.viseme_PP ?? NaN, `frame ${n} PP`).toBe(1);
      expect(driven.weights.viseme_E ?? NaN, `frame ${n} E`).toBe(0);
      expect(driven.weights.viseme_DD ?? NaN, `frame ${n} DD`).toBe(0);
      expect(driven.jawFraction, `frame ${n} jaw`).toBe(0);
    }
  });

  it("seals the PP cue centre: PP=1, neighbours 0, jaw 0 (gap -0.72mm headless)", () => {
    const pp = step3Cue("PP");
    const centreS = pp.atSecond + (pp.durationSeconds ?? 0) / 2;
    const driven = driveAt(centreS);
    expect(driven.weights.viseme_PP ?? NaN).toBe(1);
    expect(driven.weights.viseme_E ?? NaN).toBe(0);
    expect(driven.weights.viseme_DD ?? NaN).toBe(0);
    expect(driven.jawFraction).toBe(0);
  });

  it("shows no teeth at the PP centre: step3 capture teeth pixels are 0 on PP frames", () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../docs/openclinxr/mouth-dynamics/step3/metrics.json",
    );
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      toothSamples: { n: number; target: string; mouthTeethN: number }[];
    };
    const ppSamples = raw.toothSamples.filter((sample) => sample.target === "viseme_PP");
    expect(ppSamples.length).toBeGreaterThan(0);
    for (const sample of ppSamples) {
      expect(sample.mouthTeethN).toBe(0);
      expect(sample.n).toBe(0);
    }
  });

  it("keeps contact ramps at most 0.25 per 30fps frame on PP, FF, TH, and jaw", () => {
    const series = Array.from({ length: 124 }, (_, n) => driveAt(frameMediaS(n)));
    const maxStep = (key: string): number => {
      let max = 0;
      for (let n = 1; n < series.length; n += 1) {
        max = Math.max(max, Math.abs((series[n]?.weights[key] ?? 0) - (series[n - 1]?.weights[key] ?? 0)));
      }
      return max;
    };
    expect(maxStep("viseme_PP")).toBeLessThanOrEqual(0.25);
    expect(maxStep("viseme_FF")).toBeLessThanOrEqual(0.25);
    let maxJaw = 0;
    for (let n = 1; n < series.length; n += 1) {
      maxJaw = Math.max(maxJaw, Math.abs((series[n]?.jawFraction ?? 0) - (series[n - 1]?.jawFraction ?? 0)));
    }
    expect(maxJaw).toBeLessThanOrEqual(0.25);
    const thSeries = Array.from({ length: 62 }, (_, n) => driveTrackAt(thCues, frameMediaS(n), 2130));
    let maxTh = 0;
    for (let n = 1; n < thSeries.length; n += 1) {
      maxTh = Math.max(maxTh, Math.abs((thSeries[n]?.weights.viseme_TH ?? 0) - (thSeries[n - 1]?.weights.viseme_TH ?? 0)));
    }
    expect(maxTh).toBeLessThanOrEqual(0.25);
  });

  it("presses the FF centre: FF=1 with vowel neighbours at 0 (same contact check)", () => {
    const ff = step3Cue("FF");
    const centreS = ff.atSecond + (ff.durationSeconds ?? 0) / 2;
    const driven = driveAt(centreS);
    expect(driven.weights.viseme_FF ?? NaN).toBe(1);
    expect(driven.weights.viseme_E ?? NaN).toBe(0);
    expect(driven.weights.viseme_DD ?? NaN).toBe(0);
  });

  it("keeps vowels bit-equal on a contact-free track", () => {
    const first = (frame: number) => driveTrackAt(vowelCues, frameMediaS(frame), 2000);
    const second = (frame: number) => driveTrackAt(vowelCues, frameMediaS(frame), 2000);
    for (const frame of [0, 10, 16, 20, 30, 32, 40, 46, 50, 59]) {
      expect(second(frame).weights, `frame ${frame} weights`).toEqual(first(frame).weights);
      expect(second(frame).jawFraction, `frame ${frame} jaw`).toBe(first(frame).jawFraction);
    }
    expect(first(16).jawFraction).toBe(0.5186163779985098);
    expect(first(40).weights.viseme_PP ?? 0).toBe(0);
    expect(first(40).weights.viseme_FF ?? 0).toBe(0);
    expect(first(40).weights.viseme_TH ?? 0).toBe(0);
  });
});
