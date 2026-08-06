import { describe, expect, it } from "vitest";
import { renderSessionMap, sessionsForSlice } from "./board-session-map.js";

/**
 * Session ids are what make a retrospective possible at all — `--resume` reaches the agent that did
 * the work, but only if the id survived and only if you can tell which id belongs to which task.
 * Today both the ledger and the cost rollup are gitignored local state.
 *
 * Probed destructively: asserting a rendered string is non-empty would pass identically if the
 * function returned a constant.
 */

const LEDGER = [
  JSON.stringify({ sessionId: "aaa", slice: "issue-41", model: "grok-4.5", turns: 12, stopReason: "end_turn" }),
  JSON.stringify({ sessionId: "bbb", slice: "issue-39", model: "grok-4.5", turns: 41, stopReason: "end_turn" }),
  "not json at all",
  JSON.stringify({ sessionId: "ccc", slice: "issue-41", model: "deepseek-v4-pro", turns: 3, stopReason: "max_turns" }),
].join("\n");

describe("sessionsForSlice", () => {
  it("selects only the requested slice", () => {
    expect(sessionsForSlice(LEDGER, "issue-41").map((s) => s.sessionId)).toEqual(["aaa", "ccc"]);
  });

  it("survives a malformed line rather than losing the rest of the ledger", () => {
    // A single bad append must not orphan every session recorded after it.
    expect(sessionsForSlice(LEDGER, "issue-39")).toHaveLength(1);
  });

  it("de-duplicates by session id, since the ledger appends once per attempt", () => {
    const repeated = [
      JSON.stringify({ sessionId: "aaa", slice: "s", turns: 1 }),
      JSON.stringify({ sessionId: "aaa", slice: "s", turns: 9 }),
    ].join("\n");
    const sessions = sessionsForSlice(repeated, "s");
    expect(sessions).toHaveLength(1);
    // Last write wins: the final record is the completed one.
    expect(sessions[0]?.turns).toBe(9);
  });

  it("returns nothing for a slice with no sessions rather than guessing", () => {
    expect(sessionsForSlice(LEDGER, "issue-99")).toEqual([]);
  });
});

describe("renderSessionMap", () => {
  const sessions = [
    { sessionId: "aaa", model: "grok-4.5", turns: 12, stopReason: "end_turn" },
    { sessionId: "ccc", model: "deepseek-v4-pro", turns: 3, stopReason: "max_turns" },
  ];

  it("renders every session id, because an unrecorded id cannot be resumed later", () => {
    const out = renderSessionMap({ slice: "issue-41", sessions });
    expect(out).toContain("aaa");
    expect(out).toContain("ccc");
    expect(out).toContain("--resume");
  });

  it("joins cost to the right session and totals it", () => {
    const out = renderSessionMap({
      slice: "issue-41",
      sessions,
      costs: [
        { key: "aaa", tokens: 120_000, estimatedUsd: 0.42 },
        { key: "ccc", tokens: 30_000, estimatedUsd: 0.08 },
      ],
    });
    expect(out).toContain("120,000");
    expect(out).toContain("$0.42");
    expect(out).toMatch(/\*\*150,000\*\*/);
    expect(out).toMatch(/\*\*\$0\.50\*\*/);
  });

  it("does not attribute cost to a session the rollup has no entry for", () => {
    // The rollup covers a time window; a session outside it must read as unknown, not as free.
    const out = renderSessionMap({
      slice: "issue-41",
      sessions,
      costs: [{ key: "aaa", tokens: 120_000, estimatedUsd: 0.42 }],
    });
    const ccc = out.split("\n").find((line) => line.includes("ccc")) ?? "";
    expect(ccc).toContain("—");
    expect(ccc).not.toContain("$0.00");
  });

  it("shows sub-cent spend rather than rounding a real cost to $0.00", () => {
    const out = renderSessionMap({
      slice: "s",
      sessions: [{ sessionId: "aaa" }],
      costs: [{ key: "aaa", tokens: 900, estimatedUsd: 0.0031 }],
    });
    expect(out).toContain("$0.0031");
    expect(out).not.toContain("$0.00 ");
  });

  it("always carries the estimate caveat so the number is never quoted bare", () => {
    const out = renderSessionMap({ slice: "s", sessions, disclaimer: "Estimate only — not an invoice." });
    expect(out).toContain("Estimate only");
  });

  it("says so plainly when a slice has no sessions instead of rendering an empty table", () => {
    expect(renderSessionMap({ slice: "issue-99", sessions: [] })).toMatch(/no worker sessions/i);
  });
});
