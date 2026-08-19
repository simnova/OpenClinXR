#!/usr/bin/env tsx
/**
 * dispatch-chokepoint — refuse raw headless `grok -p` that bypasses dispatch().
 *
 * STOPPING CONDITION: a delegate that tries to spawn a worker via raw `grok -p` (or
 * `--single`) FAILS mechanically — without anyone reading its report. Layers 3–6 of
 * merge-safety (task contract, diff-class, merge kill, loop pause) all hang off
 * `dispatch()` in dispatch-worker.ts. A raw spawn gets none of them.
 *
 * MECHANISM (honest claim): this is a **string matcher** over shell-tool command text
 * (PreToolUse on Bash / run_terminal_command). It is NOT an OS sandbox, NOT a process
 * boundary, and NOT enforcement against a hostile peer sharing the same uid. Known
 * escapes of the matcher class include: `node -e` + spawn of the binary, computed
 * argv that never appears as `grok -p` in the shell line, and writing a helper script
 * then executing it. Real containment of hostile same-uid processes is OS-level.
 *
 * SANCTIONED ESCAPE: set OPENCLINXR_RAW_GROK_SANCTIONED=1 and a non-empty
 * OPENCLINXR_RAW_GROK_REASON (session env or leading shell assignments). Required for
 * control/treatment isolation probes that must run grok with path denies OFF — which
 * dispatch() structurally cannot do when worktree-bound. Escapes are logged to the
 * shared coordination ledger so silence is impossible.
 *
 * Workers (OPENCLINXR_WORKER=1) NEVER get the escape: a worker re-spawning raw grok is
 * exactly the silent guarantee loss this chokepoint exists to catch.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSharedCoordinationPath } from "./coordination-root.js";

/** Env that names the explicit, logged escape past the chokepoint. */
export const RAW_GROK_SANCTION_ENV = "OPENCLINXR_RAW_GROK_SANCTIONED";
/** Free-text reason required with the sanction (logged; empty reason = not sanctioned). */
export const RAW_GROK_REASON_ENV = "OPENCLINXR_RAW_GROK_REASON";
/** Append-only ledger of sanctioned escapes (shared coordination root). */
export const RAW_GROK_SANCTION_LEDGER = ".openclinxr/openclaw/raw-grok-sanctioned.jsonl";

export type ChokepointVerdict =
  | { decision: "allow"; reason: string; matched?: false }
  | { decision: "allow"; reason: string; matched: true; sanctioned: true; sanctionReason: string }
  | { decision: "deny"; reason: string; matched: true };

export type SanctionContext = {
  env: NodeJS.ProcessEnv;
  /** Absolute or relative repo root used only for the sanction ledger path. */
  repoRoot?: string;
  /** When true, write a ledger line for sanctioned allows (hook path). Tests set false. */
  logSanction?: boolean;
};

// ISSUE #437: `--prompt-file` is now THE way dispatch() enters headless mode, so the matcher must
// cover it too — otherwise a raw shell `grok --prompt-file …` bypasses dispatch() and every layer
// hanging off it (contract, worktree deny, loop pause). `--prompt-json` has the same property but
// is not used by any sanctioned path today; it is deliberately NOT added here to keep the matcher
// to the flags the pipeline actually emits (adding it would be a separate, named change).
const HEADLESS_FLAGS = new Set(["-p", "--single", "--prompt", "--prompt-file"]);

/** Path-ish tokens that are the grok CLI binary (not `pnpm grok:tier:…`). */
export function isGrokBinaryToken(token: string): boolean {
  const t = token.replace(/^['"]|['"]$/g, "");
  if (t === "grok") return true;
  // ~/.grok/bin/grok, /usr/local/bin/grok, …/grok — not *grok* embedded in other names
  if (/(?:^|\/)grok$/.test(t)) return true;
  return false;
}

/**
 * Split a shell command into rough segments at top-level operators.
 * Quote-aware enough for common agent commands; not a full shell parser.
 */
export function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    // Operators: ; && || | (newline)
    if (ch === "\n" || ch === ";") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (ch === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/** Tokenize a segment on whitespace (quote-aware). */
export function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

type LeadingEnv = { assignments: Record<string, string>; rest: string[] };

/** Peel leading VAR=value assignments (including the sanction envs). */
export function peelLeadingEnvAssignments(tokens: string[]): LeadingEnv {
  const assignments: Record<string, string> = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(t);
    if (!m) break;
    assignments[m[1]!] = m[2] ?? "";
    i += 1;
  }
  return { assignments, rest: tokens.slice(i) };
}

const WRAPPER_PREFIXES = new Set(["env", "command", "time", "nice", "nohup", "exec"]);

/**
 * True when this shell segment would launch a headless grok worker (raw, not via dispatch()).
 * CLAIM surface: matches literal argv shape of common agent shell lines.
 */
export function segmentIsRawGrokHeadless(segment: string): boolean {
  const tokens = tokenizeSegment(segment);
  if (tokens.length === 0) return false;
  const { rest } = peelLeadingEnvAssignments(tokens);
  return tokensLookLikeRawGrokHeadless(rest);
}

function tokensLookLikeRawGrokHeadless(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  // bash/sh/zsh -c '…' — inspect the script argument (common agent nesting)
  const shellIdx = tokens.findIndex((t) => /^(?:ba)?sh$|^zsh$|^dash$/.test(t));
  if (shellIdx >= 0) {
    const cIdx = tokens.indexOf("-c", shellIdx);
    if (cIdx >= 0 && tokens[cIdx + 1]) {
      // Nested command may itself contain raw grok
      if (commandContainsRawGrokHeadless(tokens[cIdx + 1]!)) return true;
    }
  }

  let i = 0;
  while (i < tokens.length && WRAPPER_PREFIXES.has(tokens[i]!)) {
    i += 1;
    // `env VAR=val …` — skip more assignments after env
    if (tokens[i - 1] === "env") {
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) i += 1;
    }
  }

  if (i >= tokens.length) return false;
  if (!isGrokBinaryToken(tokens[i]!)) return false;

  const args = tokens.slice(i + 1);
  return args.some((a) => HEADLESS_FLAGS.has(a));
}

/** True if any segment of the command is a raw headless grok invocation. */
export function commandContainsRawGrokHeadless(command: string): boolean {
  return splitShellSegments(command).some(segmentIsRawGrokHeadless);
}

export function readSanctionFromEnv(env: NodeJS.ProcessEnv): { sanctioned: boolean; reason: string } {
  const flag = env[RAW_GROK_SANCTION_ENV];
  const sanctioned = flag === "1" || flag === "true";
  const reason = (env[RAW_GROK_REASON_ENV] ?? "").trim();
  return { sanctioned: sanctioned && reason.length > 0, reason };
}

/** Merge process env with leading shell VAR= assignments for sanction evaluation. */
export function mergeSanctionEnv(
  processEnv: NodeJS.ProcessEnv,
  command: string,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...processEnv };
  for (const segment of splitShellSegments(command)) {
    const { assignments } = peelLeadingEnvAssignments(tokenizeSegment(segment));
    for (const [k, v] of Object.entries(assignments)) {
      if (k === RAW_GROK_SANCTION_ENV || k === RAW_GROK_REASON_ENV) {
        merged[k] = v;
      }
    }
  }
  return merged;
}

export function recordSanctionedEscape(repoRoot: string, entry: {
  reason: string;
  command: string;
  at?: string;
}): string {
  const path = resolveSharedCoordinationPath(RAW_GROK_SANCTION_LEDGER, repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const line = {
    schemaVersion: "openclinxr.raw-grok-sanction.v1",
    at: entry.at ?? new Date().toISOString(),
    reason: entry.reason,
    // Truncate so the ledger never becomes a prompt dump
    commandPreview: entry.command.slice(0, 200),
  };
  appendFileSync(path, `${JSON.stringify(line)}\n`);
  return path;
}

/**
 * Evaluate a shell-tool command against the chokepoint.
 *
 * @param command - the shell line the agent is about to run
 * @param ctx - env + optional ledger logging
 */
export function evaluateRawGrokShellCommand(
  command: string,
  ctx: SanctionContext = { env: process.env },
): ChokepointVerdict {
  if (!commandContainsRawGrokHeadless(command)) {
    return {
      decision: "allow",
      reason: "not a raw headless grok (-p/--single/--prompt-file) invocation",
      matched: false,
    };
  }

  // Workers never get the escape — that is the silent-bypass class this exists for.
  const worker = ctx.env["OPENCLINXR_WORKER"];
  if (worker === "1" || worker === "true") {
    return {
      decision: "deny",
      matched: true,
      reason:
        "REFUSING raw `grok -p` from OPENCLINXR_WORKER=1. Workers must not re-spawn headless "
        + "grok outside dispatch() — contract, baseline, proofs, and loop-pause would all be skipped. "
        + "Use the parent orchestrator's dispatch() path instead.",
    };
  }

  const sanctionEnv = mergeSanctionEnv(ctx.env, command);
  const { sanctioned, reason } = readSanctionFromEnv(sanctionEnv);
  if (sanctioned) {
    if (ctx.logSanction !== false && ctx.repoRoot) {
      try {
        recordSanctionedEscape(ctx.repoRoot, { reason, command });
      } catch {
        // Ledger write failure must not convert a sanctioned allow into a deny of the probe,
        // but the escape is no longer silent only if the write succeeds — best-effort.
      }
    }
    return {
      decision: "allow",
      matched: true,
      sanctioned: true,
      sanctionReason: reason,
      reason:
        `Sanctioned raw grok escape (${RAW_GROK_SANCTION_ENV}=1, reason=${JSON.stringify(reason)}). `
        + `Logged when repoRoot is provided. Isolation probes and explicit orchestrator escapes only.`,
    };
  }

  return {
    decision: "deny",
    matched: true,
    reason:
      "REFUSING raw headless `grok -p` / `--single` that bypasses dispatch(). "
      + "Layers 3–6 (task contract, diff-class, merge-kill, loop-pause) hang off "
      + "tools/openclinxr/openclaw/dispatch-worker.ts `dispatch()`. "
      + "Use dispatch() (or pnpm openclaw:dispatch when wired). "
      + `Orchestrator isolation-probe escape: ${RAW_GROK_SANCTION_ENV}=1 and non-empty `
      + `${RAW_GROK_REASON_ENV}=<why> (named + logged). `
      + "CLAIM: string matcher over shell-tool command text — not an FS sandbox.",
  };
}

// ---------------------------------------------------------------------------
// PreToolUse hook CLI (stdin JSON → stdout decision JSON)
// ---------------------------------------------------------------------------

type HookInput = {
  toolName?: string;
  toolInput?: { command?: string; [key: string]: unknown };
  cwd?: string;
  workspaceRoot?: string;
};

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function emit(decision: "allow" | "deny", reason: string): never {
  process.stdout.write(`${JSON.stringify({ decision, reason })}\n`);
  process.exit(decision === "deny" ? 2 : 0);
}

function hookMain(): void {
  const raw = readStdinSync();
  let input: HookInput = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw) as HookInput;
    } catch {
      // Fail open on unparseable input — hooks that crash fail open at the harness layer
      // anyway; emitting allow keeps the contract explicit.
      emit("allow", "dispatch-chokepoint: unparseable hook input — fail open");
    }
  }

  const command =
    (typeof input.toolInput?.command === "string" ? input.toolInput.command : "")
    || process.env["GROK_TOOL_COMMAND"]
    || "";

  if (!command) {
    emit("allow", "dispatch-chokepoint: no command on tool input");
  }

  const repoRoot =
    input.workspaceRoot
    || process.env["OPENCLINXR_REPO_ROOT"]
    || input.cwd
    || process.cwd();

  const verdict = evaluateRawGrokShellCommand(command, {
    env: process.env,
    repoRoot,
    logSanction: true,
  });

  emit(verdict.decision, verdict.reason);
}

/**
 * Probe CLI for control/treatment evidence (no stdin hook payload).
 *
 *   tsx dispatch-chokepoint.ts --probe --command 'grok -p "x"'
 *   OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_RAW_GROK_REASON=isolation-probe \
 *     tsx dispatch-chokepoint.ts --probe --command 'grok -p "x"'
 */
function probeMain(argv: string[]): void {
  const cmdIdx = argv.indexOf("--command");
  const command = cmdIdx >= 0 ? argv[cmdIdx + 1] ?? "" : "";
  if (!command) {
    process.stderr.write("usage: dispatch-chokepoint.ts --probe --command '<shell line>'\n");
    process.exit(1);
  }
  const repoRoot = process.env["OPENCLINXR_REPO_ROOT"] || process.cwd();
  const verdict = evaluateRawGrokShellCommand(command, {
    env: process.env,
    repoRoot,
    logSanction: true,
  });
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exit(verdict.decision === "deny" ? 2 : 0);
}

// Only run CLI when executed as the entry script (not when vitest/tsx imports this module).
const isMain =
  Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMain) {
  if (process.argv.includes("--probe")) {
    probeMain(process.argv.slice(2));
  } else {
    hookMain();
  }
}
