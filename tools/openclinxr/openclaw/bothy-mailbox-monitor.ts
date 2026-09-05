/**
 * Grok-native Bothy mailbox watcher. Stdout is the event stream for the
 * harness `monitor` tool: print only DONE | FAILED | CANCELLED.
 *
 * Seed tick remembers existing comment ids, the current tasks.next id, and
 * looked-at updatedAt stamps, and is silent. Later ticks print DONE when:
 *   - a new foreign mailbox comment appears on the watch ∪ looked-at set
 *   - tasks.next identity changes (new Planted+ready leaf, or queue went empty)
 *   - a looked-at card's updatedAt moved (status/factory/proofs without a comment)
 * Transient poll faults back off and never abort. Permanent faults print FAILED.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { hostname } from "node:os";

import { bothyMcpCall, type BothyFetch } from "./board-bothy-dequeue.js";
import {
  loadMailboxWatchTaskIds,
  pollForeignMailbox,
  type MailboxPollOptions,
} from "./mailbox-watch.js";

export const GROK_MAILBOX_SELF_PREFIX = "[grok-orchestrator:";
export const MAILBOX_SINCE_REL = ".openclinxr/openclaw/mailbox-since.json";
export const MAILBOX_SEEN_REL = ".openclinxr/openclaw/mailbox-seen-ids.txt";
export const GROK_MONITOR_STATE_REL = ".openclinxr/openclaw/grok-mailbox-monitor-state.json";

export type MailboxFailureClass = "permanent" | "transient";

export function classifyMailboxFailure(reason: string): MailboxFailureClass {
  if (/http_401|http_403|BOTHY_BOARD_PAT unset|invalid token/i.test(reason)) {
    return "permanent";
  }
  return "transient";
}

export function nextMailboxBackoffMs(consecutiveTransient: number, baseMs = 45_000): number {
  if (consecutiveTransient <= 0) return baseMs;
  return baseMs * Math.min(consecutiveTransient, 8);
}

export function shouldAbortMailboxWatch(opts: {
  patPresent: boolean;
  permanentErrorCount: number;
}): boolean {
  return !opts.patPresent || opts.permanentErrorCount > 0;
}

export type MonitorEmit = "DONE" | "FAILED" | null;

export function decideMailboxMonitorTick(input: {
  isSeed: boolean;
  newForeignIds: string[];
  readyTaskChanged?: boolean;
  lookedAtUpdated?: boolean;
  patPresent: boolean;
  permanentErrorCount: number;
}): { emit: MonitorEmit; abort: boolean } {
  if (shouldAbortMailboxWatch(input)) {
    return { emit: "FAILED", abort: true };
  }
  if (input.isSeed) return { emit: null, abort: false };
  if (input.newForeignIds.length > 0) return { emit: "DONE", abort: false };
  if (input.readyTaskChanged) return { emit: "DONE", abort: false };
  if (input.lookedAtUpdated) return { emit: "DONE", abort: false };
  return { emit: null, abort: false };
}

export type GrokMonitorBoardState = {
  lastReadyTaskId: string | null;
  cacheToken: string | null;
  lastUpdatedAtByTaskId: Record<string, string>;
};

export function emptyGrokMonitorBoardState(): GrokMonitorBoardState {
  return { lastReadyTaskId: null, cacheToken: null, lastUpdatedAtByTaskId: {} };
}

export function loadGrokMonitorBoardState(repoRoot: string): GrokMonitorBoardState {
  const path = join(repoRoot, GROK_MONITOR_STATE_REL);
  if (!existsSync(path)) return emptyGrokMonitorBoardState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GrokMonitorBoardState>;
    return {
      lastReadyTaskId: parsed.lastReadyTaskId ?? null,
      cacheToken: parsed.cacheToken ?? null,
      lastUpdatedAtByTaskId:
        parsed.lastUpdatedAtByTaskId && typeof parsed.lastUpdatedAtByTaskId === "object"
          ? parsed.lastUpdatedAtByTaskId
          : {},
    };
  } catch {
    return emptyGrokMonitorBoardState();
  }
}

export function writeGrokMonitorBoardState(repoRoot: string, state: GrokMonitorBoardState): void {
  const path = join(repoRoot, GROK_MONITOR_STATE_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function readyTaskChanged(
  previousId: string | null,
  nextId: string | null,
): boolean {
  return previousId !== nextId;
}

export function lookedAtCardsUpdated(
  previous: Record<string, string>,
  current: Record<string, string>,
): boolean {
  for (const [id, updatedAt] of Object.entries(current)) {
    if (!updatedAt) continue;
    if (!(id in previous)) continue;
    if (updatedAt !== previous[id]) return true;
  }
  return false;
}

export function grokMailboxSelfMarkers(sessionId = process.env.GROK_SESSION_ID ?? ""): string[] {
  const markers = [GROK_MAILBOX_SELF_PREFIX];
  if (sessionId) markers.push(`[grok-orchestrator:${sessionId}]`);
  return markers;
}

type SinceFile = Record<string, string>;

export function loadSinceByTaskId(repoRoot: string): Record<string, string> {
  const path = join(repoRoot, MAILBOX_SINCE_REL);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SinceFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSinceByTaskId(repoRoot: string, latest: Record<string, string>): void {
  const path = join(repoRoot, MAILBOX_SINCE_REL);
  mkdirSync(dirname(path), { recursive: true });
  const prev = loadSinceByTaskId(repoRoot);
  writeFileSync(path, `${JSON.stringify({ ...prev, ...latest }, null, 2)}\n`);
}

export function loadSeenCommentIds(repoRoot: string): Set<string> {
  const path = join(repoRoot, MAILBOX_SEEN_REL);
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export function rememberCommentIds(repoRoot: string, ids: string[]): void {
  if (ids.length === 0) return;
  const path = join(repoRoot, MAILBOX_SEEN_REL);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${ids.join("\n")}\n`);
}

export async function pollBoardDeltas(opts: {
  repoRoot: string;
  pat: string;
  fetch?: BothyFetch;
  machineName?: string;
  previous: GrokMonitorBoardState;
}): Promise<{
  nextId: string | null;
  readyChanged: boolean;
  lookedAtUpdated: boolean;
  nextState: GrokMonitorBoardState;
}> {
  const fetchFn = opts.fetch ?? ((args) => bothyMcpCall(opts.pat, args.tool, args.arguments));
  const machineName = opts.machineName ?? hostname();
  let nextId: string | null = opts.previous.lastReadyTaskId;
  let cacheToken = opts.previous.cacheToken;
  try {
    const { structuredContent, httpStatus } = await fetchFn({
      tool: "bothy-board.tasks.next",
      arguments: {
        machineName,
        ...(cacheToken ? { cacheToken } : {}),
      },
    });
    if (httpStatus >= 200 && httpStatus < 300) {
      const sc = (structuredContent ?? {}) as {
        task?: { id?: string; parentId?: string } | null;
        cacheToken?: string | null;
      };
      if (typeof sc.cacheToken === "string") cacheToken = sc.cacheToken;
      nextId = sc.task?.id ?? null;
      if (nextId) {
        // Watched ids persist in mailbox-watch.json; the seed pass covers the
        // current ready id via the watch file, so nothing to record here.
      }
    }
  } catch {
    nextId = opts.previous.lastReadyTaskId;
  }

  const updatedAtByTaskId: Record<string, string> = { ...opts.previous.lastUpdatedAtByTaskId };
  const lookedAt = loadMailboxWatchTaskIds(opts.repoRoot);
  for (const taskId of lookedAt) {
    try {
      const { structuredContent, httpStatus } = await fetchFn({
        tool: "bothy-board.tasks.get",
        arguments: { taskId },
      });
      if (httpStatus < 200 || httpStatus >= 300) continue;
      const sc = (structuredContent ?? {}) as { task?: { updatedAt?: string } };
      const updatedAt = sc.task?.updatedAt;
      if (typeof updatedAt === "string") updatedAtByTaskId[taskId] = updatedAt;
    } catch {
      /* looked-at get is best-effort; mailbox still covers comments */
    }
  }

  const nextState: GrokMonitorBoardState = {
    lastReadyTaskId: nextId,
    cacheToken,
    lastUpdatedAtByTaskId: updatedAtByTaskId,
  };
  return {
    nextId,
    readyChanged: readyTaskChanged(opts.previous.lastReadyTaskId, nextId),
    lookedAtUpdated: lookedAtCardsUpdated(
      opts.previous.lastUpdatedAtByTaskId,
      updatedAtByTaskId,
    ),
    nextState,
  };
}

export async function runMailboxMonitorPass(
  opts: MailboxPollOptions & { isSeed: boolean; seen: Set<string> },
): Promise<{ emit: MonitorEmit; abort: boolean; newIds: string[] }> {
  const patPresent = Boolean(opts.pat ?? process.env.BOTHY_BOARD_PAT);
  if (!patPresent) {
    return { emit: "FAILED", abort: true, newIds: [] };
  }
  const pat = opts.pat ?? process.env.BOTHY_BOARD_PAT ?? "";
  const result = await pollForeignMailbox({
    ...opts,
    selfMarkers: opts.selfMarkers ?? grokMailboxSelfMarkers(),
    sinceByTaskId: opts.sinceByTaskId ?? loadSinceByTaskId(opts.repoRoot),
    pollTimeoutMs: opts.pollTimeoutMs ?? 5_000,
  });
  const permanent = result.permanentPollErrors.length;
  const newIds: string[] = [];
  for (const comment of result.comments) {
    const id = comment.id ?? "";
    if (!id || opts.seen.has(id)) continue;
    opts.seen.add(id);
    newIds.push(id);
  }
  writeSinceByTaskId(opts.repoRoot, result.latestCreatedAtByTaskId);
  rememberCommentIds(opts.repoRoot, newIds);

  const previous = loadGrokMonitorBoardState(opts.repoRoot);
  const board = await pollBoardDeltas({
    repoRoot: opts.repoRoot,
    pat,
    fetch: opts.fetch,
    previous,
  });
  if (opts.isSeed) {
    writeGrokMonitorBoardState(opts.repoRoot, board.nextState);
  } else {
    writeGrokMonitorBoardState(opts.repoRoot, board.nextState);
  }

  const decision = decideMailboxMonitorTick({
    isSeed: opts.isSeed,
    newForeignIds: newIds,
    readyTaskChanged: board.readyChanged,
    lookedAtUpdated: board.lookedAtUpdated,
    patPresent: true,
    permanentErrorCount: permanent,
  });
  return { ...decision, newIds };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const seen = loadSeenCommentIds(repoRoot);
  const seed = await runMailboxMonitorPass({ repoRoot, isSeed: true, seen });
  if (seed.abort) {
    process.stdout.write("FAILED\n");
    process.exit(1);
  }
  let transient = 0;
  for (;;) {
    const delay = nextMailboxBackoffMs(transient);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const pass = await runMailboxMonitorPass({ repoRoot, isSeed: false, seen });
      if (pass.abort) {
        process.stdout.write("FAILED\n");
        process.exit(1);
      }
      transient = 0;
      if (pass.emit === "DONE") process.stdout.write("DONE\n");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "poll_failed";
      if (classifyMailboxFailure(reason) === "permanent") {
        process.stdout.write("FAILED\n");
        process.exit(1);
      }
      transient += 1;
    }
  }
}

if (process.argv[1]?.includes("bothy-mailbox-monitor")) {
  void main();
}
