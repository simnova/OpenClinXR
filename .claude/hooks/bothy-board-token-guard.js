/**
 * bothy-board-token-guard — PreToolUse guard that REFUSES a BothyBoard call which
 * re-downloads the whole board because it omitted its cache parameter, plus the PostToolUse
 * half that persists the token so the next call can supply it.
 *
 * ## WHY THIS EXISTS, measured
 *
 *     sync           310,977 B  ->    248 B   with cacheToken ({unchanged:true})   1254x
 *     mailbox.poll   339,390 B  ->    308 B   with since                           1101x
 *
 * ## WHY PROSE COULD NOT DO THIS, measured twice
 *
 * 1. 2026-08-29: the rule existed in `.agents/skills/bothy-board/SKILL.md:39,69`, in
 *    `board-bothy-dequeue.ts` (which persists cacheToken, with a test pinning it), and in
 *    `agents/rules/**`. Three places. An agent hand-rolled raw curl for a whole session anyway.
 *    `skill-preflight.js` was written to fix that by naming the rule in every turn's prompt.
 *
 * 2. 2026-09-13: with `skill-preflight.js` live and injecting that exact sentence — including the
 *    measured byte figures above — into the turn, I called `bothy-board_sync` with no cacheToken.
 *    The response was 1,486,342 characters and had to be spilled to a file to avoid the context.
 *
 * The failure is not ignorance and not absent documentation. Injected prose does not bind a
 * PARAMETER the way it can bind a habit. `skill-preflight.js` says so in its own header: it is
 * FAIL-OPEN BY DESIGN, and "claiming enforcement this hook does not have is the marker-check failure
 * it exists to reduce." This file is the enforcement that header declines to claim.
 *
 * Per `PROTO_VERIFY_DELEGATION.md`'s frozen header, new learning goes to something that FAILS
 * CLOSED — not to another numbered rule and not to another paragraph in a skill.
 *
 * ## THE FIRST CALL MUST BE ALLOWED
 *
 * A tokenless sync is CORRECT when no token has ever been stored: that is how the first token is
 * obtained. The deny fires only when a stored value EXISTS and the call omitted it, which is exactly
 * the wasteful case and never the necessary one.
 *
 * ## FAIL-CLOSED, DELIBERATELY AND NARROWLY
 *
 * Claude Code hooks fail OPEN on crash, timeout, or a missing interpreter; only `exit 2` always
 * blocks. So this script exits 2 when it cannot DECIDE (unparseable payload) and exits 0 when it
 * decides "allow". It does not exit 2 on a missing store — an absent store is a legitimate state
 * with a correct answer, not a failure to decide.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Tools this guard governs, and the parameter each one must carry. */
export const GUARDED_TOOLS = Object.freeze({
  "mcp__bothy-board__bothy-board_sync": Object.freeze({
    parameter: "cacheToken",
    storeKey: "cacheToken",
    measured: "310,977 B -> 248 B",
  }),
  "mcp__bothy-board__bothy-board_mailbox_poll": Object.freeze({
    parameter: "since",
    storeKey: "since",
    measured: "339,390 B -> 308 B",
  }),
});

/**
 * Deliberate full refresh. Greppable, and named so it reads as a decision in a transcript rather
 * than as a workaround. Without an escape a guard becomes something to route around.
 */
export const FULL_REFRESH_ENV = "OPENCLINXR_BOTHY_FULL_REFRESH";

/** Shared with `board-bothy-dequeue.ts`'s directory, distinct from its `bothy-next-cache.json`. */
export const TOKEN_STORE_REL = ".openclinxr/openclaw/bothy-cache-tokens.json";

/**
 * Pure decision. Wire-format-agnostic ON PURPOSE: the caller maps whatever field names the harness
 * uses onto these arguments, so a change in the hook payload shape cannot silently turn the guard
 * into a no-op that still passes its tests.
 *
 * @returns {{decision: "allow"|"deny", reason: string}}
 */
export function decideBothyCall({ toolName, toolInput, storedValue, fullRefresh = false }) {
  const guarded = GUARDED_TOOLS[toolName];
  if (!guarded) {
    return { decision: "allow", reason: "not a guarded BothyBoard call" };
  }

  const supplied = toolInput && typeof toolInput === "object" ? toolInput[guarded.parameter] : undefined;
  if (typeof supplied === "string" && supplied.trim() !== "") {
    return { decision: "allow", reason: `${guarded.parameter} supplied` };
  }

  if (fullRefresh) {
    return {
      decision: "allow",
      reason: `${FULL_REFRESH_ENV} set — deliberate full refresh, ${guarded.parameter} omitted on purpose`,
    };
  }

  if (!(typeof storedValue === "string" && storedValue.trim() !== "")) {
    // The necessary case. Never block it: this is how the first value is obtained.
    return {
      decision: "allow",
      reason: `no stored ${guarded.parameter} yet — a first call must be able to fetch one`,
    };
  }

  return {
    decision: "deny",
    reason:
      `${toolName} was called without ${guarded.parameter}, which re-downloads the whole payload ` +
      `(${guarded.measured}, measured). A ${guarded.parameter} from a previous call is on disk. ` +
      `Retry with ${guarded.parameter}: "${storedValue}". ` +
      `If a full refresh is genuinely wanted, set ${FULL_REFRESH_ENV}=1 and say why.`,
  };
}

/**
 * Pull a cache value out of an MCP tool response.
 *
 * TOLERANT BY NECESSITY, NOT BY SLOPPINESS. The hook documentation describes `tool_response` only as
 * "a structured object or string depending on the tool's definition", so the exact shape here is NOT
 * established. Committing to one shape would produce a guard that stores nothing and still passes a
 * test written against the same guess. All three plausible shapes are handled and all three are
 * pinned by the test:
 *
 *   1. a parsed object                        { cacheToken: "bb-..." }
 *   2. a JSON string                          "{\"cacheToken\":\"bb-...\"}"
 *   3. MCP content blocks                     { content: [ { type: "text", text: "{...}" } ] }
 *
 * @returns {string|null} the value, or null when it is genuinely absent
 */
export function extractCacheValue(toolResponse, key) {
  if (toolResponse == null) return null;

  if (typeof toolResponse === "string") {
    const trimmed = toolResponse.trim();
    if (trimmed === "") return null;
    try {
      return extractCacheValue(JSON.parse(trimmed), key);
    } catch {
      return null;
    }
  }

  if (Array.isArray(toolResponse)) {
    for (const item of toolResponse) {
      const found = extractCacheValue(item, key);
      if (found !== null) return found;
    }
    return null;
  }

  if (typeof toolResponse !== "object") return null;

  const direct = toolResponse[key];
  if (typeof direct === "string" && direct.trim() !== "") return direct;

  // MCP content blocks, and any other single-level nesting the server may use.
  for (const nestedKey of ["content", "structuredContent", "result", "text"]) {
    if (nestedKey in toolResponse) {
      const found = extractCacheValue(toolResponse[nestedKey], key);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Read the token store. An absent or corrupt store is an empty store, never a throw. */
export function readTokenStore(repoRoot) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, TOKEN_STORE_REL), "utf8"));
  } catch {
    return {};
  }
}

/** Merge one value into the store. Returns the written object. */
export function writeTokenStore(repoRoot, patch) {
  const file = path.join(repoRoot, TOKEN_STORE_REL);
  const next = { ...readTokenStore(repoRoot), ...patch, updatedAt: new Date().toISOString() };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

const isDirect = process.argv[1] && process.argv[1].endsWith("bothy-board-token-guard.js");
if (isDirect) {
  const mode = process.argv.includes("--post") ? "post" : "pre";
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    raw = "";
  }

  let payload = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      // Cannot DECIDE. Fail closed, because a guard that waves calls through when it is confused is
      // the fail-open shape this file exists to replace.
      process.stderr.write(`bothy-board-token-guard: unparseable hook payload: ${String(err)}\n`);
      process.exit(2);
    }
  }

  const toolName = payload.tool_name ?? "";
  const guarded = GUARDED_TOOLS[toolName];

  if (mode === "post") {
    // Observational. Never block a call that already ran.
    if (guarded) {
      const value = extractCacheValue(payload.tool_response, guarded.storeKey);
      if (value !== null) {
        try {
          writeTokenStore(repoRoot, { [guarded.storeKey]: value });
        } catch {
          // A store we cannot write is tomorrow's problem, not a reason to disrupt this turn.
        }
      }
    }
    process.exit(0);
  }

  const store = readTokenStore(repoRoot);
  const verdict = decideBothyCall({
    toolName,
    toolInput: payload.tool_input,
    storedValue: guarded ? store[guarded.storeKey] : undefined,
    fullRefresh: process.env[FULL_REFRESH_ENV] === "1",
  });

  if (verdict.decision === "deny") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: verdict.reason,
        },
      }),
    );
  }
  process.exit(0);
}
