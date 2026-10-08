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
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) {
      mismatches.push(`word[${i}] bad-span ${span.start}-${span.end}`);
      continue;
    }
    for (let p = 0; p < phones.length; p += 1) {
      plan.push({
        word: ref,
        wordIndex: i,
        phone: phones[p]!,
        startS: span.start + (p * (span.end - span.start)) / phones.length,
        endS: span.start + ((p + 1) * (span.end - span.start)) / phones.length,
      });
    }
  }
  return { plan, mismatches, oovWords };
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

function median(sorted: number[]): number | null {
  return quantile(sorted, 0.5);
}

export type ClipScore = {
  clip: string;
  closureHits: number;
  closureTotal: number;
  labiodentalHits: number;
  labiodentalTotal: number;
  onsetErrorsFrames: number[];
  onsetMedianFrames: number | null;
  onsetP95Frames: number | null;
  sttWordDriftMs: number[];
  sttWordDriftMedianMs: number | null;
  mismatches: string[];
  oovWords: string[];
  plannedPhones: number;
  mfaPhones: number;
};

/**
 * Score one clip. Closure/labiodental hit: for each MFA P/B/M (resp. F/V)
 * phone, a planned phone with the same stressless label starts inside the MFA
 * interval widened by 2 frames. Onset error: same pairing, planned onset minus
 * MFA onset in 30 fps frames. STT word drift: per-word STT start minus MFA
 * word start in ms (order-matched, truncated).
 */
export function scoreClip(
  clip: string,
  referenceWords: string[],
  sttWords: SttWord[],
  pronunciations: Readonly<Record<string, string[]>>,
  mfaPhones: PhoneCue[],
  mfaWords: WordCue[],
): ClipScore {
  const { plan, mismatches, oovWords } = buildPhonePlan(referenceWords, sttWords, pronunciations);
  const widenS = WIDEN_FRAMES / FPS;

  const hitFor = (mfa: PhoneCue, set: Set<string>): { hit: boolean; err: number | null } => {
    const want = stressless(mfa.phone);
    let best: number | null = null;
    for (const p of plan) {
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
  const onsetErrors: number[] = [];
  for (const mfa of mfaPhones) {
    const key = stressless(mfa.phone);
    if (BILABIAL.has(key)) {
      closureTotal += 1;
      const r = hitFor(mfa, BILABIAL);
      if (r.hit) closureHits += 1;
      if (r.err !== null) onsetErrors.push(r.err);
    } else if (LABIODENTAL.has(key)) {
      labiodentalTotal += 1;
      const r = hitFor(mfa, LABIODENTAL);
      if (r.hit) labiodentalHits += 1;
    }
  }
  // Onset stats are over P/B/M pairings only (the closure clock under test).
  const sortedErrs = [...onsetErrors].sort((a, b) => a - b);

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
    onsetErrorsFrames: sortedErrs.map((e) => Number(e.toFixed(2))),
    onsetMedianFrames: median(sortedErrs) === null ? null : Number(median(sortedErrs)!.toFixed(2)),
    onsetP95Frames: quantile(sortedErrs, 0.95) === null ? null : Number(quantile(sortedErrs, 0.95)!.toFixed(2)),
    sttWordDriftMs: sortedDrifts.map((d) => Number(d.toFixed(1))),
    sttWordDriftMedianMs:
      median(sortedDrifts) === null ? null : Number(median(sortedDrifts)!.toFixed(1)),
    mismatches,
    oovWords,
    plannedPhones: plan.length,
    mfaPhones: mfaPhones.length,
  };
}
