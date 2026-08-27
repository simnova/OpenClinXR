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
import { readFileSync } from "node:fs";
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
  it.fails("(1) RED: harvesting is not gated on a worker being live", () => {
    const steps = orderedSteps();
    const harvestSteps = steps.filter((s) => /harvest/i.test(s));
    expect(harvestSteps.length, "the fire must mention harvesting at all").toBeGreaterThan(0);
    // The defect: EVERY harvest step is inside the workers-live branch, so a finished slice has no
    // step that reaches it. At least one harvest step must stand outside that condition.
    const unconditional = harvestSteps.filter((s) => !/worker.*live|live.*worker/i.test(s));
    expect(unconditional.length, `harvest steps found: ${harvestSteps.join(" | ")}`).toBeGreaterThan(0);
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
