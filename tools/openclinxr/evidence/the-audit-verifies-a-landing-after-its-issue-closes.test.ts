import { describe, expect, it } from "vitest";
import { doneClaimRowsToVerify } from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: the supervisor audit's duty 3 — "review work that was said to be done and confirm it
 * was done as expected" — cannot see a landing whose issue has been closed.
 *
 * MEASURED on HEAD, `supervisor-audit-cli.ts:62-88`:
 *
 *   const issues = gh(["issue","list","--state","open", ...])     // OPEN ONLY
 *   const byNumber = new Map(issues.map(i => [i.number, i]))
 *   const doneClaims = items
 *     .filter(it => it.factory === "Landed" || it.factory === "Graded")
 *     .filter(it => byNumber.has(it.content.number))              // <- silently drops CLOSED
 *
 * So a board row marked Landed whose issue is CLOSED is dropped rather than verified. Closing is
 * the NORMAL successful end state, which means duty 3 verifies only work that is not yet finished
 * and is structurally blind to work that is.
 *
 * This is not hypothetical. Measured across two consecutive audits: `doneClaims` reported exactly
 * ONE entry (#646, Landed, open, awaiting its grade) and then ZERO the moment #646 was graded and
 * closed. The successful landing left the gauge entirely. Earlier, #665 landed and closed between
 * audits and duty 3 never saw it at all — a peer review caught it, not this instrument.
 *
 * The failure mode is the dangerous direction: an unverified or wrongly-verified landing is
 * INVISIBLE to duty 3 exactly when it is most finished and hardest to reverse.
 *
 * claimScope: which board rows duty 3 selects for verification.
 * notEvidenceFor: whether any landing is CORRECT — verifyDoneClaim does that, and a pixel grade is
 *   a separate plane again. This clause is about what gets looked at, not what is found.
 */

type Row = { factory: string; content?: { number?: number } };

const ROWS: Row[] = [
  { factory: "Landed", content: { number: 646 } }, // closed after grading
  { factory: "Landed", content: { number: 526 } }, // still open, in flight
  { factory: "Graded", content: { number: 665 } }, // closed
  { factory: "Planted", content: { number: 597 } }, // not a done-claim at all
  { factory: "Landed", content: {} }, // malformed row, no number
];
const OPEN = new Set([526, 597]);
const CLOSED = new Set([646, 665]);

describe("the audit verifies a landing after its issue closes", () => {
  it("(1) selects Landed/Graded rows whose issue has CLOSED", () => {
    const picked = doneClaimRowsToVerify(ROWS, OPEN, CLOSED).sort((a, b) => a - b);
    expect(picked, "a landing that closed is the normal successful end state and must still be verified")
      .toEqual([526, 646, 665]);
  });

  it("(2) COUNTERWEIGHT: does not widen to rows that are not done-claims", () => {
    const picked = doneClaimRowsToVerify(ROWS, OPEN, CLOSED);
    expect(picked, "Planted is not a done-claim — verifying it would make duty 3 meaningless").not.toContain(597);
  });

  it("(3) COUNTERWEIGHT: ignores a row the board knows nothing about", () => {
    // Neither open nor closed: the board row references an issue this audit never fetched. Verifying
    // it would spend a `gh` round-trip per phantom and report failures for issues that may not exist.
    const picked = doneClaimRowsToVerify(
      [{ factory: "Landed", content: { number: 99999 } }],
      OPEN,
      CLOSED,
    );
    expect(picked, "an unknown number is not evidence of a landing").toEqual([]);
  });

  it("(4) VACUITY GUARD: the old open-only rule genuinely fails this", () => {
    // What the CLI did before: keep only rows whose number is OPEN.
    const openOnly = ROWS
      .filter((r) => r.factory === "Landed" || r.factory === "Graded")
      .filter((r) => typeof r.content?.number === "number" && OPEN.has(r.content.number))
      .map((r) => r.content!.number!);
    expect(openOnly, "the old rule must NOT already satisfy clause (1), or this contract proves nothing")
      .toEqual([526]);
  });
});
