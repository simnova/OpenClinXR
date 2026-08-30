import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PLANTED RED — a live worker must not become dispatchable again when its ten-minute
 * BothyBoard claim TTL expires.
 *
 * Measured 2026-08-30: tsk_bca4085904e3b071 was claimed at 15:12:47Z and returned to
 * ready at 15:22:52Z while PID 79565 was still alive and writing. dispatch-worker.ts
 * announces presence once after spawn, but does not renew the exact claimant while the
 * child lives. The reaper cannot inspect local PID or dirty-worktree state.
 *
 * Append ## FIXED when the lifecycle renewal is implemented. Flip only the four
 * `it.fails` clauses to `it`; keep the counterweight green.
 */

/**
 * ## FIXED (tsk_36ec8d02ad31c685)
 *
 * dispatch-worker.ts now renews the Bothy claim for the child's lifetime. After the one-shot
 * `announceBothyDispatchPresence` (worktrees.register + heartbeat) still fires at spawn, a
 * recurring `startBothyClaimRenewal` interval heartbeats `bothy-board.agents.heartbeat` every
 * `BOTHY_CLAIM_INTERVAL_MS` (2 min — comfortably below the measured ~10-minute reaper) with the
 * exact claimant: the heartbeat carries `agentId` from the new `bothyAgentId` dispatch option.
 * `stopBothyRenewal()` runs in the child-close handler so renewal ends exactly when the worker
 * does. Renewal is best-effort like the one-shot — a transient board failure neither ends the
 * interval nor the worker.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const DISPATCH = readFileSync(join(SRC, "dispatch-worker.ts"), "utf8");

function heartbeatObject(source: string): string {
  const call = source.indexOf('bothyMcpCall(pat, "bothy-board.agents.heartbeat"');
  if (call < 0) return "";
  return source.slice(call, source.indexOf("});", call) + 3);
}

function recurringPresenceCallbacks(source: string): string[] {
  return [...source.matchAll(/setInterval\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,/g)]
    .map((match) => match[1] ?? "")
    .filter((body) => /announceBothyDispatchPresence|bothy-board\.agents\.heartbeat/.test(body));
}

describe("dispatch keeps the exact claimed task alive for the worker lifetime", () => {
  it("(1) A LIVE CHILD RENEWS BEFORE THE TEN-MINUTE REAPER", () => {
    const loops = recurringPresenceCallbacks(DISPATCH);
    expect(loops, "dispatch has no recurring Bothy presence callback tied to a live child").toHaveLength(1);
    expect(DISPATCH, "renewal cadence must be comfortably below the measured ten-minute reap").toMatch(
      /(?:BOTHY|CLAIM|HEARTBEAT)[A-Z_]*INTERVAL[A-Z_]*\s*=\s*(?:[1-4]\s*\*\s*60_?000|[1-5]\d{4,5})/,
    );
  });

  it("(2) RENEWAL NAMES THE EXACT CLAIMANT, NOT ONLY A SESSION", () => {
    const heartbeat = heartbeatObject(DISPATCH);
    expect(heartbeat, "dispatch must keep the existing Bothy heartbeat call").not.toBe("");
    expect(heartbeat, "heartbeat omits the board claimant identity and cannot renew that assignee").toMatch(
      /agentId\s*:/,
    );
    expect(DISPATCH, "dispatch options must carry the claimant identity used for renewal").toMatch(
      /(?:bothyAgentId|claimantAgentId)\??\s*:\s*string/,
    );
  });

  it("(3) RENEWAL STOPS WHEN THE CHILD CLOSES", () => {
    const close = DISPATCH.indexOf('child.on("close"');
    expect(close, "dispatch must still observe child close").toBeGreaterThan(-1);
    const closeBody = DISPATCH.slice(close, DISPATCH.indexOf("});", close) + 3);
    expect(
      closeBody,
      "child close clears process sampling but leaves no explicit Bothy claim-renewal cleanup",
    ).toMatch(/(?:stop|clear)[A-Za-z0-9_]*Bothy[A-Za-z0-9_]*(?:\(\)|\))/);
  });

  it("(4) A TRANSIENT BOARD FAILURE DOES NOT END RENEWAL OR THE WORKER", () => {
    const loops = recurringPresenceCallbacks(DISPATCH);
    expect(loops, "no recurring renewal exists to survive a transient board failure").toHaveLength(1);
    expect(
      loops[0],
      "renewal callback must contain or call a best-effort path whose rejection cannot escape the timer",
    ).toMatch(/announceBothyDispatchPresence|\.catch\s*\(/);
    expect(DISPATCH, "board visibility remains explicitly best-effort after spawn").toContain(
      "board visibility is not a dispatch contract",
    );
  });

  it("(5) COUNTERWEIGHT: dispatch still registers the worktree once after spawn", () => {
    expect(DISPATCH).toContain("bothy-board.worktrees.register");
    expect(DISPATCH).toContain("announceBothyDispatchPresence({");
    expect(DISPATCH.indexOf("announceBothyDispatchPresence({")).toBeGreaterThan(DISPATCH.indexOf("const child = spawn("));
  });
});

// NOT TESTED: live BothyBoard reaper timing; network partitions longer than the claim TTL;
// orchestrator crash; reassignment after child exit; dirty-worktree redispatch refusal.
