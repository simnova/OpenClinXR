import { describe, expect, it } from "vitest";

import { emptyWatchState, tick } from "./watch.js";

describe("watch", () => {
  it("a planted READY line produces exactly one READY line", () => {
    const snap = (lines: string[]) => ({
      results: [],
      logs: [{ path: "/tmp/push.log", newLines: lines }],
      board: { output: null as string | null },
      workers: [],
      nowMs: 1_000_000,
      stallMs: 600_000,
    });
    const first = tick(emptyWatchState(), snap(["noise", "READY gate green"]));
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toMatch(/^READY /);
    const second = tick(first.state, snap([]));
    expect(second.lines).toHaveLength(0);
  });

  it("a RESULT turning STATUS: done produces exactly one READY line, once", () => {
    const snap = (lastLine: string | null) => ({
      results: [{ path: "/tmp/RESULT.md", lastLine }],
      logs: [],
      board: { output: null as string | null },
      workers: [],
      nowMs: 1_000_000,
      stallMs: 600_000,
    });
    const first = tick(emptyWatchState(), snap("STATUS: done"));
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toMatch(/^READY /);
    const second = tick(first.state, snap("STATUS: done"));
    expect(second.lines).toHaveLength(0);
  });

  it("a FAIL line produces one FAIL line", () => {
    const prev = emptyWatchState();
    const out = tick(prev, {
      results: [],
      logs: [{ path: "/tmp/push.log", newLines: ["ok", "FAIL gate red"] }],
      board: { output: null as string | null },
      workers: [],
      nowMs: 1_000_000,
      stallMs: 600_000,
    });
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatch(/^FAIL /);
  });
});
