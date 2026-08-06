import { describe, expect, it } from "vitest";
import { buildScorecard, formatScorecard } from "./delegation-scorecard.js";

/** Scoreable entries are worktree-bound — that is how landing is detectable at all. */
const entry = (slice: string, model = "grok-4.5", turns = 20) => ({
  sessionId: `sid-${slice}`, slice, model, turns, at: "2026-08-05T00:00:00Z",
  worktree: `/tmp/wt/${slice}`,
});

/** A pre-worktree dispatch: wrote straight into main, so no branch exists to detect. */
const legacyEntry = (slice: string) => ({
  sessionId: `sid-${slice}`, slice, model: "unknown", at: "2026-08-05T00:00:00Z",
});

describe("delegation scorecard", () => {
  it("scores outcomes from git history, never from the worker's own report", () => {
    // A worker claiming success proves nothing — the purge worker reported success while deleting
    // MADR-cited evidence, and the cache worker reported success while skipping a required proof.
    const card = buildScorecard(process.cwd(), [entry("nonexistent-slice-xyz")]);
    expect(card.totalDispatched).toBe(1);
    expect(card.landed).toBe(0); // no merge commit mentions it, so it did not land
  });

  it("reports honestly when the sample is too small to read a trend", () => {
    const card = buildScorecard(process.cwd(), [entry("a"), entry("b")]);
    expect(card.notes.join(" ")).toMatch(/too few to read a trend/);
  });

  it("states plainly that land rate is throughput, not correctness", () => {
    // The metric closest to hand is the misleading one. Say so in the artifact itself.
    const card = buildScorecard(process.cwd(), [entry("a")]);
    expect(card.notes.join(" ")).toMatch(/throughput, not quality/);
  });

  it("segments by model so cheap-vs-frontier is measurable, not assumed", () => {
    const card = buildScorecard(process.cwd(), [
      entry("a", "deepseek-v4-pro"), entry("b", "deepseek-v4-pro"), entry("c", "grok-4.5"),
    ]);
    expect(card.byModel["deepseek-v4-pro"]?.dispatched).toBe(2);
    expect(card.byModel["grok-4.5"]?.dispatched).toBe(1);
  });

  it("excludes pre-worktree dispatches instead of scoring them as failures", () => {
    // Counting them produced a 6% land rate that measured the ledger's history, not the loop.
    const card = buildScorecard(process.cwd(), [entry("a"), legacyEntry("old-1"), legacyEntry("old-2")]);
    expect(card.totalDispatched).toBe(1);
    expect(card.notes.join(" ")).toMatch(/2 pre-worktree dispatch/);
  });

  it("formats without throwing on an empty ledger", () => {
    expect(() => formatScorecard(buildScorecard(process.cwd(), []))).not.toThrow();
  });
});
