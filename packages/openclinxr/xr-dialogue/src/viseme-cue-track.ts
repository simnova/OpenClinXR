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
  return mapSymbols("rhubarb", (doc.mouthCues ?? []).map((cue) => ({
    startS: cue.start, endS: cue.end, symbol: cue.value,
  })), RHUBARB_TO_OVR, wav);
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
