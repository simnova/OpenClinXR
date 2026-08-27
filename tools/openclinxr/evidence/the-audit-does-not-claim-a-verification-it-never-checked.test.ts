/**
 * #721 — the audit says "verified at dispatch only" without checking the dispatch record.
 *
 * THE DEFECT, MEASURED 2026-08-27 — do not re-derive this.
 *
 *   supervisor-audit.ts:521 emits, for a Landed card with no merge artifact:
 *
 *     "; NO contract-verify artifact — verified at dispatch only"
 *
 *   Nothing in that branch reads the dispatch record. The clause is an assumption printed as a
 *   finding. For the two cards that produced it, the assumption is FALSE:
 *
 *     issue-692  proofsOk=false  failing: live:  (the plant still contains it.fails)
 *     issue-693  proofsOk=false  failing: live:, exists:  (sweep.json is not on main)
 *
 *   Both rows are in .openclinxr/openclaw/worker-sessions.jsonl. They were not verified at dispatch;
 *   they FAILED at dispatch, and the finding said the opposite.
 *
 * WHY IT MATTERED, measured rather than hypothesised. Reading that message, the orchestrator
 * advanced both cards from Dispatched to Landed on git ancestry alone, concluding the work was done
 * and only the paperwork was missing. Running contract-verify against main afterwards reproduced
 * exactly the dispatch-time failures above, and both cards were reverted. A message that asserts an
 * unchecked premise caused a wrong action within one iteration of being read.
 *
 * WHAT THIS DOES NOT CHANGE. `ok` is already correct — it requires the merge artifact and refuses
 * without it. Only the human-readable `why` is wrong, which is the half an operator acts on.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#721)` block below.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const AUDIT = resolve(REPO, "tools/openclinxr/openclaw/supervisor-audit.ts");
const LEDGER = resolve(REPO, ".openclinxr/openclaw/worker-sessions.jsonl");

/** The exact cards that produced the false message, not a stand-in. */
const FALSE_CASES = [692, 693];

function lastDispatchRow(issue: number): { proofsOk?: boolean } | null {
  const lines = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i]!.includes(`"slice":"issue-${issue}"`)) continue;
    try {
      return JSON.parse(lines[i]!) as { proofsOk?: boolean };
    } catch {
      return null;
    }
  }
  return null;
}

describe("#721 the audit does not assert a dispatch verification it never read", () => {
  it.fails("(1) RED: the message does not claim dispatch verification unconditionally", () => {
    const src = readFileSync(AUDIT, "utf8");
    // The literal clause is the defect. It is emitted with no read of proofsOk anywhere in scope.
    expect(src).not.toContain("verified at dispatch only");
  });

  it("(2) the known-good column: the ledger records the truth the message contradicts", () => {
    // If this fails, the premise is gone and clause (1) is asserting about nothing — the cards were
    // re-dispatched, or the ledger was rotated. Check that before touching the message.
    for (const issue of FALSE_CASES) {
      const row = lastDispatchRow(issue);
      expect(row, `no ledger row for issue-${issue}`).not.toBeNull();
      expect(row?.proofsOk, `issue-${issue} proofsOk`).toBe(false);
    }
  });

  it("(3) COUNTERWEIGHT: the ok computation still requires the merge artifact", () => {
    // The cheapest way to clear clause (1) is to delete the whole branch, taking the correct `ok`
    // rule with it. `ok` is not the defect and must survive.
    const src = readFileSync(AUDIT, "utf8");
    expect(src).toMatch(/const ok = onMain && shas\.length > 0 && verified;/);
  });

  it("(4) COUNTERWEIGHT: the message still distinguishes present from absent", () => {
    // An operator has to be able to tell the two states apart. Clearing clause (1) by emitting the
    // same string in both branches would be worse than the defect.
    const src = readFileSync(AUDIT, "utf8");
    expect(src).toContain("contract-verify artifact present");
  });

  it("(5) COUNTERWEIGHT: the audit still reads the artifact by content, not existence", () => {
    // contractVerifiedFromArtifact replaced a bare existsSync earlier in this effort. A fix here
    // must not regress that.
    const src = readFileSync(AUDIT, "utf8");
    expect(src).toContain("contractVerifiedFromArtifact(artifact)");
  });
});
