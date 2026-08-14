/**
 * Dialogue phoneme/viseme pipeline (#376, #375).
 *
 * Extracted from `apps/ui-xr/src/main.ts` by #376 as a pure move, pinning the letter-by-letter
 * grapheme classifier. #375 replaces that classifier with real English phonology: every word is
 * looked up in `DIALOGUE_PRONUNCIATIONS` (a bank-scoped CMUdict extraction — build-time input,
 * the dictionary itself never ships; see the generated table header for provenance and licence).
 *
 * Two code paths exist, deliberately:
 *   - **Table lookup** (225 bank words + 26 contract probe words): the word's CMUdict ARPAbet
 *     phones drive the mouth. The homophone property — same pronunciation, same visemes — holds
 *     for every word that takes this path.
 *   - **Grapheme fallback** (any other word, currently `bronchodilator`, `ecg`, `nebulized` plus
 *     anything a future scenario adds): the #376 letter classifier, kept so clause (4) of the
 *     contract holds — an out-of-dictionary word must never stop the mouth mid-sentence. The
 *     fallback is spelling, not phonetics, so the homophone property does NOT hold for these words;
 *     that is the declared trade-off (recorded in #375's unlocked decision 1).
 *
 * The 48-element cap is retained as a hard safety bound on the duration estimate
 * (`humanoidDialogueDurationMs`). It no longer has to absorb letter-by-letter growth — a
 * dictionary word contributes at most ~8 phones — so the shipped bank's longest spoken line stays
 * far below it; the cap only bites on pathological input.
 */

import { DIALOGUE_PRONUNCIATIONS } from "./dialogue-pronunciations.js";

/** Hard cap on the emitted sequence — bounds the duration estimate for pathological input. */
const MAX_PHONEMES = 48;

/**
 * ARPAbet phone -> viseme collapse (7 names, the alphabet the runtime morph resolver binds).
 * Letters in the map are the OOV grapheme fallback's own phonemes, kept alongside so both code
 * paths collapse through one function. Anything unmapped (alveolars, velars, fricatives without
 * lip shape) is `mid` — the tongue does that work, not the mouth.
 */
const PHONEME_TO_VISEME: Readonly<Record<string, string>> = {
  // bilabial closure
  B: "closed",
  M: "closed",
  P: "closed",
  // labiodental — upper teeth on lower lip
  F: "teeth",
  V: "teeth",
  // rounded vowels + glide
  AO: "rounded",
  AW: "rounded",
  OY: "rounded",
  UH: "rounded",
  UW: "rounded",
  W: "rounded",
  // open vowels (OW is the open-mouthed /oʊ/ — "no", "go", "phone"; matches the legacy 'o' -> open)
  AA: "open",
  AE: "open",
  OW: "open",
  // spread vowels + glide
  AY: "wide",
  EH: "wide",
  EY: "wide",
  IH: "wide",
  IY: "wide",
  Y: "wide",
  // grapheme fallback letters (#376 classifier), same shapes as the ARPAbet groups above
  m: "closed",
  f: "teeth",
  w: "rounded",
  a: "open",
  o: "open",
  e: "wide",
  i: "wide",
};

/** The phoneme sequence the mouth animates to / that feeds evidence and the duration estimate. */
export function phonemesForText(text: string): string[] {
  const spoken = text.replace(/^[^:]+:\s*/u, "").toLowerCase();
  const sequence: string[] = [];
  for (const token of spoken.match(/[a-z']+|[^a-z\s]+/gu) ?? []) {
    if (!/^[a-z']+$/u.test(token)) {
      // Sentence-final punctuation rests the mouth; other punctuation is dropped (as before #375).
      for (const ch of token) if (/[.!?]/u.test(ch)) sequence.push("sil");
      continue;
    }
    const lookup = DIALOGUE_PRONUNCIATIONS[token];
    const phones = lookup !== undefined ? lookup.split(/\s+/u) : fallbackPhonemesForWord(token);
    for (const p of phones) if (p.length > 0) sequence.push(p);
  }
  return sequence.length > 0 ? sequence.slice(0, MAX_PHONEMES) : ["sil"];
}

/** The viseme sequence the mouth animates to — `phonemesForText` mapped through the resolver. */
export function visemesForText(text: string): string[] {
  return phonemesForText(text).map(visemeForPhoneme);
}

/**
 * OOV fallback — the #376 letter classifier, kept verbatim so out-of-dictionary words still move
 * the mouth. Spelling, not phonetics: `h` is dropped, `ph` closes the lips (the #375 defect),
 * and homophones that land here diverge. That is the declared trade-off; see the module header.
 */
function fallbackPhonemesForWord(word: string): string[] {
  const sequence: string[] = [];
  for (const char of word) {
    if (/[aeiou]/u.test(char)) sequence.push(char);
    else if (/[bmp]/u.test(char)) sequence.push("m");
    else if (/[fv]/u.test(char)) sequence.push("f");
    else if (/[tdnlsz]/u.test(char)) sequence.push("t");
    else if (/[kgqcr]/u.test(char)) sequence.push("k");
    else if (/[wy]/u.test(char)) sequence.push("w");
  }
  return sequence;
}

function visemeForPhoneme(phoneme: string): string {
  if (phoneme === "sil") return "rest";
  return PHONEME_TO_VISEME[phoneme] ?? "mid";
}
