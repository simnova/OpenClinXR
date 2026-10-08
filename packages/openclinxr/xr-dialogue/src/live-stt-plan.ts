/**
 * Live STT-timed cue-track builder (MADR 0062 live tier, S2 plan port).
 *
 * Turns {decoded mono samples, sampleRate, STT words, transcript} into the
 * existing cue-track shape the actor-turn player consumes (ARPABET cues that
 * feed the same phone->viseme intake as `mapArpabetTrack`).
 *
 * Method (operator 2026-10-08, arena 57ca31545 S2): STT word timestamps split
 * within each word by duration-weighted phones, word starts snapped backward
 * to the TTS audio-energy (or fricative ZCR) onset inside the word's own STT
 * gap, and closure-gap P emissions over inter-word silence before P/B/M
 * initials. Cost accepted per MADR 0062 decision 5, not an arena pass.
 *
 * Module-internal: no entrypoint re-exports this file, so the package's
 * reviewed public surface is unchanged. The next (wiring) card exposes it.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: Quest readiness, live speech provider, clinical affect.
 */

// ── V1 provenance ──────────────────────────────────────────────────────────
// Everything between the V-markers below is ported from
// apps/arena/viseme-audio-clock/grok-voice/measure.ts at 57ca31545, except
// deriveLiveAnchors/frameStatsFromSamples which port record.ts section 5b
// (scripts/record.ts at 57ca31545) with the input adapted from "ffmpeg-decoded
// cached mp3" to "caller-supplied mono samples + sampleRate"; the arithmetic
// (10 ms peak-dBFS frames, ZCR, -40 dBFS threshold, gap loop) is unchanged.
// A test pins each V-block against the arena source text (sync or fail).
// ── V1: phone-duration table + closure predicate (verbatim) ────────────────

export const FPS = 30;

export type SttWord = { word: string; start: number; end: number };
export type ArpabetCue = { startS: number; endS: number; phone: string };

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
// ── V1 end ─────────────────────────────────────────────────────────────────
// ── V2: snap constants + fricative gate + edge onsets + word-start snap ─────
// (verbatim from measure.ts at 57ca31545)

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
// ── V2 end ─────────────────────────────────────────────────────────────────
// ── V3: phone-plan builder (verbatim from measure.ts at 57ca31545) ─────────

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
// ── V3 end ─────────────────────────────────────────────────────────────────

// ── V4: audio anchors from caller-supplied samples ─────────────────────────
// Ports record.ts section 5b at 57ca31545 ("Audio anchors (STT gaps +
// cached-audio energy only; never MFA cues)"). Input adapted: record.ts
// decodes the cached TTS mp3 with ffmpeg at 16 kHz mono and frames the int16
// stream; here the caller supplies mono float samples plus the sample rate
// and the framing below reproduces the same 10 ms peak-dBFS + ZCR features
// (int16 peak P over 32768 and float peak P/32768 read the same dBFS; the
// zero-crossing sign classes agree, with per-frame prev reset to 0).
// Threshold -40 dBFS peak per 10-ms frame separates mp3 encoder idle noise
// (measured <= -51 dB in leading frames of all four clips) from speech onset
// (>= -29 dB); it is chosen from the audio alone, not fitted to MFA.

export const ANCHOR_THRESHOLD_DB = -40;
const ANCHOR_FRAME_S = 0.01;

export type LiveAnchors = {
  thresholdDb: number;
  energyOnsetS: number;
  noiseFloorDb: number;
  firstWordStartS: number;
  snappedStarts: number[];
  closures: ClosureSpan[];
};

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Per-10-ms peak dBFS plus zero-crossing rate over mono float samples. */
function frameStats(samples: Float32Array, sampleRate: number): { db: number[]; zcr: number[] } {
  const per = Math.max(1, Math.round(sampleRate * ANCHOR_FRAME_S));
  const db: number[] = [];
  const zcr: number[] = [];
  for (let i = 0; i < samples.length; i += per) {
    let peak = 0;
    let cross = 0;
    let prev = 0;
    const end = Math.min(i + per, samples.length);
    for (let k = i; k < end; k += 1) {
      const v = samples[k] ?? 0;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      if (k > i && (prev < 0) !== (v < 0)) cross += 1;
      prev = v;
    }
    db.push(peak <= 0 ? -99 : 20 * Math.log10(peak));
    zcr.push(cross / per);
  }
  return { db, zcr };
}

function bilabialInitial(phone: string | undefined): boolean {
  if (!phone) return false;
  return BILABIAL.has(phone.trim().toUpperCase().replace(/[0-2]$/u, ""));
}

/**
 * Derive snap + closure anchors from audio energy only (never MFA cues).
 * Closure rule: same predicate as the MFA rule (silence immediately before a
 * P/B/M initial becomes P), emitted over the STT inter-word gap (or the
 * leading silence for word 0). Closure onset is the audio-energy quiet point:
 * end of the last 10-ms frame at or above threshold with frame end <= gap
 * end, clamped to the gap, falling back to gap start when the whole gap is
 * quiet. Snapped starts come from snapWordStarts over the same frames.
 */
export function deriveLiveAnchors(
  samples: Float32Array,
  sampleRate: number,
  sttWords: SttWord[],
  referenceWords: string[],
  pronunciations: Readonly<Record<string, string[]>>,
): LiveAnchors {
  const frameS = Math.max(1, Math.round(sampleRate * ANCHOR_FRAME_S)) / sampleRate;
  const { db: dbs, zcr } = frameStats(samples, sampleRate);
  let onsetIdx = dbs.findIndex((v) => v >= ANCHOR_THRESHOLD_DB);
  if (onsetIdx < 0) onsetIdx = 0;
  const energyOnsetS = round3(onsetIdx * frameS);
  const noiseFloorDb = Number(Math.min(...dbs.slice(0, 20)).toFixed(0));
  const fricFirst = referenceWords.map((w, i) =>
    i < sttWords.length ? fricativeInitial(pronunciations[normWord(w)]?.[0]) : false,
  );
  const snapped = snapWordStarts(
    sttWords, dbs, ANCHOR_THRESHOLD_DB, SNAP_WINDOW_S, frameS, undefined, zcr, fricFirst,
  );
  const firstWordStartS = round3(snapped[0] ?? sttWords[0]?.start ?? 0);
  const snappedStarts = snapped.map(round3);
  const closures: ClosureSpan[] = [];
  const count = Math.min(referenceWords.length, sttWords.length);
  for (let i = 0; i < count; i += 1) {
    const init = pronunciations[normWord(referenceWords[i] ?? "")]?.[0];
    if (!bilabialInitial(init)) continue;
    const gapStart = i === 0 ? 0 : (sttWords[i - 1]?.end ?? 0);
    const gapEnd = snapped[i] ?? sttWords[i]?.start ?? 0;
    if (!(gapEnd > gapStart)) continue;
    let lastLoud = -1;
    for (let f = 0; f < dbs.length; f += 1) {
      const fs = f * frameS;
      const fe = (f + 1) * frameS;
      if (fe > gapEnd + 1e-9) break;
      if (fs < gapStart - 1e-9) continue;
      if (dbs[f]! >= ANCHOR_THRESHOLD_DB) lastLoud = f;
    }
    const tQuiet = lastLoud < 0 ? gapStart : Math.min(Math.max((lastLoud + 1) * frameS, gapStart), gapEnd);
    // A snap-pinched gap rounds to zero width; a sub-frame P is
    // acoustically meaningless, so only emit positive-width closures.
    const qStart = round3(tQuiet);
    const qEnd = round3(gapEnd);
    if (!(qEnd > qStart)) continue;
    closures.push({ wordIndex: i, phone: "P", startS: qStart, endS: qEnd });
  }
  return {
    thresholdDb: ANCHOR_THRESHOLD_DB,
    energyOnsetS,
    noiseFloorDb,
    firstWordStartS,
    snappedStarts,
    closures,
  };
}
// ── V4 end ─────────────────────────────────────────────────────────────────

export type LiveSttBakeInput = {
  samples: Float32Array;
  sampleRate: number;
  sttWords: SttWord[];
  transcript: string;
  pronunciations: Readonly<Record<string, string[]>>;
};

export type LiveSttBakeResult = {
  cues: ArpabetCue[];
  anchors: LiveAnchors;
  mismatches: string[];
  oovWords: string[];
};

/** Full S2 bake: transcript + STT words + audio samples -> ARPABET cue track. */
export function bakeLiveSttCueTrack(input: LiveSttBakeInput): LiveSttBakeResult {
  const referenceWords = input.transcript.split(/\s+/).map(normWord).filter(Boolean);
  const anchors = deriveLiveAnchors(
    input.samples, input.sampleRate, input.sttWords, referenceWords, input.pronunciations,
  );
  const { plan, mismatches, oovWords } = buildPhonePlan(referenceWords, input.sttWords, input.pronunciations, {
    closures: anchors.closures,
    firstWordStartS: anchors.firstWordStartS,
    wordStarts: anchors.snappedStarts,
    split: "duration",
  });
  return {
    cues: plan.map((p) => ({ startS: p.startS, endS: p.endS, phone: p.phone })),
    anchors,
    mismatches,
    oovWords,
  };
}
