import { spawn } from "node:child_process";
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

/**
 * ## FIXED (bothy-tsk_3fb3bdeedbefdce8)
 *
 * bothy-claim-renewal.ts now owns announceBothyClaimPresence, BOTHY_CLAIM_INTERVAL_MS
 * (2 min), and startBothyClaimRenewal with an injected heartbeat hook for tests;
 * dispatch-worker.ts imports the starter and re-exports the historic names, so the
 * one-shot at spawn, the interval until child close, and the exact-claimant heartbeat
 * are unchanged. All four clauses flipped it.fails to it; none edited otherwise. The
 * sibling dispatch-lifecycle plant needed its source probes retargeted at the shared
 * module (its FIXED block records the move).
 *
 * ## FIXED-2 (bothy-tsk_3fb3bdeedbefdce8 follow-up)
 *
 * The module now also exposes a standalone process entry
 * (pnpm exec tsx bothy-claim-renewal.ts --task <id> --pid <pid> [...]) backed by
 * startPidBoundClaimRenewal, which polls process.kill(pid, 0) and stops itself once
 * the worker pid disappears — renewal follows process liveness, not a caller
 * remembering stop(). Clause (5) pins that plus the missing-PAT refusal (exit 2,
 * no network call).
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
  it("(1) RENEWER IS IMPORTABLE OUTSIDE DISPATCH", async () => {
    const mod = await import("./bothy-claim-renewal.js");
    expect(typeof mod.startBothyClaimRenewal, "renewer must export a starter").toBe("function");
    expect(typeof mod.BOTHY_CLAIM_INTERVAL_MS, "renewer must export its cadence").toBe("number");
    expect(
      mod.BOTHY_CLAIM_INTERVAL_MS,
      "renewal cadence must stay comfortably below the ~10-minute reaper",
    ).toBeLessThan(10 * 60_000);
  });

  it("(2) RENEWAL HEARTBEATS THE EXACT CLAIMANT ON AN INTERVAL", async () => {
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

  it("(3) COUNTERWEIGHT: RENEWAL STOPS WHEN THE WORKER EXITS", async () => {
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

  it("(4) DISPATCH USES THE SHARED RENEWER, NOT A FORKED COPY", () => {
    const shared = renewerSource();
    expect(shared, "renewer module must define the starter").toMatch(/startBothyClaimRenewal/);
    expect(
      DISPATCH_SRC,
      "dispatch must import the shared starter instead of keeping a private interval",
    ).toMatch(/from\s*["']\.\/bothy-claim-renewal\.js["']/);
  });

  it("(5) STANDALONE CLI FOLLOWS THE WORKER PID, NOT A CALLER", async () => {
    const mod = await import("./bothy-claim-renewal.js");
    expect(
      mod.parseClaimRenewerArgs(["--task", "tsk_probe", "--pid", "123", "--agent", "a", "--session", "s"]),
    ).toEqual({ taskId: "tsk_probe", pid: 123, agentId: "a", grokSessionId: "s" });
    expect(mod.parseClaimRenewerArgs([]), "flag parser must refuse missing flags").toBeNull();
    expect(mod.claimRenewerCliMain([], {}), "CLI must refuse missing flags").toBe(2);
    expect(
      mod.claimRenewerCliMain(["--task", "tsk_probe", "--pid", "123"], {}),
      "CLI without BOTHY_BOARD_PAT must exit 2 before any network call",
    ).toBe(2);
    const shared = renewerSource();
    expect(shared, "renewer must be directly runnable as a process").toContain("import.meta.url");
    expect(shared, "renewer CLI must read its own argv").toContain("process.argv");

    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
    const childPid = child.pid ?? 0;
    expect(childPid, "probe child did not spawn").toBeGreaterThan(0);
    let calls = 0;
    vi.useFakeTimers();
    try {
      const stop = mod.startPidBoundClaimRenewal(
        { path: "/tmp/wt", branch: "standalone", taskId: "tsk_probe", agentId: "agent_probe" },
        { pid: childPid, intervalMs: 50, heartbeat: () => { calls += 1; } },
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(calls, "no heartbeat while the worker pid is alive").toBeGreaterThan(0);
      child.kill();
      await vi.advanceTimersByTimeAsync(500);
      const atDeath = calls;
      expect(atDeath, "kill before any tick cannot prove silence").toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(500);
      expect(calls, "renewer kept heartbeating after the worker pid died").toBe(atDeath);
      stop();
    } finally {
      vi.useRealTimers();
      if (child.exitCode === null) child.kill();
    }
  });
});

// NOT TESTED: whether the harness spawn path invokes the renewer automatically or the
// orchestrator starts it by hand alongside each spawn; live reaper timing; partitions
// longer than the claim TTL.
