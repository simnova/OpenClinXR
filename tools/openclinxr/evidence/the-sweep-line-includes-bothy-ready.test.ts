import { describe, expect, it } from "vitest";
import { formatSweepLine, probeBothyReady, type SweepInventory } from "../openclaw/openclaw-sweep.js";

/**
 * OBSERVABLE: the per-tick SWEEP line must name BothyBoard's ready identity so a
 * turn cannot silently skip `tasks.next`.
 *
 * Diagnosis header IMMUTABLE after plant. Flip it.fails only if a clause is
 * already green; append ## FIXED.
 */

function baseInventory(over: Partial<SweepInventory> = {}): SweepInventory {
  return {
    reds: 0,
    redFiles: [],
    undispatchable: 0,
    undispatchableIds: [],
    uncarded: 0,
    uncardedFiles: [],
    quietThreads: 0,
    liveWorkers: 3,
    workerFloor: 3,
    bothyReady: "empty",
    ...over,
  };
}

describe("the sweep line includes bothy ready", () => {
  it("(1) formatSweepLine carries bothy= from inventory.bothyReady", () => {
    const line = formatSweepLine(baseInventory({ bothyReady: "empty" }));
    expect(line).toMatch(/bothy=empty/);
    const ready = formatSweepLine(baseInventory({ bothyReady: "tsk_aabb" }));
    expect(ready).toMatch(/bothy=tsk_aabb/);
  });

  it("(2) probeBothyReady returns empty on {task:null}", async () => {
    const label = await probeBothyReady({
      pat: "bb_pat_test",
      fetch: async () => ({ structuredContent: { task: null }, httpStatus: 200 }),
    });
    expect(label).toBe("empty");
  });

  it("(3a) empty Bothy queue does not BREACH the worker floor", () => {
    const line = formatSweepLine(baseInventory({ liveWorkers: 0, workerFloor: 3, bothyReady: "empty" }));
    expect(line).not.toMatch(/BREACH/);
  });

  it("(3b) a ready Bothy task with zero workers is BREACH", () => {
    const line = formatSweepLine(baseInventory({ liveWorkers: 0, workerFloor: 3, bothyReady: "tsk_aabb" }));
    expect(line).toMatch(/BREACH/);
  });

  it("(3) probeBothyReady returns the Planted task id", async () => {
    const label = await probeBothyReady({
      pat: "bb_pat_test",
      fetch: async () => ({
        structuredContent: {
          task: { id: "tsk_wcg1", title: "lock table", factory: "Planted", status: "ready", body: "## factory_step: staging\n" },
        },
        httpStatus: 200,
      }),
    });
    expect(label).toBe("tsk_wcg1");
  });
});
