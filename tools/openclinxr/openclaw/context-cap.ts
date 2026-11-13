/**
 * context-cap — hook that warns when a long agent session is near its context limit.
 *
 * Claude transcript (JSONL at stdin field transcript_path): assistant lines are
 * {type:"assistant",message:{usage:{input_tokens,cache_creation_input_tokens,
 * cache_read_input_tokens}}}. Context = the sum on the NEWEST assistant line.
 * Only the last 4 MB are read (usage lives at the end; first partial line
 * dropped; whole file only when the tail holds no usable line). Bad lines are
 * skipped — a half-written last line must not silence the cap.
 * Grok (--grok): ~/.grok/sessions/<urlencoded cwd>/<sessionId>/updates.jsonl,
 * lines carry params._meta.totalTokens on some events; the newest such line wins.
 * The session id comes from the hook stdin JSON when present, else the newest
 * updates.jsonl under the cwd's session directory.
 *
 * Compaction counting (default off, plain 300000 cap): sessions ride Claude Code's auto-compaction
 * only when OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF=N>0 is set. The hook counts
 * top-level {type:"system",subtype:"compact_boundary"} lines over the WHOLE transcript
 * (streamed, so boundaries outside the tail count) and asks for a handoff once the count
 * reaches OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF (N>0), or when context passes the
 * backstop (default 600000, or OPENCLINXR_CONTEXT_CAP). OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF=0
 * (the default) is the plain token cap (DEFAULT_CAP) with no counting.
 *
 * Reads hook JSON on stdin. Below or equal to cap, or transcript
 * missing/unreadable: prints nothing, exit 0. Never writes any file.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Plain token cap, used when compaction counting is off (OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF=0).
// Measured 2026-11-12: a fresh session's first-turn context is 61,525 tokens (session 08aaccb2);
// across 152 compactions in 97 local transcripts, auto-compaction fires at a median preTokens of
// 316,883 (q25 263,231, q75 327,238) and the first post-compaction context is a median 102,167.
// 300k sits just under the typical auto-compaction point.
export const DEFAULT_CAP = 300000;
/** Handoff after this many compactions; 0 disables counting. */
// WHY1 2026-11-12 trial: Claude sessions did not auto-compact near 300k (603k and 341k sessions, 0 compactions), so default 2 let sessions run to the 600k backstop at ~2x per-turn cost.
export const DEFAULT_COMPACTIONS_BEFORE_HANDOFF = 0;
/** Token backstop when counting is on: a session that never compacts still hands off here. */
export const DEFAULT_BACKSTOP = 600000;
export const HANDOFF_RECENCY_MS = 10 * 60 * 1000;
/** Tail window for transcript reads: newest usage lines live at the end. */
export const TAIL_BYTES = 4 * 1024 * 1024;

export function buildCapMessage(tokens: number | null, cap: number, compactions?: number): string {
  const why =
    compactions === undefined
      ? `context ${tokens} tokens is over the cap ${cap}`
      : `this session has had ${compactions} compactions (context ${tokens ?? "unknown"} tokens, backstop ${cap})`;
  return (
    `${why}; write your handoff now with ` +
    "`pnpm exec tsx tools/openclinxr/openclaw/handoff.ts write <lane>`, fill its slots, and start no new work."
  );
}

export function contextTokensFromClaudeTranscript(text: string): number | null {
  let newest: number | null = null;
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: {
      type?: unknown;
      message?: { usage?: Record<string, unknown> };
    };
    try {
      entry = JSON.parse(trimmed);
    } catch {
      // A half-written last line (the transcript is appended while the hook
      // runs) must not silence the cap — skip bad lines, never bail.
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const usage = entry?.message?.usage;
    if (!usage || typeof usage !== "object") continue;
    const num = (key: string): number | null => {
      const value = usage[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const input = num("input_tokens");
    const created = num("cache_creation_input_tokens");
    const read = num("cache_read_input_tokens");
    if (input === null || created === null || read === null) continue;
    newest = input + created + read;
  }
  return newest;
}

export function contextTokensFromGrokUpdates(text: string): number | null {
  let newest: number | null = null;
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: { params?: { _meta?: { totalTokens?: unknown } } };
    try {
      entry = JSON.parse(trimmed);
    } catch {
      // Same half-written-line rule as the Claude parser: skip, never bail.
      continue;
    }
    const total = entry?.params?._meta?.totalTokens;
    if (typeof total === "number" && Number.isFinite(total)) newest = total;
  }
  return newest;
}

/** True when a line is a parsed top-level system/compact_boundary entry. */
export function isCompactBoundaryLine(line: string): boolean {
  if (!line.includes("compact_boundary")) return false;
  try {
    const entry = JSON.parse(line) as { type?: unknown; subtype?: unknown };
    return entry?.type === "system" && entry?.subtype === "compact_boundary";
  } catch {
    return false;
  }
}

export function countCompactionsInText(text: string): number {
  let count = 0;
  for (const line of String(text ?? "").split("\n")) if (isCompactBoundaryLine(line.trim())) count += 1;
  return count;
}

/** A line longer than this cannot be a boundary line (real ones are a few KB); it is skipped. */
const MAX_BOUNDARY_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Streams the whole file in 1 MiB chunks, so boundaries outside the tail window count.
 * Linear: newlines are found per chunk and a partial line is kept as a chunk list,
 * dropped once it passes MAX_BOUNDARY_LINE_BYTES.
 */
export function countCompactionsInFile(path: string): number | null {
  let fd = -1;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(1024 * 1024);
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let skipping = false;
    let count = 0;
    const finishLine = (tail: Buffer): void => {
      if (!skipping) {
        const line = pending.length === 0 ? tail : Buffer.concat([...pending, tail]);
        if (line.length <= MAX_BOUNDARY_LINE_BYTES && isCompactBoundaryLine(line.toString("utf8").trim())) count += 1;
      }
      pending = [];
      pendingBytes = 0;
      skipping = false;
    };
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      let start = 0;
      for (;;) {
        const nl = buf.indexOf(10, start);
        if (nl === -1 || nl >= n) break;
        finishLine(buf.subarray(start, nl));
        start = nl + 1;
      }
      if (start < n && !skipping) {
        pending.push(Buffer.from(buf.subarray(start, n)));
        pendingBytes += n - start;
        if (pendingBytes > MAX_BOUNDARY_LINE_BYTES) {
          skipping = true;
          pending = [];
          pendingBytes = 0;
        }
      }
    }
    finishLine(Buffer.alloc(0));
    return count;
  } catch {
    return null;
  } finally {
    if (fd !== -1) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Compactions before handoff: env override, default 0 = plain cap; N>0 enables counting with the 600k backstop. */
export function resolveCompactionsBeforeHandoff(env: NodeJS.ProcessEnv = process.env): number {
  const envKey: string = "OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF";
  const raw = env[envKey];
  if (raw === undefined || raw.trim() === "") return DEFAULT_COMPACTIONS_BEFORE_HANDOFF;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_COMPACTIONS_BEFORE_HANDOFF;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// Role caps (.openclinxr/context-cap.json) stay token caps: with counting on they set the backstop.
export function resolveCap(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  harness: "claude" | "grok" = "claude",
): number {
  const fromEnv = Number(env.OPENCLINXR_CONTEXT_CAP);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const role = env.OPENCLINXR_ROLE;
  if (role) {
    const file = readJsonFile(join(repoRoot, ".openclinxr", "context-cap.json"));
    if (file && typeof file === "object" && !Array.isArray(file)) {
      const perRole = (file as Record<string, unknown>)[role];
      if (typeof perRole === "number" && Number.isFinite(perRole) && perRole > 0) return perRole;
    }
  }
  // Grok has no compaction counting, so it keeps the plain cap.
  return harness === "claude" && resolveCompactionsBeforeHandoff(env) > 0 ? DEFAULT_BACKSTOP : DEFAULT_CAP;
}

function newestFileMtimeMs(dir: string): number | null {
  let newest: number | null = null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      if (stat.isFile() && (newest === null || stat.mtimeMs > newest)) newest = stat.mtimeMs;
    } catch {
      continue;
    }
  }
  return newest;
}

export function hasRecentHandoff(repoRoot: string, nowMs = Date.now()): boolean {
  const newest = newestFileMtimeMs(join(repoRoot, ".openclinxr", "handoffs"));
  return newest !== null && nowMs - newest <= HANDOFF_RECENCY_MS;
}

export type ClaudeDecision = {
  tokens: number | null;
  cap: number;
  hookEvent: string;
  stopHookActive: boolean;
  handoffRecent: boolean;
  /** Compactions seen in the transcript; with compactionsBeforeHandoff > 0, `cap` is the backstop. */
  compactions?: number | null;
  compactionsBeforeHandoff?: number;
};

/** Cap message when a handoff is due, else null. Counting applies only when compactionsBeforeHandoff > 0. */
export function handoffDue(
  tokens: number | null,
  cap: number,
  compactions: number | null | undefined,
  compactionsBeforeHandoff: number | undefined,
): string | null {
  const limit = compactionsBeforeHandoff ?? 0;
  if (limit > 0 && compactions != null && compactions >= limit) {
    return buildCapMessage(tokens, cap, compactions);
  }
  if (tokens === null) return null;
  return tokens > cap ? buildCapMessage(tokens, cap) : null;
}

/** Returns the stdout payload, or null for silence. */
export function decideClaude(opts: ClaudeDecision): string | null {
  const { tokens, cap, hookEvent, stopHookActive, handoffRecent } = opts;
  const msg = handoffDue(tokens, cap, opts.compactions, opts.compactionsBeforeHandoff);
  if (msg === null) return null;
  if (hookEvent === "Stop") {
    if (stopHookActive || handoffRecent) return null;
    return JSON.stringify({ decision: "block", reason: msg });
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: msg },
  });
}

export type GrokDecision =
  | { json: string; text?: undefined }
  | { text: string; json?: undefined };

/**
 * Over-cap probe for the inbox hook's Stop gate (see `.claude/hooks/inbox.js`).
 * Unlike decideClaude/decideGrok, this ignores handoff recency and
 * stop_hook_active: the inbox gate asks "is context over cap" (deliver later),
 * not "would the cap hook block" (suppressed after a fresh handoff). A
 * suppressed-but-over-cap probe previously read as "under cap" whenever the
 * checkout held a recent `.openclinxr/handoffs` entry, so Stop delivery fired
 * exactly when it had to hand off instead. Returns the stdout payload, or null
 * when at/under cap or when the token count is unknown.
 */
export function overCapReport(
  tokens: number | null,
  cap: number,
  compactions?: number | null,
  compactionsBeforeHandoff?: number,
): string | null {
  if (handoffDue(tokens, cap, compactions, compactionsBeforeHandoff) === null) return null;
  return JSON.stringify({ overCap: true, tokens, cap, ...(compactions != null ? { compactions } : {}) });
}

export function decideGrok(opts: {
  tokens: number | null;
  cap: number;
  isStop: boolean;
  stopHookActive: boolean;
  handoffRecent: boolean;
}): GrokDecision | null {
  const { tokens, cap, isStop, stopHookActive, handoffRecent } = opts;
  if (tokens === null || tokens <= cap) return null;
  const msg = buildCapMessage(tokens, cap);
  if (isStop) {
    if (stopHookActive || handoffRecent) return null;
    return { json: JSON.stringify({ decision: "block", reason: msg }) };
  }
  return { text: msg };
}

function grokSessionDir(cwd: string): string {
  return join(homedir(), ".grok", "sessions", encodeURIComponent(cwd));
}

function newestUpdatesFile(dir: string): string | null {
  let best: { path: string; mtimeMs: number } | null = null;
  let sessions: string[];
  try {
    sessions = readdirSync(dir);
  } catch {
    return null;
  }
  for (const sessionId of sessions) {
    const candidate = join(dir, sessionId, "updates.jsonl");
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (!best || stat.mtimeMs > best.mtimeMs)) {
        best = { path: candidate, mtimeMs: stat.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return best?.path ?? null;
}

function readTranscriptFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read at most the last maxBytes of a (possibly huge) JSONL file, dropping
 * the first partial line so the parser never starts mid-object.
 * Returns the text plus whether the file was larger than the window.
 */
export function readTailText(path: string, maxBytes: number): { text: string; truncated: boolean } | null {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return null;
  }
  if (size <= maxBytes) {
    const text = readTranscriptFile(path);
    return text === null ? null : { text, truncated: false };
  }
  let fd = -1;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(maxBytes);
    let read = 0;
    while (read < maxBytes) {
      const n = readSync(fd, buf, read, maxBytes - read, size - maxBytes + read);
      if (n <= 0) break;
      read += n;
    }
    const chunk = buf.slice(0, read).toString("utf8");
    const firstNewline = chunk.indexOf("\n");
    return {
      text: firstNewline === -1 ? "" : chunk.slice(firstNewline + 1),
      truncated: true,
    };
  } catch {
    return null;
  } finally {
    if (fd !== -1) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Newest token count from a transcript file: parse the tail window first
 * (usage lines live at the end); only when the tail holds no usable line and
 * the file is larger, fall back to the whole file.
 */
export function tokensFromTranscriptFile(
  path: string,
  parse: (text: string) => number | null,
  maxBytes = TAIL_BYTES,
): number | null {
  const tail = readTailText(path, maxBytes);
  if (tail === null) return null;
  const fromTail = parse(tail.text);
  if (fromTail !== null || !tail.truncated) return fromTail;
  const whole = readTranscriptFile(path);
  return whole === null ? null : parse(whole);
}

function main(): void {
  const argv = process.argv.slice(2);
  const grok = argv.includes("--grok");
  const repoRoot = process.cwd();
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  let input: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      process.exit(0);
    }
  }
  const cap = resolveCap(repoRoot, process.env, grok ? "grok" : "claude");
  const str = (key: string): string | null =>
    typeof input[key] === "string" ? (input[key] as string) : null;

  if (grok) {
    const sessionId = str("sessionId") ?? str("session_id") ?? str("sessionID");
    let updatesPath: string | null = null;
    if (sessionId) {
      const candidate = join(grokSessionDir(repoRoot), sessionId, "updates.jsonl");
      if (existsSync(candidate)) updatesPath = candidate;
    }
    updatesPath ??= newestUpdatesFile(grokSessionDir(repoRoot));
    const tokens = updatesPath ? tokensFromTranscriptFile(updatesPath, contextTokensFromGrokUpdates) : null;
    const stopActive =
      input.stop_hook_active === true ||
      input.stopHookActive === true ||
      input.stop_hook_active === "true";
    // The Grok Stop payload carries the closing message (see
    // blocked-work-must-escalate.mjs); SessionStart/PreCompact payloads do not.
    // Those events only show stdout text, so they get the plain message.
    const eventName =
      typeof input.hook_event_name === "string" ? input.hook_event_name : null;
    const isStop =
      stopActive ||
      eventName === "Stop" ||
      (eventName === null &&
        ("lastAssistantMessage" in input || "last_assistant_message" in input));
    const out = decideGrok({
      tokens,
      cap,
      isStop,
      stopHookActive: stopActive,
      handoffRecent: hasRecentHandoff(repoRoot),
    });
    // Grok shows hook stdout/stderr text to the agent; the Stop event also
    // honors the {"decision":"block"} JSON shape (see blocked-work-must-escalate.mjs).
    if (out?.json !== undefined) process.stdout.write(`${out.json}\n`);
    else if (out?.text !== undefined) process.stdout.write(`${out.text}\n`);
    process.exit(0);
  }

  const transcriptPath = str("transcript_path") ?? str("transcriptPath");
  const tokens = transcriptPath
    ? tokensFromTranscriptFile(transcriptPath, contextTokensFromClaudeTranscript)
    : null;
  const compactionsBeforeHandoff = resolveCompactionsBeforeHandoff();
  const compactions =
    compactionsBeforeHandoff > 0 && transcriptPath ? countCompactionsInFile(transcriptPath) : null;
  if (argv.includes("--probe-over-cap")) {
    const probe = overCapReport(tokens, cap, compactions, compactionsBeforeHandoff);
    if (probe !== null) process.stdout.write(`${probe}\n`);
    process.exit(0);
  }
  const hookEvent = str("hook_event_name") ?? str("hookEventName") ?? "UserPromptSubmit";
  const stopHookActive =
    input.stop_hook_active === true || input.stopHookActive === true;
  const out = decideClaude({
    tokens,
    cap,
    hookEvent,
    stopHookActive,
    handoffRecent: hasRecentHandoff(repoRoot),
    compactions,
    compactionsBeforeHandoff,
  });
  if (out !== null) process.stdout.write(`${out}\n`);
  process.exit(0);
}

const invokedDirectly = process.argv[1]?.endsWith("context-cap.ts") ?? false;
if (invokedDirectly) main();
