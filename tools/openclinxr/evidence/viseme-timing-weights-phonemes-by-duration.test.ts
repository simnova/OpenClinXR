import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyDialogueVisemeTimelineToRoot } from "../../../apps/ui-xr/src/viseme-runtime-wire.js";
import { phonemesForText } from "../../../apps/ui-xr/src/dialogue-visemes.js";

/**
 * **Every phoneme holds for exactly the same length of time.** A stop consonant and a stressed vowel
 * get identical screen time, so the mouth ticks through shapes like a metronome instead of speaking.
 *
 * Measured 2026-08-14 in the shipped runtime path:
 *
 *   `applyNamedSpeechVisemes` (`viseme-runtime-wire.ts:243-258`) computes
 *   `progress = (now - startedAt) / durationMs`, then `applyDialogueVisemeTimelineToRoot` builds
 *   **one frame per phoneme** (`viseme-timeline-drive.ts:122`, `phonemes.map(...)`) and selects with
 *
 *       index = Math.floor(clamped * frames.length)        // pickFrame, :116-126
 *
 *   That is a uniform division. For an N-phoneme utterance every phoneme owns exactly 1/N of the
 *   duration, whatever it is.
 *
 * ## THIS SUPERSEDES THE RHUBARB PLAN, AND THAT IS THE POINT
 *
 * MADR 0052's Visemes row names the remaining P4 gap as "deterministic phoneme TIMING from audio
 * (D9's Rhubarb station)". **Rhubarb is NOT APPLICABLE and the licence ledger already says so**: it
 * consumes audio, and this repo has **zero** audio assets and no TTS provider (measured 2026-08-13 —
 * 0 `.wav`/`.mp3`/`.ogg` under `apps/` and `packages/`). So the named plan presumes a pipeline that
 * does not exist, and waiting for it means the mouths stay metronomic indefinitely.
 *
 * Timing does not require audio. English phone durations are a property of the phones, and the phone
 * sequence is already in hand: #375 landed a CMUdict-backed `phonemesForText`. Text -> phones ->
 * durations -> timeline is fully deterministic, offline, and has no model in the loop. That is D9's
 * actual answer here; Rhubarb was one possible implementation of it and is the blocked one.
 *
 * ## THE BAND IS EXTERNAL — ENGLISH PHONETICS, NOT A NUMBER I PICKED (SS9s)
 *
 * There is **no known-good column in this tree** and that is declared rather than papered over
 * (SS9h): nothing in this repo carries phone durations today, so the reference has to be external.
 * Measured English conversational speech puts stressed vowels near 100-200 ms and stop closures near
 * 20-80 ms — a ratio comfortably above 2. Clause (1) asks only for **> 1.5x**, which is below every
 * published figure and far below the ~3x a natural rendering would show. Today the ratio is exactly
 * **1.00** by construction, so this is not a threshold fitted to sit just out of reach.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) vowel:stop | (2) varies | (3) all heard | (4) order | result
 *   ------------------------------------------------|----------------|------------|---------------|-----------|--------
 *   a) today (uniform 1/N)                          |   **FAIL**     |  **FAIL**  |     pass      |   pass    | REFUSED
 *   b) lengthen vowels, do not renormalise          |     pass       |    pass    |     pass      |   pass    | (see (5))
 *   c) drop short consonants so vowels dominate     |     pass       |    pass    |  **FAIL**     |   pass    | REFUSED
 *   d) sort phones by duration to make the ratio big|     pass       |    pass    |     pass      | **FAIL**  | REFUSED
 *   e) per-phone durations, normalised to the total |     pass       |    pass    |     pass      |   pass    | ALL PASS
 *
 * **(c) is the one to watch and it is why clause (3) exists.** The cheapest way to make vowels
 * dominate is to give stops zero time, which reads as a mouth that skips consonants entirely — worse
 * than the metronome it replaces. Every phoneme must still get a sampled frame.
 *
 * **(d) is why clause (4) exists.** The SEQUENCE is #375's guarantee and must not move; only the
 * dwell time may change. A reordering would satisfy every duration clause and destroy the mapping.
 *
 * **(b) is not refused by these four clauses and I am saying so rather than pretending otherwise.**
 * Over-running the utterance is a real defect — the mouth would still be moving after the line ends —
 * but it is a property of the caller's `durationMs` contract, not of the frame selection this file can
 * see. Recorded as NOT TESTED below rather than asserted badly.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDS and fail today by construction —
 * uniform division cannot produce a ratio other than 1.00. (3) and (4) are counterweights and pass
 * today. They are independent: changing dwell time cannot drop a phoneme or reorder the sequence
 * unless the implementation goes out of its way to.
 *
 * NOT TESTED:
 *   - **That the total still equals the utterance duration.** Treatment (b) above. `progress` is
 *     supplied by the caller and normalised to [0,1] before this code sees it, so an over-run is not
 *     observable here. It needs a contract on `applyNamedSpeechVisemes` and its `durationMs`.
 *   - **That it sounds/looks right.** There is no audio to sync against and no graded capture of a
 *     mouth mid-utterance. This bounds dwell proportions, nothing more.
 *   - **Coarticulation.** Real mouths blend between shapes; this asserts discrete dwell only.
 *   - **Stress and prosody.** CMUdict marks stress (`AA1` vs `AA0`) and nothing here requires it to be
 *     used. A model that ignores stress can still pass.
 *   - **Any non-English text.** The bank is English; nothing here speaks for other phone inventories.
 */

/**
 * ## FIXED (#382) — 2026-08-14
 *
 * `mapDialoguePhonemesToCues` now assigns per-phone dwell weights (vowels 0.24 s, stops 0.08 s,
 * nasals 0.12 s, fricatives/glides/sil 0.16 s) and `pickFrame` selects by time through the
 * cumulative timeline (`t = progress * totalDwell`, frame = the band `[atSecond, atSecond +
 * duration)` containing `t`) instead of `floor(progress * frameCount)`. The proportions are
 * normalised to the caller's `durationMs` — the mouth still finishes the utterance exactly at
 * progress 1, so the treatment-(b) over-run does not occur and remains NOT TESTED above.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const BUNDLES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");

/** Sampling resolution across the utterance. 400 samples over ~10 phones is ~40 per phone. */
const SAMPLES = 400;
/** External floor: published stressed-vowel vs stop-closure durations sit well above 2. */
const MIN_VOWEL_TO_STOP = 1.5;
/** Uniform division gives exactly 0. Any real duration model varies far more. */
const MIN_COEFF_OF_VARIATION = 0.15;

/** ARPAbet-ish vowels and stops, by the letters `phonemesForText` can emit. */
const VOWELISH = new Set(["a", "e", "i", "o", "u"]);
const STOPPISH = new Set(["t", "k", "m"]);

/** A duck-typed morph root carrying the canonical viseme names the applier drives. */
function syntheticRoot(): { traverse: (cb: (o: unknown) => void) => void; userData: Record<string, unknown> } {
  const names = ["rest", "closed", "teeth", "rounded", "open", "wide", "mid"];
  const dictionary: Record<string, number> = {};
  names.forEach((n, i) => {
    dictionary[n] = i;
  });
  const mesh = {
    name: "synthetic",
    morphTargetDictionary: dictionary,
    morphTargetInfluences: names.map(() => 0),
  };
  return {
    userData: {},
    traverse: (cb: (o: unknown) => void) => {
      cb(mesh);
    },
  };
}

/** One spoken line from the shipped bank — never a sentence I invented. */
function bankUtterance(): string | null {
  if (!existsSync(BUNDLES)) return null;
  for (const dir of readdirSync(BUNDLES).sort()) {
    const p = join(BUNDLES, dir, "learner-runtime-bundle.v1.json");
    if (!existsSync(p)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    let found: string | null = null;
    const walk = (v: unknown): void => {
      if (found) return;
      if (typeof v === "string") {
        if (v.length > 40 && /[a-z]{3}\s+[a-z]{3}\s+[a-z]{3}/i.test(v)) found = v;
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(doc);
    if (found) return found;
  }
  return null;
}

const utterance = bankUtterance();
const phones = utterance ? phonemesForText(utterance) : [];

/** Sample the timeline and count how many samples each phoneme INDEX is the active frame. */
function dwellSamples(sequence: readonly string[]): number[] {
  const root = syntheticRoot();
  const counts = new Array<number>(sequence.length).fill(0);
  for (let s = 0; s < SAMPLES; s += 1) {
    const progress = s / (SAMPLES - 1);
    const r = applyDialogueVisemeTimelineToRoot(root, { phonemeSequence: sequence, progress });
    if (r.frameIndex >= 0 && r.frameIndex < counts.length) counts[r.frameIndex]! += 1;
  }
  return counts;
}

const dwell = phones.length >= 8 ? dwellSamples(phones) : [];

function meanOf(indices: number[]): number {
  if (!indices.length) return 0;
  return indices.reduce((s, i) => s + (dwell[i] ?? 0), 0) / indices.length;
}

const vowelIdx = phones.map((p, i) => (VOWELISH.has(p) ? i : -1)).filter((i) => i >= 0);
const stopIdx = phones.map((p, i) => (STOPPISH.has(p) ? i : -1)).filter((i) => i >= 0);

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireUtterance(): void {
  expect(utterance, `a spoken line found under ${BUNDLES}`).not.toBeNull();
  expect(phones.length, `phonemes for the bank utterance (need >= 8)`).toBeGreaterThanOrEqual(8);
  expect(vowelIdx.length, "vowel-ish phonemes in the sampled utterance").toBeGreaterThanOrEqual(2);
  expect(stopIdx.length, "stop-ish phonemes in the sampled utterance").toBeGreaterThanOrEqual(2);
  expect(dwell.reduce((s, v) => s + v, 0), "samples landed on a frame").toBeGreaterThan(SAMPLES / 2);
}

describe("viseme timing weights phonemes by duration", () => {
  it("(1) RED: a vowel dwells longer than a stop consonant", () => {
    requireUtterance();
    const v = meanOf(vowelIdx);
    const s = meanOf(stopIdx);
    const ratio = s > 0 ? v / s : 0;
    expect(
      Number(ratio.toFixed(2)),
      `mean vowel dwell ${v.toFixed(1)} vs mean stop dwell ${s.toFixed(1)} samples; uniform division gives exactly 1.00 and English phonetics puts this above 2`,
    ).toBeGreaterThan(MIN_VOWEL_TO_STOP);
  });

  it("(2) RED: dwell time varies across the utterance at all", () => {
    requireUtterance();
    const mean = dwell.reduce((s, v) => s + v, 0) / dwell.length;
    const sd = Math.sqrt(dwell.reduce((s, v) => s + (v - mean) ** 2, 0) / dwell.length);
    const cv = mean > 0 ? sd / mean : 0;
    expect(
      Number(cv.toFixed(3)),
      `coefficient of variation of per-phoneme dwell (uniform division gives ~0; ${dwell.length} phonemes)`,
    ).toBeGreaterThan(MIN_COEFF_OF_VARIATION);
  });

  it("(3) COUNTERWEIGHT: every phoneme still gets screen time", () => {
    // Refuses (c): giving stops zero time makes the ratio large and the mouth skip consonants —
    // worse than the metronome. Nothing may be silently dropped.
    requireUtterance();
    const silent = dwell
      .map((count, i) => ({ count, i, p: phones[i] }))
      .filter((r) => r.count === 0)
      .map((r) => `phoneme[${r.i}] "${r.p}" never becomes the active frame across ${SAMPLES} samples`);
    expect(silent.slice(0, 8), "phonemes dropped from the timeline").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the viseme SEQUENCE is unchanged", () => {
    // Refuses (d): reordering by duration satisfies every timing clause and destroys #375's mapping.
    // Frame order must be monotonic in phoneme order as progress advances.
    requireUtterance();
    const root = syntheticRoot();
    let previous = -1;
    const regressions: string[] = [];
    for (let s = 0; s < SAMPLES; s += 1) {
      const r = applyDialogueVisemeTimelineToRoot(root, {
        phonemeSequence: phones,
        progress: s / (SAMPLES - 1),
      });
      if (r.frameIndex < previous) {
        regressions.push(`progress ${(s / (SAMPLES - 1)).toFixed(3)}: frame went ${previous} -> ${r.frameIndex}`);
      }
      previous = r.frameIndex;
    }
    expect(regressions.slice(0, 5), "the timeline moved backwards through the phoneme sequence").toEqual([]);
  });
});
