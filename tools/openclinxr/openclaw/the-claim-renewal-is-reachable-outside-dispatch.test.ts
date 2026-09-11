import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * PLANTED RED — claim renewal is trapped inside dispatch().
 *
 * Measured 2026-09-11: startBothyClaimRenewal is a private setInterval inside
 * dispatch-worker.ts with no other caller, so a worker spawned through the harness's
 * native spawn_subagent never renews its BothyBoard claim and the board reaps it at
 * ~10 minutes while it is still writing. dispatch-worker.ts already holds the whole
 * mechanism (2-minute interval against the ~10-minute TTL, agentId-carrying
 * agents.heartbeat); this card extracts and exposes it without inventing renewal.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails to it and append ## FIXED below.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const RENEWER_REL = "bothy-claim-renewal.ts";
const DISPATCH_SRC = readFileSync(join(SRC, "dispatch-worker.ts"), "utf8");

function renewerSource(): string {
  const full = join(SRC, RENEWER_REL);
  if (!existsSync(full)) throw new Error(`missing ${RENEWER_REL}: renewal not extracted`);
  return readFileSync(full, "utf8");
}

describe("the claim renewal is reachable outside dispatch", () => {
  it.fails("(1) RENEWER IS IMPORTABLE OUTSIDE DISPATCH", async () => {
    const mod = await import("./bothy-claim-renewal.js");
    expect(typeof mod.startBothyClaimRenewal, "renewer must export a starter").toBe("function");
    expect(typeof mod.BOTHY_CLAIM_INTERVAL_MS, "renewer must export its cadence").toBe("number");
    expect(
      mod.BOTHY_CLAIM_INTERVAL_MS,
      "renewal cadence must stay comfortably below the ~10-minute reaper",
    ).toBeLessThan(10 * 60_000);
  });

  it.fails("(2) RENEWAL HEARTBEATS THE EXACT CLAIMANT ON AN INTERVAL", async () => {
    const mod = await import("./bothy-claim-renewal.js");
    const seen: Array<{ agentId?: string; taskId: string }> = [];
    vi.useFakeTimers();
    try {
      const stop = mod.startBothyClaimRenewal(
        { path: "/tmp/wt", branch: "wt/test", taskId: "tsk_probe", agentId: "agent_probe" },
        {
          intervalMs: 60_000,
          heartbeat: (presence: { agentId?: string; taskId: string }) => {
            seen.push({ taskId: presence.taskId, ...(presence.agentId ? { agentId: presence.agentId } : {}) });
          },
        },
      );
      await vi.advanceTimersByTimeAsync(125_000);
      stop();
    } finally {
      vi.useRealTimers();
    }
    expect(seen.length, "renewer never heartbeated on its interval").toBeGreaterThanOrEqual(2);
    expect(seen[0]?.agentId, "renewal omits the board claimant identity").toBe("agent_probe");
  });

  it.fails("(3) COUNTERWEIGHT: RENEWAL STOPS WHEN THE WORKER EXITS", async () => {
    const mod = await import("./bothy-claim-renewal.js");
    let calls = 0;
    vi.useFakeTimers();
    try {
      const stop = mod.startBothyClaimRenewal(
        { path: "/tmp/wt", branch: "wt/test", taskId: "tsk_probe", agentId: "agent_probe" },
        { intervalMs: 60_000, heartbeat: () => { calls += 1; } },
      );
      await vi.advanceTimersByTimeAsync(65_000);
      stop();
      const atStop = calls;
      expect(atStop, "stop() before any interval cannot prove silence").toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(calls, "renewer kept heartbeating after stop — a dead worker stays warm").toBe(atStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it.fails("(4) DISPATCH USES THE SHARED RENEWER, NOT A FORKED COPY", () => {
    const shared = renewerSource();
    expect(shared, "renewer module must define the starter").toMatch(/startBothyClaimRenewal/);
    expect(
      DISPATCH_SRC,
      "dispatch must import the shared starter instead of keeping a private interval",
    ).toMatch(/from\s*["']\.\/bothy-claim-renewal\.js["']/);
  });
});

// NOT TESTED: whether the harness spawn path invokes the renewer automatically or the
// orchestrator starts it by hand alongside each spawn; live reaper timing; partitions
// longer than the claim TTL.
