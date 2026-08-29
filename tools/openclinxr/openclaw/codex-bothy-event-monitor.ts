/**
 * Codex BothyBoard wake bridge (pilot hardening).
 *
 * Quiet out-of-process poller: wakes one parked Codex session only on
 * meaningful deltas — new foreign comments on watched cards (mailbox-watch.json)
 * or a newly observed OpenClinXR ready card from a non-mutating BothyBoard
 * sync snapshot. Healthy idle
 * cycles emit no stdout and invoke no Codex model. Meaningful deltas coalesce
 * their event ids into a single codex delivery guarded by an atomic
 * single-flight lock.
 *
 * Bootstrap: on absent state the first clean poll baselines the current
 * foreign comment ids and the ready snapshot and emits nothing — historical
 * comments never wake the bridge (live-pilot fix: first run woke on 96
 * historical comments).
 *
 * Delivery: a meaningful delta spawns a FRESH bounded `codex exec` in the repo
 * (`--cd <repo> -s workspace-write`), never `codex exec resume` — resuming the
 * active Desktop session concurrently writes its thread history (live-pilot
 * defect). The wake prompt carries the self marker so the spawned agent's own
 * BothyBoard posts are filtered as self-echo, and instructs fail-closed
 * polling with no canonical no-op writes.
 *
 * Failure controls: DEGRADED after `degradedThreshold` consecutive transient
 * failures with bounded backoff and periodic STILL_DEGRADED output. Only a
 * permanent authentication/configuration failure stops the process. The
 * existing five-minute Codex heartbeat stays as fallback (out of scope to remove).
 *
 * State (seeded flag, seen comment ids, ready cache token, failure count) and
 * the lock live under .openclinxr/ (gitignored) — never canonical state.
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { bothyMcpCall, type BothyFetch } from "./board-bothy-dequeue.js";
import { pollForeignMailbox } from "./mailbox-watch.js";

export const DEFAULT_SELF_MARKER = "[codex-agent:agt_d85152e0024f10cd]";
export const MONITOR_STATE_REL = ".openclinxr/openclaw/codex-bothy-event-monitor-state.json";
export const MONITOR_LOCK_REL = ".openclinxr/openclaw/codex-bothy-event-monitor.lock";
export const DEFAULT_POLL_INTERVAL_MS = 45_000;
export const DEFAULT_DEGRADED_THRESHOLD = 3;
export const DEFAULT_STOP_THRESHOLD = 10;
export const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
export const DEFAULT_MONITOR_MAILBOX_TIMEOUT_MS = 5_000;
export const OPENCLINXR_PROJECT_ID = "prj_9b390b99b443a964";
export const DEFAULT_CODEX_COORDINATOR_MODEL = "gpt-5.6-luna";
export const DEFAULT_MAX_FANOUT = 3;

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
  maxFanout?: number;
  fetch?: BothyFetch;
  spawnCodex?: (prompt: string, repoRoot: string) => CodexChild;
  stateFile?: string;
  lockFile?: string;
  now?: () => number;
};

/** The only surface the monitor needs from the spawned codex process: an exit hook. */
export type CodexChild = {
  once(event: "exit", listener: () => void): unknown;
};

export type MonitorState = {
  seeded: boolean;
  seenCommentIds: string[];
  mailboxSinceByTaskId: Record<string, string>;
  lastReadyTaskId: string | null;
  lastReadyTaskIds: string[];
  cacheToken: string | null;
  consecutiveFailures: number;
};

export type MonitorCycleResult = {
  meaningful: boolean;
  eventIds: string[];
  degraded: boolean;
  stopped: boolean;
  permanentFailure: boolean;
  codexSpawned: boolean;
  codexRefused: boolean;
  stdoutLines: string[];
};

export function emptyMonitorState(): MonitorState {
  return {
    seeded: false,
    seenCommentIds: [],
    mailboxSinceByTaskId: {},
    lastReadyTaskId: null,
    lastReadyTaskIds: [],
    cacheToken: null,
    consecutiveFailures: 0,
  };
}

export function loadMonitorState(stateFile: string): MonitorState {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<MonitorState>;
    return {
      seeded: parsed.seeded === true,
      seenCommentIds: Array.isArray(parsed.seenCommentIds)
        ? parsed.seenCommentIds.filter((id): id is string => typeof id === "string")
        : [],
      mailboxSinceByTaskId:
        parsed.mailboxSinceByTaskId && typeof parsed.mailboxSinceByTaskId === "object"
          ? Object.fromEntries(
              Object.entries(parsed.mailboxSinceByTaskId).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
      lastReadyTaskId: typeof parsed.lastReadyTaskId === "string" ? parsed.lastReadyTaskId : null,
      lastReadyTaskIds: Array.isArray(parsed.lastReadyTaskIds)
        ? parsed.lastReadyTaskIds.filter((id): id is string => typeof id === "string")
        : typeof parsed.lastReadyTaskId === "string"
          ? [parsed.lastReadyTaskId]
          : [],
      cacheToken: typeof parsed.cacheToken === "string" ? parsed.cacheToken : null,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === "number" ? parsed.consecutiveFailures : 0,
    };
  } catch {
    return emptyMonitorState();
  }
}

export function saveMonitorState(stateFile: string, state: MonitorState): void {
  mkdirSync(dirname(stateFile), { recursive: true });
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

export function buildWakePrompt(
  eventIds: string[],
  selfMarker = DEFAULT_SELF_MARKER,
  maxFanout = DEFAULT_MAX_FANOUT,
): string {
  return [
    `BothyBoard wake: ${eventIds.length} meaningful event(s) [${eventIds.join(", ")}].`,
    "Use the bothy-board skill before acting. You are the Codex coordinator, not a product IC.",
    "Poll addressed mailbox task IDs first and operate fail-closed. Treat sync as a non-mutating hint only: it currently ignores projectId, so filter tasks strictly to OpenClinXR projectId prj_9b390b99b443a964 and never infer absence from sync. Call tasks.next only when actually dequeuing work.",
    "Board authority: you may post mailbox replies and update worker review/blocked/release/treatments status. Owner-only operations are create, plant, cancel, grade, fields, concurrency, and tasks.proofs.set; do not perform those without explicit owner scope.",
    `Fan out at most ${maxFanout} independent, non-overlapping, valid Planted cards after checking immutable bodies, write roots, RED/TREE contracts, and acquiring the repository lease.`,
    "Dispatch implementation workers explicitly to deepseek-v4-flash with modelDowngradeReason \"budget constraints\". Use deepseek-v4-flash-vision-exp only when the worker must inspect images. Luna is the Codex-native coordinator/triage fallback, not a substitute for the required DeepSeek worker route.",
    "Independently verify each diff and proof before any owner-authorized tasks.proofs.set. Do not write canonical no-op state.",
    "Never use a Stop-hook continuation loop or codex exec resume.",
    `Sign any BothyBoard posts with ${selfMarker}.`,
  ].join(" ");
}

/**
 * Fresh bounded one-shot delivery: `codex exec` in the repo with a
 * workspace-write sandbox. Never `codex exec resume` — resuming the active
 * Desktop session would concurrently write its thread history (live-pilot
 * defect). Each meaningful delta starts a NEW session instead.
 */
export const DEFAULT_CODEX_SANDBOX = "workspace-write";

export function buildCodexExecArgv(repoRoot: string, prompt: string): string[] {
  return [
    "exec",
    "--model",
    DEFAULT_CODEX_COORDINATOR_MODEL,
    "--cd",
    repoRoot,
    "-s",
    DEFAULT_CODEX_SANDBOX,
    prompt,
  ];
}

export function defaultSpawnCodex(prompt: string, repoRoot: string): CodexChild {
  const codexBin = process.env.CODEX_BIN?.trim() || "codex";
  return spawn(codexBin, buildCodexExecArgv(repoRoot, prompt), { stdio: "inherit" });
}

type BothySyncTask = { id?: unknown; projectId?: unknown };

export type OpenClinXrSyncSnapshot = {
  ok: boolean;
  permanentFailure: boolean;
  unchanged: boolean;
  cacheToken: string | null;
  scopedReadyIds: string[];
};

/**
 * Passive readiness probe. `sync` is currently board-buggy: projectId is
 * ignored and the payload is mixed/Harbor-headed. Consequently this function
 * accepts only ready IDs that can be joined to a task carrying the exact
 * OpenClinXR projectId. An empty result is UNKNOWN, never evidence that the
 * OpenClinXR ready set is empty.
 */
export async function pollOpenClinXrSync(opts: {
  pat: string;
  cacheToken: string | null;
  fetch?: BothyFetch;
}): Promise<OpenClinXrSyncSnapshot> {
  const fetchFn = opts.fetch ?? ((a) => bothyMcpCall(opts.pat, a.tool, a.arguments));
  const args: Record<string, unknown> = { projectId: OPENCLINXR_PROJECT_ID };
  if (opts.cacheToken) args.cacheToken = opts.cacheToken;
  try {
    const response = await fetchFn({ tool: "bothy-board.sync", arguments: args });
    if (response.httpStatus !== 200 || !response.structuredContent || typeof response.structuredContent !== "object") {
      return {
        ok: false,
        permanentFailure: response.httpStatus === 401 || response.httpStatus === 403,
        unchanged: false,
        cacheToken: null,
        scopedReadyIds: [],
      };
    }
    const sync = response.structuredContent as Record<string, unknown>;
    const cacheToken = typeof sync.cacheToken === "string" ? sync.cacheToken : opts.cacheToken;
    if (sync.unchanged === true) {
      return { ok: true, permanentFailure: false, unchanged: true, cacheToken, scopedReadyIds: [] };
    }
    const tasks = Array.isArray(sync.tasks) ? (sync.tasks as BothySyncTask[]) : [];
    const openClinXrTaskIds = new Set(
      tasks
        .filter((task) => task.projectId === OPENCLINXR_PROJECT_ID && typeof task.id === "string")
        .map((task) => task.id as string),
    );
    const readyIds = Array.isArray(sync.readyIds)
      ? sync.readyIds.filter((id): id is string => typeof id === "string")
      : [];
    return {
      ok: true,
      permanentFailure: false,
      unchanged: false,
      cacheToken,
      scopedReadyIds: readyIds.filter((id) => openClinXrTaskIds.has(id)).sort(),
    };
  } catch {
    return {
      ok: false,
      permanentFailure: false,
      unchanged: false,
      cacheToken: null,
      scopedReadyIds: [],
    };
  }
}

export async function runMonitorCycle(config: MonitorConfig): Promise<MonitorCycleResult> {
  const now = config.now ?? Date.now;
  const stateFile = config.stateFile ?? join(config.repoRoot, MONITOR_STATE_REL);
  const lockFile = config.lockFile ?? join(config.repoRoot, MONITOR_LOCK_REL);
  const degradedThreshold = config.degradedThreshold ?? DEFAULT_DEGRADED_THRESHOLD;
  const stopThreshold = config.stopThreshold ?? DEFAULT_STOP_THRESHOLD;
  mkdirSync(dirname(stateFile), { recursive: true });
  const state = loadMonitorState(stateFile);
  const stdoutLines: string[] = [];
  const eventIds: string[] = [];
  let cycleFailed = false;
  let permanentFailure = false;

  // 1. Mailbox — foreign comments only (self-echo filtered by author + body marker).
  const mailbox = await pollForeignMailbox({
    repoRoot: config.repoRoot,
    pat: config.pat,
    selfMarkers: [config.selfMarker],
    fetch: config.fetch,
    sinceByTaskId: state.mailboxSinceByTaskId,
    // The product-owner mailbox is intentionally long-lived and can exceed
    // mailbox-watch's interactive 2.5 s default. One tail-latency timeout must
    // not drive an otherwise healthy out-of-process monitor into STOP/restart.
    pollTimeoutMs: config.pollTimeoutMs ?? DEFAULT_MONITOR_MAILBOX_TIMEOUT_MS,
  });
  if (mailbox.pollErrors.length > 0) cycleFailed = true;
  if (mailbox.permanentPollErrors.length > 0) permanentFailure = true;
  const newCommentIds = mailbox.comments
    .map((comment) => comment.id)
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && !state.seenCommentIds.includes(id),
    );

  // 2. Passive ready hint — sync only; tasks.next is reserved for the woken
  // coordinator's actual dequeue. Strict task.projectId join counterweights
  // the current board bug where sync ignores projectId and returns mixed data.
  const sync = await pollOpenClinXrSync({
    pat: config.pat,
    cacheToken: state.cacheToken,
    fetch: config.fetch,
  });
  if (!sync.ok) cycleFailed = true;
  if (sync.permanentFailure) permanentFailure = true;
  const priorReadyIds = new Set(state.lastReadyTaskIds);
  const newReadyIds = sync.unchanged
    ? []
    : sync.scopedReadyIds.filter((id) => !priorReadyIds.has(id));
  const readyDelta = newReadyIds.length > 0;

  // 3. Bootstrap — absent (unseeded) state baselines history silently: record
  // the current foreign comment ids and the ready snapshot, emit nothing, and
  // never wake on pre-existing history. Seeding completes only on a clean read
  // of both polls, so the baseline always comes from the first healthy cycle.
  const firstRun = !state.seeded;
  let codexSpawned = false;
  let codexRefused = false;
  if (firstRun) {
    if (!cycleFailed) {
      state.seenCommentIds = [...new Set(newCommentIds)];
      state.mailboxSinceByTaskId = {
        ...state.mailboxSinceByTaskId,
        ...mailbox.latestCreatedAtByTaskId,
      };
      state.lastReadyTaskIds = sync.scopedReadyIds;
      state.lastReadyTaskId = sync.scopedReadyIds[0] ?? null;
      if (sync.cacheToken) state.cacheToken = sync.cacheToken;
      state.seeded = true;
    }
  } else if (newCommentIds.length > 0 || readyDelta) {
    eventIds.push(...newReadyIds.map((id) => `ready:${id}`));
    eventIds.unshift(...newCommentIds);
    if (acquireLock(lockFile, now(), config.lockStaleMs)) {
      try {
        const child = (config.spawnCodex ?? defaultSpawnCodex)(
          buildWakePrompt(eventIds, config.selfMarker, config.maxFanout),
          config.repoRoot,
        );
        child.once("exit", () => releaseLock(lockFile));
        codexSpawned = true;
        stdoutLines.push(`WAKE exec session=${config.sessionId} events=[${eventIds.join(", ")}]`);
      } catch (error) {
        releaseLock(lockFile);
        cycleFailed = true;
        stdoutLines.push(`SPAWN_FAILED ${String(error).slice(0, 160)}`);
      }
    } else {
      codexRefused = true;
      stdoutLines.push(
        `CODEX_REFUSED single-flight lock held; ${eventIds.length} event(s) coalesced and will retry`,
      );
    }
  }

  // Mark events handled ONLY when the wake fired (or there was no delta). A
  // refused or failed wake leaves events unseen so the next cycle retries.
  if (!firstRun && (codexSpawned || (newCommentIds.length === 0 && !readyDelta))) {
    if (newCommentIds.length > 0) {
      state.seenCommentIds = [...new Set([...state.seenCommentIds, ...newCommentIds])];
    }
    state.mailboxSinceByTaskId = {
      ...state.mailboxSinceByTaskId,
      ...mailbox.latestCreatedAtByTaskId,
    };
    if (sync.ok) {
      if (!sync.unchanged && sync.scopedReadyIds.length > 0) {
        // Empty is deliberately not used to clear state: sync cannot prove
        // OpenClinXR absence while project binding is broken board-side.
        state.lastReadyTaskIds = sync.scopedReadyIds;
        state.lastReadyTaskId = sync.scopedReadyIds[0] ?? state.lastReadyTaskId;
      }
      if (sync.cacheToken) state.cacheToken = sync.cacheToken;
    }
  }

  if (cycleFailed) {
    state.consecutiveFailures += 1;
  } else {
    state.consecutiveFailures = 0;
  }
  const degraded = state.consecutiveFailures >= degradedThreshold;
  // Authentication/configuration failures require operator repair. Network,
  // timeout, and server faults are transient: remain alive with bounded
  // backoff instead of converting a short outage into a permanent blind spot.
  const stopped = permanentFailure;
  if (stopped) {
    stdoutLines.push("STOP permanent BothyBoard authentication failure — halting monitor");
  } else if (degraded) {
    const label = state.consecutiveFailures % stopThreshold === 0 ? "STILL_DEGRADED" : "DEGRADED";
    stdoutLines.push(`${label} ${state.consecutiveFailures} consecutive transient failed cycles`);
  }

  saveMonitorState(stateFile, state);

  return {
    meaningful: !firstRun && (newCommentIds.length > 0 || readyDelta),
    eventIds,
    degraded,
    stopped,
    permanentFailure,
    codexSpawned,
    codexRefused,
    stdoutLines,
  };
}

export function monitorPollDelay(intervalMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return intervalMs;
  return intervalMs * 2 ** Math.min(consecutiveFailures, 3);
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
    const state = loadMonitorState(join(repoRoot, MONITOR_STATE_REL));
    await new Promise((resolve) =>
      setTimeout(resolve, monitorPollDelay(intervalMs, state.consecutiveFailures)),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await monitorMain();
}
