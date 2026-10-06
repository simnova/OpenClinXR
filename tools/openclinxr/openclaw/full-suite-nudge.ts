#!/usr/bin/env tsx
/**
 * full-suite-nudge — warn (never block) when a worker hand-runs full suites.
 *
 * MEASURED 2026-10-06: two mouth slices spent roughly half their wall time
 * re-running full package suites after each edit. The brief carries the Test
 * loop; this hook is the backstop for the habit: on the 2nd+ full-suite run
 * in a session it prints one line pointing back at `pnpm test:touched`.
 *
 * Wiring matches the other chokepoints (`.grok/hooks/*.json` PreToolUse on
 * Bash / run_terminal_command → this script via tsx). Verdict is always
 * `allow`: a hook that blocks test runs would stop legitimate gates.
 *
 * A full-suite run is one of:
 * - `pnpm --filter <pkg> test` (no file argument)
 * - `pnpm -r test` / `pnpm --recursive test`
 * - `pnpm test` with no file argument
 * Anything naming a file (e.g. `pnpm test:touched`, `vitest run x.test.ts`)
 * is iteration, not a full suite, and never warns.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const NUDGE_LINE = (n: number): string =>
  `full suite run #${n} this session; iterate with pnpm test:touched, the commit hook runs the full gate`;

/** One shell segment (split on &&, ||, ;, |) that runs a full test suite. */
export function isFullSuiteSegment(segment: string): boolean {
  const tokens = segment.trim().split(/\s+/u).filter(Boolean);
  const pnpmIdx = tokens.findIndex((t) => t === "pnpm" || t === "npm" || t.endsWith("/pnpm"));
  if (pnpmIdx < 0) return false;
  const argv = tokens.slice(pnpmIdx + 1);
  let i = 0;
  // Skip --filter <pkg> pairs and recursive flags.
  let sawScope = false;
  while (i < argv.length) {
    const t = argv[i]!;
    if (t === "--filter" || t === "-F") { i += 2; sawScope = true; continue; }
    if (t.startsWith("--filter=")) { i += 1; sawScope = true; continue; }
    if (t === "-r" || t === "--recursive" || t === "-w" || t === "--workspaces" || t === "--ws") {
      i += 1; sawScope = true; continue;
    }
    break;
  }
  // Then `test` or `run test`.
  if (argv[i] === "run" && argv[i + 1] === "test") i += 2;
  else if (argv[i] === "test") i += 1;
  else return false;
  void sawScope;
  // After `test`, only flags may follow. A positional (file path, filter
  // string, test name) means a scoped run, not a full suite.
  const rest = argv.slice(i);
  if (rest.length === 0) return true;
  return rest.every((t) => t.startsWith("-"));
}

/** True when any segment of a shell line is a full-suite run. */
export function isFullSuiteRun(command: string): boolean {
  return command
    .split(/&&|\|\||[;|]/u)
    .some((seg) => isFullSuiteSegment(seg));
}

/**
 * Pure sequence evaluator (what the test drives with a fixture command list):
 * returns the nudge line for a command when it is the 2nd+ full-suite run in
 * the sequence, else null. Never blocks — there is no deny path.
 */
export function warnForSequence(commands: string[]): (string | null)[] {
  let fullRuns = 0;
  return commands.map((cmd) => {
    if (!isFullSuiteRun(cmd)) return null;
    fullRuns += 1;
    return fullRuns >= 2 ? NUDGE_LINE(fullRuns) : null;
  });
}

function countFile(): string {
  const sid = process.env["GROK_SESSION_ID"] ?? "";
  const key = sid.trim().length > 0
    ? sid.trim()
    : createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12);
  const dir = join(tmpdir(), "openclinxr-full-suite-nudge");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${key}.count`);
}

function readCount(path: string): number {
  try {
    const n = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

type HookInput = {
  toolInput?: { command?: string; [key: string]: unknown };
};

function hookMain(): void {
  let command = "";
  try {
    const raw = readFileSync(0, "utf8");
    if (raw.trim()) {
      const input = JSON.parse(raw) as HookInput;
      if (typeof input.toolInput?.command === "string") command = input.toolInput.command;
    }
  } catch {
    // Fail open on unreadable input.
  }
  if (!command) command = process.env["GROK_TOOL_COMMAND"] ?? "";
  if (!isFullSuiteRun(command)) {
    process.stdout.write(`${JSON.stringify({ decision: "allow", reason: "full-suite-nudge: not a full-suite run" })}\n`);
    return;
  }
  const path = countFile();
  const n = readCount(path) + 1;
  try {
    writeFileSync(path, `${n}\n`);
  } catch {
    // Count persistence is best-effort; the verdict does not depend on it.
  }
  const reason = n >= 2 ? NUDGE_LINE(n) : `full-suite-nudge: full suite run #${n} this session`;
  process.stdout.write(`${JSON.stringify({ decision: "allow", reason })}\n`);
}

const isMain =
  Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMain) hookMain();
