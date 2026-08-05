#!/usr/bin/env tsx
/**
 * dispatch-worker — the ONE supported way to dispatch a headless grok worker.
 *
 * WHY THIS EXISTS: every rule below was learned by losing work. They were written down in
 * `agentic-eval/docs/findings/delegation-reliability.md` and then violated anyway, because a
 * finding in a document only helps the person who happens to re-read it. Encoding them in the
 * dispatch path means they hold whether or not anyone remembers them.
 *
 * Each rule is annotated with the incident that produced it.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolveSharedCoordinationPath } from "./coordination-root.js";

/**
 * INCIDENT: a worker was capped at 50 turns and died at exactly turn 50; another survived by one
 * turn under a cap of 70. Median successful worker: 21 turns. Caps of 25-70 sit in the worst
 * possible band — generous-looking, yet lethal to substantial work. A killed worker wastes every
 * token already spent PLUS salvage time, so a cap is strictly worse than letting it finish.
 * Cost is controlled by scoping the task, not by capping turns. 150 is a runaway backstop.
 */
const DEFAULT_MAX_TURNS = 150;

/** INCIDENT: doc-hygiene overreach — workers rewrote unrelated docs without this set. */
const REQUIRED_ENV = { OPENCLINXR_WORKER: "1", GROK_SUBAGENTS: "1" } as const;

/**
 * SECURITY: `RUST_LOG=debug` and `--debug-file` cause grok to log the bearer API token in
 * plaintext. Never enable them. This is a hard refusal, not a warning.
 */
const FORBIDDEN_ENV = ["RUST_LOG", "GROK_DEBUG_FILE"] as const;

/** Where session ids survive the orchestrator process that created them. */
const LEDGER = ".openclinxr/openclaw/worker-sessions.jsonl";

type DispatchOptions = {
  prompt: string;
  slice?: string;
  role?: string;
  model?: string;
  resume?: string;
  maxTurns?: number;
  /**
   * Starting directory only — NOT an isolation boundary.
   *
   * INCIDENT: a worker dispatched with `--cwd <worktree>` wrote its edits into the MAIN checkout
   * (the worktree stayed clean). Git-root resolution and the repo path named in the prompt both
   * win over `--cwd`. Consequences: serialize file-writing workers, because two concurrent writers
   * WILL collide in one tree; and for genuine isolation use `spawn_subagent isolation="worktree"`.
   */
  cwd?: string;
  streaming?: boolean;
};

export type DispatchLedgerEntry = {
  sessionId: string;
  slice?: string;
  role?: string;
  model: string;
  turns?: number;
  stopReason?: string;
  resumedFrom?: string;
  at: string;
};

/**
 * INCIDENT (2026-08-05): dispatched as `grok -p --resume <id> "<prompt>"`. `-p` is short for
 * `--single` and takes the PROMPT as its value, so `--resume` was swallowed as the prompt and the
 * run aborted with "a value is required for '--single <PROMPT>'". The wrapper shell still exited
 * 0 (the trailing echo), so it LOOKED like a completed worker that had simply done nothing.
 *
 * Correct order is always: `-p "<prompt>"` FIRST, then every other flag.
 */
export function buildArgv(options: DispatchOptions): string[] {
  const argv = ["-p", options.prompt];
  if (options.resume) argv.push("--resume", options.resume);
  argv.push("--model", options.model ?? "deepseek-v4-pro");
  argv.push("--always-approve");
  // streaming-json emits a usage event per turn — the only way to see a stall while the worker is
  // still alive. Plain json yields aggregates only, i.e. you learn about the death afterwards.
  argv.push("--output-format", options.streaming ? "streaming-json" : "json");
  argv.push("--max-turns", String(options.maxTurns ?? DEFAULT_MAX_TURNS));
  if (options.cwd) argv.push("--cwd", options.cwd);
  return argv;
}

export function assertSafeEnvironment(env: NodeJS.ProcessEnv): void {
  for (const key of FORBIDDEN_ENV) {
    if (env[key]) {
      throw new Error(
        `${key} is set. REFUSING TO DISPATCH: grok logs the bearer API token in plaintext under `
        + `debug logging. Unset it and re-run. This is a credential-leak guard, not a style rule.`,
      );
    }
  }
}

/**
 * Persist the session id where it outlives this process.
 *
 * INCIDENT: 41 session ids from one session existed only in the orchestrator's scratch files.
 * `--resume` survives process exit and recovers a worker that died at ~90% — but only if you
 * still have the id. Four workers were hand-salvaged because the id had been thrown away.
 */
export function recordSession(repoRoot: string, entry: DispatchLedgerEntry): string {
  // Shared across worktrees: an orchestrator in one worktree must be able to resume a worker
  // dispatched from another, otherwise the ledger only helps the process that already had the id.
  const path = resolveSharedCoordinationPath(LEDGER, repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  return path;
}

export function readSessions(repoRoot: string): DispatchLedgerEntry[] {
  const path = resolveSharedCoordinationPath(LEDGER, repoRoot);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DispatchLedgerEntry];
      } catch {
        return [];
      }
    });
}

/** Most recent session for a slice — the id you want when resuming a dead worker. */
export function latestSessionFor(repoRoot: string, slice: string): DispatchLedgerEntry | undefined {
  return readSessions(repoRoot)
    .filter((entry) => entry.slice === slice)
    .at(-1);
}

/**
 * INCIDENT (2026-08-05): the worker's answer is under `text`, NOT `result`. Reading `result` gave
 * `null` for every dispatch, which read as "the worker produced nothing" — while the worker had in
 * fact done the work and committed it. Three runs were misjudged before the tree was checked.
 * Corollary: verify the TREE, never the report field you assume exists.
 */
function parseResult(raw: string): { sessionId?: string; turns?: number; stopReason?: string; text?: string } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      text: (parsed["text"] ?? parsed["result"]) as string | undefined,
      sessionId: parsed["sessionId"] as string | undefined,
      turns: parsed["num_turns"] as number | undefined,
      stopReason: (parsed["stopReason"] ?? parsed["subtype"]) as string | undefined,
    };
  } catch {
    return {};
  }
}

export async function dispatch(repoRoot: string, options: DispatchOptions): Promise<DispatchLedgerEntry> {
  assertSafeEnvironment(process.env);
  const argv = buildArgv(options);
  const binary = join(homedir(), ".grok/bin/grok");

  const chunks: string[] = [];
  const stderr: string[] = [];
  const child = spawn(binary, argv, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...REQUIRED_ENV },
  });
  child.stdout.on("data", (data: Buffer) => chunks.push(data.toString()));
  child.stderr.on("data", (data: Buffer) => stderr.push(data.toString()));

  const code = await new Promise<number>((resolve) => child.on("close", (value: number | null) => resolve(value ?? 1)));
  const output = chunks.join("");
  const parsed = parseResult(output);

  if (!parsed.sessionId) {
    // A missing sessionId means an arg-parse abort or an immediate crash — surface stderr, because
    // this is exactly the case that previously looked like a silent success.
    throw new Error(
      `Dispatch produced no sessionId (exit ${code}). This usually means grok rejected the `
      + `arguments and never started. stderr:\n${stderr.join("").slice(0, 800)}`,
    );
  }

  const entry: DispatchLedgerEntry = {
    sessionId: parsed.sessionId,
    ...(options.slice ? { slice: options.slice } : {}),
    ...(options.role ? { role: options.role } : {}),
    model: options.model ?? "deepseek-v4-pro",
    ...(parsed.turns !== undefined ? { turns: parsed.turns } : {}),
    ...(parsed.stopReason ? { stopReason: parsed.stopReason } : {}),
    ...(options.resume ? { resumedFrom: options.resume } : {}),
    at: new Date().toISOString(),
  };
  recordSession(repoRoot, entry);
  writeFileSync(join(repoRoot, ".openclinxr/openclaw/worker-last-result.json"), output);
  return entry;
}
