import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type BothyFetch, bothyMcpCall } from "./board-bothy-dequeue.js";

export const MAILBOX_WATCH_REL = "tools/openclinxr/openclaw/mailbox-watch.json";
export const MAILBOX_LOOKED_AT_REL = ".openclinxr/openclaw/mailbox-looked-at.json";
export const MAILBOX_DIGEST_SINCE_REL = ".openclinxr/openclaw/mailbox-digest-since.json";
export const DEFAULT_MAX_MAILBOX_TASKS_PER_PASS = 16;
export const MAX_LOOKED_AT_MAILBOX_TASKS = 32;

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
  return readTaskIdFile(join(repoRoot, MAILBOX_LOOKED_AT_REL)).slice(-MAX_LOOKED_AT_MAILBOX_TASKS);
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
  const incoming = [
    ...new Set(taskIds.filter((id) => typeof id === "string" && id.startsWith("tsk_"))),
  ];
  const incomingSet = new Set(incoming);
  const looked = [
    ...loadLookedAtTaskIds(repoRoot).filter((id) => !incomingSet.has(id)),
    ...incoming,
  ].slice(-MAX_LOOKED_AT_MAILBOX_TASKS);
  const path = join(repoRoot, MAILBOX_LOOKED_AT_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ taskIds: looked }, null, 2)}\n`);
}

/**
 * Comments carry no agentId and foreign agents' posts arrive as
 * authorName "member", so author-name filtering alone cannot tell self from
 * foreign. Self posts are additionally identified by a body marker
 * (`[codex-agent:…]`) embedded by the authoring agent. Harnesses that cannot
 * stamp bodies may additionally provide an exact self author name.
 */
export function isSelfComment(
  comment: PollComment,
  selfMarkers: string[] = [],
  selfAuthorNames: string[] = [],
): boolean {
  const body = comment.body ?? "";
  return (
    selfMarkers.some((marker) => marker.length > 0 && body.includes(marker)) ||
    selfAuthorNames.some((author) => author.length > 0 && comment.authorName === author)
  );
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
  nextPollAfterTaskId: string | null;
};

export type MailboxPollOptions = {
  repoRoot: string;
  pat?: string;
  selfMarkers?: string[];
  selfAuthorNames?: string[];
  fetch?: BothyFetch;
  pollTimeoutMs?: number;
  maxTasks?: number;
  pollAfterTaskId?: string | null;
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
      nextPollAfterTaskId: null,
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
      nextPollAfterTaskId: opts.pollAfterTaskId ?? null,
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
  const allPriorityIds = loadMailboxWatchTaskIds(opts.repoRoot);
  // If the explicit watch list fills the entire pass, reserve one slot for
  // the remaining union. Otherwise the first maxTasks priority ids turn every
  // later explicit/history/extra card into a permanently starved tail.
  const hasOverflow = taskIds.length > Math.min(allPriorityIds.length, maxTasks);
  const priorityLimit = hasOverflow ? Math.max(0, maxTasks - 1) : maxTasks;
  const priorityIds = allPriorityIds.slice(0, priorityLimit);
  const prioritySet = new Set(priorityIds);
  // A value-stable order lets the cursor survive removal from the current
  // membership. Insertion order cannot locate the cursor's former position.
  const rotatingIds = taskIds.filter((id) => !prioritySet.has(id)).sort();
  const rotatingBudget = Math.max(0, maxTasks - priorityIds.length);
  const pollAfterTaskId = opts.pollAfterTaskId ?? null;
  const previousIndex = pollAfterTaskId
    ? rotatingIds.indexOf(pollAfterTaskId)
    : -1;
  const successorIndex = pollAfterTaskId
    ? rotatingIds.findIndex((id) => id > pollAfterTaskId)
    : -1;
  const start = rotatingIds.length === 0
    ? 0
    : previousIndex >= 0
      ? (previousIndex + 1) % rotatingIds.length
      : successorIndex >= 0
        ? successorIndex
        : 0;
  const rotated = rotatingIds.length > 0
    ? [...rotatingIds.slice(start), ...rotatingIds.slice(0, start)].slice(0, rotatingBudget)
    : [];
  const polledTaskIds = [...priorityIds, ...rotated];
  const nextPollAfterTaskId = rotated.at(-1) ?? opts.pollAfterTaskId ?? null;
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
      const sinceCursor = opts.sinceByTaskId?.[taskId];
      const foreign = addressed.filter((comment) => {
        // Filter out self comments first
        if (isSelfComment(comment, markers, opts.selfAuthorNames)) {
          return false;
        }
        // Filter out comments at or before the since cursor for this taskId
        // A card with no stored cursor has no basis to filter: everything is new
        if (sinceCursor && typeof comment.createdAt === "string") {
          if (comment.createdAt <= sinceCursor) {
            return false;
          }
        }
        // A comment with no createdAt cannot be compared and must be reported
        // rather than silently dropped, because dropping it loses mail
        return true;
      });
      for (const comment of foreign) {
        if (
          typeof comment.createdAt === "string" &&
          comment.createdAt > (latestCreatedAtByTaskId[taskId] ?? "")
        ) {
          latestCreatedAtByTaskId[taskId] = comment.createdAt;
        }
      }
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
    nextPollAfterTaskId,
  };
}

export function loadDigestSinceByTaskId(repoRoot: string): Record<string, string> {
  try {
    const parsed = JSON.parse(
      readFileSync(join(repoRoot, MAILBOX_DIGEST_SINCE_REL), "utf8"),
    ) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function writeDigestSinceByTaskId(
  repoRoot: string,
  latest: Record<string, string>,
  watchedTaskIds: string[],
): void {
  const watched = new Set(watchedTaskIds);
  const merged = { ...loadDigestSinceByTaskId(repoRoot), ...latest };
  const next = Object.fromEntries(Object.entries(merged).filter(([taskId]) => watched.has(taskId)));
  const path = join(repoRoot, MAILBOX_DIGEST_SINCE_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Sync-safe digest for Stop-hook stdout. Missing PAT or network failure is
 * non-fatal: the loop still continues; the digest says why the poll was empty.
 */
export async function pollWatchedMailboxes(
  repoRoot: string,
  pat = process.env.BOTHY_BOARD_PAT ?? "",
  selfMarkers: string[] = [],
  fetch?: BothyFetch,
): Promise<string> {
  const taskIds = loadMailboxWatchTaskIds(repoRoot);
  if (taskIds.length === 0) {
    return "MAILBOX: watch list empty (tools/openclinxr/openclaw/mailbox-watch.json).";
  }
  if (!pat) {
    return "MAILBOX: BOTHY_BOARD_PAT unset — skipped poll.";
  }
  const result = await pollForeignMailbox({
    repoRoot,
    pat,
    selfMarkers,
    fetch,
    sinceByTaskId: loadDigestSinceByTaskId(repoRoot),
  });
  writeDigestSinceByTaskId(
    repoRoot,
    result.latestCreatedAtByTaskId,
    result.watchedTaskIds,
  );
  const { comments, pollErrors } = result;
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
