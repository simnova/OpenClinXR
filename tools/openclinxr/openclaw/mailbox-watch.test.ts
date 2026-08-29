import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadMailboxWatchTaskIds, pollWatchedMailboxes } from "./mailbox-watch.js";

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
});
