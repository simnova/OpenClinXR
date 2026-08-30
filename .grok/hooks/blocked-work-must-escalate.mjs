#!/usr/bin/env node
/**
 * Grok Stop hook: identifying a blocker and going idle is not finishing the turn.
 *
 * OPERATOR DIRECTIVE, 2026-08-30, verbatim:
 *   "you're on a team, you can't just identify an issue and throw your hands up
 *    update your stop hook and either you can message the manager or teammate
 *    or you do the work yourself, you can't identify a problem and let it fall
 *    silent on your output."
 *
 * Port of .claude/hooks/blocked-work-must-escalate.js to Grok Stop JSON:
 *   {"decision":"block","reason":...} keeps the turn going (max 8 continuations).
 * Workers/subagents NO-OP. stopHookActive skips a second block.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

if (
  process.env.OPENCLINXR_WORKER === "1" ||
  process.env.OPENCLINXR_WORKER === "true" ||
  Boolean(process.env.GROK_SUBAGENT)
) {
  process.exit(0);
}

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* fail-open */
}

if (payload.stopHookActive === true || payload.stop_hook_active === true) {
  process.exit(0);
}

const DEFERRAL_PATTERNS = [
  /\bsay the word\b/i,
  /\blet me know if\b/i,
  /\bif you(?:'d| would) like\b/i,
  /\bif you want me to\b/i,
  /\bwant me to\b/i,
  /\bshall I\b/i,
  /\bI (?:have not|haven't) .{0,60}\byet\b/i,
  /\bready to .{0,40}\bon your (?:word|go|say)\b/i,
  /\bjust say\b/i,
  /\bwaiting on (?:you|codex|the manager)\b/i,
  /\bI will not retry\b/i,
  /\bStill waiting\b/i,
  /\bNo Grok action\b/i,
  /\bOwner must plant\b/i,
  /\bstays Claude\b/i,
  /\buntil a card is planted\b/i,
  /\bImplementation stays blocked\b/i,
];

const last =
  typeof payload.lastAssistantMessage === "string"
    ? payload.lastAssistantMessage
    : typeof payload.last_assistant_message === "string"
      ? payload.last_assistant_message
      : "";

const deferrals = DEFERRAL_PATTERNS.map((re) => last.match(re)?.[0]).filter(Boolean);

const namedParties = [
  /\bCodex\b/i.test(last),
  /\bClaude\b/i.test(last),
  /\bowner\b/i.test(last),
].filter(Boolean).length;
const directedAsk =
  /@(?:Codex|claude)/i.test(last) ||
  /\bASK Codex\b/i.test(last) ||
  /\bQUESTION\{/i.test(last) ||
  /\bmailbox\.post\b/i.test(last);
if (namedParties >= 2 && !directedAsk) {
  deferrals.push("named 2+ teammates without a directed ASK/QUESTION/@");
}

if (deferrals.length > 0) {
  const quoted = [...new Set(deferrals)].map((d) => `"${d}"`).join(", ");
  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason: [
        `Closing message defers instead of deciding: ${quoted}.`,
        "If you named two people and two actions, mailbox.post each of them: WHO, WHAT, by when, RECOMMENDATION.",
        "There is no third option:",
        "  DO IT — if Codex/operator already authorized it, execute (or retry with evidence).",
        "  ASK  — mailbox.post the ONE decision, WHO owns it, what you ruled out, and a RECOMMENDATION.",
        "An offer or 'waiting' is not an ask. Message the manager/teammate or do the work now.",
      ].join("\n"),
    })}\n`,
  );
  process.exit(0);
}

const repo = process.env.OPENCLINXR_REPO ?? process.cwd();
function git(args, cwd = repo) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 8000 }).trim();
  } catch {
    return "";
  }
}

const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
if (staged.length > 0) {
  let newest = 0;
  for (const rel of staged) {
    try {
      const { mtimeMs } = statSync(join(repo, rel));
      if (mtimeMs > newest) newest = mtimeMs;
    } catch {
      newest = Date.now();
    }
  }
  const hours = Number(process.env.OPENCLINXR_PARKED_WORK_HOURS ?? 24);
  if (newest > Date.now() - hours * 3600_000 && existsSync(join(repo, ".git"))) {
    process.stderr.write(
      `PARKED WORK: ${staged.length} staged path(s) in ${repo} (${staged.slice(0, 4).join(", ")}). Commit, unstage, or ASK Codex — do not end silent.\n`,
    );
  }
}

process.exit(0);
