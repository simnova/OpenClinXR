/**
 * #727 — the drain loop harvests only while a worker is LIVE, so a finished slice is never harvested.
 *
 * THE DEFECT, MEASURED 2026-08-27 — do not re-derive this.
 *
 *   .openclinxr/openclaw/superagent-loop-prompt.md, steps 2 and 4:
 *
 *     2. If any product grok worker is live: harvest only ... Do not dispatch.
 *     4. Else select one GitHub issue ... with Factory=Planted
 *
 *   Harvesting is the BODY of a branch whose condition is "a worker is live". Once the worker has
 *   exited that condition is false, control reaches step 4, and the fire dispatches something new.
 *   No step harvests a slice whose worker already finished.
 *
 *   Cost, same day: #723 completed at 74 turns with proofsOk:true, a clean tree and two commits
 *   ahead, and sat until a supervisor iteration harvested it by hand. #641 completed at its 200-turn
 *   ceiling with 28 dirty files and nothing committed, likewise.
 *
 * WHAT THIS CONTRACT CAN AND CANNOT SHOW. It asserts on the PROMPT DOCUMENT. The drain fire is an
 * LLM reading that document, so no test here proves the loop behaves differently — only that the
 * instruction it reads no longer gates harvesting on a live worker. Said plainly because a document
 * assertion dressed as a behaviour proof is the exact defect this loop has corrected three times.
 *
 * THE THREE LEDGER SHAPES ARE NOT ONE CLASS, and a blanket "harvest anything completed" would be
 * wrong: ready_to_integrate integrates, needs_resume must NOT integrate (#641, #714), and a worktree
 * already on main needs board repair only — after verifying the contract against main, because
 * advancing on git ancestry alone was wrong on #692 and #693.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#727)` block below.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const PROMPT = resolve(REPO, ".openclinxr/openclaw/superagent-loop-prompt.md");

function orderedSteps(): string[] {
  const body = readFileSync(PROMPT, "utf8");
  const each = body.slice(body.indexOf("## Each fire"));
  return each
    .split("\n")
    .filter((line) => /^\s*\d+\.\s/.test(line))
    .map((line) => line.trim());
}

describe("#727 the drain loop harvests a finished slice before it dispatches a new one", () => {
  it("(0) the subject exists — this contract must not go green on a clone that lacks the prompt", () => {
    /**
     * MEASURED 2026-08-27: .openclinxr/ is gitignored (.gitignore:9), so this prompt is UNTRACKED
     * and absent from HEAD. Every other clause reads it. Without this clause a fresh clone would
     * see readFileSync throw, or a future refactor returning "" would make the ordering checks
     * vacuous — green about a file nobody has.
     *
     * The fix itself therefore does NOT land: it lives in this machine's working copy only. That is
     * the #64 shape — a deliverable under a gitignored path has no land path — and it is stated
     * here rather than discovered later.
     */
    expect(existsSync(PROMPT), `${PROMPT} is absent — the drain prompt is gitignored and machine-local`).toBe(true);
    expect(readFileSync(PROMPT, "utf8").length).toBeGreaterThan(500);
    expect(orderedSteps().length, "the fire must enumerate numbered steps").toBeGreaterThanOrEqual(8);
  });

  it("(1) harvesting is not gated on a worker being live", () => {
    const steps = orderedSteps();
    const firstHarvest = steps.findIndex((s) => /harvest/i.test(s));
    const workersLive = steps.findIndex((s) => /worker.*live|live.*worker/i.test(s) && /not.*dispatch/i.test(s));
    expect(firstHarvest, "the fire must mention harvesting at all").toBeGreaterThanOrEqual(0);
    expect(workersLive, "the workers-live mutex step must exist").toBeGreaterThanOrEqual(0);
    /**
     * ORDERING is the property, not wording. An earlier draft filtered harvest steps for the phrase
     * "worker is live" and so excluded the very step that fixes this, whose text reads "whether or
     * not a worker is live" — a self-defeating matcher, the same shape as a regex that matches its
     * own literal. Harvest must come BEFORE the workers-live branch; then a finished worker's slice
     * is reached whether or not anything is running.
     */
    expect(firstHarvest, `harvest at step ${firstHarvest + 1}, workers-live at step ${workersLive + 1}`)
      .toBeLessThan(workersLive);
  });

  it("(2) the known-good column: the fire still refuses to dispatch past a live worker", () => {
    // If this fails, the fix removed the mutex rather than adding a harvest path. The live-worker
    // guard is why two writers never share a slice and must survive.
    const steps = orderedSteps();
    expect(steps.some((s) => /worker.*live|live.*worker/i.test(s) && /not.*dispatch/i.test(s))).toBe(true);
  });

  it("(3) COUNTERWEIGHT: harvesting still requires the proofs to be green", () => {
    // Passes TODAY: step 2 already reads "contract-verify / integrate if proofs green". The cheap
    // wrong fix is a harvest step that integrates any completed slice on sight — which would land
    // #641's and #714's unflipped REDs, since #714's clause (1) is still it.fails and its contract
    // refuses. An earlier draft of this clause asserted the FIX instead (requiring the prompt to
    // name needs_resume) and was therefore a second RED, not a counterweight.
    const body = readFileSync(PROMPT, "utf8");
    expect(body).toMatch(/contract-verify/i);
    expect(body).toMatch(/proofs green/i);
  });

  it("(4) COUNTERWEIGHT: the loop still does not plant or invent done_when", () => {
    // The cheapest wrong fix is to widen the fire's remit. It drains; it does not plant.
    const body = readFileSync(PROMPT, "utf8");
    expect(body).toMatch(/Plant a RED or invent `done_when`/);
    expect(body).toMatch(/It does not plant\./);
  });
});

/**
 * ## FIXED (#727)
 *
 * A new step 2 harvests FIRST, whether or not a worker is live, and branches on the latest ledger
 * row's handoff: ready_to_integrate acquires the lease and integrates only on green proofs;
 * needs_resume resumes and explicitly does not integrate; a worktree already on main repairs the
 * board only, after verifying against main. The old workers-live branch survives as step 3, so the
 * mutex that stops two writers sharing a slice is unchanged.
 *
 * Still true and still stated in the header: this asserts on the document. Whether the fire behaves
 * differently is a question about an LLM reading a prompt, and no assertion here answers it.
 */
