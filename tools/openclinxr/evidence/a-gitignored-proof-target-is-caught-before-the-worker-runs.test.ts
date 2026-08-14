import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The gitignored-proof-target check runs at MERGE time, after a worker has done all the work. It
 * cost ~89 worker-turns in one session, twice, for a defect detectable in milliseconds at brief time.**
 *
 * Measured 2026-08-14:
 *
 *   slice   turns   outcome
 *   ------  -----   ------------------------------------------------------------
 *   #392       38   completed, contract green, REFUSED at land, resume to force-add
 *   #367       51   completed, contract green, REFUSED at land, resume to force-add
 *
 * Both refusals were correct and both were the orchestrator's brief defect: an `exists:` proof whose
 * target lives under gitignored `.openclinxr/`. The refusal message is exactly right —
 * *"a clean clone will not have it, yet proof `exists:…` reads it"* (incident class #217/#64).
 *
 * ## THE EVALUATOR EXISTS, IS GOOD, AND IS WIRED AT ONE END ONLY
 *
 *   `evaluateGitignoredProofTarget`      merge-kill.ts:696   — the evaluator
 *   called from                          merge-kill.ts:765   — MERGE time
 *   called from                          gitignored-proof-target-table.ts:110 — an offline table
 *   `gitignoredProofTargetsAllowed`      dispatch-worker.ts:291 — the opt-out FIELD
 *
 * `board-brief.ts` and `dispatch-worker.ts` mention gitignoring only in **comments** and in that
 * option's declaration. **Neither evaluates anything.** So a brief carrying an unlandable proof is
 * accepted, dispatched, worked, and refused — and the orchestrator learns at the end.
 *
 * This is not a missing mechanism. It is a correct mechanism wired at the wrong end of the pipeline,
 * and moving the failure from post-work to pre-work is the whole slice (D9: make the pipeline step
 * deterministic and early).
 *
 * ## THE FIXTURE PAIR IS IDEAL AND ALREADY ON DISK (SS9h)
 *
 * Both live under the same gitignored tree and differ ONLY in tracked status — which is exactly what
 * the evaluator keys on:
 *
 *   .openclinxr/openclaw/worker-sessions.jsonl                untracked, ignored  -> must FLAG
 *   .openclinxr/evidence/issue-367/worktree-prune-plan.json   TRACKED (force-added) -> must NOT flag
 *
 * The second is tracked precisely because a resume force-added it after the land was refused. The
 * remediation the gate recommends is therefore also the control that proves the check is not simply
 * banning a directory.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) flags early | (2) tracked ok | (3) opt-out | result
 *   ----------------------------------------------------|-----------------|----------------|-------------|--------
 *   a) today — no pre-flight check at all              |   **FAIL**      |      pass      |    pass     | REFUSED
 *   b) refuse every target under a gitignored dir      |     pass        |    **FAIL**    |    pass     | REFUSED
 *   c) reimplement a second gitignore test             |     pass        |      pass      |  **FAIL**   | REFUSED
 *   d) call the SAME evaluator merge-kill uses, early  |     pass        |      pass      |    pass     | ALL PASS
 *
 * **(b) is the one to watch.** Banning the directory would flag the force-added artifact that is the
 * sanctioned remediation, making the gate unusable. Clause (2) pins that exact file.
 *
 * **(c) is why clause (3) exists.** A second implementation drifts from merge-kill's, and then the
 * pre-flight and the land disagree — which is worse than no pre-flight, because it teaches the
 * orchestrator to trust a verdict the land will overturn. Clause (3) requires the pre-flight verdict
 * to MATCH merge-kill's evaluator on both fixtures, so a divergent reimplementation fails.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today because no pre-flight
 * surface exists. (2) and (3) also fail today — unavoidable, they interrogate the same absent surface
 * — and they are what stops (1) being satisfied by a check that over-flags or diverges.
 *
 * NOT TESTED:
 *   - **Whether the pre-flight belongs in `briefFromIssue` or in `dispatch()`.** Either satisfies this
 *     contract. `briefFromIssue` is earlier and cheaper; `dispatch()` sees the resolved options
 *     including the opt-out. The implementer chooses and records why.
 *   - **`min-bytes:` targets.** Same class, not asserted here.
 *   - **Whether the two refusals this session were the only ones.** No history sweep was done.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** Untracked and ignored — a proof reading this cannot pass on a clean clone. */
const UNLANDABLE = ".openclinxr/openclaw/worker-sessions.jsonl";
/** Force-added after #367's land was refused: the sanctioned remediation, and the control. */
const LANDABLE = ".openclinxr/evidence/issue-367/worktree-prune-plan.json";

/** Computed so TypeScript cannot resolve a not-yet-exported symbol at compile time (#383/#352). */
const PREFLIGHT_SPECIFIER = ["../openclaw/proof", "target", "preflight.js"].join("-");

type Verdict = { target: string; unlandable: boolean; reason?: string };

async function loadPreflight(): Promise<((repoRoot: string, proofs: readonly string[], allowed?: readonly string[]) => Verdict[]) | null> {
  try {
    const mod = (await import(PREFLIGHT_SPECIFIER)) as {
      evaluateProofTargetsBeforeDispatch?: (repoRoot: string, proofs: readonly string[], allowed?: readonly string[]) => Verdict[];
    };
    return mod.evaluateProofTargetsBeforeDispatch ?? null;
  } catch {
    return null;
  }
}

const preflight = await loadPreflight();

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requirePreflight(): NonNullable<typeof preflight> {
  expect(
    preflight,
    `a pre-dispatch surface must export evaluateProofTargetsBeforeDispatch(repoRoot, proofs, allowed) — today the gitignored-proof-target evaluator is called only from merge-kill.ts:765, after the worker has finished`,
  ).not.toBeNull();
  return preflight as NonNullable<typeof preflight>;
}

describe("a gitignored proof target is caught before the worker runs", () => {
  it.fails("(1) RED: an exists: proof on an untracked, gitignored target is flagged at brief time", () => {
    const check = requirePreflight();
    const verdicts = check(REPO_ROOT, [`exists:${UNLANDABLE}`]);
    const hit = verdicts.find((v) => v.target === UNLANDABLE);
    expect(hit?.unlandable, `${UNLANDABLE} is untracked and ignored — a clean clone cannot satisfy this proof`).toBe(true);
  });

  it.fails("(2) COUNTERWEIGHT: a TRACKED target under the same ignored tree is NOT flagged", () => {
    // Refuses (b). Banning the directory would flag the force-added artifact that IS the gate's own
    // recommended remediation, which would make the pre-flight unusable.
    const check = requirePreflight();
    const verdicts = check(REPO_ROOT, [`exists:${LANDABLE}`]);
    const hit = verdicts.find((v) => v.target === LANDABLE);
    expect(hit?.unlandable ?? false, `${LANDABLE} is tracked (force-added) and must pass`).toBe(false);
  });

  it.fails("(3) COUNTERWEIGHT: the opt-out suppresses the flag, as merge-kill's does", () => {
    // Refuses (c). A second implementation drifts from merge-kill's and then pre-flight and land
    // disagree — worse than no pre-flight, because it teaches trust in a verdict the land overturns.
    const check = requirePreflight();
    const verdicts = check(REPO_ROOT, [`exists:${UNLANDABLE}`], [UNLANDABLE]);
    const hit = verdicts.find((v) => v.target === UNLANDABLE);
    expect(hit?.unlandable ?? false, `${UNLANDABLE} named in gitignoredProofTargetsAllowed must be suppressed`).toBe(false);
  });
});
