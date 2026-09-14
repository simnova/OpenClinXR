import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-relative-parent-imports -- the hook lives outside the package tree by design
import {
  decideBothyCall,
  extractCacheValue,
  FULL_REFRESH_ENV,
  GUARDED_TOOLS,
} from "../../../.claude/hooks/bothy-board-token-guard.js";

/**
 * The defect this pins, measured 2026-09-13: `bothy-board_sync` was called with no cacheToken while
 * `skill-preflight.js` was live and injecting the rule — with the byte figures — into that very
 * turn's prompt. The response was 1,486,342 characters and had to be spilled to a file.
 *
 * The RED is not "does the function return the right string". It is: does a deny fire on the exact
 * call shape that actually happened, and does it NOT fire on the shapes that must keep working. A
 * guard that only refuses is as broken as one that only allows, so four clauses are counterweights.
 */
describe("bothy board token guard", () => {
  const SYNC = "mcp__bothy-board__bothy-board_sync";
  const POLL = "mcp__bothy-board__bothy-board_mailbox_poll";

  it("refuses the call that actually happened: sync with no cacheToken while one is stored", () => {
    const verdict = decideBothyCall({ toolName: SYNC, toolInput: {}, storedValue: "bb-r4664-a37409f8" });
    expect(verdict.decision).toBe("deny");
    // The reason must carry the token, or the agent has to go find it — and calling sync is how.
    expect(verdict.reason).toContain("bb-r4664-a37409f8");
    expect(verdict.reason).toContain("310,977 B -> 248 B");
  });

  it("refuses a tokenless mailbox poll the same way, naming `since`", () => {
    const verdict = decideBothyCall({
      toolName: POLL,
      toolInput: { taskId: "tsk_a775eb9e466328a0" },
      storedValue: "2026-09-13T20:32:00Z",
    });
    expect(verdict.decision).toBe("deny");
    expect(verdict.reason).toContain("since");
    expect(verdict.reason).toContain("2026-09-13T20:32:00Z");
  });

  // COUNTERWEIGHT 1. The necessary case. If this ever denies, a clean checkout cannot reach the
  // board at all, because a first sync is how the first token is obtained.
  it("ALLOWS a tokenless sync when nothing is stored yet", () => {
    for (const stored of [null, undefined, "", "   "]) {
      expect(decideBothyCall({ toolName: SYNC, toolInput: {}, storedValue: stored }).decision).toBe("allow");
    }
  });

  // COUNTERWEIGHT 2. The correct call must never be slowed by the guard that exists to encourage it.
  it("ALLOWS a call that supplies the parameter", () => {
    expect(
      decideBothyCall({
        toolName: SYNC,
        toolInput: { cacheToken: "bb-r4664-a37409f8" },
        storedValue: "bb-r0001-older",
      }).decision,
    ).toBe("allow");
  });

  // COUNTERWEIGHT 3. A guard with no escape becomes something to route around. The escape is
  // explicit and greppable rather than silent.
  it("ALLOWS a deliberate full refresh, and the deny message names the env var", () => {
    expect(
      decideBothyCall({ toolName: SYNC, toolInput: {}, storedValue: "bb-r4664", fullRefresh: true }).decision,
    ).toBe("allow");
    expect(decideBothyCall({ toolName: SYNC, toolInput: {}, storedValue: "bb-r4664" }).reason).toContain(
      FULL_REFRESH_ENV,
    );
  });

  // COUNTERWEIGHT 4. The guard must not become a general-purpose blocker. Every other board call has
  // no cache parameter and must pass untouched.
  it("ALLOWS every unguarded tool, including other bothy-board calls", () => {
    for (const tool of [
      "mcp__bothy-board__bothy-board_tasks_get",
      "mcp__bothy-board__bothy-board_tasks_comment",
      "mcp__bothy-board__bothy-board_tasks_plant",
      "Bash",
      "Read",
    ]) {
      expect(decideBothyCall({ toolName: tool, toolInput: {}, storedValue: null }).decision).toBe("allow");
    }
  });

  it("does not throw on a missing or malformed input object", () => {
    expect(() => decideBothyCall({ toolName: SYNC, toolInput: undefined, storedValue: "t" })).not.toThrow();
    expect(() => decideBothyCall({ toolName: SYNC, toolInput: null, storedValue: "t" })).not.toThrow();
    // A non-string parameter is not a supplied parameter.
    expect(decideBothyCall({ toolName: SYNC, toolInput: { cacheToken: 42 }, storedValue: "t" }).decision).toBe(
      "deny",
    );
  });

  it("governs exactly the two cache-bearing tools, so a new one cannot be silently unguarded", () => {
    expect(Object.keys(GUARDED_TOOLS).sort()).toEqual([POLL, SYNC].sort());
    expect(GUARDED_TOOLS[SYNC].parameter).toBe("cacheToken");
    expect(GUARDED_TOOLS[POLL].parameter).toBe("since");
  });
});

/**
 * The hook documentation describes `tool_response` only as "a structured object or string depending
 * on the tool's definition", so the shape is NOT established. Pinning one guessed shape would give a
 * guard that stores nothing while its test passes — the vacuous-proof shape. All three plausible
 * shapes are asserted, and so is the case where the value is genuinely absent.
 */
describe("cache value extraction from an MCP response of unknown shape", () => {
  it("reads a parsed object", () => {
    expect(extractCacheValue({ cacheToken: "bb-r4664-a37409f8", revision: 4664 }, "cacheToken")).toBe(
      "bb-r4664-a37409f8",
    );
  });

  it("reads a JSON string", () => {
    expect(extractCacheValue('{"cacheToken":"bb-r4664-a37409f8"}', "cacheToken")).toBe("bb-r4664-a37409f8");
  });

  it("reads MCP content blocks", () => {
    const response = { content: [{ type: "text", text: '{"cacheToken":"bb-r4664-a37409f8","tasks":[]}' }] };
    expect(extractCacheValue(response, "cacheToken")).toBe("bb-r4664-a37409f8");
  });

  it("reads the mailbox cursor under its own key", () => {
    expect(extractCacheValue({ since: "2026-09-13T20:32:00Z" }, "since")).toBe("2026-09-13T20:32:00Z");
  });

  // Absence must be null rather than a thrown error or an empty string written to the store: a
  // stored empty token would make every later call look tokenless and deny nothing.
  it("returns null when the value is genuinely absent, and never throws", () => {
    for (const response of [null, undefined, "", "   ", "not json at all", {}, { cacheToken: "" }, []]) {
      expect(extractCacheValue(response, "cacheToken")).toBeNull();
    }
  });
});
