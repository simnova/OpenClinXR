/**
 * board-close-chokepoint — refuse a raw `gh issue close` that skips the Factory grade.
 *
 * ## THE MEASURED HOLE
 *
 * `pnpm openclaw:board -- close` advances the card's Factory field to `Graded` unless `--no-grade`
 * is passed, which exists so rot, superseded premises and dead cards can be closed WITHOUT
 * inflating the one number that means "a human looked at the output".
 *
 * A raw `gh issue close` skips that entirely, and the board shows the cost. Measured 2026-08-24 on
 * the 610-item projection:
 *
 *     Landed  111
 *     Graded   21
 *
 * The same day's orchestrator transcript carried **23 direct `gh issue close` calls and zero through
 * `board-cli`**, the most recent at 03:44:43Z. That session had explicitly loaded its `board-conduit`
 * skill 28 minutes earlier and closed five issues directly afterwards — which is the evidence that
 * prose does not bind a routing decision. This does.
 *
 * ## MECHANISM — an honest claim, mirroring dispatch-chokepoint
 *
 * A **string matcher** over shell-tool command text on PreToolUse. It is NOT an OS sandbox, NOT a
 * process boundary, and NOT enforcement against a hostile peer sharing this uid. Known escapes of
 * the matcher class: computed argv that never appears literally, `node -e` invoking the API, or
 * writing a helper script and running it. Real containment is OS-level.
 *
 * What it DOES do is make the ordinary path the easy one and the bypass deliberate.
 *
 * ## SANCTIONED ESCAPE
 *
 * `OPENCLINXR_RAW_GH_CLOSE_SANCTIONED=1` plus a non-empty `OPENCLINXR_RAW_GH_CLOSE_REASON`. Escapes
 * append to a shared ledger so silence is impossible. A close that genuinely should not grade has a
 * first-class flag already — `--no-grade` — and should use it rather than this escape.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { peelLeadingEnvAssignments, splitShellSegments, tokenizeSegment } from "./dispatch-chokepoint.js";

export const RAW_CLOSE_SANCTION_ENV = "OPENCLINXR_RAW_GH_CLOSE_SANCTIONED";
export const RAW_CLOSE_REASON_ENV = "OPENCLINXR_RAW_GH_CLOSE_REASON";
export const RAW_CLOSE_LEDGER = ".openclinxr/openclaw/raw-gh-close-sanctioned.jsonl";

export type CloseChokepointVerdict =
  | { refuse: false }
  | { refuse: true; segment: string; message: string };

/**
 * True when a segment is literally `gh issue close`.
 *
 * Deliberately narrow. `gh issue view|comment|list|edit` are NOT refused: they do not change the
 * grade, and refusing ordinary reads would push agents to work around the gate entirely — which is
 * how a chokepoint becomes noise rather than a guard.
 */
export function segmentIsRawGhIssueClose(segment: string): boolean {
  const tokens = peelLeadingEnvAssignments(tokenizeSegment(segment)).rest;
  const i = tokens.findIndex((t) => t === "gh" || t.endsWith("/gh"));
  if (i < 0) return false;
  return tokens[i + 1] === "issue" && tokens[i + 2] === "close";
}

export function commandContainsRawGhIssueClose(command: string): string | null {
  for (const seg of splitShellSegments(command)) {
    if (segmentIsRawGhIssueClose(seg)) return seg.trim();
  }
  return null;
}

export function readCloseSanction(env: NodeJS.ProcessEnv): { sanctioned: boolean; reason: string } {
  const reason = (env[RAW_CLOSE_REASON_ENV] ?? "").trim();
  return { sanctioned: env[RAW_CLOSE_SANCTION_ENV] === "1" && reason.length > 0, reason };
}

export function evaluateCloseCommand(command: string, env: NodeJS.ProcessEnv): CloseChokepointVerdict {
  const segment = commandContainsRawGhIssueClose(command);
  if (!segment) return { refuse: false };
  const { sanctioned } = readCloseSanction(env);
  if (sanctioned) return { refuse: false };
  return {
    refuse: true,
    segment,
    message:
      `REFUSED: raw \`gh issue close\` skips the Factory grade. Use \`pnpm openclaw:board -- close --slice-id <id> --body '<resolution>'\`, `
      + `which advances Factory to Graded — or \`--no-grade\` when the close is rot, a superseded premise or a dead card. `
      + `Measured 2026-08-24: the board carries 111 Landed against 21 Graded, and one session made 23 direct closes in a day. `
      + `To bypass deliberately set ${RAW_CLOSE_SANCTION_ENV}=1 and ${RAW_CLOSE_REASON_ENV}="<why>"; the escape is logged.`,
  };
}

/** Escapes are recorded so a bypass is visible rather than silent. Best-effort by design. */
export function recordCloseEscape(repoRoot: string, entry: Record<string, unknown>): void {
  try {
    const path = resolveSharedCoordinationPath(RAW_CLOSE_LEDGER, repoRoot);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch { /* a ledger write must never block the caller */ }
}

// ---------------------------------------------------------------------------------------------
// PreToolUse hook entry. Mirrors dispatch-chokepoint's protocol exactly: a JSON verdict on stdout,
// exit 2 to deny. FAIL OPEN on unparseable input — a hook that crashes fails open at the harness
// layer anyway, so emitting `allow` keeps that contract explicit rather than accidental.
// ---------------------------------------------------------------------------------------------
import { readFileSync as readFd } from "node:fs";
import { pathToFileURL } from "node:url";

type HookInput = { toolInput?: { command?: unknown }; tool_input?: { command?: unknown } };

function emitVerdict(decision: "allow" | "deny", reason: string): never {
  process.stdout.write(`${JSON.stringify({ decision, reason })}\n`);
  process.exit(decision === "deny" ? 2 : 0);
}

function readStdin(): string {
  try { return readFd(0, "utf8"); } catch { return ""; }
}

function hookEntry(): void {
  const raw = readStdin();
  let input: HookInput = {};
  if (raw.trim()) {
    try { input = JSON.parse(raw) as HookInput; }
    catch { emitVerdict("allow", "board-close-chokepoint: unparseable hook input — fail open"); }
  }
  const command =
    (typeof input.toolInput?.command === "string" ? input.toolInput.command : "")
    || (typeof input.tool_input?.command === "string" ? input.tool_input.command : "");
  if (!command) emitVerdict("allow", "board-close-chokepoint: no command — fail open");

  const verdict = evaluateCloseCommand(command, process.env);
  if (!verdict.refuse) {
    const { sanctioned, reason } = readCloseSanction(process.env);
    if (sanctioned && commandContainsRawGhIssueClose(command)) {
      recordCloseEscape(process.env["OPENCLINXR_REPO_ROOT"] || process.cwd(), {
        kind: "raw-gh-issue-close", reason, command: command.slice(0, 400),
      });
    }
    emitVerdict("allow", "board-close-chokepoint: allow");
  }
  emitVerdict("deny", verdict.message);
}

/** Probe CLI for control/treatment evidence, same shape as dispatch-chokepoint --probe. */
function probeEntry(argv: string[]): void {
  const i = argv.indexOf("--command");
  const command = i >= 0 ? argv[i + 1] ?? "" : "";
  if (!command) {
    process.stderr.write("usage: board-close-chokepoint.ts --probe --command '<shell line>'\n");
    process.exit(1);
  }
  const verdict = evaluateCloseCommand(command, process.env);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exit(verdict.refuse ? 2 : 0);
}

const isEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntry) {
  if (process.argv.includes("--probe")) probeEntry(process.argv.slice(2));
  else hookEntry();
}
