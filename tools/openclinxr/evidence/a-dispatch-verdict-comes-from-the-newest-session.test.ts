/**
 * #722 — dispatchProofVerdict walks back to an OLDER session and reports its verdict.
 *
 * THE DEFECT, MEASURED 2026-08-27 — do not re-derive this. It is mine, introduced the previous
 * iteration in the fix that made the audit read the dispatch record at all.
 *
 *   supervisor-audit.ts scans worker-sessions.jsonl backwards and does
 *   `if (typeof row.proofsOk !== "boolean") continue;`. A `spawned` row and a `died` row both lack
 *   proofsOk, so the newest session is SKIPPED and an earlier session's verdict is returned.
 *
 *   Live on issue-638, whose five rows are:
 *
 *     0  spawned    proofsOk ABSENT  08-24T18:23
 *     1  completed  proofsOk ABSENT  08-24T18:33
 *     2  completed  proofsOk true    08-24T18:33
 *     3  spawned    proofsOk ABSENT  08-24T20:05   <- newest session
 *     4  died       proofsOk ABSENT  08-24T20:06   <- newest session, DIED
 *
 *   describeDispatchProofs("...", 638) returns ", and the dispatch record says proofs passed" —
 *   sourced from row 2, a DIFFERENT session that ended ninety minutes earlier. The card's latest
 *   attempt died and the audit reports a pass.
 *
 * WHY IT MATTERS. The whole point of reading the ledger was to stop the `why` line asserting
 * something it had not checked. A verdict from a superseded session is the same defect wearing the
 * evidence's clothes: it is read, and it is still wrong.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#722)` block below.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describeDispatchProofs } from "../openclaw/supervisor-audit.js";

const REPO = resolve(import.meta.dirname, "../../..");
const LEDGER = resolve(REPO, ".openclinxr/openclaw/worker-sessions.jsonl");

/** The real card whose newest session died while an earlier one passed. Not a stand-in. */
const DIED_NEWEST = 638;

function rowsFor(issue: number): Array<{ phase?: string; proofsOk?: boolean }> {
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter((line) => line.includes(`"slice":"issue-${issue}"`))
    .map((line) => {
      try {
        return JSON.parse(line) as { phase?: string; proofsOk?: boolean };
      } catch {
        return {};
      }
    });
}

describe("#722 a dispatch verdict comes from the NEWEST session, not an older one", () => {
  it("(1) a card whose newest session died is not reported as passing", () => {
    const text = describeDispatchProofs(REPO, DIED_NEWEST);
    // The newest session died. Reporting a pass is the defect; any of died / in flight / unknown
    // would be honest.
    expect(text).not.toContain("proofs passed");
  });

  it("(2) the known-good column: the ledger still exhibits the shape this asserts about", () => {
    // If issue-638 is re-dispatched to a terminal proofs-bearing row, clause (1) stops asserting
    // about anything and the fixture must move. Fail loudly rather than pass vacuously.
    const rows = rowsFor(DIED_NEWEST);
    expect(rows.length, "issue-638 ledger rows").toBeGreaterThanOrEqual(5);
    expect(rows.at(-1)?.phase, "newest row phase").toBe("died");
    expect(typeof rows.at(-1)?.proofsOk, "newest row carries no verdict").not.toBe("boolean");
    expect(rows.some((r) => r.proofsOk === true), "an older row DID pass").toBe(true);
  });

  it("(3) COUNTERWEIGHT: a genuine newest-session verdict is still reported", () => {
    // The cheapest way to clear clause (1) is to stop reading the ledger at all. issue-714's newest
    // row carries proofsOk:false and must still come back as a failure.
    const text = describeDispatchProofs(REPO, 714);
    expect(text).toContain("FAILED");
  });

  it("(4) COUNTERWEIGHT: an unknown card still says UNKNOWN rather than inventing a verdict", () => {
    expect(describeDispatchProofs(REPO, 999_999)).toContain("UNKNOWN");
  });
});

/**
 * ## FIXED (#722)
 *
 * dispatchProofVerdict now binds to the newest SESSION id on its first matching row and stops at
 * the session boundary. If that session carries no verdict it returns its phase, and
 * describeDispatchProofs renders DIED or IN FLIGHT rather than reaching past it.
 *
 * Measured after the fix:
 *   #638  the newest dispatch session is DIED — it carries no proof verdict
 *   #714  the dispatch record says proofs FAILED (live, changed)
 *   #999999  no dispatch record — verification state UNKNOWN
 */
