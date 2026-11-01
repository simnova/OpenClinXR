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
/**
 * ## QUALIFICATION (2026-10-27, portable contract proposal)
 *
 * The header above and the `## FIXED (#721)` block below are the immutable 2026-08-27/28
 * historical record: a real-card report measured against the live ledger (issue-692/693).
 * That live ledger is gitignored private state and is NOT read or authenticated here.
 * Every fixture in THIS file is synthetic, written to a unique mkdtemp root per test with
 * cleanup, uses distinct synthetic issue/session IDs, and never reads the real 692/693 rows.
 * `describeDispatchProofs(tempRoot, syntheticID)` is called purely against those temp ledgers
 * in the exact worker-sessions.jsonl shape. No historical IDs or evidence are fabricated.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../../..");
const AUDIT = resolve(REPO, "tools/openclinxr/openclaw/supervisor-audit.ts");

/** Synthetic cards mirroring the 692/693 shape: proofsOk=false with live-family failures. */
const FALSE_CASES = [602001, 602002];

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "audit-ledger-"));
  tmpRoots.push(root);
  return root;
}

function writeLedger(root: string, rows: unknown[]): void {
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  writeFileSync(
    join(root, ".openclinxr/openclaw/worker-sessions.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8",
  );
}

function seedFalseLedger(root: string): void {
  writeLedger(root, [
    { slice: `issue-${FALSE_CASES[0]}`, sessionId: "sess-synth-a", phase: "completed", proofsOk: false, proofs: [{ rule: "live:plant-still-fails", passed: false }] },
    { slice: `issue-${FALSE_CASES[1]}`, sessionId: "sess-synth-b", phase: "completed", proofsOk: false, proofs: [{ rule: "live:sweep-missing", passed: false }, { rule: "exists:sweep.json", passed: false }] },
  ]);
}

function lastDispatchRow(root: string, issue: number): { proofsOk?: boolean } | null {
  const lines = readFileSync(join(root, ".openclinxr/openclaw/worker-sessions.jsonl"), "utf8").split("\n").filter(Boolean);
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
  it("(1) the message does not claim dispatch verification unconditionally", () => {
    const src = readFileSync(AUDIT, "utf8");
    // The literal clause is the defect. It is emitted with no read of proofsOk anywhere in scope.
    expect(src).not.toContain("verified at dispatch only");
  });

  it("(1b) the message BEHAVES — it names the real dispatch failure, not a template", async () => {
    // Source-text clauses prove a literal is gone. They cannot prove the replacement fires, and no
    // card on the board currently reaches this branch (every Landed card has an artifact), so the
    // wording would otherwise ship untested. Exercise it against synthetic cards carrying the same
    // shape as the two cards that produced the false message.
    const root = tempRoot();
    seedFalseLedger(root);
    const mod = (await import("../supervisor-audit.js")) as {
      describeDispatchProofs?: (root: string, issue: number) => string;
    };
    expect(typeof mod.describeDispatchProofs).toBe("function");
    for (const issue of FALSE_CASES) {
      const text = mod.describeDispatchProofs!(root, issue);
      expect(text, `issue-${issue}`).toContain("dispatch record says proofs FAILED");
      // The failing rule kinds must be named, or the operator learns nothing actionable.
      expect(text, `issue-${issue}`).toContain("live");
    }
    // And the UNKNOWN branch must be reachable rather than decorative.
    expect(mod.describeDispatchProofs!(root, 999_999)).toContain("UNKNOWN");
  });

  it("(2) the synthetic known-good column: the synthetic ledger records proofs FAILED", () => {
    // Synthetic contract only, not a historical authentication: the temp ledger above carries
    // proofsOk=false rows in the exact worker-sessions.jsonl shape. If this fails, the
    // synthetic seeding broke — not that a live campaign rotated.
    const root = tempRoot();
    seedFalseLedger(root);
    for (const issue of FALSE_CASES) {
      const row = lastDispatchRow(root, issue);
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

/**
 * ## FIXED (#721)
 *
 * `describeDispatchProofs` now reads the last terminal row in `worker-sessions.jsonl` and the `why`
 * line states what it found: proofs FAILED with the failing rule kinds named, proofs passed against
 * a tree that may no longer be main, or no dispatch record and the state UNKNOWN. Nothing is assumed.
 *
 * A note on clause (1) itself: it forbids a literal string, so the doc comment above deliberately
 * paraphrases the old wording instead of quoting it. Quoting it made the clause fail against its own
 * documentation, which is the self-matching shape and would have been the wrong reason to weaken it.
 */
