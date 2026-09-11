import { hostname } from "node:os";
import { bothyMcpCall } from "./board-bothy-dequeue.js";

export type BothyClaimPresence = {
  path: string;
  branch: string;
  taskId: string;
  grokSessionId?: string;
  agentId?: string;
};

/**
 * Standalone Bothy claim renewer (extracted from dispatch-worker.ts).
 *
 * The board reaps a claim whose holder stops heartbeating (~10 min TTL), with no
 * visibility into local PID or dirty-worktree state. Any spawn path — dispatch()
 * or a harness-native spawn — can run this alongside its worker and hold the
 * exact claimant warm until the worker exits, then stop.
 */
export async function announceBothyClaimPresence(
  input: BothyClaimPresence,
): Promise<void> {
  const pat = process.env.BOTHY_BOARD_PAT ?? "";
  if (!pat) return;
  const machineName = hostname();
  try {
    await bothyMcpCall(pat, "bothy-board.worktrees.register", {
      path: input.path,
      branch: input.branch,
      machineName,
      taskId: input.taskId,
    });
  } catch {
    // board visibility is not a dispatch contract
  }
  try {
    await bothyMcpCall(pat, "bothy-board.agents.heartbeat", {
      name: "dispatch-worker",
      machineName,
      currentTaskId: input.taskId,
      status: "working",
      ...(input.grokSessionId ? { grokSessionId: input.grokSessionId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
  } catch {
    // board visibility is not a dispatch contract
  }
}

/**
 * B2 claim renewal (tsk_36ec8d02ad31c685): how often the claim is renewed while the
 * worker lives. Measured 2026-08-30: tsk_bca4085904e3b071 was claimed at 15:12:47Z
 * and returned to ready at 15:22:52Z with PID 79565 still alive and writing. Two
 * minutes is comfortably below the ~10-minute reaper while staying quiet.
 */
export const BOTHY_CLAIM_INTERVAL_MS = 2 * 60_000;

export type ClaimRenewalHooks = {
  intervalMs?: number;
  heartbeat?: (presence: BothyClaimPresence) => void | Promise<void>;
};

/**
 * Renew the exact Bothy claim while the worker lives. Returns a stop function the
 * caller runs when the worker exits — a stale renewer would keep a dead worker's
 * claim warm. Best-effort: a transient board failure must neither end renewal nor
 * the worker; the interval keeps running and retries.
 */
export function startBothyClaimRenewal(
  input: BothyClaimPresence,
  hooks?: ClaimRenewalHooks,
): () => void {
  const beat = hooks?.heartbeat ?? announceBothyClaimPresence;
  const every = hooks?.intervalMs ?? BOTHY_CLAIM_INTERVAL_MS;
  const timer = setInterval(() => {
    void Promise.resolve()
      .then(() => beat(input))
      .catch(() => {
        // board visibility is not a dispatch contract
      });
  }, every);
  timer.unref();
  return () => clearInterval(timer);
}
