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
  /** Per-word snapped starts (audio onset snap); entry i overrides word i's
   * start when finite and below the word end. Supplied from audio anchors. */
  wordStarts?: readonly number[] | null;
  /** Within-word split: "even" subdivides uniformly; "duration" weights by
   * fixed per-phone relative durations (PHONE_WEIGHT, published norms). */
  split?: SplitMode;
};

export type SplitMode = "even" | "duration";

/**
 * Fixed per-phone relative durations. Class weights follow published English
 * phone-duration norms (Crystal & House 1988 mean segment durations: vowels
 * longest, fricatives intermediate, stops shortest; unstressed vowels
 * reduced — cf. Klatt 1979 duration rules): diphthongs 1.5, monophthongs
 * 1.15 (stressed x1.1, unstressed x0.8), affricates 1.0, fricatives 0.9
 * (SH/ZH 1.0), liquids 0.85, nasals 0.8, glides 0.7, stops 0.6, flap 0.5.
 * Fixed a priori; never fitted to these clips' MFA output, which this
 * function cannot see (no MFA parameter anywhere in plan construction).
 */
const DIPHTHONG = new Set(["AY", "EY", "OY", "AW", "OW"]);
const VOWEL = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW", "AX",
  "IX", "UX", "AXR",
]);
const FRICATIVE = new Set(["F", "V", "S", "Z", "TH", "DH", "HH"]);
const NASAL = new Set(["M", "N", "NG"]);
const LIQUID_GLIDE = new Set(["L", "R", "W", "Y", "EL"]);
const STOP = new Set(["P", "B", "T", "D", "K", "G"]);

export function phoneWeight(phone: string): number {
  const p = phone.trim().toUpperCase();
  const m = p.match(/^([A-Z]+)([0-2])?$/u);
  if (!m) return 0.9;
  const base = m[1]!;
  const stress = m[2];
  if (base === "SIL" || base === "SP" || base === "SPN") return 0;
  if (base === "DX" || base === "Q") return 0.5;
  if (STOP.has(base)) return 0.6;
  if (base === "CH" || base === "JH") return 1.0;
  if (base === "SH" || base === "ZH") return 1.0;
  if (FRICATIVE.has(base)) return 0.9;
  if (NASAL.has(base)) return 0.8;
  if (base === "L" || base === "R") return 0.85;
  if (LIQUID_GLIDE.has(base)) return 0.7;
  if (VOWEL.has(base)) {
    let w = DIPHTHONG.has(base) ? 1.5 : 1.15;
    if (stress === "1") w *= 1.1;
    else if (stress === "0") w *= 0.8;
    return w;
  }
  return 0.9;
}

/** Snap window: +-150 ms, chosen on the ORIGINAL 4 clips' audio+STT only
 * (covers their near-onset class, viseme-words p95 124 ms, while
 * continuous-speech starts 300-700 ms away stay untouched). The 10 clin
 * lines are the held-out half for this choice. */
/** Pre-onset quiet run: 90 ms. The original-4 audio-only quiet-run
 * distribution is bimodal with nothing between 80 and 100 ms (short class
 * 10-80 ms intra-speech dips/closures; pause class 100-460 ms), so an onset
 * qualifies only after a real pause, never after a stop burst. */
export const SNAP_WINDOW_S = 0.15;
export const SNAP_QUIET_RUN_S = 0.09;
/**
 * Fricative-onset ZCR gate. Voiceless frication is too weak for the -40 dBFS
 * energy edge (fat-F reaches it 140 ms after MFA; the vowel 160 ms after),
 * but its zero-crossing rate separates cleanly in the original-4 audio
 * alone: pause frames sit at 2-8% while frication holds 42-81% and vowels
 * 4-12%. Onset at ZCR >= 0.25, pause run below 0.15, amplitude floor -55
 * dBFS (pause floors measure -58..-68 dBFS, frication >= -53 dBFS).
 */
export const SNAP_ZCR_ON = 0.25;
export const SNAP_ZCR_OFF = 0.15;
export const SNAP_ZCR_FLOOR_DB = -55;
export const SNAP_ZCR_QUIET_RUN_S = 0.05;

/** Initial phones whose acoustic onset is frication (weak energy, high ZCR)
 * and therefore snap to the ZCR edge instead of the energy edge. */
const FRICATIVE_ONSET = new Set(["F", "V", "S", "Z", "SH", "ZH", "TH", "DH", "HH"]);

export function fricativeInitial(phone: string | undefined): boolean {
  if (!phone) return false;
  return FRICATIVE_ONSET.has(phone.trim().toUpperCase().replace(/[0-2]$/u, ""));
}

/** Rising-edge onsets over one feature track with a pause-run requirement. */
function edgeOnsets(
  loud: (f: number) => boolean,
  quiet: (f: number) => boolean,
  n: number,
  frameS: number,
  quietRunS: number,
): number[] {
  const need = Math.max(1, Math.round(quietRunS / frameS));
  const onsets: number[] = [];
  for (let f = 0; f < n; f += 1) {
    if (loud(f) && (f === 0 || !loud(f - 1))) {
      let run = 0;
      for (let g = f - 1; g >= 0 && quiet(g); g -= 1) run += 1;
      if (run >= need || run === f) onsets.push(f * frameS);
    }
  }
  return onsets;
}

/**
 * Snap each late STT word start back to its audio onset. Fricative-initial
 * words (per pronunciation) snap to the ZCR frication edge; all others snap
 * to the energy edge. The snap is backward-only inside the word's own STT
 * gap (previous word end .. STT start, within windowS): STT starts lag the
 * acoustic onset, and bounding by the gap refuses neighbor theft. Edges
 * must rise out of a real pause (energy: 90 ms below threshold; ZCR: 50 ms
 * below SNAP_ZCR_OFF with the edge frame above SNAP_ZCR_FLOOR_DB) so
 * phrase-internal bursts never capture a word start. Starts with no
 * qualifying onset keep STT bounds. Pure: frames in, no MFA.
 */
export function snapWordStarts(
  sttWords: SttWord[],
  frameDb: readonly number[],
  thresholdDb: number,
  windowS: number,
  frameS: number,
  quietRunS: number = SNAP_QUIET_RUN_S,
  frameZcr: readonly number[] | null = null,
  fricativeFirst: readonly boolean[] | null = null,
): number[] {
  const n = frameDb.length;
  const energy = edgeOnsets(
    (f) => frameDb[f]! >= thresholdDb,
    (f) => frameDb[f]! < thresholdDb,
    n,
    frameS,
    quietRunS,
  );
  let fric: number[] = [];
  if (frameZcr) {
    // The pause run uses the ON threshold, not the OFF one: frication ramps
    // over several frames (19% -> 49%), and a strict OFF run would reject
    // the very edge it climbs to.
    fric = edgeOnsets(
      (f) => frameZcr[f]! >= SNAP_ZCR_ON && frameDb[f]! >= SNAP_ZCR_FLOOR_DB,
      (f) => frameZcr[f]! < SNAP_ZCR_ON,
      n,
      frameS,
      SNAP_ZCR_QUIET_RUN_S,
    );
  }
  return sttWords.map((w, i) => {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) return w.start;
    const track = fricativeFirst?.[i] && frameZcr ? fric : energy;
    // Backward-only inside the word's own gap: the true onset precedes the
    // (late) STT start but never the previous word's end. This refuses
    // neighbor theft in both directions (a later word's burst, or an
    // earlier phrase onset inside the previous word's span).
    const gapStart = i === 0 ? 0 : (sttWords[i - 1]?.end ?? 0);
    let best = w.start;
    let bestDist = Infinity;
    for (const t of track) {
      if (t >= w.end || t < gapStart - 1e-9) continue;
      const d = w.start - t;
      if (d < -1e-9) continue;
      if (d <= windowS + 1e-9 && d < bestDist - 1e-9) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  });
}

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
    // Onset snap: word i starts at its snapped audio onset when supplied
    // (word 0 falls back to the legacy firstWordStartS offset). Later words
    // keep STT bounds unless the snap moved them; their residual lag is
    // per-word drift, not a uniform clock offset.
    const snap = opts?.wordStarts?.[i];
    const w0 =
      snap !== undefined && snap !== null && Number.isFinite(snap) && snap < span.end
        ? snap
        : i === 0 && opts?.firstWordStartS != null && opts.firstWordStartS < span.end
          ? opts.firstWordStartS
          : span.start;
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) {
      mismatches.push(`word[${i}] bad-span ${span.start}-${span.end}`);
      continue;
    }
    for (let p = 0; p < phones.length; p += 1) {
      const weights =
        opts?.split === "duration" ? phones.map((ph) => Math.max(phoneWeight(ph), 1e-6)) : null;
      const total = weights ? weights.reduce((a, b) => a + b, 0) : phones.length;
      const before = weights ? weights.slice(0, p).reduce((a, b) => a + b, 0) : p;
      const w = weights ? weights[p]! : 1;
      plan.push({
        word: ref,
        wordIndex: i,
        phone: phones[p]!,
        startS: w0 + (before * (span.end - w0)) / total,
        endS: w0 + ((before + w) * (span.end - w0)) / total,
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
