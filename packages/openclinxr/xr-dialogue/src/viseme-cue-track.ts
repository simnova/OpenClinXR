/** Canonical timed OVR-viseme cue intake shared by audio preparation and runtime playback. */
import { decodePcm16MonoWav } from "./actor-audio-prepared-data.js";

const OVR_VISEMES = [
  "sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U",
] as const;

type OvrViseme = (typeof OVR_VISEMES)[number];

export type VisemeCue = {
  startS: number;
  endS: number;
  viseme: OvrViseme;
  intensity: number;
};

export type RhubarbCueDocument = {
  mouthCues?: ReadonlyArray<{ start: number; end: number; value: string }>;
};

export type ArpabetCue = { startS: number; endS: number; phone: string };
export type PollyCue = { startS: number; endS: number; viseme: string };

export const RHUBARB_TO_OVR = Object.freeze({
  A: "PP", B: "DD", C: "E", D: "aa", E: "O", F: "U", G: "FF", H: "nn", X: "sil",
} satisfies Record<string, OvrViseme>);

export const ARPABET_TO_OVR = Object.freeze({
  SIL: "sil", SP: "sil", SPN: "sil",
  P: "PP", B: "PP", M: "PP",
  F: "FF", V: "FF",
  TH: "TH", DH: "TH",
  T: "DD", D: "DD",
  K: "kk", G: "kk", NG: "kk",
  CH: "CH", JH: "CH", SH: "CH", ZH: "CH",
  S: "SS", Z: "SS",
  N: "nn", L: "nn",
  R: "RR", ER: "RR",
  AA: "aa", AE: "aa", AH: "aa", AW: "aa", AY: "aa", HH: "aa",
  EH: "E", EY: "E",
  IH: "I", IY: "I", Y: "I",
  AO: "O", OW: "O", OY: "O",
  UH: "U", UW: "U", W: "U",
} satisfies Record<string, OvrViseme>);

export const POLLY_TO_OVR = Object.freeze({
  p: "PP", t: "DD", S: "CH", T: "TH", f: "FF", k: "kk", i: "I", r: "RR", s: "SS",
  u: "U", "@": "aa", a: "aa", e: "E", E: "E", o: "O", O: "O", sil: "sil",
} satisfies Record<string, OvrViseme>);

type SymbolCue = { startS: number; endS: number; symbol: string };

/**
 * Bilabial-stop acoustic correction for Rhubarb intake (operator 2026-10-06:
 * "B for Better doesn't have lips touch").
 *
 * Rhubarb mislabels the /b/ of "better" as G (->FF, 2.48-2.55 s) and ends the
 * /p/ PP cue of "pain" at 1.39 s while the acoustic closure silence runs to
 * ~1.44 s with the burst at ~1.45 s. An /f/ is frication noise, never a
 * silent closure, so a G/FF cue overlapping a true closure is a stop.
 *
 * Pure function of (rhubarb doc, wav); deterministic. Rhubarb path only: the
 * G bucket is Rhubarb-specific, and PP extension keys on the Rhubarb A cue.
 *
 * Closure = a run of 10 ms RMS windows below the silence floor lasting at
 * least 40 ms, immediately followed by an onset window at or above the
 * floor. Floor = 5% of the track's loudest cue-window RMS (unnormalized, same
 * computation as the intensity path below). Measured provenance on the step3
 * wav (22050 Hz mono, sha256 05c11f51...): loudest cue-window RMS 0.2476
 * (E 3.10-3.31 s) -> floor 0.0124; /p/ run 1.38-1.45 s + onset 1.45 s;
 * /b/ run 2.41-2.52 s + onset 2.52 s; vowel/frication windows read 0.02+.
 *
 * (1) A G/FF cue overlapped by a closure (silence starts before the cue ends
 * and the burst lands after the cue starts) is relabelled to the Rhubarb PP
 * key. Broadband noise has no 40 ms sub-floor run, so a true fricative cue
 * over noise stays FF.
 * (2) A PP cue's end moves to the burst onset of the closure straddling it
 * (silence starts at or before the cue end, burst after the cue start),
 * bounded by the next cue's end minus one 30 fps frame; the next cue's start
 * moves accordingly. Without wav the track is returned unchanged.
 *
 * A weak-frication carve (operator 2026-10-06: "fix the F sound") runs after
 * the closure correction, on its corrected symbols, sharing the same 10 ms
 * RMS windowing plus an identically windowed zero-crossing count:
 * (3) A run of >= 30 ms with RMS above the silence floor but below a voiced
 * level, AND a high zero-crossing rate (fricative noise), immediately
 * followed by a voiced onset, carves an FF cue over the run (start = run
 * start, end = voiced onset) where the run starts inside a sil/X cue (or the
 * onset straddles the cue end by <= 20 ms); the neighbours shrink. Runs
 * under non-silence cues are left alone. Without wav the track is returned
 * unchanged.
 *
 * Threshold provenance (all deterministic functions of this doc + wav):
 * - WINDOW 10 ms: shared with the closure correction above (BILABIAL_WINDOW_S).
 * - FLOOR 5% of the track's loudest cue-window RMS: shared with the closure
 *   correction (step3 wav 22050 Hz mono sha256 05c11f51...: loudest 0.2476 on
 *   E 3.10-3.31 s -> floor 0.0124; /p/ run 1.38-1.45 s, /b/ run 2.41-2.52 s).
 * - VOICED 12% of the loudest cue-window RMS (step3: 0.0297): clears the
 *   step3 /f/ weak-run maximum 0.0210 (10 ms windows 35-48, 0.35-0.48 s) and
 *   sits below the voiced onset 0.0458 (window 49, 0.49 s).
 * - ZCR_HIGH 1.5x the 99th percentile of per-10-ms zero-crossing counts over
 *   vowel-cue interiors (Rhubarb C/D/E/F -> OVR E/aa/O/U, trimmed 30 ms each
 *   side so boundary transients cannot move the gate; step3 p99 = 47 ->
 *   70.5): clears the vowel-tail transition maximum 52 (window 33, 0.33 s)
 *   and keeps the weakest frication window 83 (window 48, 0.48 s). Percentile
 *   (not max) so one burst transient cannot move the gate.
 * - MIN_RUN 30 ms (>= 3 windows): operator brief.
 * Measured separation on step3: /f/ run windows 35-48 (RMS 0.0141-0.0210,
 * ZCR 83-181) carve FF [0.35, 0.49]; /z/ run 2.24-2.37 s (RMS up to 0.1212,
 * ZCR up to 172) lies inside the DD cue 1.79-2.48 s (non-silence) and is
 * left alone; /b/ closure 2.38-2.52 s sits below the floor and stays owned
 * by the PP rule above.
 */
const BILABIAL_WINDOW_S = 0.01;
const FRICATIVE_MIN_RUN_S = 0.03;
const FRICATIVE_VOICED_FRACTION = 0.12;
const FRICATIVE_ZCR_P99_MULTIPLE = 1.5;
const FRICATIVE_VOWEL_TRIM_S = 0.03;
const FRICATIVE_MAX_STRADDLE_S = 0.02;
const BILABIAL_MIN_SILENCE_S = 0.04;
const BILABIAL_FLOOR_FRACTION = 0.05;
const BILABIAL_FRAME_S = 1 / 30;

type BilabialClosure = { silenceStartS: number; burstS: number };

function windowRms(
  samples: Float32Array,
  sampleRate: number,
  sampleCount: number,
  durationS: number,
): number[] {
  const perWindow = Math.max(1, Math.round(sampleRate * BILABIAL_WINDOW_S));
  const windowCount = Math.max(1, Math.ceil(durationS / BILABIAL_WINDOW_S));
  const rms: number[] = [];
  for (let window = 0; window < windowCount; window += 1) {
    const first = window * perWindow;
    const last = Math.min(sampleCount, first + perWindow);
    if (last <= first) {
      rms.push(0);
      continue;
    }
    let squareSum = 0;
    for (let index = first; index < last; index += 1) {
      const sample = samples[index] ?? 0;
      squareSum += sample * sample;
    }
    rms.push(Math.sqrt(squareSum / (last - first)));
  }
  return rms;
}

function windowZeroCrossings(
  samples: Float32Array,
  sampleRate: number,
  sampleCount: number,
  durationS: number,
): number[] {
  const perWindow = Math.max(1, Math.round(sampleRate * BILABIAL_WINDOW_S));
  const windowCount = Math.max(1, Math.ceil(durationS / BILABIAL_WINDOW_S));
  const crossings: number[] = [];
  for (let window = 0; window < windowCount; window += 1) {
    const first = window * perWindow;
    const last = Math.min(sampleCount, first + perWindow);
    let count = 0;
    let previous: number | null = null;
    for (let index = first; index < last; index += 1) {
      const sample = samples[index] ?? 0;
      if (previous !== null && (previous >= 0) !== (sample >= 0)) count += 1;
      previous = sample;
    }
    crossings.push(count);
  }
  return crossings;
}

function bilabialClosures(
  samples: Float32Array,
  sampleRate: number,
  sampleCount: number,
  durationS: number,
  floor: number,
): BilabialClosure[] {
  const rms = windowRms(samples, sampleRate, sampleCount, durationS);
  const windowCount = rms.length;
  const minRun = Math.round(BILABIAL_MIN_SILENCE_S / BILABIAL_WINDOW_S);
  const closures: BilabialClosure[] = [];
  let window = 0;
  while (window < windowCount) {
    if ((rms[window] ?? Number.POSITIVE_INFINITY) >= floor) {
      window += 1;
      continue;
    }
    let end = window;
    while (end < windowCount && (rms[end] ?? Number.POSITIVE_INFINITY) < floor) end += 1;
    if (end - window >= minRun && end < windowCount) {
      closures.push({ silenceStartS: window * BILABIAL_WINDOW_S, burstS: end * BILABIAL_WINDOW_S });
    }
    window = end + 1;
  }
  return closures;
}

function correctBilabialClosures(cues: readonly SymbolCue[], wav: ArrayBuffer): SymbolCue[] {
  if (cues.length === 0) return [];
  const table: Readonly<Record<string, OvrViseme>> = RHUBARB_TO_OVR;
  const ppKey = Object.keys(table).find((key) => table[key] === "PP");
  if (ppKey === undefined) return cues.map((cue) => ({ ...cue }));
  const decoded = decodePcm16MonoWav(wav);
  const unnormalized: number[] = cues.map((cue) => {
    const first = Math.max(0, Math.floor(cue.startS * decoded.sampleRate));
    const last = Math.min(decoded.sampleCount, Math.ceil(cue.endS * decoded.sampleRate));
    if (last <= first) return 0;
    let squareSum = 0;
    for (let index = first; index < last; index += 1) {
      const sample = decoded.float32[index] ?? 0;
      squareSum += sample * sample;
    }
    return Math.sqrt(squareSum / (last - first));
  });
  const loudest = Math.max(0, ...unnormalized);
  if (!(loudest > 0)) return cues.map((cue) => ({ ...cue }));
  const lastCue = cues[cues.length - 1];
  if (!lastCue) return cues.map((cue) => ({ ...cue }));
  const closures = bilabialClosures(
    decoded.float32,
    decoded.sampleRate,
    decoded.sampleCount,
    lastCue.endS,
    BILABIAL_FLOOR_FRACTION * loudest,
  );
  if (closures.length === 0) {
    return carveFricativeOnsets(cues.map((cue) => ({ ...cue })), decoded, loudest);
  }
  const out = cues.map((cue) => ({ ...cue }));
  for (const cue of out) {
    if (table[cue.symbol] !== "FF") continue;
    const hit = closures.some(
      (closure) => closure.silenceStartS < cue.endS && closure.burstS > cue.startS,
    );
    if (hit) cue.symbol = ppKey;
  }
  for (let index = 0; index < out.length; index += 1) {
    const cue = out[index];
    if (!cue || table[cue.symbol] !== "PP") continue;
    const closure = closures.find(
      (entry) => entry.silenceStartS <= cue.endS && entry.burstS > cue.startS,
    );
    if (!closure) continue;
    const next = out[index + 1];
    const bounded = next === undefined ? closure.burstS : Math.min(closure.burstS, next.endS - BILABIAL_FRAME_S);
    if (bounded > cue.startS && bounded !== cue.endS) {
      cue.endS = bounded;
      if (next) next.startS = bounded;
    }
  }
  return carveFricativeOnsets(out, decoded, loudest);
}

const FRICATIVE_VOWEL_VISemes: ReadonlySet<OvrViseme> = new Set(["aa", "E", "O", "U"]);

type FricativeCarve = { index: number; startS: number; endS: number };

function carveFricativeOnsets(
  cues: SymbolCue[],
  decoded: { sampleRate: number; sampleCount: number; float32: Float32Array },
  loudest: number,
): SymbolCue[] {
  const table: Readonly<Record<string, OvrViseme>> = RHUBARB_TO_OVR;
  const ffKey = Object.keys(table).find((key) => table[key] === "FF");
  if (ffKey === undefined || !(loudest > 0)) return cues;
  const floor = BILABIAL_FLOOR_FRACTION * loudest;
  const voiced = FRICATIVE_VOICED_FRACTION * loudest;
  if (!(voiced > floor)) return cues;
  const lastCue = cues[cues.length - 1];
  if (!lastCue) return cues;
  const rms = windowRms(decoded.float32, decoded.sampleRate, decoded.sampleCount, lastCue.endS);
  const zcr = windowZeroCrossings(decoded.float32, decoded.sampleRate, decoded.sampleCount, lastCue.endS);
  const reference: number[] = [];
  for (const cue of cues) {
    const viseme = table[cue.symbol];
    if (viseme === undefined || !FRICATIVE_VOWEL_VISemes.has(viseme)) continue;
    for (let window = 0; window < rms.length; window += 1) {
      const start = window * BILABIAL_WINDOW_S;
      if (start + 1e-9 >= cue.startS + FRICATIVE_VOWEL_TRIM_S && start + BILABIAL_WINDOW_S <= cue.endS - FRICATIVE_VOWEL_TRIM_S + 1e-9) {
        reference.push(zcr[window] ?? 0);
      }
    }
  }
  if (reference.length === 0) return cues;
  const sorted = [...reference].sort((a, b) => a - b);
  const loud = sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 0;
  const high = FRICATIVE_ZCR_P99_MULTIPLE * loud;
  const minRun = Math.max(1, Math.round(FRICATIVE_MIN_RUN_S / BILABIAL_WINDOW_S));
  const carves: FricativeCarve[] = [];
  cues.forEach((cue, index) => {
    if (!cue || table[cue.symbol] !== "sil") return;
    const next = cues[index + 1];
    if (!next) return;
    let window = Math.max(0, Math.ceil(cue.startS / BILABIAL_WINDOW_S - 1e-9));
    while (window < rms.length) {
      const start = window * BILABIAL_WINDOW_S;
      if (start >= cue.endS) break;
      const inBand = (rms[window] ?? 0) >= floor && (rms[window] ?? 0) < voiced && (zcr[window] ?? 0) > high;
      if (!inBand) {
        window += 1;
        continue;
      }
      let end = window;
      while (
        end + 1 < rms.length &&
        (end + 1) * BILABIAL_WINDOW_S < cue.endS + FRICATIVE_MAX_STRADDLE_S &&
        (rms[end + 1] ?? 0) >= floor &&
        (rms[end + 1] ?? 0) < voiced &&
        (zcr[end + 1] ?? 0) > high
      ) end += 1;
      const onset = end + 1;
      const onsetS = onset * BILABIAL_WINDOW_S;
      if (
        end - window + 1 >= minRun &&
        start > cue.startS &&
        onset < rms.length &&
        (rms[onset] ?? 0) >= voiced &&
        onsetS <= cue.endS + FRICATIVE_MAX_STRADDLE_S &&
        onsetS < next.endS
      ) {
        carves.push({ index, startS: start, endS: onsetS });
      }
      window = end + 1;
    }
  });
  if (carves.length === 0) return cues;
  for (let carve = carves.length - 1; carve >= 0; carve -= 1) {
    const { index, startS, endS } = carves[carve]!;
    cues[index]!.endS = startS;
    cues[index + 1]!.startS = endS;
    cues.splice(index + 1, 0, { startS, endS, symbol: ffKey });
  }
  return cues;
}

function checkedCue(cue: SymbolCue, index: number, previousEnd: number): SymbolCue {
  if (!Number.isFinite(cue.startS) || !Number.isFinite(cue.endS) || cue.startS < 0 || cue.endS <= cue.startS) {
    throw new Error(`invalid-viseme-cue:${index}`);
  }
  if (cue.startS < previousEnd) throw new Error(`overlapping-viseme-cue:${index}`);
  return cue;
}

function cueRms(bytes: ArrayBuffer, cues: readonly SymbolCue[]): number[] {
  const decoded = decodePcm16MonoWav(bytes);
  const rms = cues.map((cue) => {
    const start = Math.max(0, Math.floor(cue.startS * decoded.sampleRate));
    const end = Math.min(decoded.sampleCount, Math.ceil(cue.endS * decoded.sampleRate));
    if (end <= start) return 0;
    let squareSum = 0;
    for (let index = start; index < end; index += 1) {
      const sample = decoded.float32[index] ?? 0;
      squareSum += sample * sample;
    }
    return Math.sqrt(squareSum / (end - start));
  });
  const maximum = Math.max(0, ...rms);
  return rms.map((value) => maximum > 0 ? Math.min(1, Math.max(0, value / maximum)) : 0);
}

function mapSymbols(
  source: string,
  cues: readonly SymbolCue[],
  table: Readonly<Record<string, OvrViseme>>,
  wav?: ArrayBuffer,
  normalize?: (symbol: string) => string,
): VisemeCue[] {
  let previousEnd = 0;
  const checked = cues.map((cue, index) => {
    const valid = checkedCue(cue, index, previousEnd);
    previousEnd = valid.endS;
    return valid;
  });
  const intensities = wav === undefined ? checked.map(() => 1) : cueRms(wav, checked);
  return checked.map((cue, index) => {
    const key = normalize ? normalize(cue.symbol) : cue.symbol;
    const viseme = table[key];
    if (viseme === undefined) throw new Error(`unknown-${source}-symbol:${cue.symbol}`);
    return { startS: cue.startS, endS: cue.endS, viseme, intensity: intensities[index] ?? 0 };
  });
}

export function mapRhubarbTrack(doc: RhubarbCueDocument, wav?: ArrayBuffer): VisemeCue[] {
  const symbols = (doc.mouthCues ?? []).map((cue) => ({
    startS: cue.start, endS: cue.end, symbol: cue.value,
  }));
  return mapSymbols(
    "rhubarb",
    wav === undefined ? symbols : correctBilabialClosures(symbols, wav),
    RHUBARB_TO_OVR,
    wav,
  );
}

export function mapArpabetTrack(cues: readonly ArpabetCue[], wav?: ArrayBuffer): VisemeCue[] {
  return mapSymbols("arpabet", cues.map((cue) => ({ ...cue, symbol: cue.phone })), ARPABET_TO_OVR, wav,
    (symbol) => symbol.trim().toUpperCase().replace(/[0-2]$/u, ""));
}

export function mapPollyTrack(cues: readonly PollyCue[], wav?: ArrayBuffer): VisemeCue[] {
  return mapSymbols("polly", cues.map((cue) => ({ ...cue, symbol: cue.viseme })), POLLY_TO_OVR, wav);
}

export const visemeCueMappings = Object.freeze({
  ovrVisemes: OVR_VISEMES,
  rhubarb: RHUBARB_TO_OVR,
  arpabet: ARPABET_TO_OVR,
  polly: POLLY_TO_OVR,
});
