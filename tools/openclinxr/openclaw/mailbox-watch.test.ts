import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BothyFetch } from "./board-bothy-dequeue.js";
import {
  isSelfComment,
  loadDigestSinceByTaskId,
  loadLookedAtTaskIds,
  loadMailboxWatchTaskIds,
  pollForeignMailbox,
  pollWatchedMailboxes,
  resolveMailboxWatchTaskIds,
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

  it("unions the watch file with looked-at cards and extra ids", () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-union-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_watch"] }),
    );
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_looked", "tsk_watch"] }),
    );
    expect(resolveMailboxWatchTaskIds(root, ["tsk_extra"])).toEqual([
      "tsk_watch",
      "tsk_looked",
      "tsk_extra",
    ]);
  });

  it("bounds the session-local looked-at tail while preserving the newest cards", () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-looked-bound-${Date.now()}`);
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    const ids = Array.from({ length: 40 }, (_, index) => `tsk_${index}`);
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ids }),
    );
    const loaded = loadLookedAtTaskIds(root);
    expect(loaded).toHaveLength(32);
    expect(loaded[0]).toBe("tsk_8");
    expect(loaded.at(-1)).toBe("tsk_39");
  });

  it("polls every resolved id rather than dropping after eight", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-all-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    const ids = Array.from({ length: 10 }, (_, i) => `tsk_${i}`);
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ids }),
    );
    const seen: string[] = [];
    await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      fetch: async ({ arguments: args }) => {
        seen.push(String(args.taskId));
        return { structuredContent: { comments: [] }, httpStatus: 200 };
      },
    });
    expect(seen).toEqual(ids);
  });

  it("always polls explicit watch cards and fairly rotates capped looked-at history", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-rotate-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_priority_a", "tsk_priority_b"] }),
    );
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_history_0", "tsk_history_1", "tsk_history_2", "tsk_history_3"] }),
    );
    const fetch: BothyFetch = async () => ({ structuredContent: { comments: [] }, httpStatus: 200 });
    const first = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      fetch,
      maxTasks: 4,
      pollAfterTaskId: null,
    });
    const second = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      fetch,
      maxTasks: 4,
      pollAfterTaskId: first.nextPollAfterTaskId,
    });
    expect(first.polledTaskIds).toEqual([
      "tsk_priority_a",
      "tsk_priority_b",
      "tsk_history_0",
      "tsk_history_1",
    ]);
    expect(second.polledTaskIds).toEqual([
      "tsk_priority_a",
      "tsk_priority_b",
      "tsk_history_2",
      "tsk_history_3",
    ]);
    expect(first.watchedTaskCount).toBe(6);
    expect(first.watchedTaskIds).toEqual([
      "tsk_priority_a",
      "tsk_priority_b",
      "tsk_history_0",
      "tsk_history_1",
      "tsk_history_2",
      "tsk_history_3",
    ]);
    expect(second.nextPollAfterTaskId).toBe("tsk_history_3");
  });

  it("resumes after a stable task id when the rotating watch set changes", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-stable-cursor-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_priority"] }),
    );
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_a", "tsk_b", "tsk_c", "tsk_d"] }),
    );
    const fetch: BothyFetch = async () => ({ structuredContent: { comments: [] }, httpStatus: 200 });
    const first = await pollForeignMailbox({ repoRoot: root, pat: "bb_pat_test", fetch, maxTasks: 3 });
    expect(first.nextPollAfterTaskId).toBe("tsk_b");
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_new", "tsk_a", "tsk_b", "tsk_c", "tsk_d"] }),
    );
    const second = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      fetch,
      maxTasks: 3,
      pollAfterTaskId: first.nextPollAfterTaskId,
    });
    expect(second.polledTaskIds).toEqual(["tsk_priority", "tsk_c", "tsk_d"]);
  });

  it("resumes by value after the cursor card is evicted", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-evicted-cursor-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_priority"] }),
    );
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_a", "tsk_b", "tsk_c", "tsk_d"] }),
    );
    const fetch: BothyFetch = async () => ({ structuredContent: { comments: [] }, httpStatus: 200 });
    const first = await pollForeignMailbox({ repoRoot: root, pat: "bb_pat_test", fetch, maxTasks: 3 });
    expect(first.nextPollAfterTaskId).toBe("tsk_b");
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_a", "tsk_c", "tsk_d", "tsk_e"] }),
    );
    const second = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      fetch,
      maxTasks: 3,
      pollAfterTaskId: first.nextPollAfterTaskId,
    });
    expect(second.polledTaskIds).toEqual(["tsk_priority", "tsk_c", "tsk_d"]);
  });

  it("reserves a rotating slot when priority cards fill the pass", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-priority-overflow-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_priority_a", "tsk_priority_b", "tsk_priority_c"] }),
    );
    writeFileSync(
      join(root, ".openclinxr/openclaw/mailbox-looked-at.json"),
      JSON.stringify({ taskIds: ["tsk_history_a", "tsk_history_b"] }),
    );
    const fetch: BothyFetch = async () => ({ structuredContent: { comments: [] }, httpStatus: 200 });
    let cursor: string | null = null;
    const rotated: string[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      const result = await pollForeignMailbox({
        repoRoot: root,
        pat: "bb_pat_test",
        fetch,
        maxTasks: 3,
        pollAfterTaskId: cursor,
      });
      expect(result.polledTaskIds.slice(0, 2)).toEqual(["tsk_priority_a", "tsk_priority_b"]);
      rotated.push(result.polledTaskIds[2] ?? "missing");
      cursor = result.nextPollAfterTaskId;
    }
    expect(rotated).toEqual(["tsk_history_a", "tsk_history_b", "tsk_priority_c"]);
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

  it("isSelfComment is session-marker only — other grok-orchestrator CEOs are foreign", () => {
    expect(isSelfComment({ authorName: "grok-orchestrator", body: "x" })).toBe(false);
    expect(
      isSelfComment(
        { authorName: "grok-orchestrator", body: "[grok-orchestrator:01a0678a] plant this" },
        ["[grok-orchestrator:019ff803]"],
      ),
    ).toBe(false);
    expect(
      isSelfComment(
        { authorName: "member", body: `mine ${SELF_MARKER} done` },
        [SELF_MARKER],
      ),
    ).toBe(true);
    expect(isSelfComment({ authorName: "member", body: "foreign" }, [SELF_MARKER])).toBe(false);
    expect(isSelfComment({ authorName: "sc-04-worker", body: "unmarked" }, [], ["sc-04-worker"])).toBe(true);
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
    expect(result.comments.map((c) => c.id)).toEqual(["cmt_other", "cmt_author"]);
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

  it("persists and reuses a since cursor on the lifecycle digest path", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-watch-digest-since-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_digest"] }),
    );
    const calls: Record<string, unknown>[] = [];
    const fetch: BothyFetch = async ({ arguments: args }) => {
      calls.push(args);
      return {
        structuredContent: {
          comments: calls.length === 1
            ? [{ id: "cmt_digest", createdAt: "2026-09-15T03:00:00.000Z" }]
            : [],
        },
        httpStatus: 200,
      };
    };
    await pollWatchedMailboxes(root, "bb_pat_test", [], fetch);
    await pollWatchedMailboxes(root, "bb_pat_test", [], fetch);
    expect(calls[1]).toEqual({ taskId: "tsk_digest", since: "2026-09-15T03:00:00.000Z" });
    expect(loadDigestSinceByTaskId(root)).toEqual({
      tsk_digest: "2026-09-15T03:00:00.000Z",
    });
  });
});
