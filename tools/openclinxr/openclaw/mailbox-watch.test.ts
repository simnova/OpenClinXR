import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BothyFetch } from "./board-bothy-dequeue.js";
import {
  isSelfComment,
  loadMailboxWatchTaskIds,
  pollForeignMailbox,
  pollWatchedMailboxes,
} from "./mailbox-watch.js";

const SELF_MARKER = "[codex-agent:agt_d85152e0024f10cd]";

describe("mailbox-watch", () => {
  it("loads tsk_ ids from the watch file and ignores junk", () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc", "issue-1", "tsk_def"] }),
    );
    expect(loadMailboxWatchTaskIds(root)).toEqual(["tsk_abc", "tsk_def"]);
  });

  it("skips the live poll when BOTHY_BOARD_PAT is unset", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-nopat-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc"] }),
    );
    const digest = await pollWatchedMailboxes(root, "");
    expect(digest).toContain("BOTHY_BOARD_PAT unset");
  });

  it("isSelfComment recognizes author-name and body-marker self posts", () => {
    expect(isSelfComment({ authorName: "grok-orchestrator", body: "x" })).toBe(true);
    expect(
      isSelfComment(
        { authorName: "member", body: `mine ${SELF_MARKER} done` },
        [SELF_MARKER],
      ),
    ).toBe(true);
    expect(isSelfComment({ authorName: "member", body: "foreign" }, [SELF_MARKER])).toBe(false);
  });

  it("pollForeignMailbox filters self comments by body marker", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-self-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc"] }),
    );
    const fetch: BothyFetch = async () => ({
      structuredContent: {
        comments: [
          { id: "cmt_self", authorName: "member", body: `mine ${SELF_MARKER}` },
          { id: "cmt_other", authorName: "member", body: "look at this" },
          { id: "cmt_author", authorName: "grok-orchestrator", body: "system" },
        ],
      },
      httpStatus: 200,
    });
    const result = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      selfMarkers: [SELF_MARKER],
      fetch,
    });
    expect(result.comments.map((c) => c.id)).toEqual(["cmt_other"]);
    expect(result.comments[0]?.taskId).toBe("tsk_abc");
    expect(result.pollErrors).toEqual([]);
  });

  it("passes the persisted since cursor and returns the newest addressed timestamp", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-since-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc"] }),
    );
    const calls: Record<string, unknown>[] = [];
    const result = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      sinceByTaskId: { tsk_abc: "2026-08-29T20:00:00.000Z" },
      fetch: async ({ arguments: args }) => {
        calls.push(args);
        return {
          structuredContent: {
            comments: [
              { id: "c1", createdAt: "2026-08-29T20:01:00.000Z" },
              { id: "c2", createdAt: "2026-08-29T20:02:00.000Z" },
            ],
          },
          httpStatus: 200,
        };
      },
    });
    expect(calls).toEqual([
      { taskId: "tsk_abc", since: "2026-08-29T20:00:00.000Z" },
    ]);
    expect(result.latestCreatedAtByTaskId).toEqual({
      tsk_abc: "2026-08-29T20:02:00.000Z",
    });
  });

  it("classifies authentication failures as permanent", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-auth-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc"] }),
    );
    const result = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      fetch: async () => ({ structuredContent: {}, httpStatus: 401 }),
    });
    expect(result.pollErrors).toEqual(["tsk_abc poll_error:http_401"]);
    expect(result.permanentPollErrors).toEqual(["tsk_abc poll_error:http_401"]);
  });

  it("digest includes only foreign comments when selfMarkers are given", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-digest-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc"] }),
    );
    const fetch: BothyFetch = async () => ({
      structuredContent: {
        comments: [
          { id: "cmt_self", authorName: "member", body: `mine ${SELF_MARKER}` },
          { id: "cmt_other", authorName: "member", body: "look at this" },
        ],
      },
      httpStatus: 200,
    });
    const digest = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      selfMarkers: [SELF_MARKER],
      fetch,
    }).then((r) => r.comments.map((c) => c.id));
    expect(digest).toEqual(["cmt_other"]);
  });
});
