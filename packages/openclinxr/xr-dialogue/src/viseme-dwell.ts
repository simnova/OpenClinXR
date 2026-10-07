/**
 * Dialogue phoneme mapping and duration-weighted cue dwells (#376, #382).
 *
 * Extracted verbatim from viseme-runtime-wire.ts (file-size budget): the wire
 * crossed the 500-line zone budget when lip-bone rounding landed, and the gate
 * forces extraction over appends. Re-exported through the wire so every
 * existing importer (package index, tools, tests) resolves unchanged.
 */

import type { PhonemeCue } from "./viseme-timeline-drive.js";

/** Dialogue / gen-drive tokens → ARKit-style phoneme labels resolveVisemeTarget understands. */
const DIALOGUE_PHONEME_TO_ARKIT: Readonly<Record<string, string>> = {
  sil: "sil",
  silence: "sil",
  rest: "sil",
  a: "AA",
  e: "E",
  i: "IH",
  o: "OH",
  u: "OU",
  m: "sil",
  b: "sil",
  p: "sil",
  f: "FV",
  v: "FV",
  t: "L",
  d: "L",
  n: "L",
  l: "L",
  s: "TH",
  z: "TH",
  k: "sil",
  g: "sil",
  q: "sil",
  c: "sil",
  r: "L",
  w: "OU",
  y: "IH",
  // ARPAbet vowels widened onto the visemes02 names the rebaked parent carries (#469).
  // AH was the defect: dialogue-pronunciations.ts "a": "AH" resolved to nothing. Oculus/ARPAbet
  // standard vowel→viseme assignment; the contract asserts AH/IY/OW/UW reach distinct baked shapes.
  AH: "aa",
  AE: "aa",
  AO: "O",
  AW: "O",
  AY: "aa",
  EH: "E",
  ER: "E",
  EY: "E",
  IY: "I",
  OW: "O",
  OY: "O",
  UH: "U",
  UW: "U",
  // ARKit / mesh tokens passthrough
  AA: "AA",
  E: "E",
  IH: "IH",
  OH: "OH",
  OU: "OU",
  FV: "FV",
  L: "L",
  TH: "TH",
};

export function mapDialoguePhonemeToArkit(phoneme: string): string {
  const raw = phoneme.trim();
  if (!raw) return "sil";
  return DIALOGUE_PHONEME_TO_ARKIT[raw] ?? DIALOGUE_PHONEME_TO_ARKIT[raw.toLowerCase()] ?? raw;
}

/**
 * Per-phone dwell weights for a normalised timeline, in seconds. Proportions only: the caller's
 * `durationMs` scales the whole utterance uniformly, so these numbers choose how the total is
 * shared, never wall-clock. External reference (no known-good column in this tree — #382):
 * English conversational speech puts stressed vowels near 100-200 ms and stop closures near
 * 20-80 ms. Keyed on the raw tokens the pipeline can emit: CMUdict ARPAbet (uppercase) and the
 * #376 grapheme-fallback letters (lowercase).
 */
const VOWEL_DWELL_SECONDS = 0.24;
const STOP_DWELL_SECONDS = 0.08;
const NASAL_DWELL_SECONDS = 0.12;
const FRICATIVE_DWELL_SECONDS = 0.16;
const GLIDE_DWELL_SECONDS = 0.16;
const SIL_DWELL_SECONDS = 0.16;

const VOWEL_TOKENS: ReadonlySet<string> = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW",
  "a", "e", "i", "o", "u",
]);
const STOP_TOKENS: ReadonlySet<string> = new Set(["P", "B", "T", "D", "K", "G", "t", "k"]);
const NASAL_TOKENS: ReadonlySet<string> = new Set(["M", "N", "NG", "m"]);
const FRICATIVE_TOKENS: ReadonlySet<string> = new Set([
  "F", "V", "S", "Z", "SH", "ZH", "TH", "DH", "CH", "JH", "HH", "f",
]);
const GLIDE_TOKENS: ReadonlySet<string> = new Set(["L", "R", "W", "Y", "w"]);
const SILENCE_TOKENS: ReadonlySet<string> = new Set(["sil", "silence", "rest"]);

/** Dwell length for a raw phoneme token; unknown tokens get a mid-length dwell, never zero. */
function phonemeDwellSeconds(phoneme: string): number {
  const raw = phoneme.trim();
  if (SILENCE_TOKENS.has(raw.toLowerCase())) return SIL_DWELL_SECONDS;
  if (VOWEL_TOKENS.has(raw)) return VOWEL_DWELL_SECONDS;
  if (STOP_TOKENS.has(raw)) return STOP_DWELL_SECONDS;
  if (NASAL_TOKENS.has(raw)) return NASAL_DWELL_SECONDS;
  if (FRICATIVE_TOKENS.has(raw)) return FRICATIVE_DWELL_SECONDS;
  if (GLIDE_TOKENS.has(raw)) return GLIDE_DWELL_SECONDS;
  return FRICATIVE_DWELL_SECONDS;
}

/**
 * Map dialogue phonemes to duration-weighted cues: each cue carries the phoneme's dwell length
 * and a cumulative `atSecond`. `pickFrame` selects by time through the total, so dwell is
 * proportional to the phone's class (vowel > stop) instead of a uniform 1/N division (#382).
 */
export function mapDialoguePhonemesToCues(phonemes: readonly string[]): PhonemeCue[] {
  let at = 0;
  return phonemes.map((phoneme) => {
    const durationSeconds = phonemeDwellSeconds(phoneme);
    const cue: PhonemeCue = {
      phoneme: mapDialoguePhonemeToArkit(phoneme),
      atSecond: Number(at.toFixed(4)),
      durationSeconds,
    };
    at += durationSeconds;
    return cue;
  });
}
