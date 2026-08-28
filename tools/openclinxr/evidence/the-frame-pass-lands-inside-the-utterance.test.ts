import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #729 / xr-systems-architect.
 *
 * ## THE DEFECT, MEASURED 2026-08-27 at main `2f07ba8b` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * The viseme capture's frame pass intends a 250 ms step and costs ten times that, so the eight
 * frames it takes for the orchestrator's pixel grade land mostly after the utterance has ended.
 *
 * `ui-xr-viseme-drive-capture.ts:923-924` authors `FRAME_STEP_MS = 250` and `FRAME_COUNT = 8`, an
 * intended span of 7 x 250 = 1750 ms. Measured from `inspection.json` of a live run:
 *
 *   frame 00  t=57.349 s     —
 *   frame 01  t=59.559 s   dt=2210 ms
 *   frame 02  t=61.959 s   dt=2400 ms
 *   frame 03  t=64.421 s   dt=2462 ms
 *   frame 04  t=66.631 s   dt=2210 ms
 *   frame 05  t=69.119 s   dt=2488 ms
 *   frame 06  t=71.615 s   dt=2496 ms
 *   frame 07  t=74.288 s   dt=2673 ms
 *
 * Span 57.349 -> 74.288 = **16.9 s** against a ~3.7 s utterance (#723). Six of the eight land after
 * speech ends, which is why so many frames read `viseme_sil`.
 *
 * The cost is inside `sampleStates` (`:836-871`), which runs a full `reframeCameraOnParentFace` —
 * a scene walk, a projection and a raycast — on every iteration before reading the influences. The
 * screenshot is not the expensive part.
 *
 * ## MY OWN WITHDRAWN DIAGNOSIS — do not act on it
 *
 * I first filed this as "frames and labels come from different passes". FALSE. The frame pass calls
 * `sampleStates(framePath)` and then `page.screenshot(...)` in the same loop iteration
 * (`:903-921`). The harness note I leaned on says the DENSE pass is screenshot-free; it does not say
 * labels come from elsewhere. What survives is narrower: within one iteration the influences are
 * read one reframe round trip before the pixels.
 *
 * ## THE BOUND IS THE UTTERANCE, NOT A NUMBER I CHOSE
 *
 * Clause (2) compares the measured span against the recorded utterance duration. Both come from the
 * run. No factor, tolerance or budget of mine appears anywhere in this file, and clause (5) checks
 * the authored intent is achievable against that duration before clause (2) is allowed to mean
 * anything.
 *
 * claimScope: whether the frames this capture takes fall inside the utterance they claim to sample.
 * notEvidenceFor: whether a viseme is legible; whether the label matches the pixels within one
 *   iteration; the dense states pass, which #723 already measured at ~380 ms and is a separate card.
 */

const REPORT = "tools/openclinxr/evidence/frame-pass-timing.json";
const HARNESS = "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts";

/** Read the authored constants from the harness rather than restating them here. */
function authored(name: string): number {
  const src = readFileSync(HARNESS, "utf8");
  const m = new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(src);
  if (!m) throw new Error(`${name} not found in ${HARNESS}`);
  return Number(m[1]);
}

type Frame = { framePath: string; tMs: number; bytes: number };
type Report = {
  utteranceDurationMs: number;
  frames: Frame[];
};

function report(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function spanMs(r: Report): number {
  const ts = r.frames.map((f) => f.tMs);
  return Math.max(...ts) - Math.min(...ts);
}

describe("the frame pass lands inside the utterance (#729)", () => {
  /**
   * RED. Nothing records the frame pass's own timing today; `inspection.json` carries the numbers
   * but is gitignored, so no contract can read it. This requires a TRACKED artifact carrying one
   * row per frame and the utterance duration those frames claim to sample.
   */
  it.fails("(1) the capture records its frame timings and the utterance they sample", () => {
    const r = report();
    expect(r, `${REPORT} must exist — tracked, not the gitignored inspection.json`).not.toBeNull();
    expect(
      r!.frames.length,
      `one row per captured frame; the harness authors FRAME_COUNT = ${authored("FRAME_COUNT")}`,
    ).toBeGreaterThanOrEqual(authored("FRAME_COUNT"));
    expect(
      typeof r!.utteranceDurationMs === "number" && r!.utteranceDurationMs > 0,
      "the duration the frames claim to sample, read from the live speech state",
    ).toBe(true);
  });

  /**
   * RED, and the bound is the run's own utterance duration. Measured 16.9 s against ~3.7 s today.
   */
  it.fails("(2) the frames span no more than the utterance they sample", () => {
    const r = report();
    expect(r, `${REPORT} must exist`).not.toBeNull();
    expect(
      spanMs(r!),
      "frames taken after the utterance ends sample silence, not speech; the cost is the per-frame "
        + "reframe in sampleStates, not the screenshot",
    ).toBeLessThanOrEqual(r!.utteranceDurationMs);
  });

  /**
   * COUNTERWEIGHT. Taking fewer frames is the cheapest way to shrink the span and it removes the
   * evidence the pass exists to produce. The floor is the harness's own authored constant, so a
   * deliberate change to FRAME_COUNT moves this with it rather than being pinned by me.
   */
  it("(3) COUNTERWEIGHT: the authored frame count is not reduced", () => {
    expect(
      authored("FRAME_COUNT"),
      "eight frames were authored for the orchestrator's pixel grade; fewer frames is a smaller "
        + "span bought by less evidence",
    ).toBeGreaterThanOrEqual(8);
  });

  /**
   * COUNTERWEIGHT. Skipping the screenshot is the other way to make the span fit. The recorded byte
   * size is written at capture time, so this does not read the gitignored PNG directory.
   */
  it("(4) COUNTERWEIGHT: every recorded frame carries a non-empty screenshot", () => {
    const r = report();
    if (r === null) return; // clause (1) owns the artifact's existence
    for (const f of r.frames) {
      expect(f.bytes, `${f.framePath} recorded ${f.bytes} bytes`).toBeGreaterThan(0);
    }
  });

  /**
   * KNOWN-GOOD, and it is the precondition check that stops clause (2) asking the impossible: the
   * authored intent must fit inside the utterance. 7 x 250 = 1750 ms against a ~3.7 s utterance, so
   * the harness's own design already satisfies the bound and only its runtime cost does not.
   */
  it("(5) KNOWN-GOOD: the authored step and count already fit the utterance", () => {
    const r = report();
    if (r === null) return; // clause (1) owns the artifact's existence
    const intendedSpan = (authored("FRAME_COUNT") - 1) * authored("FRAME_STEP_MS");
    expect(
      intendedSpan,
      "if the authored intent did not fit, clause (2) would be unsatisfiable without changing the "
        + "constants, and this card would be about the constants instead",
    ).toBeLessThanOrEqual(r.utteranceDurationMs);
  });
});

// NOT TESTED: whether hoisting the reframe out of the per-frame path lets the camera drift — that is
// a pixel grade and is the orchestrator's. Whether the residual one-round-trip gap between reading
// the influences and taking the screenshot matters; this file bounds the span, not the ordering
// inside an iteration. The dense states pass is untouched here and remains #723's subject.
