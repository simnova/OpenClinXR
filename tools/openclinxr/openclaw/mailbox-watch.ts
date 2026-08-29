import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bothyMcpCall } from "./board-bothy-dequeue.js";

export const MAILBOX_WATCH_REL = "tools/openclinxr/openclaw/mailbox-watch.json";

const SELF_AUTHORS = new Set(["orchestrator-019ff803", "grok-orchestrator"]);

type WatchFile = { taskIds?: string[] };

type PollComment = { id?: string; authorName?: string; body?: string; createdAt?: string };

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

function formatComment(taskId: string, comment: PollComment): string {
  const author = comment.authorName ?? "unknown";
  const body = (comment.body ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  return `${taskId} ${author}: ${body}`;
}

/**
 * Sync-safe digest for Stop-hook stdout. Missing PAT or network failure is
 * non-fatal: the loop still continues; the digest says why the poll was empty.
 */
export async function pollWatchedMailboxes(repoRoot: string, pat = process.env.BOTHY_BOARD_PAT ?? ""): Promise<string> {
  const taskIds = loadMailboxWatchTaskIds(repoRoot);
  if (taskIds.length === 0) {
    return "MAILBOX: watch list empty (tools/openclinxr/openclaw/mailbox-watch.json).";
  }
  if (!pat) {
    return "MAILBOX: BOTHY_BOARD_PAT unset — skipped poll.";
  }
  const lines: string[] = [];
  for (const taskId of taskIds.slice(0, 8)) {
    try {
      const { structuredContent } = await Promise.race([
        bothyMcpCall(pat, "bothy-board.mailbox.poll", { taskId }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 2500);
        }),
      ]);
      const sc = (structuredContent ?? {}) as { comments?: PollComment[]; unread?: number };
      const foreign = (sc.comments ?? []).filter((comment) => !SELF_AUTHORS.has(comment.authorName ?? ""));
      if (foreign.length === 0) continue;
      const last = foreign[foreign.length - 1];
      if (last) lines.push(formatComment(taskId, last));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "poll_failed";
      lines.push(`${taskId} poll_error:${reason}`);
    }
  }
  if (lines.length === 0) {
    return `MAILBOX: polled ${taskIds.length} card(s); no foreign comments.`;
  }
  return `MAILBOX:\n${lines.join("\n")}`.slice(0, 1800);
}
