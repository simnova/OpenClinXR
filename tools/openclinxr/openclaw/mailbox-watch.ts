import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type BothyFetch, bothyMcpCall } from "./board-bothy-dequeue.js";

export const MAILBOX_WATCH_REL = "tools/openclinxr/openclaw/mailbox-watch.json";
export const MAILBOX_LOOKED_AT_REL = ".openclinxr/openclaw/mailbox-looked-at.json";
export const DEFAULT_MAX_MAILBOX_TASKS_PER_PASS = 16;

/** Other Grok CEOs share authorName "grok-orchestrator". Never treat that name as self. */

type WatchFile = { taskIds?: string[] };

export type PollComment = {
  id?: string;
  taskId?: string;
  authorName?: string;
  body?: string;
  createdAt?: string;
};

function readTaskIdFile(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WatchFile;
    return (parsed.taskIds ?? []).filter((id) => typeof id === "string" && id.startsWith("tsk_"));
  } catch {
    return [];
  }
}

export function loadMailboxWatchTaskIds(repoRoot: string): string[] {
  return readTaskIdFile(join(repoRoot, MAILBOX_WATCH_REL));
}

export function loadLookedAtTaskIds(repoRoot: string): string[] {
  return readTaskIdFile(join(repoRoot, MAILBOX_LOOKED_AT_REL));
}

/** Union of the static watch file and cards this session has gotten/claimed. */
export function resolveMailboxWatchTaskIds(
  repoRoot: string,
  extraTaskIds: string[] = [],
): string[] {
  const merged = [
    ...loadMailboxWatchTaskIds(repoRoot),
    ...loadLookedAtTaskIds(repoRoot),
    ...extraTaskIds,
  ];
  return [...new Set(merged.filter((id) => typeof id === "string" && id.startsWith("tsk_")))];
}

export function rememberLookedAtTaskIds(repoRoot: string, taskIds: string[]): void {
  const looked = [
    ...new Set([
      ...loadLookedAtTaskIds(repoRoot),
      ...taskIds.filter((id) => typeof id === "string" && id.startsWith("tsk_")),
    ]),
  ];
  const path = join(repoRoot, MAILBOX_LOOKED_AT_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ taskIds: looked }, null, 2)}\n`);
}

/**
 * Comments carry no agentId and foreign agents' posts arrive as
 * authorName "member", so author-name filtering alone cannot tell self from
 * foreign. Self posts are additionally identified by a body marker
 * (`[codex-agent:…]`) embedded by the authoring agent.
 */
export function isSelfComment(comment: PollComment, selfMarkers: string[] = []): boolean {
  const body = comment.body ?? "";
  return selfMarkers.some((marker) => marker.length > 0 && body.includes(marker));
}

function formatComment(taskId: string, comment: PollComment): string {
  const author = comment.authorName ?? "unknown";
  const body = (comment.body ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  return `${taskId} ${author}: ${body}`;
}

export type ForeignMailboxResult = {
  comments: PollComment[];
  pollErrors: string[];
  permanentPollErrors: string[];
  latestCreatedAtByTaskId: Record<string, string>;
  polledTaskCount: number;
  watchedTaskCount: number;
  watchedTaskIds: string[];
  polledTaskIds: string[];
  successfulTaskIds: string[];
  nextPollOffset: number;
};

export type MailboxPollOptions = {
  repoRoot: string;
  pat?: string;
  selfMarkers?: string[];
  fetch?: BothyFetch;
  pollTimeoutMs?: number;
  maxTasks?: number;
  pollOffset?: number;
  sinceByTaskId?: Record<string, string>;
  extraTaskIds?: string[];
};

/**
 * Poll the watched taskIds and return foreign comments (structured, with ids)
 * plus per-task poll errors. `fetch` is injectable for tests; the default is
 * the authenticated BothyBoard JSON-RPC call.
 */
export async function pollForeignMailbox(
  opts: MailboxPollOptions,
): Promise<ForeignMailboxResult> {
  const taskIds = resolveMailboxWatchTaskIds(opts.repoRoot, opts.extraTaskIds);
  if (taskIds.length === 0) {
    return {
      comments: [],
      pollErrors: [],
      permanentPollErrors: [],
      latestCreatedAtByTaskId: {},
      polledTaskCount: 0,
      watchedTaskCount: 0,
      watchedTaskIds: [],
      polledTaskIds: [],
      successfulTaskIds: [],
      nextPollOffset: 0,
    };
  }
  const pat = opts.pat ?? process.env.BOTHY_BOARD_PAT ?? "";
  if (!pat) {
    return {
      comments: [],
      pollErrors: ["BOTHY_BOARD_PAT unset — skipped poll."],
      permanentPollErrors: ["BOTHY_BOARD_PAT unset — skipped poll."],
      latestCreatedAtByTaskId: {},
      polledTaskCount: 0,
      watchedTaskCount: taskIds.length,
      watchedTaskIds: taskIds,
      polledTaskIds: [],
      successfulTaskIds: [],
      nextPollOffset: opts.pollOffset ?? 0,
    };
  }
  const markers = opts.selfMarkers ?? [];
  const fetchFn = opts.fetch ?? ((args) => bothyMcpCall(pat, args.tool, args.arguments));
  const timeoutMs = opts.pollTimeoutMs ?? 2500;
  const maxTasks = Math.max(1, opts.maxTasks ?? DEFAULT_MAX_MAILBOX_TASKS_PER_PASS);
  // The checked-in watch file is the small, explicit priority set. Always
  // poll it first. Cards accumulated in the session-local looked-at file are
  // best-effort history and rotate through the remaining budget. The former
  // `slice(0, 64)` shape permanently starved newer looked-at cards once the
  // union crossed the cap and generated 64 requests every pass while idle.
  const priorityIds = loadMailboxWatchTaskIds(opts.repoRoot).slice(0, maxTasks);
  const prioritySet = new Set(priorityIds);
  const rotatingIds = taskIds.filter((id) => !prioritySet.has(id));
  const rotatingBudget = Math.max(0, maxTasks - priorityIds.length);
  const start = rotatingIds.length > 0
    ? Math.max(0, opts.pollOffset ?? 0) % rotatingIds.length
    : 0;
  const rotated = rotatingIds.length > 0
    ? [...rotatingIds.slice(start), ...rotatingIds.slice(0, start)].slice(0, rotatingBudget)
    : [];
  const polledTaskIds = [...priorityIds, ...rotated];
  const nextPollOffset = rotatingIds.length > 0
    ? (start + rotated.length) % rotatingIds.length
    : 0;
  const comments: PollComment[] = [];
  const pollErrors: string[] = [];
  const permanentPollErrors: string[] = [];
  const latestCreatedAtByTaskId: Record<string, string> = {};
  const successfulTaskIds: string[] = [];
  for (const taskId of polledTaskIds) {
    try {
      const args: Record<string, unknown> = { taskId };
      const since = opts.sinceByTaskId?.[taskId];
      if (since) args.since = since;
      const { structuredContent, httpStatus } = await Promise.race([
        fetchFn({ tool: "bothy-board.mailbox.poll", arguments: args }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
      if (httpStatus === 401 || httpStatus === 403) {
        const reason = `${taskId} poll_error:http_${httpStatus}`;
        pollErrors.push(reason);
        permanentPollErrors.push(reason);
        continue;
      }
      if (httpStatus < 200 || httpStatus >= 300) {
        pollErrors.push(`${taskId} poll_error:http_${httpStatus}`);
        continue;
      }
      successfulTaskIds.push(taskId);
      const sc = (structuredContent ?? {}) as { comments?: PollComment[]; unread?: number };
      const addressed = (sc.comments ?? []).map((comment) =>
        typeof comment.taskId === "string" ? comment : { ...comment, taskId },
      );
      for (const comment of addressed) {
        if (
          typeof comment.createdAt === "string" &&
          comment.createdAt > (latestCreatedAtByTaskId[taskId] ?? "")
        ) {
          latestCreatedAtByTaskId[taskId] = comment.createdAt;
        }
      }
      const foreign = addressed
        .filter((comment) => !isSelfComment(comment, markers));
      comments.push(...foreign);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "poll_failed";
      pollErrors.push(`${taskId} poll_error:${reason}`);
    }
  }
  return {
    comments,
    pollErrors,
    permanentPollErrors,
    latestCreatedAtByTaskId,
    polledTaskCount: polledTaskIds.length,
    watchedTaskCount: taskIds.length,
    watchedTaskIds: taskIds,
    polledTaskIds,
    successfulTaskIds,
    nextPollOffset,
  };
}

/**
 * Sync-safe digest for Stop-hook stdout. Missing PAT or network failure is
 * non-fatal: the loop still continues; the digest says why the poll was empty.
 */
export async function pollWatchedMailboxes(
  repoRoot: string,
  pat = process.env.BOTHY_BOARD_PAT ?? "",
  selfMarkers: string[] = [],
): Promise<string> {
  const taskIds = loadMailboxWatchTaskIds(repoRoot);
  if (taskIds.length === 0) {
    return "MAILBOX: watch list empty (tools/openclinxr/openclaw/mailbox-watch.json).";
  }
  if (!pat) {
    return "MAILBOX: BOTHY_BOARD_PAT unset — skipped poll.";
  }
  const { comments, pollErrors } = await pollForeignMailbox({ repoRoot, pat, selfMarkers });
  const lastByTask = new Map<string, PollComment>();
  for (const comment of comments) {
    lastByTask.set(comment.taskId ?? "?", comment);
  }
  const lines = [...pollErrors];
  for (const [taskId, comment] of lastByTask) {
    lines.push(formatComment(taskId, comment));
  }
  if (lines.length === 0) {
    return `MAILBOX: polled ${taskIds.length} card(s); no foreign comments.`;
  }
  return `MAILBOX:\n${lines.join("\n")}`.slice(0, 1800);
}
