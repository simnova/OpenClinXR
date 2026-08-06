import { describe, expect, it } from "vitest";
import { evaluateIntegrateGate, requiresKillReport } from "./integrate-gate.js";

/**
 * Half two of the land boundary. `pnpm openclaw:integrate` runs merge-kill first, but typing
 * `git merge` skips it entirely — so the wrapper is a convention, and conventions lose to a hurried
 * operator.
 *
 * The discriminator is deliberately "is this an integrate LAND", not "are product paths staged".
 * Keying on product paths would demand a kill report for every ordinary commit on main, which is
 * how a gate gets disabled — the same failure mode as a slow hook driving people to --no-verify.
 * The target is "forgot to run kill while landing worker work", not "cannot edit packages on main".
 */

describe("when a kill report is required", () => {
  it("does NOT require one for an ordinary commit on main", () => {
    // Human IC work. Demanding a report here is what gets the hook turned off.
    expect(requiresKillReport({ branch: "main", integrating: false, mergeParents: [] })).toBe(false);
  });

  it("does not require one off main at all", () => {
    expect(requiresKillReport({ branch: "wt/slice-a", integrating: true, mergeParents: [] })).toBe(false);
  });

  it("requires one when the wrapper marks the commit as an integrate land", () => {
    expect(requiresKillReport({ branch: "main", integrating: true, mergeParents: [] })).toBe(true);
  });

  it("requires one for a merge landing a worker branch, even without the env marker", () => {
    // Covers `git merge wt/...` typed by hand — the bypass this half exists to close.
    expect(requiresKillReport({ branch: "main", integrating: false, mergeParents: ["wt/slice-a"] })).toBe(true);
  });
});

describe("evaluating the gate against the staged tree", () => {
  const clean = { killed: false, treeHash: "abc123" };

  it("allows when a clean report matches the tree about to be committed", () => {
    expect(evaluateIntegrateGate({ treeHash: "abc123", report: clean }).allowed).toBe(true);
  });

  it("refuses when there is no report at all", () => {
    const result = evaluateIntegrateGate({ treeHash: "abc123", report: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/openclaw:integrate/);
  });

  it("refuses a STALE report — freshness is by tree content, not by existence", () => {
    // An mtime or existence check would pass here. The tree actually being committed is not the
    // tree that was judged, so the report says nothing about this commit.
    const result = evaluateIntegrateGate({ treeHash: "def456", report: clean });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/different tree|stale/i);
  });

  it("refuses a report that matches the tree but recorded a KILL", () => {
    const result = evaluateIntegrateGate({ treeHash: "abc123", report: { killed: true, treeHash: "abc123" } });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/killed/i);
  });
});
