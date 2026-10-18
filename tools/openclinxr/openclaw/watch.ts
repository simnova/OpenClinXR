/**
 * watch — script-only watcher loop for long agent sessions. No LLM calls.
 *
 * Sources by flag: --result <path> (repeatable), --log <path> (push-queue
 * output; new lines only), --board-cmd "<cmd>" (a changed output emits one
 * line), --worker <pid>:<transcriptPath> (repeatable).
 *
 * Exactly one line per event, nothing otherwise:
 *   READY  — a new line starting READY, or a RESULT whose last line becomes STATUS: done
 *   FAIL   — a new line matching /\b(FAIL|ERROR|GAVE_UP)\b/
 *   DECISION — a new line starting DECISION
 *   STALL  — worker pid alive but transcript unchanged for --stall seconds (default 600)
 *   EXIT   — worker pid gone
 * An unchanged file emits nothing. State lives in memory.
 *
 * Loop mode baselines on the first tick: existing log content, RESULT states,
 * board output and worker presence are recorded with nothing emitted, so
 * starting the watcher on an old log does not replay history. --once keeps
 * reporting everything, including pre-existing content.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

export const DEFAULT_INTERVAL_S = 30;
export const DEFAULT_STALL_S = 600;

export type LogSnapshot = { path: string; newLines: string[] };
export type ResultSnapshot = { path: string; lastLine: string | null };
export type WorkerSnapshot = { pid: number; alive: boolean; transcriptMtimeMs: number | null };

export type WatchSnapshot = {
  results: ResultSnapshot[];
  logs: LogSnapshot[];
  board: { output: string | null };
  workers: WorkerSnapshot[];
  nowMs: number;
  stallMs: number;
};

export type WatchState = {
  results: Record<string, string | null>;
  boardSeen: boolean;
  boardLast: string | null;
  workers: Record<string, { lastMtimeMs: number | null; unchangedSinceMs: number; stalledNotified: boolean }>;
  exited: Record<string, true>;
};

export function emptyWatchState(): WatchState {
  return { results: {}, boardSeen: false, boardLast: null, workers: {}, exited: {} };
}

const FAIL_RE = /\b(FAIL|ERROR|GAVE_UP)\b/;

export type TickOptions = { baseline?: boolean };

export function tick(
  prev: WatchState,
  snap: WatchSnapshot,
  opts: TickOptions = {},
): { state: WatchState; lines: string[] } {
  const lines: string[] = [];
  const state: WatchState = {
    results: { ...prev.results },
    boardSeen: prev.boardSeen,
    boardLast: prev.boardLast,
    workers: Object.fromEntries(Object.entries(prev.workers).map(([k, v]) => [k, { ...v }])),
    exited: { ...prev.exited },
  };

  for (const log of snap.logs) {
    for (const line of log.newLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("READY")) lines.push(`READY ${log.path}: ${trimmed}`);
      else if (trimmed.startsWith("DECISION")) lines.push(`DECISION ${log.path}: ${trimmed}`);
      else if (FAIL_RE.test(trimmed)) lines.push(`FAIL ${log.path}: ${trimmed}`);
    }
  }

  for (const result of snap.results) {
    const before = state.results[result.path];
    state.results[result.path] = result.lastLine;
    if (result.lastLine !== null && result.lastLine.trim() === "STATUS: done" && before?.trim() !== "STATUS: done") {
      lines.push(`READY ${result.path}: STATUS: done`);
    }
  }

  if (snap.board.output !== null) {
    if (state.boardSeen && snap.board.output !== state.boardLast) {
      lines.push(`BOARD changed: ${snap.board.output.slice(0, 200)}`);
    }
    state.boardSeen = true;
    state.boardLast = snap.board.output;
  }

  for (const worker of snap.workers) {
    const key = String(worker.pid);
    if (!worker.alive) {
      if (!state.exited[key]) {
        lines.push(`EXIT worker ${worker.pid}`);
        state.exited[key] = true;
      }
      delete state.workers[key];
      continue;
    }
    const known = state.workers[key];
    if (!known) {
      state.workers[key] = {
        lastMtimeMs: worker.transcriptMtimeMs,
        unchangedSinceMs: snap.nowMs,
        stalledNotified: false,
      };
      continue;
    }
    if (worker.transcriptMtimeMs !== known.lastMtimeMs) {
      known.lastMtimeMs = worker.transcriptMtimeMs;
      known.unchangedSinceMs = snap.nowMs;
      known.stalledNotified = false;
      continue;
    }
    if (!known.stalledNotified && snap.nowMs - known.unchangedSinceMs >= snap.stallMs) {
      const secs = Math.round((snap.nowMs - known.unchangedSinceMs) / 1000);
      lines.push(`STALL worker ${worker.pid} transcript unchanged ${secs}s`);
      known.stalledNotified = true;
    }
  }

  return { state, lines: opts.baseline ? [] : lines };
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function tailFromOffset(path: string, offset: number): { newLines: string[]; offset: number } {
  const text = readText(path);
  if (text === null) return { newLines: [], offset };
  if (text.length < offset) offset = 0;
  const fresh = text.slice(offset);
  const newLines = fresh.split("\n").filter((l) => l.length > 0);
  return { newLines, offset: text.length };
}

function lastNonEmptyLine(text: string | null): string | null {
  if (text === null) return null;
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.at(-1) ?? null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function transcriptMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function boardOutput(cmd: string | null): string | null {
  if (!cmd) return null;
  try {
    return execFileSync("sh", ["-c", cmd], { encoding: "utf8", timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

function parseFlags(argv: string[]): {
  results: string[];
  logs: string[];
  boardCmd: string | null;
  workers: { pid: number; transcript: string }[];
  intervalS: number;
  stallS: number;
  once: boolean;
} {
  const out = {
    results: [] as string[],
    logs: [] as string[],
    boardCmd: null as string | null,
    workers: [] as { pid: number; transcript: string }[],
    intervalS: DEFAULT_INTERVAL_S,
    stallS: DEFAULT_STALL_S,
    once: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--once") continue;
    if (value === undefined) throw new Error(`flag ${flag} needs a value`);
    if (flag === "--result") out.results.push(value);
    else if (flag === "--log") out.logs.push(value);
    else if (flag === "--board-cmd") out.boardCmd = value;
    else if (flag === "--worker") {
      const sep = value.lastIndexOf(":");
      const pid = Number(value.slice(0, sep));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`bad --worker ${value}`);
      out.workers.push({ pid, transcript: value.slice(sep + 1) });
    } else if (flag === "--interval") out.intervalS = Number(value);
    else if (flag === "--stall") out.stallS = Number(value);
    else throw new Error(`unknown flag ${flag}`);
    i += 1;
  }
  out.once = argv.includes("--once");
  if (!Number.isFinite(out.intervalS) || out.intervalS <= 0) throw new Error("bad --interval");
  if (!Number.isFinite(out.stallS) || out.stallS <= 0) throw new Error("bad --stall");
  return out;
}

const invokedDirectly = process.argv[1]?.endsWith("watch.ts") ?? false;
if (invokedDirectly) {
  let flags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`usage: watch.ts [--result <p> ...] [--log <p> ...] [--board-cmd "<cmd>"] [--worker <pid>:<transcript> ...] [--interval <s>] [--stall <s>] [--once]\n--once reports everything, including pre-existing content; loop mode baselines on the first tick and only reports what changes after.\n${String(error)}\n`);
    process.exit(2);
  }
  const offsets = new Map<string, number>();
  let state = emptyWatchState();
  let firstTick = !flags.once;
  const runOnce = (): void => {
    const nowMs = Date.now();
    const logs: LogSnapshot[] = flags.logs.map((path) => {
      const { newLines, offset } = tailFromOffset(path, offsets.get(path) ?? 0);
      offsets.set(path, offset);
      return { path, newLines };
    });
    const snap: WatchSnapshot = {
      results: flags.results.map((path) => ({ path, lastLine: lastNonEmptyLine(readText(path)) })),
      logs,
      board: { output: boardOutput(flags.boardCmd) },
      workers: flags.workers.map((w) => ({
        pid: w.pid,
        alive: pidAlive(w.pid),
        transcriptMtimeMs: transcriptMtime(w.transcript),
      })),
      nowMs,
      stallMs: flags.stallS * 1000,
    };
    const out = tick(state, snap, firstTick ? { baseline: true } : {});
    state = out.state;
    firstTick = false;
    for (const line of out.lines) process.stdout.write(`${line}\n`);
  };
  if (flags.once) {
    runOnce();
  } else {
    for (;;) {
      runOnce();
      execFileSync("sleep", [String(flags.intervalS)]);
    }
  }
}
