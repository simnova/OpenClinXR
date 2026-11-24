/**
 * lane-driver — advance an AUTOCONTINUE lane headlessly: one `claude -p` process per handoff item,
 * so each item starts with a fresh context and no desktop click restarts the lane. No model in the
 * control path (D9): continue/stop is decided from the run's final line and the handoff file.
 *
 * Usage: pnpm openclaw:lane-driver -- <lane> <worktree>
 *   [--max-iterations 10] [--timeout-min 60] [--min-idle-min 15] [--model <id>] [--max-budget-usd <n>]
 *   [--allow <tool pattern> ...]
 *
 * Handoff: <worktree>/.openclinxr/handoffs/<lane>.md. Refuses unless it has a line `AUTOCONTINUE: on`.
 * Item id: the first `START AT item <id>` line. Halt lines: `LANE HALTED`, `AUTOCONTINUE: off`, or a
 * line that is only `pause` / `stop` (any case).
 *
 * Decision per run, first match wins: handoff halted -> stop; final line BLOCKED: -> stop; run timed out
 * or failed -> stop; START AT advanced -> continue; final line WAITING: -> stop; START AT unchanged for
 * 2 runs in a row -> stop (one retry); else continue. Plus --max-iterations.
 *
 * Background jobs: the run's process group is killed when it exits or times out, so a Blender job left
 * in the background dies. Chosen approach: the prompt tells the run to run renders in the FOREGROUND and
 * wait for them (Bash timeout up to 10 min per call; split longer renders). The driver does not wait on
 * jobs it cannot see.
 *
 * Refuses when the handoff changed less than --min-idle-min ago (a live desktop session may hold the
 * lane) or when another driver holds <worktree>/.openclinxr/lane-driver/<lane>.lock.
 *
 * Permissions: --permission-mode dontAsk (anything not allowed is denied, never prompted) with an
 * explicit --allowedTools list: BASE_ALLOWED below plus permissions.allow from the worktree's
 * .claude/settings.json. --setting-sources user,project keeps the main checkout's local Stop hook
 * (lane-continue.js) out of the run, so one process does one item. Child env drops RUST_LOG,
 * OPENCLAW_SKIP_HOOKS and inherited GIT_* repo vars.
 *
 * Auth: refuses unless `claude auth status` reports loggedIn. LANE_DRIVER_CLAUDE_BIN overrides the
 * binary (tests use a fake).
 *
 * Log: <worktree>/.openclinxr/lane-driver/<lane>.jsonl, one line per run (duration, cost, tokens,
 * final line, START AT before/after, decision).
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const BASE_ALLOWED = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "TodoWrite",
  "Skill",
  // All of git: lanes use `git -C <path> ...` and compound commands; DISALLOWED (deny wins) removes the unsafe parts.
  "Bash(git:*)",
  "Bash(cd:*)",
  "Bash(test:*)",
  "Bash(diff:*)",
  "Bash(sort:*)",
  "Bash(jq:*)",
  "Bash(pnpm:*)",
  "Bash(node:*)",
  "Bash(npx tsx:*)",
  "Bash(python3:*)",
  "Bash(blender:*)",
  "Bash(/Applications/Blender.app/Contents/MacOS/Blender:*)",
  "Bash(/Applications/Blender-5.3.app/Contents/MacOS/Blender:*)",
  "Bash(timeout:*)",
  "Bash(shasum:*)",
  "Bash(which:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(head:*)",
  "Bash(tail:*)",
  "Bash(wc:*)",
  "Bash(grep:*)",
  "Bash(rg:*)",
  "Bash(find:*)",
  "Bash(sed:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "Bash(stat:*)",
  "Bash(date:*)",
  "Bash(echo:*)",
  "Bash(printf:*)",
  "Bash(touch:*)",
  "Bash(sips:*)",
  "Bash(magick:*)",
  "Bash(ffmpeg:*)",
];

export const DISALLOWED = [
  "Bash(git push:*)",
  "Bash(git *push*)",
  "Bash(git stash:*)",
  "Bash(git *stash*)",
  "Bash(git reset --hard:*)",
  "Bash(git *reset --hard*)",
  "Bash(git config:*)",
  "Bash(git -C * config:*)",
  "Bash(*--no-verify*)",
  "Bash(*OPENCLAW_SKIP_HOOKS*)",
  "Bash(*core.hooksPath*)",
  "Bash(*RUST_LOG*)",
];

export type Marker = "BLOCKED" | "WAITING" | "DONE" | null;

export type RunOutcome = {
  final: string;
  startBefore: string | null;
  startAfter: string | null;
  halted: boolean;
  timedOut: boolean;
  failed: boolean;
  stalls: number;
};

export type Decision = { action: "continue" | "stop"; reason: string; stalls: number };

export function startAtItem(handoff: string): string | null {
  return /^\s*START AT item\s+([^\s(:,]+)/m.exec(handoff)?.[1] ?? null;
}

export function isOptedIn(handoff: string): boolean {
  return /^AUTOCONTINUE:\s*on\s*$/m.test(handoff) && !isHalted(handoff);
}

export function isHalted(handoff: string): boolean {
  return /^(LANE HALTED\b|AUTOCONTINUE:\s*off\s*$|\s*(pause|stop)\s*$)/im.test(handoff);
}

/** Last non-empty line of the run's result text. */
export function finalLine(result: string): string {
  return (
    String(result ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

/** Marker at the start of a line, tolerating markdown emphasis (`**BLOCKED:** x`). */
export function markerOf(line: string): Marker {
  const m = /^[\s*_>`#-]*(BLOCKED|WAITING|DONE)[*_`]*:/.exec(line);
  return (m?.[1] as Marker) ?? null;
}

export function decide(o: RunOutcome): Decision {
  const marker = markerOf(o.final);
  if (o.halted) return { action: "stop", reason: "handoff halted (pause/stop/LANE HALTED/AUTOCONTINUE: off)", stalls: o.stalls };
  if (marker === "BLOCKED") return { action: "stop", reason: `blocked: ${o.final}`, stalls: o.stalls };
  if (o.timedOut) return { action: "stop", reason: "run timed out", stalls: o.stalls };
  if (o.failed) return { action: "stop", reason: "run failed (non-zero exit or is_error)", stalls: o.stalls };
  if (o.startAfter === null) return { action: "stop", reason: "handoff has no START AT line after the run", stalls: o.stalls };
  if (o.startAfter !== o.startBefore) return { action: "continue", reason: `START AT ${o.startBefore} -> ${o.startAfter}`, stalls: 0 };
  if (marker === "WAITING") return { action: "stop", reason: `waiting: ${o.final}`, stalls: o.stalls + 1 };
  const stalls = o.stalls + 1;
  if (stalls >= 2) return { action: "stop", reason: `START AT ${o.startAfter} unchanged for ${stalls} runs`, stalls };
  return { action: "continue", reason: `START AT ${o.startAfter} unchanged, retrying once`, stalls };
}

export function resumePrompt(lane: string, handoffPath: string, item: string): string {
  return (
    `You are resuming lane ${lane}. Read ${handoffPath}, verify every mechanical fact with git before acting, ` +
    `then do START AT item ${item}.\n\n` +
    "Headless run rules (lane-driver):\n" +
    "- Do only this one item. This process exits when you end the turn; the driver starts a fresh one for the next item.\n" +
    "- When the item is done, commit it in this worktree and update the handoff: set the START AT line to the next item.\n" +
    "- Run Blender renders and other long jobs in the FOREGROUND and wait for them. Background jobs are killed when this " +
    "process exits. Split a job over 10 minutes into several foreground calls.\n" +
    "- There is no human. Never ask a question. End your reply with exactly one final line:\n" +
    `  DONE: ${item} (when START AT moved), or WAITING: <what> (cannot proceed yet, retry later), ` +
    "or BLOCKED: <what the operator must decide>."
  );
}

export function allowedTools(worktree: string): string[] {
  const out = new Set(BASE_ALLOWED);
  for (const f of ["settings.json", "settings.local.json"]) {
    try {
      const s = JSON.parse(readFileSync(join(worktree, ".claude", f), "utf8")) as { permissions?: { allow?: unknown } };
      for (const a of Array.isArray(s.permissions?.allow) ? s.permissions.allow : []) if (typeof a === "string") out.add(a);
    } catch {
      // absent or unreadable settings contribute nothing
    }
  }
  return [...out];
}

/**
 * Drops hook-bypass and git-redirect vars, and every CLAUDE* var: launched from inside a desktop
 * session, the child inherits CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH and session ids and fails auth
 * (measured 2026-11-24: "OAuth session expired"); without them it uses the CLI's own keychain login.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const k of Object.keys(env)) {
    if (/^CLAUDE/.test(k) || ["RUST_LOG", "OPENCLAW_SKIP_HOOKS", "AI_AGENT", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].includes(k)) {
      delete env[k];
    }
  }
  return env;
}

function claudeBin(): string {
  return process.env.LANE_DRIVER_CLAUDE_BIN || "claude";
}

/** `claude auth status` JSON; null when unreadable. */
function authStatus(cwd: string): Promise<{ loggedIn?: boolean } | null> {
  return new Promise((done) => {
    const child = spawn(claudeBin(), ["auth", "status"], { cwd, env: childEnv(), stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => done(null));
    child.on("close", () => {
      try {
        done(JSON.parse(out) as { loggedIn?: boolean });
      } catch {
        done(null);
      }
    });
  });
}

type ClaudeJson = {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
  usage?: Record<string, number>;
  permission_denials?: { tool_name?: string; tool_input?: Record<string, unknown> }[];
};

type RunResult = { json: ClaudeJson | null; code: number | null; timedOut: boolean; stderr: string; ms: number };

function runClaude(args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((done) => {
    const t0 = Date.now();
    // detached: own process group, so a timeout kills the run and anything it started.
    const child = spawn(claudeBin(), args, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const killGroup = (sig: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        // group already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup("SIGTERM");
      let json: ClaudeJson | null = null;
      try {
        json = JSON.parse(stdout.trim()) as ClaudeJson;
      } catch {
        json = null;
      }
      done({ json, code, timedOut, stderr: stderr.slice(-2000), ms: Date.now() - t0 });
    });
  });
}

type Options = {
  lane: string;
  worktree: string;
  maxIterations: number;
  timeoutMin: number;
  minIdleMin: number;
  model?: string;
  maxBudgetUsd?: string;
  allow: string[];
};

function parseArgs(argv: string[]): Options | null {
  const pos: string[] = [];
  const o: Partial<Options> & { allow: string[] } = { allow: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const v = argv[i + 1];
    if (a === "--") continue;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    if (v === undefined) return null;
    i += 1;
    if (a === "--max-iterations") o.maxIterations = Number(v);
    else if (a === "--timeout-min") o.timeoutMin = Number(v);
    else if (a === "--min-idle-min") o.minIdleMin = Number(v);
    else if (a === "--model") o.model = v;
    else if (a === "--max-budget-usd") o.maxBudgetUsd = v;
    else if (a === "--allow") o.allow.push(v);
    else return null;
  }
  if (pos.length !== 2) return null;
  return {
    lane: pos[0]!,
    worktree: resolve(pos[1]!),
    maxIterations: o.maxIterations ?? 10,
    timeoutMin: o.timeoutMin ?? 60,
    minIdleMin: o.minIdleMin ?? 15,
    model: o.model,
    maxBudgetUsd: o.maxBudgetUsd,
    allow: o.allow,
  };
}

async function main(o: Options): Promise<number> {
  const handoffPath = join(o.worktree, ".openclinxr", "handoffs", `${o.lane}.md`);
  const logDir = join(o.worktree, ".openclinxr", "lane-driver");
  const logPath = join(logDir, `${o.lane}.jsonl`);
  const lockPath = join(logDir, `${o.lane}.lock`);
  const say = (s: string): void => void process.stdout.write(`lane-driver ${o.lane}: ${s}\n`);
  const read = (): string => readFileSync(handoffPath, "utf8");

  if (!existsSync(handoffPath)) return say(`no handoff at ${handoffPath}`), 2;
  if (!isOptedIn(read())) return say("handoff is not AUTOCONTINUE: on (or is halted); refusing"), 2;
  const idleMin = (Date.now() - statSync(handoffPath).mtimeMs) / 60_000;
  if (idleMin < o.minIdleMin) {
    return say(`handoff changed ${idleMin.toFixed(1)} min ago (< --min-idle-min ${o.minIdleMin}); a live session may hold the lane`), 2;
  }
  const auth = await authStatus(o.worktree);
  if (auth?.loggedIn !== true) return say("`claude auth status` is not logged in; run `claude auth login` in a terminal"), 2;
  mkdirSync(logDir, { recursive: true });
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) return say(`driver pid ${pid} holds ${lockPath}`), 2;
  }
  writeFileSync(lockPath, String(process.pid));
  const release = (): void => rmSync(lockPath, { force: true });
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(130));

  const tools = [...allowedTools(o.worktree), ...o.allow];
  let stalls = 0;
  for (let i = 1; i <= o.maxIterations; i += 1) {
    const before = read();
    const startBefore = startAtItem(before);
    if (!isOptedIn(before)) return say("handoff halted before run"), 0;
    if (startBefore === null) return say("handoff has no START AT item line"), 2;
    const args = [
      "-p",
      resumePrompt(o.lane, handoffPath, startBefore),
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--setting-sources",
      "user,project",
      "--allowedTools",
      ...tools,
      "--disallowedTools",
      ...DISALLOWED,
    ];
    if (o.model) args.push("--model", o.model);
    if (o.maxBudgetUsd) args.push("--max-budget-usd", o.maxBudgetUsd);
    say(`run ${i}/${o.maxIterations}: START AT ${startBefore}`);
    const r = await runClaude(args, o.worktree, o.timeoutMin * 60_000);
    const after = existsSync(handoffPath) ? read() : "";
    const final = finalLine(r.json?.result ?? "");
    const decision = decide({
      final,
      startBefore,
      startAfter: startAtItem(after),
      halted: after !== "" && isHalted(after),
      timedOut: r.timedOut,
      failed: r.code !== 0 || r.json === null || r.json.is_error === true,
      stalls,
    });
    stalls = decision.stalls;
    const u = r.json?.usage ?? {};
    const entry = {
      at: new Date().toISOString(),
      lane: o.lane,
      run: i,
      session_id: r.json?.session_id ?? null,
      exit: r.code,
      timed_out: r.timedOut,
      duration_ms: r.json?.duration_ms ?? r.ms,
      cost_usd: r.json?.total_cost_usd ?? null,
      num_turns: r.json?.num_turns ?? null,
      tokens: {
        input: u.input_tokens ?? null,
        output: u.output_tokens ?? null,
        cache_creation: u.cache_creation_input_tokens ?? null,
        cache_read: u.cache_read_input_tokens ?? null,
      },
      start_before: startBefore,
      start_after: startAtItem(after),
      final_line: final,
      decision,
      // Tool calls dontAsk refused; a lane that BLOCKs on permissions shows the missing pattern here.
      permission_denials: (r.json?.permission_denials ?? []).map((d) => ({
        tool: d.tool_name ?? "?",
        input: String(d.tool_input?.command ?? d.tool_input?.file_path ?? JSON.stringify(d.tool_input ?? {})).slice(0, 300),
      })),
      stderr_tail: r.json === null ? r.stderr : undefined,
    };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    say(
      `run ${i}: ${(entry.duration_ms / 1000).toFixed(0)} s, $${entry.cost_usd ?? "?"}, ` +
        `out ${entry.tokens.output ?? "?"} tok, final "${final}" -> ${decision.action} (${decision.reason})`,
    );
    if (decision.action === "stop") return markerOf(final) === "BLOCKED" || r.timedOut || entry.decision.reason.startsWith("run failed") ? 3 : 0;
  }
  say(`max iterations ${o.maxIterations} reached`);
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("lane-driver.ts") ?? false;
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write(
      "usage: lane-driver.ts <lane> <worktree> [--max-iterations N] [--timeout-min N] [--min-idle-min N] " +
        "[--model id] [--max-budget-usd N] [--allow <tool pattern> ...]\n",
    );
    process.exit(2);
  }
  main(opts).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`lane-driver failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
}
