import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #723 residual / xr-systems-architect.
 *
 * ## THE DEFECT, MEASURED 2026-08-28 at main `0a982e8e` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * The frame pass reads the morph influences, then takes the screenshot. The label a frame carries
 * therefore describes the face one round trip BEFORE the pixels it is attached to.
 * `ui-xr-viseme-drive-capture.ts:942-954`, verbatim:
 *
 *     const { t, dominant } = await sampleStates(framePath);
 *     const tMs = Date.now() - t0FramePass;
 *     await page.screenshot({ path: framePath, fullPage: false });
 *     framePass.push({ t, tMs, framePath, targetName: dominant, bytes: … });
 *
 * `sampleStates` (`:836-871`) runs a full `reframeCameraOnParentFace` — a scene walk, a projection
 * and a raycast — and then reads the influences, so the gap is that round trip plus the screenshot
 * call. Post-#729 those cost roughly 10-30 ms and 85-100 ms respectively on the GPU path.
 *
 * ## WHY THIS IS THE LAST OPEN QUESTION ON THE CHAIN
 *
 * #729 put the frames inside the utterance; #732 made silence close the mouth; #738 and #739 moved
 * the teeth behind the face. What remains unresolved from #723 is a single graded observation: a
 * frame labelled `viseme_sil` at 542 ms showed an open mouth. The dense pass nearest that instant
 * showed `mouth-open` at 0.30 with a viseme at full weight, not silence — but the dense pass and the
 * frame pass are different sample sets, so that is not evidence about the frame. Nothing in the tree
 * can currently say whether a frame's label matches its own pixels.
 *
 * ## WHAT THIS CONTRACT ASKS FOR, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It asks the artifact to record the state on BOTH sides of the screenshot and the elapsed gap
 * between them. It does NOT require the two to agree: at a 250 ms cadence against cues that change
 * every 40-500 ms, some disagreement may be unavoidable, and demanding zero would buy a threshold
 * nobody has measured. Recording is the requirement; the orchestrator grades the number.
 *
 * claimScope: whether the capture records the morph state at its own screenshot instant.
 * notEvidenceFor: whether any label is correct; whether the mouth is legible; the dense states pass,
 *   which #723 still owns.
 */

const REPORT = "tools/openclinxr/evidence/frame-pass-timing.json";
const HARNESS = "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts";

/** Read an authored constant from the harness rather than restating it. */
function authored(name: string): number {
  const m = new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(readFileSync(HARNESS, "utf8"));
  if (!m) throw new Error(`${name} not found in ${HARNESS}`);
  return Number(m[1]);
}

type Frame = {
  framePath: string;
  tMs: number;
  bytes: number;
  /** dominant read BEFORE the screenshot — what the capture records today */
  targetName?: string;
  /** dominant read AFTER the screenshot */
  targetNameAfterShot?: string;
  /** elapsed ms from the pre-shot read to the post-shot read */
  labelToPixelGapMs?: number;
  /** whether the two reads agree */
  labelStableAcrossShot?: boolean;
};

type Report = { utteranceDurationMs: number; frames: Frame[] };

function report(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("a frame label is read at its own screenshot (#723 residual)", () => {
  /**
   * RED. Today each row carries `targetName` read before the shot and nothing after it, so no
   * consumer can tell whether the label describes the pixels. Requiring both sides plus the gap is
   * the smallest change that makes the question answerable.
   */
  it.fails("(1) every frame records the state on both sides of its screenshot", () => {
    const r = report();
    expect(r, `${REPORT} must exist`).not.toBeNull();
    expect(r!.frames.length, "one row per captured frame").toBeGreaterThan(0);
    for (const f of r!.frames) {
      expect(
        typeof f.targetNameAfterShot,
        `${f.framePath}: the dominant read AFTER page.screenshot, so the label can be compared to `
          + "the pixels it is attached to",
      ).toBe("string");
      expect(
        typeof f.labelToPixelGapMs,
        `${f.framePath}: elapsed ms between the pre-shot read and the post-shot read`,
      ).toBe("number");
      expect(
        typeof f.labelStableAcrossShot,
        `${f.framePath}: whether the two reads agree — recorded, not required to be true`,
      ).toBe("boolean");
    }
  });

  /**
   * COUNTERWEIGHT. Recording a post-shot read is trivially satisfiable by reading it in the same
   * breath as the pre-shot one and calling the gap zero. The gap must be a real elapsed measurement,
   * so it must be positive on every frame — a screenshot cannot take no time.
   */
  it("(2) COUNTERWEIGHT: the recorded gap is a real elapsed time", () => {
    const r = report();
    if (r === null) return; // clause (1) owns the artifact's shape
    for (const f of r.frames) {
      if (typeof f.labelToPixelGapMs !== "number") continue;
      expect(
        f.labelToPixelGapMs,
        `${f.framePath}: a screenshot takes ~85-100 ms on the GPU path (#729); a zero gap means the `
          + "second read did not straddle it",
      ).toBeGreaterThan(0);
    }
  });

  /**
   * COUNTERWEIGHT. Dropping the screenshot, or the frames, makes the label question moot by removing
   * the pixels. Both floors are the harness's own authored constants.
   */
  it("(3) COUNTERWEIGHT: the frames and their screenshots survive", () => {
    const r = report();
    if (r === null) return;
    expect(r.frames.length, `FRAME_COUNT is ${authored("FRAME_COUNT")}`).toBeGreaterThanOrEqual(authored("FRAME_COUNT"));
    for (const f of r.frames) expect(f.bytes, `${f.framePath} must carry a non-empty PNG`).toBeGreaterThan(0);
  });

  /**
   * KNOWN-GOOD. #729's property must survive: the frames still land inside the utterance. If this
   * fails, a change made for this card has undone that one, and clause (1) is not the story.
   */
  it("(4) KNOWN-GOOD: the frames still span no more than the utterance (#729)", () => {
    const r = report();
    if (r === null) return;
    const ts = r.frames.map((f) => f.tMs);
    expect(
      Math.max(...ts) - Math.min(...ts),
      "#729 landed this at 1745 ms against a 2940 ms utterance",
    ).toBeLessThanOrEqual(r.utteranceDurationMs);
  });
});

// NOT TESTED: whether any label is CORRECT — this records the comparison, it does not adjudicate it.
// What an acceptable disagreement rate is; demanding zero would invent a threshold nobody has
// measured, and the orchestrator grades the recorded number instead. The dense states pass, which
// #723 still owns and which this file does not touch. Whether reading the influences twice per frame
// changes the frame cadence enough to breach clause (4) — that is why clause (4) is here.
