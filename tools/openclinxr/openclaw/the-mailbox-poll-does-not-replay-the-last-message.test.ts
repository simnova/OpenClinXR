import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BothyFetch } from "./board-bothy-dequeue.js";
import {
  pollForeignMailbox,
  pollWatchedMailboxes,
  writeDigestSinceByTaskId,
} from "./mailbox-watch.js";

describe("the mailbox poll does not replay the last message", () => {
  it("pollForeignMailbox filters comments at or before the since cursor for their taskId", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-no-replay-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_abc"] }),
    );

    const sinceCursor = "2026-09-11T18:54:02.778Z";
    const fetch: BothyFetch = async () => ({
      structuredContent: {
        comments: [
          { id: "cmt_replay", createdAt: sinceCursor }, // EXACTLY at cursor - should be filtered
          { id: "cmt_new", createdAt: "2026-09-11T18:55:00.000Z" }, // strictly newer - should pass
          { id: "cmt_older", createdAt: "2026-09-11T18:53:00.000Z" }, // older - should be filtered
          { id: "cmt_no_date" }, // no createdAt - should pass (cannot compare, don't drop)
        ],
      },
      httpStatus: 200,
    });

    const result = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      sinceByTaskId: { tsk_abc: sinceCursor },
      fetch,
    });

    // Only strictly newer comments and comments without createdAt should be returned
    expect(result.comments.map((c) => c.id)).toEqual(["cmt_new", "cmt_no_date"]);
  });

  it("pollForeignMailbox returns all comments when taskId has no stored cursor", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-no-cursor-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_new_card"] }),
    );

    const fetch: BothyFetch = async () => ({
      structuredContent: {
        comments: [
          { id: "cmt_old", createdAt: "2026-09-01T00:00:00.000Z" },
          { id: "cmt_new", createdAt: "2026-09-15T00:00:00.000Z" },
        ],
      },
      httpStatus: 200,
    });

    const result = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      sinceByTaskId: {}, // No cursor for tsk_new_card
      fetch,
    });

    // No cursor means everything is new
    expect(result.comments.map((c) => c.id)).toEqual(["cmt_old", "cmt_new"]);
  });

  it("pollWatchedMailboxes does not re-report the last message on consecutive polls", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-digest-no-replay-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_digest"] }),
    );

    const sinceCursor = "2026-09-15T03:00:00.000Z";
    let _pollCount = 0;
    const fetch: BothyFetch = async () => {
      _pollCount += 1;
      return {
        structuredContent: {
          comments: [
            { id: "cmt_replay", createdAt: sinceCursor, body: "replay message" }, // EXACTLY at cursor - should be filtered
            { id: "cmt_new", createdAt: "2026-09-15T03:01:00.000Z", body: "new message" }, // strictly newer
            { id: "cmt_no_date", body: "no date message" }, // no createdAt - should pass
          ],
        },
        httpStatus: 200,
      };
    };

    // Pre-seed the digest with a cursor
    writeDigestSinceByTaskId(root, { tsk_digest: sinceCursor }, ["tsk_digest"]);

    const firstDigest = await pollWatchedMailboxes(root, "bb_pat_test", [], fetch);
    const secondDigest = await pollWatchedMailboxes(root, "bb_pat_test", [], fetch);

    // The replay comment should not appear in either digest
    expect(firstDigest).not.toContain("replay message");
    expect(secondDigest).not.toContain("replay message");

    // The digest only shows the most recent comment per taskId (lastByTask Map behavior)
    // So the no-date comment (last in the filtered array) will be shown
    // But importantly, the replay message at cursor is filtered out
    // Both new message and no-date message should be returned by pollForeignMailbox
    // The digest shows whichever comes last in the filtered array
    expect(firstDigest).toContain("no date message");
  });

  it("zero returned comments are older-or-equal to their card cursor", async () => {
    const root = join(tmpdir(), `ocxr-mailbox-zero-replay-${Date.now()}`);
    mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(
      join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
      JSON.stringify({ taskIds: ["tsk_xyz"] }),
    );

    const cursor = "2026-09-11T18:54:02.778Z";
    const fetch: BothyFetch = async () => ({
      structuredContent: {
        comments: [
          { id: "c1", createdAt: cursor },
          { id: "c2", createdAt: "2026-09-11T18:54:02.777Z" }, // 1ms older
          { id: "c3", createdAt: "2026-09-11T18:54:02.779Z" }, // 1ms newer
          { id: "c4" }, // no createdAt
        ],
      },
      httpStatus: 200,
    });

    const result = await pollForeignMailbox({
      repoRoot: root,
      pat: "bb_pat_test",
      sinceByTaskId: { tsk_xyz: cursor },
      fetch,
    });

    // Filter: only strictly newer and no-date comments pass
    // c1 = equal to cursor -> filtered
    // c2 = older than cursor -> filtered
    // c3 = newer than cursor -> passes
    // c4 = no createdAt -> passes
    const returnedCreatedAts = result.comments
      .filter((c) => typeof c.createdAt === "string")
      .map((c) => c.createdAt!);

    // Every returned comment with a createdAt must be strictly greater than the cursor
    for (const createdAt of returnedCreatedAts) {
      expect(createdAt > cursor).toBe(true);
    }
    // The no-date comment must still be returned
    expect(result.comments.some((c) => !c.createdAt)).toBe(true);
  });
});