import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapArpabetTrack, mapPollyTrack, mapRhubarbTrack, visemeCueMappings } from "./viseme-cue-track.js";
import { applyNamedSpeechVisemes } from "./index.js";
import { createJawDynamicsSampler, createLipDynamicsSampler, jawTargetForCue, lipDynamicsConstants } from "./viseme-jaw-dynamics.js";

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
describe("bilabial-stop acoustic correction", () => {
  const step3Doc = (() => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../docs/openclinxr/mouth-dynamics/step3/metrics.json",
    );
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      rhubarb: { mouthCues: { start: number; end: number; value: string }[] };
    };
    return { mouthCues: raw.rhubarb.mouthCues };
  })();

  function step3Wav(): ArrayBuffer {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "./test-fixtures/step3-speech-22050.wav",
    );
    const bytes = readFileSync(file);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
  }

  it("relabels the mislabelled /b/ G cue at 2.48 to PP", () => {
    const mapped = mapRhubarbTrack(step3Doc, step3Wav());
    const cue = mapped.find((entry) => Math.abs(entry.startS - 2.48) < 1e-9);
    expect(cue?.viseme).toBe("PP");
    expect(cue?.endS).toBeCloseTo(2.52, 2);
  });

  it("extends the /p/ PP cue at 1.33 to its burst onset within 10 ms", () => {
    const mapped = mapRhubarbTrack(step3Doc, step3Wav());
    const cue = mapped.find((entry) => Math.abs(entry.startS - 1.33) < 1e-9);
    expect(cue?.viseme).toBe("PP");
    expect(cue?.endS).toBeCloseTo(1.45, 2);
  });

  it("changes only the carved boundaries: +1 FF cue, b9e0e93a6 corrections intact", () => {
    const plain = mapRhubarbTrack(step3Doc);
    const mapped = mapRhubarbTrack(step3Doc, step3Wav());
    expect(mapped.length).toBe(plain.length + 1);
    // b9e0e93a6 corrections intact: /b/ G cue relabelled PP ending at its
    // burst, /p/ PP cue extended to its burst.
    const pp248 = mapped.find((entry) => Math.abs(entry.startS - 2.48) < 1e-9);
    expect(pp248?.viseme).toBe("PP");
    expect(pp248?.endS).toBeCloseTo(2.52, 2);
    const pp133 = mapped.find((entry) => Math.abs(entry.startS - 1.33) < 1e-9);
    expect(pp133?.viseme).toBe("PP");
    expect(pp133?.endS).toBeCloseTo(1.45, 2);
    // The frication carve: exactly one new FF cue over the weak run before
    // the voiced onset. Measured run windows 35-48 (0.35-0.48 s, RMS
    // 0.0141-0.0210, ZCR 83-181) with onset window 49 (RMS 0.0458); the cue
    // end (voiced onset) lands in [0.38, 0.50].
    const ffs = mapped.filter((entry) => entry.viseme === "FF");
    expect(ffs).toHaveLength(1);
    const ff = ffs[0]!;
    expect(ff.startS).toBeCloseTo(0.35, 2);
    expect(ff.endS).toBeCloseTo(0.49, 2);
    expect(ff.endS).toBeGreaterThanOrEqual(0.38);
    expect(ff.endS).toBeLessThanOrEqual(0.5);
    const before = new Map(plain.map((cue) => [cue.startS, cue] as const));
    // Starts moved by the b9e0e93a6 closure correction (asserted above) or
    // the frication carve (asserted below): excluded from the generic loop.
    const moved = new Map([
      [1.33, { viseme: "PP", endS: 1.45 }],
      [1.45, { viseme: "E", endS: 1.79 }],
      [2.48, { viseme: "PP", endS: 2.52 }],
      [2.52, { viseme: "E", endS: 2.75 }],
      [0.29, { viseme: "sil", endS: 0.35 }],
      [0.49, { viseme: "DD", endS: 0.83 }],
    ]);
    for (const cue of mapped) {
      if (cue.viseme === "FF") continue;
      const pinned = [...moved.entries()].find(([start]) => Math.abs(cue.startS - start) < 1e-9);
      if (pinned) {
        expect(cue.viseme, `cue ${cue.startS} viseme`).toBe(pinned[1].viseme);
        expect(cue.endS, `cue ${cue.startS} end`).toBeCloseTo(pinned[1].endS, 2);
        continue;
      }
      const orig = before.get(cue.startS);
      expect(orig, `cue start ${cue.startS}`).toBeDefined();
      expect(cue.endS, `cue ${cue.startS} end`).toBe(orig!.endS);
      expect(cue.viseme, `cue ${cue.startS} viseme`).toBe(orig!.viseme);
    }
    const labels = mapped.map((cue) => cue.viseme);
    expect(labels.filter((viseme) => viseme === "FF")).toHaveLength(1);
    expect(labels.filter((viseme) => viseme === "PP")).toHaveLength(2);
  });

  it("leaves the track unchanged without wav", () => {
    const plain = mapRhubarbTrack(step3Doc);
    const cue = plain.find((entry) => Math.abs(entry.startS - 2.48) < 1e-9);
    expect(cue?.viseme).toBe("FF");
    expect(cue?.endS).toBe(2.55);
    const pp = plain.find((entry) => Math.abs(entry.startS - 1.33) < 1e-9);
    expect(pp?.viseme).toBe("PP");
    expect(pp?.endS).toBe(1.39);
  });

  it("keeps a synthetic G cue over broadband noise at FF", () => {
    const noise = Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 0.5 : -0.5));
    const wav = pcm16Wav(noise);
    const mapped = mapRhubarbTrack({ mouthCues: [{ start: 0, end: 0.3, value: "G" }] }, wav);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.viseme).toBe("FF");
  });

  it("relabels a synthetic G cue spanning silence plus a burst to PP", () => {
    const samples = [
      ...Array(20).fill(0.5),
      ...Array(8).fill(0),
      ...Array(12).fill(0.5),
    ];
    const wav = pcm16Wav(samples);
    const mapped = mapRhubarbTrack(
      {
        mouthCues: [
          { start: 0, end: 0.2, value: "D" },
          { start: 0.2, end: 0.32, value: "G" },
          { start: 0.32, end: 0.4, value: "C" },
        ],
      },
      wav,
    );
    expect(mapped.map((cue) => cue.viseme)).toEqual(["aa", "PP", "E"]);
  });

  it("carves a synthetic weak frication run under X to FF and shrinks the neighbours", () => {
    // 22050 Hz so the 10 ms windows hold 221 samples with a real crossing
    // count (the 100 Hz helper gives 1 sample per window, ZCR always 0).
    // Frication (alternating +/-0.04, RMS 0.04) sits in the (floor, voiced)
    // band under X; the D cue vowel sets the scale (loudest 0.5 -> floor
    // 0.025, voiced 0.06) and the zero-crossing vowel reference (ZCR 0).
    const sr = 22050;
    const samples: number[] = [];
    const at = (t: number) => Math.floor(t * sr);
    for (let i = 0; i < at(0.6); i += 1) {
      const t = i / sr;
      if (t >= 2210 / sr && t < 5304 / sr) samples.push(i % 2 === 0 ? 0.04 : -0.04);
      else samples.push(0.5);
    }
    const wav = pcm16Wav(samples, sr);
    const mapped = mapRhubarbTrack(
      { mouthCues: [{ start: 0, end: 0.3, value: "X" }, { start: 0.3, end: 0.6, value: "D" }] },
      wav,
    );
    expect(mapped.map((cue) => cue.viseme)).toEqual(["sil", "FF", "aa"]);
    expect(mapped[0]?.endS).toBeCloseTo(0.1, 2);
    expect(mapped[1]?.startS).toBeCloseTo(0.1, 2);
    expect(mapped[1]?.endS).toBeCloseTo(0.24, 2);
    expect(mapped[2]?.startS).toBeCloseTo(0.24, 2);
    expect(mapped[2]?.endS).toBe(0.6);
  });

  it("leaves a loud /s/-like high-ZCR run under a non-sil cue alone", () => {
    // Alternating +/-0.3 at 22050 Hz: RMS 0.3 with maximum crossing rate,
    // but under C (->E, non-silence) and above the voiced level, so the
    // carve does not touch it.
    const sr = 22050;
    const samples = Array.from({ length: Math.floor(0.3 * sr) }, (_, i) => (i % 2 === 0 ? 0.3 : -0.3));
    const wav = pcm16Wav(samples, sr);
    const mapped = mapRhubarbTrack({ mouthCues: [{ start: 0, end: 0.3, value: "C" }] }, wav);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.viseme).toBe("E");
    expect(mapped[0]?.startS).toBe(0);
    expect(mapped[0]?.endS).toBe(0.3);
  });

  it("carves nothing when the weak run has no voiced onset after it", () => {
    // Weak frication under X running into a silent next cue: the onset
    // window reads silence, not voiced, so the run is left alone.
    const sr = 22050;
    const samples: number[] = [];
    for (let i = 0; i < Math.floor(0.6 * sr); i += 1) {
      const t = i / sr;
      if (t >= 0.1 && t < 0.29) samples.push(i % 2 === 0 ? 0.04 : -0.04);
      else if (t >= 0.3) samples.push(0);
      else samples.push(0.5);
    }
    const wav = pcm16Wav(samples, sr);
    const mapped = mapRhubarbTrack(
      { mouthCues: [{ start: 0, end: 0.3, value: "X" }, { start: 0.3, end: 0.6, value: "D" }] },
      wav,
    );
    expect(mapped.map((cue) => cue.viseme)).toEqual(["sil", "aa"]);
    expect(mapped).toHaveLength(2);
  });

  it("is deterministic", () => {
    const wav = step3Wav();
    expect(mapRhubarbTrack(step3Doc, wav)).toEqual(mapRhubarbTrack(step3Doc, wav));
  });
});
describe("carved FF runtime drive", () => {
  const names = ["viseme_sil", "viseme_aa", "viseme_DD", "viseme_nn", "viseme_E", "viseme_PP", "viseme_FF", "viseme_O"];
  function step3DocFile() {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../docs/openclinxr/mouth-dynamics/step3/metrics.json",
    );
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      rhubarb: { mouthCues: { start: number; end: number; value: string }[] };
    };
    return { mouthCues: raw.rhubarb.mouthCues };
  }
  function driveMappedAt(mediaS: number) {
    const bytes = step3WavFile();
    const mapped = mapRhubarbTrack(step3DocFile(), bytes);
    const cues = mapped.map((cue) => ({
      phoneme: cue.viseme,
      atSecond: cue.startS,
      durationSeconds: cue.endS - cue.startS,
      intensity: cue.intensity,
    }));
    const mesh = {
      name: "Body",
      morphTargetDictionary: Object.fromEntries(names.map((name, index) => [name, index])),
      morphTargetInfluences: names.map(() => 0),
    };
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
      activeSpeech: { phonemeSequence: ["sil"], startedAtMs: 0, durationMs: 4130, bakedCues: cues },
      mediaPositionSeconds: () => mediaS,
    });
    const tag = root.userData.openClinXrNamedVisemeDrive as
      | { weights?: Record<string, number>; jawFraction?: number }
      | undefined;
    return { weights: { ...(tag?.weights ?? {}) }, jawFraction: tag?.jawFraction ?? NaN };
  }
  function step3WavFile(): ArrayBuffer {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "./test-fixtures/step3-speech-22050.wav",
    );
    const bytes = readFileSync(file);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
  }
  it("seals the carved FF cue with the PP blend and the jaw shut on every frame inside", () => {
    const ff = mapRhubarbTrack(step3DocFile(), step3WavFile()).find((entry) => entry.viseme === "FF");
    if (!ff) throw new Error("step3 mapped track has no carved FF cue");
    const inside: number[] = [];
    for (let n = 0; n < 124; n += 1) {
      const mediaS = (n + 0.5) / 30;
      if (mediaS >= ff.startS && mediaS < ff.endS) inside.push(n);
    }
    expect(inside.length).toBeGreaterThan(0);
    for (const n of inside) {
      const driven = driveMappedAt((n + 0.5) / 30);
      // Operator 2026-10-06: the lips touch on F via the proven PP seal;
      // the FF morph is capped at 1-PP so the pair stays bounded.
      // K = 0 (FF_PP_BLEND_K in viseme-lip-dynamics.ts, package-private):
      // PP rides at 0 and FF carries uncapped at 1 through the cue.
      expect(driven.weights.viseme_PP ?? NaN, `frame ${n} PP`).toBeCloseTo(0, 5);
      expect(driven.weights.viseme_FF ?? NaN, `frame ${n} FF`).toBeCloseTo(1, 5);
      expect(driven.jawFraction, `frame ${n} jaw`).toBe(0);
    }
  });
  it("ramps FF and jaw at most 0.25 per 30 fps frame across the carved clip", () => {
    const series = Array.from({ length: 124 }, (_, n) => driveMappedAt((n + 0.5) / 30));
    let maxFf = 0;
    let maxJaw = 0;
    for (let n = 1; n < series.length; n += 1) {
      maxFf = Math.max(maxFf, Math.abs((series[n]?.weights.viseme_FF ?? 0) - (series[n - 1]?.weights.viseme_FF ?? 0)));
      maxJaw = Math.max(maxJaw, Math.abs((series[n]?.jawFraction ?? 0) - (series[n - 1]?.jawFraction ?? 0)));
    }
    expect(maxFf).toBeLessThanOrEqual(0.25);
    expect(maxJaw).toBeLessThanOrEqual(0.25);
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
/** Step-interpolation frame fixture (driveVisemeTimeline, package-private): resolved viseme 1, rest 0. */
const STEP_TARGET: Record<string, string> = { DD: "viseme_DD", FF: "viseme_FF", TH: "viseme_TH", PP: "viseme_PP", E: "viseme_E" };
function stepFrames(cues: { phoneme: string; atSecond: number; durationSeconds: number }[]) {
  return cues.map((cue) => ({
    atSecond: cue.atSecond,
    durationSeconds: cue.durationSeconds,
    weights: Object.fromEntries(contactAvail.map((name) => [name, name === STEP_TARGET[cue.phoneme] ? 1 : 0])),
  }));
}
function contactSampler(phoneme: string, durationS: number, intensity: number) {
  const cues = [
    { phoneme: "DD", atSecond: 0, durationSeconds: 0.3, intensity: 1 },
    { phoneme, atSecond: 0.3, durationSeconds: durationS, intensity },
    { phoneme: "E", atSecond: 0.3 + durationS, durationSeconds: 0.3, intensity: 1 },
  ];
  return createLipDynamicsSampler(cues, stepFrames(cues));
}

describe("contact viseme envelope dynamics", () => {
  it("drives faint and full FF identically through the follower; the envelope sets the peak", () => {
    const faint = contactSampler("FF", 0.07, 0.05).sample(0.335).weights.viseme_FF ?? NaN;
    const full = contactSampler("FF", 0.07, 1).sample(0.335).weights.viseme_FF ?? NaN;
    expect(faint).toBe(full);
  });
  // Envelope hold (contactEnvelope = 1 through [s, e], package-private) is
  // pinned at the public wire: pp-seal.test.ts pins PP = 1 at the PP cue
  // centre and FF ~= 1 at the FF cue centre through applyNamedSpeechVisemes,
  // and viseme-runtime-wire.test.ts pins PP/FF/TH >= 0.9 within one frame of
  // cue onset with per-frame change capped at 0.25. No follower-level
  // duplicate here: the follower lags the envelope by design, so a >= 0.9
  // follower pin at cue centre would fail while the envelope holds.
  it("leaves vowels unchanged: short E keeps its coarticulated centre weight", () => {
    const cues = [
      { phoneme: "DD", atSecond: 0, durationSeconds: 0.2, intensity: 1 },
      { phoneme: "E", atSecond: 0.2, durationSeconds: 0.06, intensity: 1 },
      { phoneme: "DD", atSecond: 0.26, durationSeconds: 0.2, intensity: 1 },
    ];
    expect(createLipDynamicsSampler(cues, stepFrames(cues)).sample(0.23).weights.viseme_E).toBeCloseTo(0.048505, 6);
  });
  it("brings faint short PP onto the envelope within one frame of cue onset", () => {
    // The raw follower stays bounded; the applied peak (>= 0.9 within one
    // frame of onset) is pinned on the prepared path in viseme-runtime-wire.
    const sample = contactSampler("PP", 0.06, 0.09).sample(0.33);
    expect(sample.weights.viseme_PP ?? NaN).toBeLessThanOrEqual(0.25);
    expect(sample.hardClosure).toBe(true);
  });
});
