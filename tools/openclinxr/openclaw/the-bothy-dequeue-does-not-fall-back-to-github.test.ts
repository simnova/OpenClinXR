import { describe, expect, it } from "vitest";
import { bothyDequeueEnabled, selectNextBothyCard } from "./board-bothy-dequeue.js";
import { boardCardFromSelection } from "./openclaw-slice-runner.js";

/**
 * Dual-dequeue is refused. Missing PAT or {task:null} must not rank GitHub project 7.
 */
describe("BothyBoard dequeue hop", () => {
  it("BothyBoard is the default dequeue SSOT; GitHub is opt-in retire", () => {
    expect(bothyDequeueEnabled({})).toBe(true);
    expect(bothyDequeueEnabled({ BOTHY_BOARD_DEQUEUE: undefined })).toBe(true);
    expect(bothyDequeueEnabled({ BOTHY_BOARD_DEQUEUE: "1" })).toBe(true);
    expect(bothyDequeueEnabled({ BOTHY_BOARD_DEQUEUE: "0" })).toBe(false);
  });

  it("missing PAT is incomplete-read, not a GitHub fallback", async () => {
    const v = await selectNextBothyCard({ pat: "", env: {} });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("incomplete-read");
    expect(v.detail).toMatch(/BOTHY_BOARD_PAT is missing/);
  });

  it("{task:null} is no-candidate success", async () => {
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      fetch: async () => ({ structuredContent: { task: null }, httpStatus: 200 }),
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("no-candidate");
  });

  it("Planted task maps to bothy-tsk slice id and sends machineName", async () => {
    let sent: Record<string, unknown> | undefined;
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "audit-box",
      fetch: async ({ tool, arguments: args }) => {
        sent = args;
        if (tool === "bothy-board.tasks.next") {
          return {
            structuredContent: {
              task: {
                id: "tsk_aabb",
                title: "body_param",
                factory: "Planted",
                status: "ready",
                body: "## factory_step: body_param\n## done_when\n- exists:x\n",
              },
              spawnCommand: "grok -s sess-1 -w -p …",
              grokSessionId: "sess-1",
              cacheToken: "bb-r1",
            },
            httpStatus: 200,
          };
        }
        return { structuredContent: {}, httpStatus: 200 };
      },
    });
    expect(sent?.machineName).toBe("audit-box");
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.taskId).toBe("tsk_aabb");
    expect(v.spawnCommand).toMatch(/grok -s sess-1/);
    expect(v.body).toContain("## factory_step:");
    expect(boardCardFromSelection(v)?.sliceId).toBe("bothy-tsk_aabb");
  });

  it("does not send cacheToken when the last next was empty", async () => {
    let sent: Record<string, unknown> | undefined;
    await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "box",
      store: {
        read: () => ({ task: null, cacheToken: "bb-empty" }),
        write: () => undefined,
      },
      fetch: async ({ arguments: args }) => {
        sent = args;
        return { structuredContent: { task: null }, httpStatus: 200 };
      },
    });
    expect(sent?.cacheToken).toBeUndefined();
  });

  it("unchanged:true replays last snapshot and is success", async () => {
    const mem: { snap: import("./board-bothy-dequeue.js").BothyNextSnapshot | null } = {
      snap: {
        task: { id: "tsk_keep", title: "kept", body: "## factory_step: staging\n" },
        spawnCommand: "grok -s old -w",
        cacheToken: "bb-r1",
      },
    };
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "box",
      store: {
        read: () => mem.snap,
        write: (s) => {
          mem.snap = s;
        },
      },
      fetch: async () => ({
        structuredContent: { unchanged: true, cacheToken: "bb-r2" },
        httpStatus: 200,
      }),
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.taskId).toBe("tsk_keep");
    expect(v.spawnCommand).toBe("grok -s old -w");
    expect(mem.snap?.cacheToken).toBe("bb-r2");
  });

  it("loser-shaped rate_limited structuredContent is incomplete-read", async () => {
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      fetch: async () => ({
        structuredContent: { error: "rate_limited", code: "rate_limited", retryAfterSec: 12 },
        httpStatus: 200,
      }),
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("incomplete-read");
    expect(v.detail).toMatch(/retryAfterSec=12/);
  });
});
