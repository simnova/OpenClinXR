import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveHandoffState } from "./worker-handoff-state.js";

/**
 * **OBSERVABLE: a returned worker with uncommitted work is NOT ready to integrate.**
 *
 * MEASURED on issue-620, 2026-08-24. The ledger's authoritative final row read
 * `phase: completed, turns: 150, stopReason: cancelled, proofsOk: true` — while four files sat dirty
 * and uncommitted. Every field was individually correct; the combination misled two monitors:
 *
 *     factory-pulse.ts:94    counted it as one completion and one pass
 *     campaign-track.ts:48   selected it as the slice's outcome
 *
 * A bare resume later committed the work and wrote no ledger row, so the ledger's last word stayed
 * the intermediate state.
 *
 * claimScope: committed-ness of a worktree. notEvidenceFor: correctness of the work or its proofs.
 */
const repo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "handoff-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  g("add", "-A"); g("commit", "-qm", "seed");
  return root;
};

describe("a cancelled dirty worker is not ready to integrate", () => {
  it("(1) THE issue-620 SHAPE: dirty tree -> needs_resume", () => {
    const root = repo();
    writeFileSync(join(root, "work.ts"), "the worker's output, uncommitted\n");
    const h = deriveHandoffState(root);
    expect(h.handoff).toBe("needs_resume");
    expect(h.dirtyFiles).toBeGreaterThan(0);
    // The detail must name the recovery, or a monitor re-dispatches and destroys the worktree.
    expect(h.detail).toMatch(/Resume the session in place/u);
  });

  it("(2) COUNTERWEIGHT: a clean tree WITH commits is ready", () => {
    // Without this, a deriver that always says needs_resume satisfies clause (1) and nothing ever
    // integrates.
    const root = repo();
    const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    // A real worker commits on its OWN branch inside a worktree, never onto main — so readiness is
    // measured as main..HEAD. My first fixture committed onto main itself and read as zero ahead,
    // which is the deriver being right about an unrealistic tree.
    g("checkout", "-q", "-b", "wt/issue-620");
    writeFileSync(join(root, "work.ts"), "committed output\n");
    g("add", "-A"); g("commit", "-qm", "the worker's commit");
    const h = deriveHandoffState(root);
    expect(h.handoff).toBe("ready_to_integrate");
    expect(h.dirtyFiles).toBe(0);
    expect(h.aheadCommits).toBe(1);
  });

  it("(3) a clean tree with NOTHING ahead is also needs_resume — the worker landed nothing", () => {
    const root = repo();
    const h = deriveHandoffState(root);
    expect(h.handoff).toBe("needs_resume");
    expect(h.aheadCommits).toBe(0);
  });

  it("(4) an unreadable path is UNKNOWN — never silently ready", () => {
    const h = deriveHandoffState("/nonexistent-worktree-xyz");
    expect(h.handoff, "an unmeasured tree is unmeasured, not ready").toBe("unknown");
    expect(h.dirtyFiles).toBe(-1);
  });
});
