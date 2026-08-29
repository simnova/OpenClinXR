import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bothyMcpCall, type BothyFetch } from "./board-bothy-dequeue.js";

export const MAILBOX_WATCH_REL = "tools/openclinxr/openclaw/mailbox-watch.json";

const SELF_AUTHORS = new Set(["orchestrator-019ff803", "grok-orchestrator"]);

type WatchFile = { taskIds?: string[] };

export type PollComment = {
  id?: string;
  taskId?: string;
  authorName?: string;
  body?: string;
  createdAt?: string;
};

export function loadMailboxWatchTaskIds(repoRoot: string): string[] {
  const path = join(repoRoot, MAILBOX_WATCH_REL);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WatchFile;
    return (parsed.taskIds ?? []).filter((id) => typeof id === "string" && id.startsWith("tsk_"));
  } catch {
    return [];
  }
}

/**
 * Comments carry no agentId and foreign agents' posts arrive as
 * authorName "member", so author-name filtering alone cannot tell self from
 * foreign. Self posts are additionally identified by a body marker
 * (`[codex-agent:…]`) embedded by the authoring agent.
 */
export function isSelfComment(comment: PollComment, selfMarkers: string[] = []): boolean {
  const author = comment.authorName ?? "";
  if (SELF_AUTHORS.has(author)) return true;
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
  polledTaskCount: number;
};

export type MailboxPollOptions = {
  repoRoot: string;
  pat?: string;
  selfMarkers?: string[];
  fetch?: BothyFetch;
  pollTimeoutMs?: number;
  maxTasks?: number;
};

/**
 * Poll the watched taskIds and return foreign comments (structured, with ids)
 * plus per-task poll errors. `fetch` is injectable for tests; the default is
 * the authenticated BothyBoard JSON-RPC call.
 */
export async function pollForeignMailbox(
  opts: MailboxPollOptions,
): Promise<ForeignMailboxResult> {
  const taskIds = loadMailboxWatchTaskIds(opts.repoRoot);
  if (taskIds.length === 0) {
    return { comments: [], pollErrors: [], polledTaskCount: 0 };
  }
  const pat = opts.pat ?? process.env.BOTHY_BOARD_PAT ?? "";
  if (!pat) {
    return { comments: [], pollErrors: ["BOTHY_BOARD_PAT unset — skipped poll."], polledTaskCount: 0 };
  }
  const markers = opts.selfMarkers ?? [];
  const fetchFn = opts.fetch ?? ((args) => bothyMcpCall(pat, args.tool, args.arguments));
  const timeoutMs = opts.pollTimeoutMs ?? 2500;
  const maxTasks = opts.maxTasks ?? 8;
  const comments: PollComment[] = [];
  const pollErrors: string[] = [];
  for (const taskId of taskIds.slice(0, maxTasks)) {
    try {
      const { structuredContent } = await Promise.race([
        fetchFn({ tool: "bothy-board.mailbox.poll", arguments: { taskId } }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
      const sc = (structuredContent ?? {}) as { comments?: PollComment[]; unread?: number };
      const foreign = (sc.comments ?? [])
        .map((comment) => (typeof comment.taskId === "string" ? comment : { ...comment, taskId }))
        .filter((comment) => !isSelfComment(comment, markers));
      comments.push(...foreign);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "poll_failed";
      pollErrors.push(`${taskId} poll_error:${reason}`);
    }
  }
  return { comments, pollErrors, polledTaskCount: Math.min(taskIds.length, maxTasks) };
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
