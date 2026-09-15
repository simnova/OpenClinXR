import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceBothyClaimPresence, type ClaimRenewalHooks, startBothyClaimRenewal } from "./bothy-claim-renewal.js";
import { boardTaskIdForSlice } from "./dispatch-worker.js";

/**
 * THE FAILURE SHAPE, MEASURED
 *
 * bothyMcpCall (board-bothy-dequeue.ts:121-143) awaits fetch, parses `json.result?.structuredContent`,
 * and returns `{ structuredContent, httpStatus }`. The wire result carries `isError`, declared in the
 * parsed type at :140, and THE HELPER DROPS IT at :142.
 *
 * For a bad identifier the board answers HTTP 200 with an error payload. Measured read-only:
 *     tasks.get "bothy-tsk_e0682be792f231f4"  -> httpStatus 200,
 *                                                structuredContent { error: "This token is not scoped to that project." }
 *     tasks.get "tsk_e0682be792f231f4"        -> httpStatus 200, resolves, status=claimed
 *
 * So bothyMcpCall RESOLVES NORMALLY. Neither catch at bothy-claim-renewal.ts:33 nor :45 ever fires
 * for this defect. Those catches handle TRANSPORT failure only.
 *
 * AND httpStatus ALONE CANNOT DETECT IT. Existing callers guard on 2xx — mailbox-watch.ts:220,
 * bothy-mailbox-monitor.ts:218, codex-bothy-event-monitor.ts:394 — and a board refusal is 200, so
 * every one of those guards passes on a refusal. The signal is in the PAYLOAD.
 */

// Mock fetch globally for bothyMcpCall
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the dispatch renewer sends the bare card id to BothyBoard", () => {
  describe("CLAUSE 1 — BOARD REFUSAL IS AUDIBLE (both shapes)", () => {
    it("(a) RESOLVED refusal: model the real return — HTTP 200 with structuredContent.error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            structuredContent: {
              error: "This token is not scoped to that project.",
            },
            isError: true,
          },
        }),
      });
      globalThis.fetch = mockFetch;

      // Test the worktrees.register call path
      await announceBothyClaimPresence({
        path: "/test/path",
        branch: "test-branch",
        taskId: "bothy-tsk_badid", // WRONG: prefixed id
        grokSessionId: "session-123",
        agentId: "agent-456",
      });

      // Verify the mock was called with the correct tool
      expect(mockFetch).toHaveBeenCalledTimes(2); // worktrees.register + agents.heartbeat
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[0]).toBe("https://bothyboard.com/api/mcp");
      const firstBody = JSON.parse(firstCall[1]?.body as string);
      expect(firstBody.method).toBe("tools/call");
      expect(firstBody.params.name).toBe("bothy-board.worktrees.register");
      expect(firstBody.params.arguments.taskId).toBe("bothy-tsk_badid");

      // Verify the warning was emitted for the refusal
      expect(console.warn).toHaveBeenCalledWith(
        "[bothy-claim-renewal] worktrees.register board refusal:",
        "This token is not scoped to that project.",
      );
    });

    it("(b) REJECTED transport: the call rejects, and that is audible too, still non-fatal", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      globalThis.fetch = mockFetch;

      await announceBothyClaimPresence({
        path: "/test/path",
        branch: "test-branch",
        taskId: "tsk_goodid",
        grokSessionId: "session-123",
        agentId: "agent-456",
      });

      // Verify the warning was emitted for the transport failure
      expect(console.warn).toHaveBeenCalledWith(
        "[bothy-claim-renewal] worktrees.register transport failure",
      );
      // The promise should still resolve (not throw)
    });
  });

  describe("CLAUSE 2 — RENEWAL CONTINUITY", () => {
    it("reject one interval beat, prove a LATER beat still runs", async () => {
      // Use fake timers
      vi.useFakeTimers();
      
      let callCount = 0;
      const mockHeartbeat = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call rejects
          throw new Error("transient board error");
        }
        // Subsequent calls resolve
      });

      const hooks: ClaimRenewalHooks = {
        intervalMs: 100, // Fast interval for testing
        heartbeat: mockHeartbeat,
      };

      const presence = {
        path: "/test/path",
        branch: "test-branch",
        taskId: "tsk_test",
        grokSessionId: "session-123",
        agentId: "agent-456",
      };

      const stop = startBothyClaimRenewal(presence, hooks);

      // Advance time past first interval
      await vi.advanceTimersByTimeAsync(100);
      // First call threw, but interval should continue
      expect(callCount).toBe(1);

      // Advance time past second interval
      await vi.advanceTimersByTimeAsync(100);
      // Second call should have executed
      expect(callCount).toBe(2);

      // Advance time past third interval
      await vi.advanceTimersByTimeAsync(100);
      expect(callCount).toBe(3);

      stop();
      vi.useRealTimers();
      // This proves retry and non-fatality ONLY. It does not prove board refusals are audible — that is clause 1.
    });
  });

  describe("CLAUSE 3 — DISPATCH NORMALIZATION", () => {
    it("boardTaskIdForSlice derives bare taskId for board calls", () => {
      // Prefixed slice id -> bare taskId (tsk_ preserved)
      expect(boardTaskIdForSlice("bothy-tsk_abc")).toBe("tsk_abc");
      // Already bare -> passes through unchanged
      expect(boardTaskIdForSlice("tsk_abc")).toBe("tsk_abc");
      // Unscoped fallback
      expect(boardTaskIdForSlice(undefined)).toBe("unscoped");
      // Never strips tsk_ prefix
      expect(boardTaskIdForSlice("bothy-tsk_abc")).not.toBe("abc");
    });

    it("board calls receive bare taskId while worktree path and branch retain slice-scoped values", () => {
      // Source-text assertions: verify the call sites pass taskIdForBoard to board-facing calls
      // while path and branch receive worktreePath/branch (not the slice)
      const DISPATCH = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "dispatch-worker.ts"), "utf8");

      // Both board-facing calls use taskIdForBoard
      const announceIdx = DISPATCH.indexOf("announceBothyDispatchPresence({");
      expect(announceIdx).toBeGreaterThan(-1);
      const announceBlock = DISPATCH.slice(announceIdx, DISPATCH.indexOf("});", announceIdx) + 3);
      expect(announceBlock).toContain("taskId: taskIdForBoard");
      expect(announceBlock).toContain("path: worktreePath ?? repoRoot");
      expect(announceBlock).toContain("branch: options.branch ?? \"main\"");

      const renewalIdx = DISPATCH.indexOf("startBothyClaimRenewal({");
      expect(renewalIdx).toBeGreaterThan(-1);
      const renewalBlock = DISPATCH.slice(renewalIdx, DISPATCH.indexOf("});", renewalIdx) + 3);
      expect(renewalBlock).toContain("taskId: taskIdForBoard");
      expect(renewalBlock).toContain("path: worktreePath ?? repoRoot");
      expect(renewalBlock).toContain("branch: options.branch ?? \"main\"");

      // options.slice is never rewritten in dispatch (no assignment to options.slice)
      expect(DISPATCH).not.toContain("options.slice =");
    });
  });
});

// This test file is designed to:
// 1. FAIL against unfixed source (the test above will fail because dispatch-worker.ts doesn't use the converter)
// 2. PASS after fixes are applied
// The three clauses correspond to:
// - CLAUSE 1: Board refusal observability (both resolved and rejected shapes)
// - CLAUSE 2: Renewal continuity (rejection on one beat doesn't stop later beats)
// - CLAUSE 3: Dispatch normalization (bare taskId to board, prefixed retained internally for worktree/branch/ledger)