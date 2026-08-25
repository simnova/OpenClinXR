import { describe, expect, it } from "vitest";
import { attributeIsolationLeak } from "../openclaw/dispatch-worker.js";

/**
 * OBSERVABLE: dirt a concurrent COMMIT explains is not attributed to the worker.
 *
 * MEASURED 2026-08-25, do not re-derive. Two dispatches have been failed by this detector for writes
 * their workers did not make (#344 and this session's #665).
 *
 * #665's instance: the guard named `.openclinxr/evidence/issue-297/landmark-comparison.json`. The
 * change was one field —
 *   -  "generatedAt": "2026-08-11T04:08:44.165Z",
 *   +  "generatedAt": "2026-08-25T14:42:13.936Z",
 * and a peer lane committed `5fae7afd fix(#297): landmark instrument refuses a disconnected surface`
 * at exactly 10:42 local, touching that instrument. The worker's slice was a physician body bake and
 * never went near issue-297. The dispatch windows simply overlapped.
 *
 * THE GAP IS NAMED IN THE FUNCTION'S OWN DOCSTRING (dispatch-worker.ts:930-939). It records INCIDENT
 * #48/#41 — treating ANY new dirt as a leak aborted correct work — and the mechanism chosen in
 * response: caller-declared `orchestratorPaths`. So the design admits exactly TWO writers, the worker
 * and the orchestrator, and the orchestrator declares its own paths. A PEER AGENT LANE is neither, so
 * its write falls through to "real deny escape" by elimination.
 *
 * MEASURED TODAY: `orchestratorPaths` is set at the single call site from `options.orchestratorPaths`,
 * and no dispatch caller anywhere sets that option — grep finds it only in dispatch-worker.test.ts.
 * In production the filter is therefore empty and ALL new main dirt is attributed to the worker.
 *
 * FAILED TREATMENT, refused by clause (2): trusting all main dirt, or widening the filter to anything
 * dirty. The docstring rejects this explicitly and is right to — "the detector is the only watcher for
 * computed-path escapes past the literal `--deny` matcher", and that matcher is already known not to be
 * a sandbox. An uncommitted escape must still be caught.
 *
 * FAILED TREATMENT, refused by clause (3): dropping `orchestratorPaths`. That is the #48/#41 fix and
 * removing it re-opens the incident this function was written for.
 *
 * WHY A COMMIT IS THE RIGHT EVIDENCE: it is positive proof that somebody else wrote the file, it is
 * cheap to obtain, and a worker that only writes files cannot forge one.
 *
 * KNOWN-GOOD COLUMN: clauses (2) and (3), which are the behaviour that exists today and must survive.
 *
 * NO SCALAR THRESHOLD APPEARS IN THIS CONTRACT. Every assertion is set membership.
 *
 * claimScope: which paths `attributeIsolationLeak` returns as a worker leak.
 * notEvidenceFor: whether the deny matcher is a sandbox (it is not); whether any real cross-worktree
 *   write has ever occurred; the detector's behaviour on a peer lane that writes WITHOUT committing,
 *   which this contract does not address and which remains misattributed.
 *
 * ## FIXED (#344)
 *
 * `attributeIsolationLeak` now takes `concurrentlyCommittedPaths` — paths touched by commits made
 * to the main checkout between the dispatch's spawn snapshot and its exit. A path in that set is
 * attributed to whoever made the commit, never to the worker: a worker only writes files and
 * cannot forge a commit. The evidence is gathered by `pathsTouchedByCommitsSince(repoRoot,
 * mainHeadBefore)` at the leak check inside `dispatch()`; the window is anchored at the same
 * instant as the `mainDirtyBefore` snapshot (`mainHeadSha` — `git rev-parse HEAD` at spawn), and
 * `--no-ff` integrate merges are read via their first-parent diff. Uncommitted peer-lane writes
 * are NOT covered — they remain misattributed (notEvidenceFor above). `orchestratorPaths`
 * survives as the #48/#41 fix (clause 3); no production dispatch caller sets it, but the
 * orchestrator cannot pre-declare mid-dispatch discoveries, so the declared set stays the
 * mechanism for uncommitted orchestrator work.
 *
 * Clause (1) flipped `it.fails` -> `it`.
 */

const WORKER_LEAK = "packages/openclinxr/asset-registry/src/leaked-by-worker.ts";
const PEER_COMMITTED = ".openclinxr/evidence/issue-297/landmark-comparison.json";
const ORCHESTRATOR = "tools/openclinxr/openclaw/board-session-map.ts";

describe("a peer lane's commit is not a worker leak", () => {
  it("(1) dirt explained by a commit made during the window is not a worker leak", () => {
    // The #665 shape: main was clean at spawn; a peer lane committed a change to PEER_COMMITTED while
    // the worker ran. The worker never touched it.
    const leaked = (attributeIsolationLeak as (input: {
      before: readonly string[];
      after: readonly string[];
      orchestratorPaths?: readonly string[];
      concurrentlyCommittedPaths?: readonly string[];
    }) => string[])({
      before: [],
      after: [PEER_COMMITTED],
      concurrentlyCommittedPaths: [PEER_COMMITTED],
    });
    expect(
      leaked,
      "a path touched by a commit made during the dispatch window was written by whoever made that "
        + "commit; attributing it to the worker fails a healthy dispatch, twice now (#344, #665)",
    ).toEqual([]);
  });

  it("(2) KNOWN-GOOD: an UNCOMMITTED escape is still attributed — the detector must not go blind", () => {
    // Refuses the over-correction of trusting all main dirt. The docstring: "Trusting ALL main dirt
    // would silence the detector; the detector is the only watcher for computed-path escapes past the
    // literal --deny matcher."
    const leaked = attributeIsolationLeak({ before: [], after: [WORKER_LEAK] });
    expect(leaked, "an unexplained new dirty path must still be reported").toEqual([WORKER_LEAK]);
  });

  it("(3) COUNTERWEIGHT: orchestratorPaths still filters — the #48/#41 fix does not regress", () => {
    // Refuses satisfying clause (1) by deleting the existing mechanism.
    const leaked = attributeIsolationLeak({
      before: [],
      after: [ORCHESTRATOR, WORKER_LEAK],
      orchestratorPaths: [ORCHESTRATOR],
    });
    expect(leaked, "declared orchestrator work must stay excluded, and real dirt stay reported")
      .toEqual([WORKER_LEAK]);
  });
});
