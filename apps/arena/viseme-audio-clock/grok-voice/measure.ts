/**
 * Pure measurement: STT word timestamps -> phone plan -> MFA agreement.
 * No network, no fs, no subprocess: inputs are passed in, so the vitest
 * replay path exercises exactly this code.
 *
 * Joining rule (stated per card): each STT word span is split uniformly
 * across that word's dictionary phones (even subdivision). Planned phone i of
 * N in word [w0, w1] starts at w0 + i * (w1 - w0) / N. MFA is an aligner, not
 * ground truth; every number below is agreement with MFA.
 */
import type { SttWord } from "./client.js";

export const FPS = 30;
/** Known-good hit window: MFA interval widened by 2 frames at 30 fps. */
export const WIDEN_FRAMES = 2;

export type PhoneCue = { startS: number; endS: number; phone: string };
export type WordCue = { startS: number; endS: number; word: string };

export type PlannedPhone = {
  word: string;
  wordIndex: number;
  phone: string;
  startS: number;
  endS: number;
};

export function stressless(phone: string): string {
  return phone.trim().toUpperCase().replace(/[0-2]$/u, "");
}

const BILABIAL = new Set(["P", "B", "M"]);
const LABIODENTAL = new Set(["F", "V"]);

/**
 * Closure-gap rule, vendored verbatim in predicate from the repo MFA cue
 * source (`tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`,
 * `applyMfaClosureRule`: a silence interval immediately preceding a bilabial
 * stop or nasal (P/B/M) is the acoustic closure and relabels to P with
 * unchanged bounds). No published package entrypoint exports that function,
 * and a relative import into another package's src is refused by the
 * architecture rule, so the predicate (BILABIAL = P/B/M; silence before it
 * becomes P) is reused here without reimplementation rather than re-derived.
 * Adaptation (stated, not hidden): MFA relabels a phone-tier SIL interval;
 * the STT plan has no SIL intervals, so the same predicate EMITS a P phone
 * spanning the STT inter-word gap (or the leading silence for word 0) when
 * the next word starts with P/B/M. Emission bounds come only from STT word
 * bounds plus cached-audio energy (see audio-anchors.json); never MFA cues.
 * This function takes no MFA input (counterweight: a plan that reads MFA to
 * place closures would pass by construction).
 */
export type ClosureSpan = {
  wordIndex: number;
  phone: "P";
  startS: number;
  endS: number;
};

export type PlanOpts = {
  /** Precomputed closure emissions (STT gap + audio energy only). */
  closures?: readonly ClosureSpan[];
  /** Re-anchored start for word 0 (audio energy onset). Defaults to STT start. */
  firstWordStartS?: number | null;
};

function normWord(w: string): string {
  return w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, "");
}

/**
 * Build the phone plan. `pronunciations` maps normalized word -> ARPABET
 * phones (resolved once at record time from the repo CMU subset, then the MFA
 * dictionary, then cmudict; recorded in phone-plans.json). Words are matched
 * to STT words by order; a count or text mismatch is recorded and the pairing
 * truncates to the shorter side.
 */
export function buildPhonePlan(
  referenceWords: string[],
  sttWords: SttWord[],
  pronunciations: Readonly<Record<string, string[]>>,
  opts?: PlanOpts,
): { plan: PlannedPhone[]; mismatches: string[]; oovWords: string[] } {
  const mismatches: string[] = [];
  const oovWords: string[] = [];
  const plan: PlannedPhone[] = [];
  const n = Math.min(referenceWords.length, sttWords.length);
  if (referenceWords.length !== sttWords.length) {
    mismatches.push(`word-count ref=${referenceWords.length} stt=${sttWords.length}`);
  }
  for (let i = 0; i < n; i += 1) {
    const ref = normWord(referenceWords[i] ?? "");
    const got = normWord(sttWords[i]?.word ?? "");
    if (ref !== got) mismatches.push(`word[${i}] ref=${ref} stt=${got}`);
    const phones = pronunciations[ref];
    const span = sttWords[i]!;
    if (!phones || phones.length === 0) {
      oovWords.push(ref);
      continue;
    }
    // Leading-silence offset: word 0 starts at the audio energy onset, not
    // the STT start, absorbing the TTS leading-silence systematic. Later
    // words keep STT bounds (their lag is per-word duration drift, not a
    // uniform clock offset, so a global shift would mistarget them).
    const w0 =
      i === 0 && opts?.firstWordStartS != null && opts.firstWordStartS < span.end
        ? opts.firstWordStartS
        : span.start;
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) {
      mismatches.push(`word[${i}] bad-span ${span.start}-${span.end}`);
      continue;
    }
    for (let p = 0; p < phones.length; p += 1) {
      plan.push({
        word: ref,
        wordIndex: i,
        phone: phones[p]!,
        startS: w0 + (p * (span.end - w0)) / phones.length,
        endS: w0 + ((p + 1) * (span.end - w0)) / phones.length,
      });
    }
  }
  // Closure emissions: same predicate as the MFA rule (gap before a P/B/M
  // initial becomes P), placed from STT/audio inputs only. Sorted by onset
  // so the plan stays in time order.
  for (const c of opts?.closures ?? []) {
    if (c.endS <= c.startS) continue;
    const ref = normWord(referenceWords[c.wordIndex] ?? "");
    plan.push({ word: ref, wordIndex: c.wordIndex, phone: "P", startS: c.startS, endS: c.endS });
  }
  plan.sort((a, b) => a.startS - b.startS || a.wordIndex - b.wordIndex);
  return { plan, mismatches, oovWords };
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length / 2;
  if (Number.isInteger(mid)) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[Math.floor(mid)]!;
}

export type ClipScore = {
  clip: string;
  closureHits: number;
  closureTotal: number;
  labiodentalHits: number;
  labiodentalTotal: number;
  /** All-phone onset coverage: every non-silence MFA phone is scored. A phone
   * with no planned same-label counterpart counts as a miss, not a skip. */
  phoneHits: number;
  phoneTotal: number;
  pairedPhones: number;
  onsetErrorsFrames: number[];
  onsetMedianFrames: number | null;
  onsetP95Frames: number | null;
  /** Corrected statistics: median / p95 over ABSOLUTE onset error, plus the
   * signed median as bias. The pass bar scores medianAbs <= 1, p95Abs <= 2:
   * signed quantiles hide early errors in the upper tail. */
  medianAbsFrames: number | null;
  p95AbsFrames: number | null;
  biasMedianFrames: number | null;
  sttWordDriftMs: number[];
  sttWordDriftMedianMs: number | null;
  mismatches: string[];
  oovWords: string[];
  plannedPhones: number;
  mfaPhones: number;
};

/**
 * Score one clip. Closure/labiodental/all-phone hit: for each MFA P/B/M
 * (resp. F/V, resp. every non-silence phone), a planned phone with the same
 * stressless label starts inside the MFA interval widened by 2 frames.
 * Onset error: same pairing, planned onset minus MFA onset in 30 fps
 * frames, over every paired non-silence phone. A phone with no planned
 * same-label counterpart is a miss, not a skip. STT word drift: per-word
 * STT start minus MFA word start in ms (order-matched, truncated).
 */
export function scoreClip(
  clip: string,
  referenceWords: string[],
  sttWords: SttWord[],
  pronunciations: Readonly<Record<string, string[]>>,
  mfaPhones: PhoneCue[],
  mfaWords: WordCue[],
  opts?: PlanOpts,
): ClipScore {
  const { plan, mismatches, oovWords } = buildPhonePlan(referenceWords, sttWords, pronunciations, opts);
  const widenS = WIDEN_FRAMES / FPS;

  // Same-word pairing: MFA phones join the MFA word containing their onset
  // (gap phones join the following word, matching closure emissions, which
  // carry the following word's index); they pair only with planned phones of
  // the same order-matched word index. A phone with no same-label planned
  // counterpart in its word is a miss, not a skip. Global nearest-same-label
  // pairing is refused: dictionary pronunciation variants (MFA dog D AA1 G
  // vs plan D AO1 G) would otherwise pair across words and report acoustic
  // distances as clock errors.
  const plannedByWord = new Map<number, PlannedPhone[]>();
  for (const p of plan) {
    const arr = plannedByWord.get(p.wordIndex) ?? [];
    arr.push(p);
    plannedByWord.set(p.wordIndex, arr);
  }
  const wordIndexOf = (phoneStartS: number): number | null => {
    for (let i = 0; i < mfaWords.length; i += 1) {
      const w = mfaWords[i]!;
      if (phoneStartS >= w.startS - 1e-9 && phoneStartS < w.endS - 1e-9) return i;
    }
    for (let i = 0; i < mfaWords.length; i += 1) {
      if (mfaWords[i]!.startS > phoneStartS + 1e-9) return i;
    }
    return null;
  };

  const hitFor = (mfa: PhoneCue, wi: number | null): { hit: boolean; err: number | null } => {
    const want = stressless(mfa.phone);
    let best: number | null = null;
    for (const p of wi === null ? [] : (plannedByWord.get(wi) ?? [])) {
      if (stressless(p.phone) !== want) continue;
      const err = (p.startS - mfa.startS) * FPS;
      if (best === null || Math.abs(err) < Math.abs(best)) best = err;
    }
    if (best === null) return { hit: false, err: null };
    const onsetS = mfa.startS + best / FPS;
    const hit = onsetS >= mfa.startS - widenS && onsetS <= mfa.endS + widenS;
    return { hit, err: best };
  };

  let closureHits = 0;
  let closureTotal = 0;
  let labiodentalHits = 0;
  let labiodentalTotal = 0;
  let phoneHits = 0;
  let phoneTotal = 0;
  const onsetErrors: number[] = [];
  for (const mfa of mfaPhones) {
    const key = stressless(mfa.phone);
    if (key === "SIL" || key === "SP" || key === "SPN") continue;
    phoneTotal += 1;
    const r = hitFor(mfa, wordIndexOf(mfa.startS));
    if (r.hit) phoneHits += 1;
    if (r.err !== null) onsetErrors.push(r.err);
    if (BILABIAL.has(key)) {
      closureTotal += 1;
      if (r.hit) closureHits += 1;
    } else if (LABIODENTAL.has(key)) {
      labiodentalTotal += 1;
      if (r.hit) labiodentalHits += 1;
    }
  }
  // Onset stats are over ALL paired non-silence phones (the full clock under
  // test), not just the P/B/M subset. Median uses the mean of the two middle
  // values for even n. p95 uses nearest-rank ceil(0.95*n)-1, so for small n
  // (pangram n=4, viseme n=7 paired subsets) it is effectively the max.
  const sortedErrs = [...onsetErrors].sort((a, b) => a - b);
  const sortedAbs = onsetErrors.map((e) => Math.abs(e)).sort((a, b) => a - b);

  const n = Math.min(referenceWords.length, sttWords.length, mfaWords.length);
  const drifts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = sttWords[i]!;
    const m = mfaWords[i]!;
    if (Number.isFinite(s.start) && Number.isFinite(m.startS)) {
      drifts.push((s.start - m.startS) * 1000);
    }
  }
  const sortedDrifts = [...drifts].sort((a, b) => a - b);

  return {
    clip,
    closureHits,
    closureTotal,
    labiodentalHits,
    labiodentalTotal,
    phoneHits,
    phoneTotal,
    pairedPhones: onsetErrors.length,
    onsetErrorsFrames: sortedErrs.map((e) => Number(e.toFixed(2))),
    onsetMedianFrames: median(sortedErrs) === null ? null : Number(median(sortedErrs)!.toFixed(2)),
    onsetP95Frames: quantile(sortedErrs, 0.95) === null ? null : Number(quantile(sortedErrs, 0.95)!.toFixed(2)),
    medianAbsFrames: median(sortedAbs) === null ? null : Number(median(sortedAbs)!.toFixed(2)),
    p95AbsFrames: quantile(sortedAbs, 0.95) === null ? null : Number(quantile(sortedAbs, 0.95)!.toFixed(2)),
    biasMedianFrames: median(sortedErrs) === null ? null : Number(median(sortedErrs)!.toFixed(2)),
    sttWordDriftMs: sortedDrifts.map((d) => Number(d.toFixed(1))),
    sttWordDriftMedianMs:
      median(sortedDrifts) === null ? null : Number(median(sortedDrifts)!.toFixed(1)),
    mismatches,
    oovWords,
    plannedPhones: plan.length,
    mfaPhones: mfaPhones.length,
  };
}
