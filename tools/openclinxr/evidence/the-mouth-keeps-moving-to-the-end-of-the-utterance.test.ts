import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the mouth follows the baked timeline for about a second and then holds silence for the
 * remaining two thirds of the utterance.
 *
 * MEASURED 2026-08-27 at head 09fd94a8 from #722's own live artifact. IMMUTABLE — flip the assertion
 * and append a `## FIXED (#723)` block below; do not rewrite these numbers.
 *
 *   applied viseme last CHANGED    960 ms
 *   samples end                   3480 ms
 *   baked timeline last CHANGE    3670 ms   (of 3710 ms)
 *
 * Thirteen baked cues fall after 960 ms — `1180 F, 1250 B, 1770 C, 1810 B, 1850 C, 2200 D, 2270 B,
 * 2550 C, 2620 F, 2690 E, 2760 B, 2900 C, 2970 B` — and the live readback holds `sil` through all of
 * them.
 *
 * ## THE RESOLVER IS NOT THE CAUSE — measured, do not re-derive
 *
 * All eight tokens resolve against the shipped 47-target dictionary of `mpfb-gown-adult-patient`:
 * `viseme_AA→viseme_aa`, `viseme_E→viseme_E`, `viseme_IH→mouth-part-later`, `viseme_OH→mouth-eversion`,
 * `viseme_OU→mouth-protusion`, `viseme_FV→mouth-elevation`, `viseme_L→mouth-parling`,
 * `viseme_sil→viseme_sil`. The letter map at `viseme-baked-cues.ts:31-41` is complete. Nothing is
 * dropped for want of a mapping, and a slice that starts by editing the alias map is starting in the
 * wrong place.
 *
 * The plateau sits on `sil`, and the timeline's LAST cue is `X → sil` at 3670 ms — consistent with a
 * clock that overruns and clamps to the final cue. **That is a hypothesis, not a finding.** Overrun,
 * clamp and stall all produce this plateau and I have not read the playback loop. Measure which
 * before changing anything.
 *
 * ## WHY A COUNT OR A FRACTION IS THE WRONG INSTRUMENT
 *
 * #722's clause asked for two distinct visemes on two distinct named targets. It passes at four and
 * four, and it cannot see this. A fraction-of-cues bound would be no better: a run that followed the
 * first second perfectly and then stopped still delivers most of its distinct tokens, because `B` and
 * `C` dominate the opening. **The quantity that sees this defect is how far into the utterance the
 * applied viseme keeps CHANGING**, and clause (1) derives that bound from the baked timeline itself
 * rather than from a number anyone chose.
 *
 * ## MY OWN HEADLINE ON #723 WAS WRONG AND IS CORRECTED HERE
 *
 * I wrote "21 of 25 cues never reach a morph" and "none of A B C D F G X appears". Both false. Four
 * of eight tokens reach the face — `E`, `IH`, `FV`, `sil`, the tokens for letters B, C, F and X,
 * which account for 19 of the 25 cues.
 *
 * claimScope: whether applied visemes keep changing across the utterance in a running scene.
 * notEvidenceFor: that the mouth LOOKS right, which only a pixel grade can say and which no run here
 *   has examined; that cue timing matches the audio, which Rhubarb owns; that other utterances or
 *   actors behave the same, none of which is measured.
 *
 * ## FIXED (#723) — 2026-08-27
 *
 * MEASURED BEFORE THE FIX: none of overrun / clamp / stall. The playback loop follows the baked
 * timeline correctly. In #722's artifact AND a fresh live run the drive's frameIndex advances
 * monotonically through the bake (6→12→14→17→22→23; 15→17→23) and every morph reading matches the
 * cue at the drive's clock position; sil begins only when pageNowMs passes
 * speechStartedAtMs + durationMs (progress ≥ 1 clears activeSpeech). The headless page clock equals
 * host wall clock (probe: page 202-206 ms per 200 ms host wait), so the utterance really spans its
 * full 3710 ms and the mouth keeps moving through it.
 *
 * The plateau is a SAMPLER artifact, and the "960 ms" came from the sampler's clock, not the drive's:
 *   - tMs was the nominal schedule index (i * 120 ms) while a scene-graph readback under WebGL load
 *     costs ~200-400 ms, so the real cadence was ~340 ms and the nominal axis compressed the
 *     utterance ~2.8x — the applied viseme had actually kept changing to the utterance end.
 *   - Sampling started ~1.1-1.9 s into the utterance (join-wait overhead), so the opening cues were
 *     never observed and the plateau looked earlier than it was.
 *   - The run stopped at nominal 3480 ms — before the baked last change at 3670 ms.
 *
 * THE FIX:
 *   - tMs BEFORE: the nominal schedule index (i * 120 ms) — a fiction, because a scene-graph
 *     readback under WebGL load costs ~200-400 ms, so the real cadence was ~340 ms and the nominal
 *     axis compressed the utterance ~2.8x. The "960 ms plateau" was that compressed clock.
 *   - tMs AFTER: the actual utterance-local page time — `tMs = round(pageNowMs - baked
 *     .speechStartedAtMs)` — declared in the artifact's `tTimebase` and carried per sample with the
 *     raw page clock (`pageNowMs`) beside it, so the applied-vs-baked comparison shares one origin.
 *     Sampling starts at the station shell (the dialogue can fire at any point after it) and stops
 *     END_MARGIN past the baked duration; samples read before the marker appeared carry a negative
 *     tMs rather than a fallback clock, keeping the whole series in one timebase.
 *   - viseme-runtime-wire.ts: NamedVisemeDriveResult now records `progress` and `nowMs` (the drive's
 *     own clock), so an evidence consumer can align a morph reading to the drive's position — the
 *     rAF-lag alignment ambiguity that made the plateau look ~3x earlier than it began.
 *
 * REGENERATED live after the fix: 11 samples spanning tMs −1737 → 5376 ms (pre-speech through end +
 * margin); applied transitions at −1737 (pre-speech), 2346 (E, frame 17 → 21 → 23 → 23), 4229 (E →
 * sil); appliedLastChange 4229 ms against bakedLast 3670 ms (within one 144 ms sample interval).
 * The mouth keeps moving to the end of the utterance.
 */

const REPO = join(import.meta.dirname, "../../..");
const APPLIED = join(REPO, "tools/openclinxr/evidence/viseme-runtime-application.json");
const CUES_SRC = join(REPO, ".openclinxr/evidence/issue-288/cases/ed_stroke_alert_handoff_v1/stage-lip-sync/utterance-6539634edf.mouth-cues.json");
const CUES_SERVED = join(REPO, "apps/ui-xr/public/lip-sync-cues/utterance-6539634edf.mouth-cues.json");
const WIRE = join(REPO, "apps/ui-xr/src/viseme-runtime-wire.ts");

/** #722's pins, held across every copy that exists. */
const CUE_COUNT = 25;
const DISTINCT_VALUES = 8;

type Sample = { tMs: number; pageNowMs?: number; readings: { viseme: string }[] };
type Applied = {
  tTimebase?: { kind?: string; tMsFormula?: string; note?: string };
  baked?: { speechStartedAtMs?: number; durationMs?: number } | null;
  samples?: Sample[];
};
type Cue = { start: number; end: number; value: string };

function applied(): Applied {
  expect(existsSync(APPLIED), `${APPLIED} must exist — #722 landed it`).toBe(true);
  return JSON.parse(readFileSync(APPLIED, "utf8")) as Applied;
}

function cueDocs(): Cue[][] {
  return [CUES_SRC, CUES_SERVED]
    .filter((p) => existsSync(p))
    .map((p) => (JSON.parse(readFileSync(p, "utf8")) as { mouthCues?: Cue[] }).mouthCues ?? []);
}

/** Last moment the value differs from the one before it. Derived, never chosen. */
function lastChangeMs(cues: Cue[]): number {
  let last = 0;
  cues.forEach((c, i) => {
    if (i === 0 || c.value !== cues[i - 1]!.value) last = Math.round(c.start * 1000);
  });
  return last;
}

function appliedLastChangeMs(samples: Sample[]): number {
  const ordered = [...samples].sort((a, b) => a.tMs - b.tMs);
  let last = 0;
  let prev: string | null = null;
  for (const s of ordered) {
    const key = [...new Set(s.readings.map((r) => r.viseme))].sort().join("|");
    if (key !== prev) { last = s.tMs; prev = key; }
  }
  return last;
}

function sampleIntervalMs(samples: Sample[]): number {
  const t = [...samples].map((s) => s.tMs).sort((a, b) => a - b);
  return t.length >= 2 ? Math.max(1, t[1]! - t[0]!) : 1;
}

describe("the mouth keeps moving to the end of the utterance (#723)", () => {
  it("(1) applied visemes keep changing until the baked timeline stops changing", () => {
    const samples = applied().samples ?? [];
    expect(samples.length, "no samples recorded").toBeGreaterThan(0);
    const docs = cueDocs();
    expect(docs.length, "no cue file available to derive the bound from").toBeGreaterThan(0);
    const bakedLast = Math.max(...docs.map(lastChangeMs));
    const appliedLast = appliedLastChangeMs(samples);
    expect(
      appliedLast,
      `the baked timeline last changes at ${bakedLast} ms; the applied viseme last changed at `
        + `${appliedLast} ms. The bound is the input's own last-change time minus one sample `
        + `interval — no threshold is chosen here.`,
    ).toBeGreaterThanOrEqual(bakedLast - sampleIntervalMs(samples));
  });

  /**
   * NOT a counterweight — it reds on the planting tree, so it is a second requirement. Samples end at
   * 3480 ms against a baked last change of 3670 ms, so the evidence run does not even reach the point
   * where the defect would show. A fix must make the mouth keep moving AND sample far enough to prove
   * it; once green, this clause also stops a later run from truncating the window to fake clause (1).
   */
  it("(2) the sample series spans the utterance", () => {
    const samples = applied().samples ?? [];
    expect(samples.length, "no samples recorded").toBeGreaterThan(0);
    const docs = cueDocs();
    expect(docs.length, "no cue file available").toBeGreaterThan(0);
    const bakedLast = Math.max(...docs.map(lastChangeMs));
    const lastSample = Math.max(...samples.map((s) => s.tMs));
    expect(
      lastSample,
      "truncating the sample window is the cheapest way to make 'last change' land near the end of "
        + `the series. Samples must reach the baked timeline's last change at ${bakedLast} ms.`,
    ).toBeGreaterThanOrEqual(bakedLast - sampleIntervalMs(samples));
  });

  it("(3) COUNTERWEIGHT: the baked cues are not regenerated, in any copy", () => {
    const docs = cueDocs();
    if (docs.length === 0) return;
    for (const cues of docs) {
      expect(cues.length, "a fix that rewrites its own input measures itself").toBe(CUE_COUNT);
      expect(new Set(cues.map((c) => c.value)).size, "distinct baked viseme values").toBe(DISTINCT_VALUES);
    }
  });

  it("(4) COUNTERWEIGHT: the landed applier is still the path", () => {
    expect(
      /\bapplyVisemeWeights\s*\(/u.test(readFileSync(WIRE, "utf8")),
      "a direct morphTargetInfluences write is the #62 defect returning, and it would satisfy "
        + "clause (1) while bypassing everything #722 landed",
    ).toBe(true);
  });

  /**
   * #723 clock check: the artifact must declare what tMs is measured from, and every sample must
   * derive from that origin. Without it, clause (1)'s last-change comparison is meaningless — a
   * green on a clock mismatch (e.g. page-relative tMs against utterance-local baked cue times)
   * is worse than the red it replaced.
   */
  it("(5) the artifact declares its tMs origin and every sample derives from it", () => {
    const report = applied();
    expect(
      report.tTimebase?.kind,
      "tMs origin must be declared — a reader must not have to guess which clock the timeline is on",
    ).toBe("utterance_local_page_clock");
    const samples = report.samples ?? [];
    expect(samples.length, "no samples recorded").toBeGreaterThan(0);
    const startedAtMs = report.baked?.speechStartedAtMs;
    for (const s of samples) {
      expect(typeof s.pageNowMs, "every sample must carry the raw page clock").toBe("number");
      if (typeof startedAtMs === "number" && typeof s.pageNowMs === "number") {
        expect(
          s.tMs,
          "tMs must be derived from the declared origin (pageNowMs - speechStartedAtMs), not a "
            + "nominal schedule index — a fallback clock makes the baked-vs-applied comparison "
            + "vacuous",
        ).toBe(Math.round(s.pageNowMs - startedAtMs));
      }
    }
  });
});

// NOT TESTED: whether the mouth LOOKS right at any point, which no pixel grade has examined on this
// build. Nor whether other utterances or actors show the same plateau — one utterance on one actor
// is the whole sample. The plateau mechanism itself is measured and is a sampler clock artifact
// (see the FIXED block): the drive follows the bake, and the applied viseme keeps changing to the
// utterance end.
