/**
 * Codex BothyBoard wake bridge (pilot).
 *
 * Quiet out-of-process poller: wakes one parked Codex session only on
 * meaningful deltas — new foreign comments on watched cards (mailbox-watch.json)
 * or a new ready card from the BothyBoard ready set (tasks.next). Healthy idle
 * cycles emit no stdout and invoke no Codex model. Meaningful deltas coalesce
 * their event ids into a single `codex exec resume <session> <prompt>` guarded
 * by an atomic single-flight lock.
 *
 * Failure controls: DEGRADED after `degradedThreshold` consecutive failed
 * cycles, STOP after `stopThreshold`. The existing five-minute Codex heartbeat
 * stays as fallback during the pilot (out of scope to remove).
 *
 * State (seen comment ids, ready cache token, failure count) and the lock live
 * under .openclinxr/ (gitignored) — never canonical state.
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  selectNextBothyCard,
  type BothyFetch,
  type BothyTokenStore,
} from "./board-bothy-dequeue.js";
import { pollForeignMailbox } from "./mailbox-watch.js";

export const DEFAULT_SELF_MARKER = "[codex-agent:agt_d85152e0024f10cd]";
export const MONITOR_STATE_REL = ".openclinxr/openclaw/codex-bothy-event-monitor-state.json";
export const MONITOR_LOCK_REL = ".openclinxr/openclaw/codex-bothy-event-monitor.lock";
export const DEFAULT_POLL_INTERVAL_MS = 45_000;
export const DEFAULT_DEGRADED_THRESHOLD = 3;
export const DEFAULT_STOP_THRESHOLD = 10;
export const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export type MonitorConfig = {
  pat: string;
  repoRoot: string;
  sessionId: string;
  selfMarker: string;
  machineName?: string;
  pollTimeoutMs?: number;
  degradedThreshold?: number;
  stopThreshold?: number;
  lockStaleMs?: number;
  fetch?: BothyFetch;
  spawnResume?: (sessionId: string, prompt: string) => ResumeChild;
  stateFile?: string;
  lockFile?: string;
  now?: () => number;
};

/** The only surface the monitor needs from the resumed process: an exit hook. */
export type ResumeChild = {
  once(event: "exit", listener: () => void): unknown;
};

export type MonitorState = {
  seenCommentIds: string[];
  lastReadyTaskId: string | null;
  cacheToken: string | null;
  consecutiveFailures: number;
};

export type MonitorCycleResult = {
  meaningful: boolean;
  eventIds: string[];
  degraded: boolean;
  stopped: boolean;
  resumeSpawned: boolean;
  resumeRefused: boolean;
  stdoutLines: string[];
};

export function emptyMonitorState(): MonitorState {
  return { seenCommentIds: [], lastReadyTaskId: null, cacheToken: null, consecutiveFailures: 0 };
}

export function loadMonitorState(stateFile: string): MonitorState {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<MonitorState>;
    return {
      seenCommentIds: Array.isArray(parsed.seenCommentIds)
        ? parsed.seenCommentIds.filter((id): id is string => typeof id === "string")
        : [],
      lastReadyTaskId: typeof parsed.lastReadyTaskId === "string" ? parsed.lastReadyTaskId : null,
      cacheToken: typeof parsed.cacheToken === "string" ? parsed.cacheToken : null,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === "number" ? parsed.consecutiveFailures : 0,
    };
  } catch {
    return emptyMonitorState();
  }
}

export function saveMonitorState(stateFile: string, state: MonitorState): void {
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Atomic single-flight lock: exclusive create; refuses while the owner lives. */
export function acquireLock(
  lockFile: string,
  now = Date.now(),
  staleMs = DEFAULT_LOCK_STALE_MS,
): boolean {
  try {
    const fd = openSync(lockFile, "wx");
    writeSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: now })}\n`);
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!lockIsStale(lockFile, now, staleMs)) return false;
    try {
      writeFileSync(lockFile, `${JSON.stringify({ pid: process.pid, createdAt: now })}\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

export function lockIsStale(
  lockFile: string,
  now = Date.now(),
  staleMs = DEFAULT_LOCK_STALE_MS,
): boolean {
  let pid: number | null = null;
  try {
    const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as { pid?: unknown };
    pid = typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return true; // unreadable lock is stale
  }
  if (pid !== null && pid > 0) {
    try {
      process.kill(pid, 0);
      return false; // owner process alive
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return false; // alive, other user
      return true; // ESRCH: owner gone
    }
  }
  try {
    const stat = statSync(lockFile);
    return now - stat.mtimeMs > staleMs;
  } catch {
    return true;
  }
}

/** Remove the lock only when we still own it. */
export function releaseLock(lockFile: string, ownerPid = process.pid): void {
  try {
    const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as { pid?: unknown };
    if (typeof parsed.pid === "number" && parsed.pid !== ownerPid) return;
    unlinkSync(lockFile);
  } catch {
    // already gone
  }
}

export function buildWakePrompt(eventIds: string[]): string {
  return `BothyBoard wake: ${eventIds.length} meaningful event(s) [${eventIds.join(", ")}]. Poll the BothyBoard mailbox and ready set, then continue the parked session.`;
}

export function defaultSpawnResume(sessionId: string, prompt: string): ResumeChild {
  return spawn("codex", ["exec", "resume", sessionId, prompt], { stdio: "inherit" });
}

export async function runMonitorCycle(config: MonitorConfig): Promise<MonitorCycleResult> {
  const now = config.now ?? Date.now;
  const stateFile = config.stateFile ?? join(config.repoRoot, MONITOR_STATE_REL);
  const lockFile = config.lockFile ?? join(config.repoRoot, MONITOR_LOCK_REL);
  const degradedThreshold = config.degradedThreshold ?? DEFAULT_DEGRADED_THRESHOLD;
  const stopThreshold = config.stopThreshold ?? DEFAULT_STOP_THRESHOLD;
  const machineName = config.machineName ?? hostname();
  const state = loadMonitorState(stateFile);
  const stdoutLines: string[] = [];
  const eventIds: string[] = [];
  let cycleFailed = false;

  // 1. Mailbox — foreign comments only (self-echo filtered by author + body marker).
  const mailbox = await pollForeignMailbox({
    repoRoot: config.repoRoot,
    pat: config.pat,
    selfMarkers: [config.selfMarker],
    fetch: config.fetch,
    pollTimeoutMs: config.pollTimeoutMs,
  });
  if (mailbox.pollErrors.length > 0) cycleFailed = true;
  const newCommentIds = mailbox.comments
    .map((comment) => comment.id)
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && !state.seenCommentIds.includes(id),
    );

  // 2. Ready set — tasks.next; unchanged replay of the same card is not a delta.
  let capturedToken = "";
  const store: BothyTokenStore = {
    read: () => ({
      task: state.lastReadyTaskId ? { id: state.lastReadyTaskId } : null,
      cacheToken: state.cacheToken,
    }),
    write: (snap) => {
      if (typeof snap.cacheToken === "string") capturedToken = snap.cacheToken;
    },
  };
  let next: Awaited<ReturnType<typeof selectNextBothyCard>> | null = null;
  try {
    next = await selectNextBothyCard({
      pat: config.pat,
      machineName,
      fetch: config.fetch,
      store,
      repoRoot: config.repoRoot,
    });
  } catch {
    cycleFailed = true;
  }
  if (next?.ok === false && next.reason === "incomplete-read") cycleFailed = true;
  const readyAnswered = next !== null && !(next.ok === false && next.reason === "incomplete-read");
  const readyTaskId = next?.ok ? next.taskId || null : null;
  const readyDelta = readyTaskId !== null && readyTaskId !== state.lastReadyTaskId;

  if (readyDelta && readyTaskId) eventIds.push(`ready:${readyTaskId}`);
  eventIds.unshift(...newCommentIds);
  const meaningful = newCommentIds.length > 0 || readyDelta;

  let resumeSpawned = false;
  let resumeRefused = false;
  if (meaningful) {
    if (acquireLock(lockFile, now(), config.lockStaleMs)) {
      try {
        const child = (config.spawnResume ?? defaultSpawnResume)(
          config.sessionId,
          buildWakePrompt(eventIds),
        );
        child.once("exit", () => releaseLock(lockFile));
        resumeSpawned = true;
        stdoutLines.push(`WAKE resume=${config.sessionId} events=[${eventIds.join(", ")}]`);
      } catch (error) {
        releaseLock(lockFile);
        cycleFailed = true;
        stdoutLines.push(`SPAWN_FAILED ${String(error).slice(0, 160)}`);
      }
    } else {
      resumeRefused = true;
      stdoutLines.push(
        `RESUME_REFUSED single-flight lock held; ${eventIds.length} event(s) coalesced and will retry`,
      );
    }
  }

  // Mark events handled ONLY when the wake fired (or there was no delta). A
  // refused or failed wake leaves events unseen so the next cycle retries.
  if (resumeSpawned || !meaningful) {
    if (newCommentIds.length > 0) {
      state.seenCommentIds = [...new Set([...state.seenCommentIds, ...newCommentIds])];
    }
    if (readyAnswered) {
      state.lastReadyTaskId = readyTaskId;
      if (capturedToken.length > 0) {
        state.cacheToken = capturedToken;
      }
    }
  }

  if (cycleFailed) {
    state.consecutiveFailures += 1;
  } else {
    state.consecutiveFailures = 0;
  }
  const degraded = state.consecutiveFailures >= degradedThreshold;
  const stopped = state.consecutiveFailures >= stopThreshold;
  if (stopped) {
    stdoutLines.push(`STOP ${state.consecutiveFailures} consecutive failed cycles — halting monitor`);
  } else if (degraded) {
    stdoutLines.push(`DEGRADED ${state.consecutiveFailures} consecutive failed cycles`);
  }

  saveMonitorState(stateFile, state);

  return {
    meaningful,
    eventIds,
    degraded,
    stopped,
    resumeSpawned,
    resumeRefused,
    stdoutLines,
  };
}

export type MonitorCliArgs = {
  sessionId: string;
  pat: string;
  repoRoot: string;
  intervalMs: number;
  selfMarker: string;
  machineName: string;
  once: boolean;
};

export function parseMonitorArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): { args: MonitorCliArgs } | { error: string } {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
  };
  const has = (name: string): boolean => argv.includes(name);
  const sessionId = value("--session") ?? env.CODEX_BOTHY_SESSION_ID ?? "";
  const pat = value("--pat") ?? env.BOTHY_BOARD_PAT ?? "";
  const repoRoot = value("--repo-root") ?? process.cwd();
  const intervalMs = Number(value("--interval-ms") ?? String(DEFAULT_POLL_INTERVAL_MS));
  const selfMarker = value("--self-marker") ?? DEFAULT_SELF_MARKER;
  const machineName = value("--machine-name") ?? env.BOTHY_MACHINE_NAME ?? hostname();
  const once = has("--once");
  if (!sessionId) {
    return { error: "missing --session <uuid> (or CODEX_BOTHY_SESSION_ID env)" };
  }
  if (!pat.startsWith("bb_pat_")) {
    return { error: "BOTHY_BOARD_PAT must be set and start with bb_pat_" };
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    return { error: "--interval-ms must be a number >= 1000" };
  }
  return { args: { sessionId, pat, repoRoot, intervalMs, selfMarker, machineName, once } };
}

export async function monitorMain(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseMonitorArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`codex-bothy-event-monitor: ${parsed.error}\n`);
    return 2;
  }
  const { sessionId, pat, repoRoot, intervalMs, selfMarker, machineName, once } = parsed.args;
  const config: MonitorConfig = { pat, repoRoot, sessionId, selfMarker, machineName };
  if (once) {
    const result = await runMonitorCycle(config);
    for (const line of result.stdoutLines) process.stdout.write(`${line}\n`);
    return result.stopped ? 1 : 0;
  }
  for (;;) {
    const result = await runMonitorCycle(config);
    for (const line of result.stdoutLines) process.stdout.write(`${line}\n`);
    if (result.stopped) return 1;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await monitorMain();
}
