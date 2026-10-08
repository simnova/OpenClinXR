/**
 * Audio conditioning for the live STT bake (sibling of live-stt-plan.ts).
 *
 * Module-internal: imported only by live-stt-plan.ts, never re-exported by
 * any entrypoint, so the package's reviewed public surface is unchanged.
 * Split out because live-stt-plan.ts sits at its 500-line zone budget.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: Quest readiness, live speech provider, clinical affect.
 */
import {
  ANCHOR_FRAME_S,
  ANCHOR_THRESHOLD_DB,
  BILABIAL,
  frameStats,
  stressless,
  type PlannedPhone,
} from "./live-stt-plan.js";

/**
 * Fixed analysis rate for the onset snap. The browser bakes from a 48 kHz
 * Web Audio decode while the reference bakes from ffmpeg at 22.05 kHz, and
 * per-sample ZCR reads lower at 48 kHz for the same frication, so the
 * F-onset edge lands ~29 ms later. Resampling every input to 16 kHz (the
 * record.ts fixed decode rate the parity test pins) puts both paths on the
 * same grid with the same thresholds. At 16 kHz this is the identity.
 */
export const ANALYSIS_SAMPLE_RATE = 16000;

export function resampleToAnalysisRate(
  samples: Float32Array,
  sampleRate: number,
): { samples: Float32Array; sampleRate: number } {
  if (!Number.isFinite(sampleRate) || !(sampleRate > 0)) {
    return { samples, sampleRate: ANALYSIS_SAMPLE_RATE };
  }
  if (Math.abs(sampleRate - ANALYSIS_SAMPLE_RATE) < 1e-9) return { samples, sampleRate };
  const durationS = samples.length / sampleRate;
  if (!(durationS > 0)) return { samples: new Float32Array(0), sampleRate: ANALYSIS_SAMPLE_RATE };
  const outLen = Math.max(1, Math.round(durationS * ANALYSIS_SAMPLE_RATE));
  const out = new Float32Array(outLen);
  const last = samples.length - 1;
  for (let j = 0; j < outLen; j += 1) {
    const srcPos = (j / ANALYSIS_SAMPLE_RATE) * sampleRate;
    const lo = Math.floor(srcPos);
    const hi = Math.min(last, lo + 1);
    const frac = srcPos - lo;
    const a = samples[Math.max(0, Math.min(last, lo))] ?? 0;
    const b = samples[Math.max(0, Math.min(last, hi))] ?? 0;
    out[j] = a + (b - a) * frac;
  }
  return { samples: out, sampleRate: ANALYSIS_SAMPLE_RATE };
}

export type GapAudio = { db: readonly number[]; frameS: number; thresholdDb: number };

/** Frame energy for the gap fill, resampled to the fixed analysis rate. */
export function gapAudioForFill(
  audio: { samples: Float32Array; sampleRate: number } | null | undefined,
): GapAudio | null {
  if (!audio) return null;
  const analysis = resampleToAnalysisRate(audio.samples, audio.sampleRate);
  const gapFrameS =
    Math.max(1, Math.round(analysis.sampleRate * ANCHOR_FRAME_S)) / analysis.sampleRate;
  const { db: gapDb } = frameStats(analysis.samples, analysis.sampleRate);
  return { db: gapDb, frameS: gapFrameS, thresholdDb: ANCHOR_THRESHOLD_DB };
}

/** True when at least one audio frame overlapping the gap is quiet. */
function gapHasQuiet(db: readonly number[], frameS: number, thresholdDb: number, gapStartS: number, gapEndS: number): boolean {
  if (!(gapEndS > gapStartS)) return true;
  for (let f = 0; f < db.length; f += 1) {
    if ((f + 1) * frameS <= gapStartS + 1e-9 || f * frameS >= gapEndS - 1e-9) continue;
    if (db[f]! < thresholdDb) return true;
  }
  return false;
}

const GAP_FILL_THRESHOLD_S = 0.03;

/**
 * Inter-cue gap fill. Gaps play as sil/rest frames; (1) a gap before a
 * bilabial becomes a P closure, (2) any other gap shorter than 0.030 s
 * (shortest interior SIL in the 14 cached clips' MFA refs) splits at the
 * midpoint, longer gaps stay sil. Loud-gap rule: a gap with no quiet frame
 * is continuous speech (clin-01 puffs/of 40 ms), so it splits however long
 * it is and never becomes a closure. Threshold unchanged at 0.030 s.
 */
export function fillInterCueGaps(plan: PlannedPhone[], audio: GapAudio | null = null): PlannedPhone[] {
  const sorted = [...plan].sort((a, b) => a.startS - b.startS || a.wordIndex - b.wordIndex);
  const out: PlannedPhone[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = { ...(sorted[i]!) };
    const next = sorted[i + 1];
    const gap = next === undefined ? 0 : next.startS - cur.endS;
    if (next === undefined || !(gap > 1e-9)) { out.push(cur); continue; }
    const gapIsSpeech = audio
      ? !gapHasQuiet(audio.db, audio.frameS, audio.thresholdDb, cur.endS, next.startS)
      : false;
    if (gapIsSpeech) { const mid = cur.endS + gap / 2; out.push({ ...cur, endS: mid }); sorted[i + 1] = { ...next, startS: mid }; }
    else if (BILABIAL.has(stressless(next.phone))) out.push(cur, { word: next.word, wordIndex: next.wordIndex, phone: "P", startS: cur.endS, endS: next.startS });
    else if (gap < GAP_FILL_THRESHOLD_S - 1e-9) { const mid = cur.endS + gap / 2; out.push({ ...cur, endS: mid }); sorted[i + 1] = { ...next, startS: mid }; }
    else out.push(cur);
  }
  return out;
}
