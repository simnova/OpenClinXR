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
 */
const BILABIAL_WINDOW_S = 0.01;
const BILABIAL_MIN_SILENCE_S = 0.04;
const BILABIAL_FLOOR_FRACTION = 0.05;
const BILABIAL_FRAME_S = 1 / 30;

type BilabialClosure = { silenceStartS: number; burstS: number };

function bilabialClosures(
  samples: Float32Array,
  sampleRate: number,
  sampleCount: number,
  durationS: number,
  floor: number,
): BilabialClosure[] {
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
  if (closures.length === 0) return cues.map((cue) => ({ ...cue }));
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
  return out;
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
