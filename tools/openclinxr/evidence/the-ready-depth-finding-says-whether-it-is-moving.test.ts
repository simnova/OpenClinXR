import { describe, expect, it } from "vitest";
import { readyDepthTrend } from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: `ready-depth-below-floor` has been reported CHRONIC for 24 consecutive audits and
 * the record cannot say whether anything is moving.
 *
 * MEASURED — a history row is exactly this, and nothing more (`supervisor-audit.ts:288`):
 *
 *   {"at":"2026-08-25T21:32:50.808Z","head":"b3916e4c…","keys":["ready-depth-below-floor"]}
 *
 * Finding KEYS only. No card membership. So a queue that burns two cards and refills two, and a
 * queue frozen at the same five cards for a day, produce IDENTICAL history. Duty 1's whole question
 * is "is this self-correcting?" and for its longest-running finding the instrument cannot answer.
 *
 * The supervisor skill already concedes this in prose — treat readyDepth as telemetry "until the
 * gauge can tell refill from burn (#654)" — which is a documented blind spot, not a fix. Twenty-four
 * windows of an uninterpretable number is what that concession costs.
 *
 * Reported once, verbatim, by the peer review: "Calling 6→5 throughput counts work started while
 * ignoring replenishment and completion. On present evidence, the product queue is net thinning."
 * That was an INFERENCE from two data points, and it could not be checked, because the data to check
 * it was never written down.
 *
 * claimScope: whether the ready-card set is stagnant, churning, or draining across recorded windows.
 * notEvidenceFor: whether the floor of 10 is the right floor; whether any card is good work; whether
 *   a dequeue is imminent. This says only whether the SET is moving.
 */

describe("the ready-depth finding says whether it is moving", () => {
  it("(1) RED: reports STAGNANT when the same cards persist across every window", () => {
    const t = readyDepthTrend([
      { at: "1", cards: [181, 510, 577, 588, 597] },
      { at: "2", cards: [181, 510, 577, 588, 597] },
      { at: "3", cards: [181, 510, 577, 588, 597] },
    ]);
    expect(t.status).toBe("stagnant");
    expect(t.entered, "nothing entered the queue").toEqual([]);
    expect(t.left, "nothing left it either").toEqual([]);
  });

  it("(2) reports CHURNING when cards leave AND arrive — work is flowing", () => {
    const t = readyDepthTrend([
      { at: "1", cards: [1, 2, 3] },
      { at: "2", cards: [2, 3, 4] },
      { at: "3", cards: [3, 4, 5] },
    ]);
    expect(t.status).toBe("churning");
    expect(t.entered.sort()).toEqual([4, 5]);
    expect(t.left.sort()).toEqual([1, 2]);
  });

  it("(3) reports DRAINING when cards only leave — the case the peer inferred and could not check", () => {
    const t = readyDepthTrend([
      { at: "1", cards: [1, 2, 3, 4, 5, 6] },
      { at: "2", cards: [1, 2, 3, 4, 5] },
      { at: "3", cards: [1, 2, 3, 4] },
    ]);
    expect(t.status).toBe("draining");
    expect(t.entered).toEqual([]);
    expect(t.left.sort()).toEqual([5, 6]);
  });

  it("(4) COUNTERWEIGHT: refuses to judge when the history predates card recording", () => {
    // Every row written before this change has no `cards`. Treating a missing field as an empty
    // queue would report DRAINING across the entire backfill and bury the real signal under a
    // fabricated one — the report-clean-about-what-you-never-read defect, inverted.
    const t = readyDepthTrend([
      { at: "1" },
      { at: "2", cards: [1, 2] },
    ]);
    expect(t.status, "a window with no recorded membership is unknown, not empty").toBe("unknown");
  });

  it("(5) COUNTERWEIGHT: one window is not a trend", () => {
    expect(readyDepthTrend([{ at: "1", cards: [1, 2, 3] }]).status).toBe("unknown");
    expect(readyDepthTrend([]).status).toBe("unknown");
  });
});
