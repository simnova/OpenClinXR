import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertWorkerReported } from "../openclaw/integrate.js";

/**
 * #448's worker-comment gate does not test what its name says, and it is BLOCKING A LAND.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 *   integrate.ts:383  const WORKER_REPORT_MARKERS = /(UNABLE:|Factory:|cannot pass)/i;
 *   integrate.ts:425  workerSpoke = comments.some(c =>
 *                       (c.author.login !== orchestratorLogin) || MARKERS.test(c.body));
 *
 * Every comment on every card this session, with `gh api user -q .login` = `gidich`:
 *
 *   card   author   marker   body
 *   -----|--------|--------|------------------------------------------------------
 *   #480 | gidich | **YES** | "Factory: Landed"
 *   #480 | gidich |  no    | the orchestrator's close comment
 *   #481 | gidich | **YES** | "Factory: Landed — commit b856c917"
 *   #482 | gidich | **YES** | "Factory: Dispatched / clause (1) could not pass as written"
 *   #483 | gidich |  no    | **the worker's full IN-SCOPE / OUT-OF-SCOPE / CLAIM / NOT TESTED report**
 *
 * TWO defects, and they compound:
 *
 * 1. **The author branch is dead code.** The worker and the orchestrator authenticate with the SAME
 *    `gh` token, so `c.author.login !== orchestratorLogin` is false for every comment that will ever
 *    exist under this topology. The gate rests entirely on the regex.
 *
 * 2. **All three markers are failure or board-stage words.** A worker whose slice went cleanly has
 *    nothing to write that the regex recognises. #480, #481 and #482 satisfied the gate on
 *    `Factory:` — which is the BOARD FIELD marker written when a card changes stage, not a report.
 *
 * So the gate answers *"does any comment contain a failure keyword or a board-stage marker?"* It
 * does not answer *"did the worker report?"*, and the two diverge in exactly the case that matters:
 * a clean slice with an honest report. #483's worker wrote the most complete report of the four —
 * including an explicit proof audit, *"none could not pass as written, passed trivially, or rested
 * on a false premise"* — and is the only one refused.
 *
 * **This is the gate being wrong, not the worker.** The land is blocked, `--force` is refused and
 * correct, and re-posting the report with the word "cannot pass" in it would satisfy the gate by
 * teaching workers to write failure words when nothing failed. None of those is the fix.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) report | (2) marker | (3) not any | result
 *   ------------------------------------------------|------------|------------|-------------|--------
 *   a) today — failure/stage words only              |  **FAIL**  |    pass    |    pass     | REFUSED
 *   b) delete the gate / always return null          |    pass    |  **FAIL**  |  **FAIL**   | REFUSED
 *   c) accept ANY comment on the card                |    pass    |    pass    |  **FAIL**   | REFUSED
 *   d) also recognise report structure (CLAIM: etc.) |    pass    |    pass    |    pass     | ALL PASS
 *
 * **(c) is the one to watch.** "Any comment counts" is the one-line fix and it destroys the gate
 * entirely: the orchestrator comments on every card it closes, so every card would pass with the
 * worker still mute — which is precisely the #448 incident. Clause (3) requires a bare orchestrator
 * bookkeeping comment to STILL be refused.
 *
 * **(b) is worth naming too.** `Factory: Landed` must not go on satisfying this gate by itself. It
 * is written when a stage changes and says nothing about whether anyone reported.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (3b) are RED.** (3b) was written as a
 * counterweight and FAILED on the plant run — `Factory: Landed` matches the regex today — so it was
 * split out rather than left mislabelled. That mislabelling is the #227 defect itself, committed by
 * the author of this contract, and caught only because the plant was run before it was committed.
 * (2), (3) and (4) pass today: they exist so (1) and (3b) cannot be satisfied by deleting the gate,
 * by accepting any comment, or by returning "spoke" for an empty card.
 *
 * NOT TESTED:
 *   - Whether a separate worker identity (a bot token or GitHub App) SHOULD exist. That would make
 *     the author branch live and is the better long-term fix; it is a topology change, not a slice,
 *     and this contract deliberately does not assume it. Reported to the superagent separately.
 *   - Whether `Factory:` should be removed from the marker set ENTIRELY, or merely stop counting on
 *     its own. Clause (3b) requires the latter and says nothing about the former.
 *   - Any other merge-kill finding. This bounds `assertWorkerReported` only.
 *
 * ## FIXED (#484)
 *
 * The gate now recognises report structure, not only failure keywords:
 *
 *   integrate.ts  WORKER_REPORT_MARKERS = /(UNABLE:|cannot pass|Factory: Dispatched)/i;
 *                 WORKER_REPORT_SECTIONS = [/IN-SCOPE:/i, /OUT-OF-SCOPE:/i, /CLAIM:/i, /NOT TESTED:/i]
 *                 workerSpoke = author-branch || MARKERS || all four sections in one comment
 *
 * `Factory:` was narrowed to `Factory: Dispatched`. The board FIELD write "Factory: Landed" is no
 * longer a marker (clause 3b above), while the worker's own dispatch status line stays one — the
 * existing #448 suite (integrate.test.ts:315/334) lands on "Factory: Dispatched — work complete,
 * proofs green", so removing it entirely would break a green land path.
 *
 * DEVIATION from the candidate fix, named at discovery: "a comment carrying both CLAIM: and
 * NOT TESTED:" was probed FIRST and FAILS the existing suite. integrate.test.ts:287 (the
 * #441-#446 refusal) uses an orchestrator close comment "CLAIM: wired. NOT TESTED: nothing."
 * and requires it to be REFUSED — the orchestrator's own close comments can carry that pair. The
 * discriminator is therefore the FULL four-section skeleton (IN-SCOPE: + OUT-OF-SCOPE: + CLAIM: +
 * NOT TESTED:), which the worker's dispatch contract produces and bookkeeping does not.
 *
 * Matrix after the fix (planted contract + existing integrate.test.ts):
 *
 *   planted (1)  WORKER_REPORT (full skeleton)          -> spoke      (structure)
 *   planted (2)  WORKER_UNABLE                          -> spoke      (UNABLE: marker)
 *   planted (3)  orchestrator bookkeeping               -> refused
 *   planted (3b) "Factory: Landed" + bookkeeping        -> refused    ("Factory: Landed" not a marker)
 *   planted (4)  empty card                             -> refused
 *   itest :287   "CLAIM: wired. NOT TESTED: nothing."   -> refused    (two sections insufficient)
 *   itest :315   "Factory: Dispatched — work complete, proofs green" -> spoke (dispatch status line)
 *   itest :334   "Factory: Dispatched"                  -> spoke      (dispatch status line)
 *
 * NOT TESTED (unchanged, restated): whether `Factory:` leaves the marker set ENTIRELY (removing
 * it would break integrate.test.ts:315/334 as written); whether a separate worker identity should
 * exist. Both remain open.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** #483's worker report, trimmed. A clean slice: no failure word anywhere in it. */
const WORKER_REPORT =
  "IN-SCOPE: Added a floor in tools/openclinxr/evidence/head-focus-derivation.test.ts (new describe "
  + "at line 238)... OUT-OF-SCOPE: Corrected the stale premise in dispatch-binds-the-role-charter... "
  + "CLAIM: head-focus-derivation now asserts at least one subject carries fitted hair... "
  + "NOT TESTED: The other ~349 evidence tests for dormant conditionals.";

/** What the orchestrator writes on every card it closes. Must NOT satisfy a worker-report gate. */
const ORCHESTRATOR_BOOKKEEPING = "## Landed `c2219a75` — verified 3/3 and graded. Closing.";

/** The board-stage marker. Also not a report — it is written when a stage changes. */
const BOARD_STAGE = "Factory: Landed";

/** A genuine worker failure report. Must keep working — this is what #448 was built to surface. */
const WORKER_UNABLE = "UNABLE: the bake needs the anny package, which is absent in this worktree.";

const LOGIN = "gidich";

/** Drives the real `assertWorkerReported` with a scripted `gh`, so the gate itself is under test. */
function gateVerdict(comments: string[]): "spoke" | "never-spoke" {
  const runner = (argv: readonly string[]): string => {
    if (argv[1] === "api" && argv[2] === "user") return `${LOGIN}\n`;
    if (argv[1] === "issue" && argv[2] === "view") {
      return JSON.stringify(comments.map((body) => ({ author: { login: LOGIN }, body })));
    }
    throw new Error(`unscripted gh call: ${argv.join(" ")}`);
  };
  // slice "issue-483" resolves to card #483 without touching the network.
  const finding = assertWorkerReported(REPO_ROOT, "issue-483", runner);
  return finding === null ? "spoke" : "never-spoke";
}

describe("the worker-comment gate recognises a report, not a failure keyword", () => {
  it("(1) RED→FIXED: a clean worker report satisfies the gate", () => {
    // Measured on #483: this exact report is refused today, because a clean slice contains no
    // UNABLE:, no "cannot pass" and no "Factory:".
    expect(
      gateVerdict([WORKER_REPORT]),
      "a worker that reported IN-SCOPE / OUT-OF-SCOPE / CLAIM / NOT TESTED has spoken",
    ).toBe("spoke");
  });

  it("(2) NET: a genuine UNABLE: report still satisfies the gate", () => {
    // Refuses (b). #448 exists to surface UNABLE: and unpassable-proof reports; widening the gate
    // must not cost the thing it was built for.
    expect(gateVerdict([WORKER_UNABLE]), "UNABLE: must keep counting as the worker speaking").toBe("spoke");
  });

  it("(3) COUNTERWEIGHT: orchestrator bookkeeping alone is still refused", () => {
    // Refuses (c). "any comment counts" is the one-line fix and it destroys the gate: the
    // orchestrator comments on every card it closes, so every card would pass with the worker mute.
    // That is the #448 incident exactly. PASSES TODAY — a true net.
    expect(
      gateVerdict([ORCHESTRATOR_BOOKKEEPING]),
      "a close comment written by the orchestrator is not a worker report",
    ).toBe("never-spoke");
  });

  it("(3b) RED→FIXED: a board-stage marker alone does not count as a worker report", () => {
    // SPLIT OUT OF (3) AFTER THE PLANT RUN, and the split is the #227 lesson landing on me: I wrote
    // this as a counterweight and it FAILED, because `Factory: Landed` matches the marker regex
    // today. It is a second RED, not a net, and mislabelling it would have hidden a real defect
    // inside a clause that reads as already-satisfied.
    //
    // This is how #480, #481 and #482 passed the gate: a board field changing stage, standing in
    // for a report nobody wrote.
    expect(
      gateVerdict([BOARD_STAGE, ORCHESTRATOR_BOOKKEEPING]),
      "`Factory: Landed` is written when a card changes stage — it says nothing about whether the "
        + "worker reported, and must not satisfy a worker-report gate on its own",
    ).toBe("never-spoke");
  });

  it("(4) VACUITY GUARD: the gate can still refuse an empty card", () => {
    // Reads the gate, passes today. If a widened gate returned "spoke" for zero comments, clauses
    // (1)-(3) would be measuring nothing.
    expect(gateVerdict([]), "a card with no comments at all must be refused").toBe("never-spoke");
  });
});
