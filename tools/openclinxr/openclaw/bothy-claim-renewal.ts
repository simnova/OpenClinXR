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

export type PidBoundRenewalHooks = ClaimRenewalHooks & {
  pid: number;
  isAlive?: (pid: number) => boolean;
  onExit?: () => void;
};

/** Liveness probe — signal 0 succeeds for a live process and throws for a dead one. */
export function defaultPidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renew the claim until a worker PID disappears, then stop itself. The caller does
 * not need to remember stop(): the tick checks liveness first, so at most one
 * interval passes between the worker's death and the last heartbeat attempt — a
 * dead worker's claim goes cold and the reaper can take it. Best-effort like the
 * manual starter. The timer is left referenced so a standalone CLI process running
 * only this loop stays alive; dispatch() keeps using startBothyClaimRenewal.
 */
export function startPidBoundClaimRenewal(
  input: BothyClaimPresence,
  hooks: PidBoundRenewalHooks,
): () => void {
  const beat = hooks.heartbeat ?? announceBothyClaimPresence;
  const every = hooks.intervalMs ?? BOTHY_CLAIM_INTERVAL_MS;
  const alive = hooks.isAlive ?? defaultPidIsAlive;
  const target = hooks.pid;
  const timer = setInterval(() => {
    if (!alive(target)) {
      clearInterval(timer);
      hooks.onExit?.();
      return;
    }
    void Promise.resolve()
      .then(() => beat(input))
      .catch(() => {
        // board visibility is not a dispatch contract
      });
  }, every);
  return () => clearInterval(timer);
}

export type ClaimRenewerCliArgs = {
  taskId: string;
  pid: number;
  agentId?: string;
  grokSessionId?: string;
};

/** Parse the standalone renewer CLI flags; null when required flags are absent. */
export function parseClaimRenewerArgs(argv: readonly string[]): ClaimRenewerCliArgs | null {
  let taskId: string | undefined;
  let pidRaw: string | undefined;
  let agentId: string | undefined;
  let grokSessionId: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--task") {
      taskId = argv[i + 1];
      i += 1;
    } else if (arg === "--pid") {
      pidRaw = argv[i + 1];
      i += 1;
    } else if (arg === "--agent") {
      agentId = argv[i + 1];
      i += 1;
    } else if (arg === "--session") {
      grokSessionId = argv[i + 1];
      i += 1;
    }
  }
  const pid = pidRaw === undefined ? Number.NaN : Number(pidRaw);
  if (!taskId || !Number.isInteger(pid)) return null;
  return {
    taskId,
    pid,
    ...(agentId ? { agentId } : {}),
    ...(grokSessionId ? { grokSessionId } : {}),
  };
}

/**
 * Standalone entry for harness-native spawns:
 *   pnpm exec tsx tools/openclinxr/openclaw/bothy-claim-renewal.ts \
 *     --task <taskId> --pid <workerPid> [--agent <agentId>] [--session <grokSessionId>]
 * Returns a process exit code without exiting, so tests can call it. On success the
 * caller must NOT exit: the referenced renewal timer keeps the process alive until
 * the worker pid disappears, then onExit stops renewal and exits 0.
 */
export function claimRenewerCliMain(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): number {
  const parsed = parseClaimRenewerArgs(argv);
  if (!parsed) {
    process.stderr.write("bothy-claim-renewal: --task <taskId> --pid <workerPid> required\n");
    return 2;
  }
  if (!env.BOTHY_BOARD_PAT) {
    process.stderr.write("bothy-claim-renewal: BOTHY_BOARD_PAT is not set — no network call made\n");
    return 2;
  }
  const presence: BothyClaimPresence = {
    path: process.cwd(),
    branch: "standalone",
    taskId: parsed.taskId,
    ...(parsed.agentId ? { agentId: parsed.agentId } : {}),
    ...(parsed.grokSessionId ? { grokSessionId: parsed.grokSessionId } : {}),
  };
  void announceBothyClaimPresence(presence);
  startPidBoundClaimRenewal(presence, {
    pid: parsed.pid,
    onExit: () => process.exit(0),
  });
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = claimRenewerCliMain(process.argv.slice(2), process.env);
  if (code !== 0) process.exit(code);
}
