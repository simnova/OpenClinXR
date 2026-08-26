/**
 * Compose a raw `grok -p --resume` that carries what `dispatch()` would have added.
 *
 * WHY THIS EXISTS. `dispatch()` appends protections its callers never think about: the worker
 * guard env, worktree isolation denies, and — since 88037391 (#242) — image Read denies for
 * text-only models. A raw `grok -p --resume` reaches none of that, and the losses are silent:
 *
 *   worker guard missing      -> unrequested doc-archive churn in the worktree (#99)
 *   contract report missing   -> integrate refuses the branch
 *   vision denies missing     -> a text-only model Reads a PNG, hard 400, dispatch dead
 *
 * The third killed #642 at turn 110 having spent 26.4M tokens, on a slice whose guard had been
 * wired for seventeen days.
 *
 * WHY THE RAW PATH IS USED AT ALL. `dispatch({worktree, resume})` runs ensureWorktreeBaseFresh,
 * which resets a reused worktree unconditionally (worktree-base-freshness.ts:118-121). Resuming
 * to preserve a worker's on-disk work through dispatch() destroys exactly that work. So the raw
 * path is the correct choice and it is the unprotected one; this closes that gap rather than
 * arguing with the choice.
 *
 * SCOPE. Composition only. It runs nothing and it does not touch the reset behaviour — that is
 * correct for a fresh dispatch and wrong only for a resume, and a `preserveWorktree` mode is a
 * separate change with a much larger blast radius.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildTextOnlyVisionDenies,
  buildWorktreeIsolationDenies,
  isTextOnlyModel,
  RESUME_REQUIRED_ENV,
} from "./dispatch-worker.js";
import { RAW_GROK_REASON_ENV, RAW_GROK_SANCTION_ENV } from "./dispatch-chokepoint.js";

/**
 * What no flag can restore. `dispatch()` re-runs the brief's proofs after the worker exits and
 * writes the report `integrate` consumes; a resume produces no such report, so the branch must be
 * run through contract-verify-cli before it can land.
 */
export const RAW_RESUME_NOT_RESTORED: readonly string[] = [
  "contract verification — dispatch() re-runs the brief's proofs after the worker exits and writes "
  + "the report integrate consumes. A resume writes none. Before integrate, run: "
  + "pnpm exec tsx tools/openclinxr/openclaw/contract-verify-cli.ts --slice <id> --tree <worktree>",
  "the ledger row — a raw resume writes no worker-sessions.jsonl entry, so the session id and turn "
  + "count are recoverable only from the session directory.",
] as const;

export type RawResumeOptions = {
  /** Session to reattach. Take it from the ledger or the session dir — never typed from memory. */
  sessionId: string;
  /** Model alias. Decides whether vision denies are emitted. */
  model: string;
  /** Working directory for the resumed worker, normally its worktree. */
  cwd: string;
  /** Non-empty reason; the chokepoint treats an empty reason as unsanctioned. */
  reason: string;
  /** Main checkout root. When set, adds the path-scoped denies that protect it. */
  mainRoot?: string;
  maxTurns?: number;
};

export type RawResumeCommand = {
  /**
   * LEADING SHELL ASSIGNMENTS — never `export`.
   *
   * dispatch-chokepoint.ts refuses raw grok from OPENCLINXR_WORKER=1 at :294, BEFORE evaluating
   * the sanction at :306, and mergeSanctionEnv merges only the two sanction vars out of leading
   * assignments. So a leading assignment is invisible to the worker check and the sanction allows
   * the command; the same variable EXPORTED into the session makes every later raw grok refused.
   */
  envAssignments: Record<string, string>;
  binary: string;
  argv: string[];
  /** One shell line, ready to run. */
  shell: string;
  notRestored: readonly string[];
};

function quote(value: string): string {
  return /^[A-Za-z0-9_./:=-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildRawResumeCommand(options: RawResumeOptions): RawResumeCommand {
  const reason = options.reason.trim();
  if (reason.length === 0) {
    throw new Error(
      "buildRawResumeCommand: a non-empty reason is required — dispatch-chokepoint's "
      + "readSanctionFromEnv treats an empty reason as UNSANCTIONED, so the emitted command would "
      + "be refused. Say why this resume must bypass dispatch().",
    );
  }
  if (options.sessionId.trim().length === 0) {
    throw new Error("buildRawResumeCommand: sessionId is required — resuming a wrong or empty id "
      + "does not fail, it confabulates against a different session's transcript.");
  }

  const envAssignments: Record<string, string> = {
    ...RESUME_REQUIRED_ENV,
    [RAW_GROK_SANCTION_ENV]: "1",
    [RAW_GROK_REASON_ENV]: reason,
  };

  const argv = [
    "--resume", options.sessionId,
    "--model", options.model,
    "--cwd", options.cwd,
    "--output-format", "json",
    "--max-turns", String(options.maxTurns ?? 200),
  ];

  if (options.mainRoot) {
    argv.push(...buildWorktreeIsolationDenies(options.mainRoot).flatMap((r) => ["--deny", r]));
  }
  if (isTextOnlyModel(options.model)) {
    argv.push(...buildTextOnlyVisionDenies().flatMap((r) => ["--deny", r]));
  }

  const binary = join(homedir(), ".grok/bin/grok");
  const shell = [
    ...Object.entries(envAssignments).map(([k, v]) => `${k}=${quote(v)}`),
    binary,
    "-p", "<prompt>",
    ...argv.map(quote),
  ].join(" ");

  return { envAssignments, binary, argv, shell, notRestored: RAW_RESUME_NOT_RESTORED };
}
