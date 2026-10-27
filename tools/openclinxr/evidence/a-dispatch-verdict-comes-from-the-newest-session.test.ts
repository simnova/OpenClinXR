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
/**
 * ## QUALIFICATION (2026-10-26, portable contract proposal)
 *
 * The header above and the `## FIXED (#722)` block below are the immutable 2026-08-27/28
 * historical record: a real-card report measured against the live ledger (issue-638/714).
 * That live ledger is gitignored private state and is NOT regenerated or authenticated here.
 * Every fixture in THIS file is synthetic, written to a unique mkdtemp root per test with
 * cleanup, uses distinct synthetic issue/session IDs, and never reads the real 638/714 rows.
 * `describeDispatchProofs(tempRoot, syntheticID)` is called purely against those temp ledgers
 * in the exact worker-sessions.jsonl shape. No historical IDs or evidence are fabricated.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeDispatchProofs } from "../openclaw/supervisor-audit.js";

type Row = { slice: string; sessionId: string; phase: string; proofsOk?: boolean; proofs?: Array<{ rule: string; passed: boolean }> };

function writeLedger(root: string, rows: Row[]): void {
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  writeFileSync(
    join(root, ".openclinxr/openclaw/worker-sessions.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "dispatch-ledger-"));
}

const OLD_PASS = "sess-old-pass";
const NEW_DIED = "sess-new-died";
const NEW_SPAWN = "sess-new-spawn";
const NEW_FALSE = "sess-new-false";
const NEW_TRUE = "sess-new-true";

describe("#722 a dispatch verdict comes from the NEWEST session, not an older one", () => {
  it("(1) old PASS + new DIED session is not reported as passing and names DIED", () => {
    const root = tempRoot();
    try {
      const issue = 601001;
      writeLedger(root, [
        { slice: `issue-${issue}`, sessionId: OLD_PASS, phase: "completed", proofsOk: true, proofs: [] },
        { slice: `issue-${issue}`, sessionId: NEW_DIED, phase: "spawned" },
        { slice: `issue-${issue}`, sessionId: NEW_DIED, phase: "died" },
      ]);
      const text = describeDispatchProofs(root, issue);
      expect(text).not.toContain("proofs passed");
      expect(text).toContain("DIED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(2) ledger shape guard: newest session died with no verdict while an older row passed", () => {
    const root = tempRoot();
    try {
      const issue = 601002;
      const rows: Row[] = [
        { slice: `issue-${issue}`, sessionId: "s1", phase: "spawned" },
        { slice: `issue-${issue}`, sessionId: "s1", phase: "completed" },
        { slice: `issue-${issue}`, sessionId: "s2", phase: "completed", proofsOk: true, proofs: [] },
        { slice: `issue-${issue}`, sessionId: NEW_SPAWN, phase: "spawned" },
        { slice: `issue-${issue}`, sessionId: NEW_SPAWN, phase: "died" },
      ];
      writeLedger(root, rows);
      expect(rows.length).toBeGreaterThanOrEqual(5);
      expect(rows.at(-1)?.phase).toBe("died");
      expect(typeof rows.at(-1)?.proofsOk).not.toBe("boolean");
      expect(rows.some((r) => r.proofsOk === true)).toBe(true);
      expect(describeDispatchProofs(root, issue)).not.toContain("proofs passed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(2b) old PASS + new SPAWNED session reports IN FLIGHT, not a pass", () => {
    const root = tempRoot();
    try {
      const issue = 601003;
      writeLedger(root, [
        { slice: `issue-${issue}`, sessionId: OLD_PASS, phase: "completed", proofsOk: true, proofs: [] },
        { slice: `issue-${issue}`, sessionId: NEW_SPAWN, phase: "spawned" },
      ]);
      const text = describeDispatchProofs(root, issue);
      expect(text).not.toContain("proofs passed");
      expect(text).toContain("IN FLIGHT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(3) COUNTERWEIGHT: genuine newest-session false verdict still reports FAILED with rules", () => {
    const root = tempRoot();
    try {
      const issue = 601004;
      writeLedger(root, [
        { slice: `issue-${issue}`, sessionId: OLD_PASS, phase: "completed", proofsOk: true, proofs: [] },
        { slice: `issue-${issue}`, sessionId: NEW_FALSE, phase: "completed", proofsOk: false, proofs: [{ rule: "run:check-a:extra", passed: false }, { rule: "run:check-a:extra", passed: false }, { rule: "lint:ok", passed: true }] },
      ]);
      const text = describeDispatchProofs(root, issue);
      expect(text).toContain("FAILED (run)");
      expect(text.match(/\(run\)/g)?.length).toBe(1);
      expect(text).not.toContain("lint");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(3b) newest-session true verdict still reports passed", () => {
    const root = tempRoot();
    try {
      const issue = 601005;
      writeLedger(root, [
        { slice: `issue-${issue}`, sessionId: NEW_TRUE, phase: "completed", proofsOk: true, proofs: [] },
      ]);
      expect(describeDispatchProofs(root, issue)).toContain("proofs passed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(4) COUNTERWEIGHT: unknown card and missing ledger say UNKNOWN", () => {
    const root = tempRoot();
    try {
      const issue = 601006;
      writeLedger(root, [
        { slice: `issue-${issue}`, sessionId: "other", phase: "completed", proofsOk: true, proofs: [] },
      ]);
      expect(describeDispatchProofs(root, 999_999)).toContain("UNKNOWN");
      const empty = tempRoot();
      try {
        expect(describeDispatchProofs(empty, issue)).toContain("UNKNOWN");
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(5) malformed and unrelated rows cannot fabricate a verdict", () => {
    const root = tempRoot();
    try {
      const issue = 601007;
      mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
      const good = JSON.stringify({ slice: `issue-${issue}`, sessionId: NEW_DIED, phase: "died" });
      const unrelated = JSON.stringify({ slice: "issue-1", sessionId: "x", phase: "completed", proofsOk: true, proofs: [] });
      writeFileSync(join(root, ".openclinxr/openclaw/worker-sessions.jsonl"), `{not-json\n${unrelated}\n${good}\n`, "utf8");
      const text = describeDispatchProofs(root, issue);
      expect(text).not.toContain("proofs passed");
      expect(text).toContain("DIED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(6) TAMPER counterweight: skipping the newest session would return the old pass", () => {
    const root = tempRoot();
    try {
      const issue = 601008;
      const rows: Row[] = [
        { slice: `issue-${issue}`, sessionId: OLD_PASS, phase: "completed", proofsOk: true, proofs: [] },
        { slice: `issue-${issue}`, sessionId: NEW_DIED, phase: "died" },
      ];
      writeLedger(root, rows);
      const buggy = rows.filter((r) => typeof r.proofsOk === "boolean").at(-1);
      expect(buggy?.sessionId).toBe(OLD_PASS);
      expect(describeDispatchProofs(root, issue)).not.toContain("proofs passed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
