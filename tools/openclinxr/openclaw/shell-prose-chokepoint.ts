/**
 * shell-prose-chokepoint — refuse prose passed through a shell-evaluated argument.
 *
 * ## THE MEASURED DEFECT, three incidents, two agents
 *
 * Markdown prose containing backticked code spans was embedded in a shell command string. zsh
 * evaluated the backticks as COMMAND SUBSTITUTION before `git` or `gh` ever received the argument.
 * The substituted commands failed, the surrounding operation SUCCEEDED, and the technical spans
 * silently vanished from the published artifact.
 *
 *   commit 6a52e755   `the early return on skipFraming turned` -> "neutering  turned"
 *   gh issue comment  seven spans executed, including headCenterY, flat_baseline, matrixWorld[13]
 *   issue #576 body   (this orchestrator, same night) every backticked identifier stripped
 *
 * ## WHY THIS IS A GATE AND NOT A RULE
 *
 * A rule already existed. `.agents/skills/gh-body-file` says in its own one-line description that
 * backticks in `--body` are command substitution. It did not prevent any of the three incidents —
 * and MEASURED 2026-08-24, it is absent from `.claude/skills`, so a Claude-side agent never had it
 * in its available skills at all. The rule was unreachable, not ignored.
 *
 * The agent then diagnosed the class itself and committed `47b3d4b8`: eleven lines of Markdown in
 * one skill. No hook, no test, no wrapper. That changes the retrieval lottery; it is not a control.
 *
 * ## WHY IT REFUSES THE TRANSPORT, NOT THE CHARACTERS
 *
 * Scanning for backticks, `$` or `!` recreates the escaping problem this exists to remove — an
 * escaping bug in the detector is the same class as an escaping bug in the caller. So it refuses the
 * unsafe ARGUMENT FORM regardless of content, and a safe file route always exists.
 *
 * MECHANISM, claimed honestly: a string matcher over shell-tool command text on PreToolUse. NOT an
 * OS sandbox, NOT a process boundary. Computed argv, helper scripts and direct API calls remain
 * escapes, exactly as `board-close-chokepoint` records of its own class.
 */
import { peelLeadingEnvAssignments, splitShellSegments, tokenizeSegment } from "./dispatch-chokepoint.js";

export type ProseVerdict =
  | { refuse: false }
  | { refuse: true; segment: string; form: string; message: string };

const isGh = (t: string): boolean => t === "gh" || t.endsWith("/gh");
const isGit = (t: string): boolean => t === "git" || t.endsWith("/git");

/**
 * `-F body=@file` and `-F body=-` are SAFE: the value is read from a file or stdin, never evaluated.
 * Only a literal inline value is refused.
 */
const isFileOrStdinField = (v: string): boolean => v.startsWith("@") || v === "-";

/** Returns the offending argument form, or null when the segment is safe. */
export function unsafeProseForm(segment: string): string | null {
  const tokens = peelLeadingEnvAssignments(tokenizeSegment(segment)).rest;
  if (tokens.length === 0) return null;
  const head = tokens.findIndex((t) => isGh(t) || isGit(t));
  if (head < 0) return null;
  const argv = tokens.slice(head);

  if (isGit(argv[0]!) && argv.includes("commit")) {
    for (const t of argv) {
      if (t === "-m" || t === "--message") return t;
      if (t.startsWith("--message=")) return "--message=";
      // bundled short flags: -am, -sm, -amsomething
      if (/^-[a-zA-Z]*m[a-zA-Z]*$/u.test(t) && t !== "-m") return t;
    }
    return null;
  }

  if (isGh(argv[0]!)) {
    for (let i = 1; i < argv.length; i += 1) {
      const t = argv[i]!;
      if (t === "--body" || t === "-b") return t;
      if (t.startsWith("--body=")) return "--body=";
      // gh api -f body=<literal> / -F body=<literal> / --raw-field body=<literal>
      if (t === "-f" || t === "-F" || t === "--field" || t === "--raw-field") {
        const v = argv[i + 1] ?? "";
        if (/^body=/u.test(v) && !isFileOrStdinField(v.slice("body=".length))) return `${t} body=`;
      }
    }
    return null;
  }
  return null;
}

/**
 * A QUOTED heredoc delimiter (`<<'EOF'` or `<<"EOF"`) suppresses expansion, so backticks inside the
 * body are NOT substituted and the form is safe.
 *
 * Verified in the shell before allowing it:
 *
 *     V="$(cat <<'EOFX'
 *     literal `echo SUBSTITUTED` span
 *     EOFX
 *     )"                     ->  literal `echo SUBSTITUTED` span
 *
 * This exception exists because refusing it would block the dominant safe pattern in this repo —
 * `git commit -m "$(cat <<'EOF' … EOF)"` — and a gate with a false positive on the common correct
 * form is a gate that gets worked around wholesale rather than obeyed. An UNQUOTED `<<EOF` still
 * expands and is deliberately NOT exempted.
 */
const hasQuotedHeredoc = (segment: string): boolean => /<<-?\s*(['"])\w+\1/u.test(segment);

export function evaluateProseCommand(command: string): ProseVerdict {
  for (const seg of splitShellSegments(command)) {
    const form = unsafeProseForm(seg);
    if (!form) continue;
    if (hasQuotedHeredoc(seg)) continue;
    return {
      refuse: true,
      segment: seg.trim(),
      form,
      message:
        `REFUSED: \`${form}\` passes prose through a shell-evaluated argument. Backticks in that text become `
        + `COMMAND SUBSTITUTION before the program sees it — measured three times: commit 6a52e755 published `
        + `"neutering  turned", a gh comment executed seven code spans, and an issue body lost every backticked `
        + `identifier. The surrounding command SUCCEEDS, so the loss is silent. `
        + `Use an opaque path instead: \`git commit -F <file>\` or \`-F - <<'EOF'\`; \`gh ... --body-file <file>\`; `
        + `\`gh api -F body=@<file>\`. There is no sanctioned escape because a safe route always exists.`,
    };
  }
  return { refuse: false };
}

// ---------------------------------------------------------------------------------------------
// PreToolUse entry. Same protocol as dispatch- and board-close-chokepoint: JSON verdict on stdout,
// exit 2 to deny. FAILS OPEN on unparseable input.
// ---------------------------------------------------------------------------------------------
import { readFileSync as readFd } from "node:fs";
import { pathToFileURL } from "node:url";

type HookInput = { toolInput?: { command?: unknown }; tool_input?: { command?: unknown } };

function emitProse(decision: "allow" | "deny", reason: string): never {
  process.stdout.write(`${JSON.stringify({ decision, reason })}\n`);
  process.exit(decision === "deny" ? 2 : 0);
}

function proseHookEntry(): void {
  let raw = "";
  try { raw = readFd(0, "utf8"); } catch { /* no stdin */ }
  let input: HookInput = {};
  if (raw.trim()) {
    try { input = JSON.parse(raw) as HookInput; }
    catch { emitProse("allow", "shell-prose-chokepoint: unparseable hook input — fail open"); }
  }
  const command =
    (typeof input.toolInput?.command === "string" ? input.toolInput.command : "")
    || (typeof input.tool_input?.command === "string" ? input.tool_input.command : "");
  if (!command) emitProse("allow", "shell-prose-chokepoint: no command — fail open");
  const v = evaluateProseCommand(command);
  emitProse(v.refuse ? "deny" : "allow", v.refuse ? v.message : "shell-prose-chokepoint: allow");
}

function proseProbe(argv: string[]): void {
  const i = argv.indexOf("--command");
  const command = i >= 0 ? argv[i + 1] ?? "" : "";
  if (!command) { process.stderr.write("usage: shell-prose-chokepoint.ts --probe --command '<shell line>'\n"); process.exit(1); }
  const v = evaluateProseCommand(command);
  process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  process.exit(v.refuse ? 2 : 0);
}

const isProseEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isProseEntry) {
  if (process.argv.includes("--probe")) proseProbe(process.argv.slice(2));
  else proseHookEntry();
}
