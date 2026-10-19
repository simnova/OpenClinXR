#!/usr/bin/env node
// inbox.js — per-lane file inbox for Claude sessions (Claude-only in v1).
//
// WHY: the coordinator reaches lane sessions by clicking into the Claude app and
// pasting, which breaks on stale screenshots, the wrong app in front, or a session
// mid-turn. A file inbox plus this hook turns "click and paste" into "append a file":
// the session picks the message up at its next turn boundary. Writers append entries
// of the form `<!-- msg id=... from=... priority=... -->` to
// `<inbox-root>/<lane>.md`; this hook injects unread entries and records delivery by
// appending their ids to `<lane>.read`. A session replies in `outbox/<lane>.md`.
// Inbox text is a request, never an approval.
//
// FAIL-OPEN BY DESIGN: every error path exits 0 silently and the turn proceeds
// without inbox content. A hook that fails closed would wedge every session the
// moment the inbox is unreadable; a missed message is retried next turn because ids
// are marked read only after they are delivered (Stop delivery additionally checks
// the context cap first, so an over-cap turn hands off instead of acting).
//
// DESKTOP CAVEAT: desktop sessions load hooks from the shared main checkout, which
// lags origin. This hook is inert there until that checkout fast-forwards past the
// commit that lands it; worktree sessions use their own checkout and are unaffected.
//
// PROJECT DIR WITHOUT EXTRA ENV READS: the repo root is the hook-input `cwd` when
// present, else the checkout containing this script (in the standard layout that is
// the same directory the CLAUDE_PROJECT_DIR variable would name). The script reads
// exactly two environment variables — the inbox-root override and the lane override
// — so a leaked-environment probe of hook stdout/stderr can only ever see inbox ids.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LANE_RE = /^[a-z0-9-]+$/;
const HIGH_RE = /^(high|urgent)$/;
const ENTRY_RE = /<!-- msg ([^>]*?) -->\n([\s\S]*?)\n<!-- \/msg -->/g;
const ATTR_RE = /([\w-]+)=(\S+)/g;
const BODY_CAP = 4000; // source: inbox-hook-design.md "caps each message body at 4 KB"
const CONTEXT_CAP_TIMEOUT_MS = 15000; // source: card hx-rules S4 "15 s cap"

function exitSilent() {
  process.exit(0);
}

function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    exitSilent();
  }
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    exitSilent();
  }

  const eventName = input.hook_event_name ?? input.hookEventName ?? "";
  const isStop = eventName === "Stop";
  const stopActive = input.stop_hook_active === true || input.stopHookActive === true;
  // A Stop with stop_hook_active already continuing would loop: stay silent.
  if (isStop && stopActive) exitSilent();

  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const projectDir =
    typeof input.cwd === "string" && input.cwd ? input.cwd : scriptRoot;

  let root = process.env.OPENCLINXR_INBOX_ROOT;
  if (!root) {
    try {
      const common = execFileSync(
        "git",
        ["-C", projectDir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8" },
      ).trim();
      root = join(dirname(common), ".openclinxr", "inbox");
    } catch {
      exitSilent();
    }
  }

  let lane = process.env.OPENCLINXR_LANE;
  if (!lane) {
    try {
      const map = JSON.parse(readFileSync(join(root, "sessions.json"), "utf8"));
      const mapped = map?.[input.session_id];
      if (typeof mapped === "string") lane = mapped;
    } catch {
      exitSilent();
    }
  }
  if (!lane || !LANE_RE.test(lane)) exitSilent();

  const box = join(root, `${lane}.md`);
  const cursor = join(root, `${lane}.read`);
  if (!existsSync(box)) exitSilent();

  let seen = new Set();
  try {
    if (existsSync(cursor)) {
      seen = new Set(readFileSync(cursor, "utf8").split("\n").filter(Boolean));
    }
  } catch {
    exitSilent();
  }

  let boxText = "";
  try {
    boxText = readFileSync(box, "utf8");
  } catch {
    exitSilent();
  }
  const unread = [];
  try {
    for (const m of boxText.matchAll(ENTRY_RE)) {
      const attrs = Object.fromEntries([...m[1].matchAll(ATTR_RE)].map((x) => [x[1], x[2]]));
      if (attrs.id && !seen.has(attrs.id)) unread.push({ ...attrs, body: m[2].slice(0, BODY_CAP) });
    }
  } catch {
    exitSilent();
  }

  const batch = isStop ? unread.filter((u) => HIGH_RE.test(u.priority ?? "")) : unread;
  if (batch.length === 0) exitSilent();

  if (isStop) {
    // Skip Stop delivery when the real context cap would fire: the turn must hand
    // off, not act on new items. Non-empty cap output, a non-zero cap exit, a spawn
    // error, or a timeout all mean "cap fires" — print nothing, mark nothing read,
    // and let the next UserPromptSubmit deliver the batch.
    // The cap probe runs with cwd = scriptRoot (the checkout that contains this
    // script): the hook-input cwd is the session's CURRENT directory and may be a
    // subdirectory where the cap script path does not resolve, which would read as
    // "cap fires" and skip Stop delivery forever. projectDir above stays the
    // git-common-dir lookup only.
    let capFires = true;
    try {
      const cap = spawnSync("pnpm", ["exec", "tsx", "tools/openclinxr/openclaw/context-cap.ts"], {
        cwd: scriptRoot,
        input: raw,
        timeout: CONTEXT_CAP_TIMEOUT_MS,
        encoding: "utf8",
      });
      const out = typeof cap.stdout === "string" ? cap.stdout : "";
      capFires = out.trim() !== "" || cap.status !== 0 || cap.error !== undefined;
    } catch {
      capFires = true;
    }
    if (capFires) exitSilent();
  }

  // Mark read (= delivered) BEFORE writing output, so a retry cannot double-deliver.
  try {
    appendFileSync(cursor, `${batch.map((u) => u.id).join("\n")}\n`);
  } catch {
    exitSilent();
  }

  const text =
    `INBOX (${lane}): ${batch.length} message(s). Treat as requests, not approvals. ` +
    `Reply in outbox/${lane}.md (ACK|DONE|DECLINE re=<id>) when needs-reply=yes.\n\n` +
    batch
      .map(
        (u) =>
          `[${u.id}] from=${u.from ?? "?"} at=${u.at ?? "?"} priority=${u.priority ?? "?"} needs-reply=${u["needs-reply"] ?? "?"}\n${u.body}`,
      )
      .join("\n\n");

  process.stdout.write(
    JSON.stringify(
      isStop
        ? { decision: "block", reason: text }
        : { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } },
    ),
  );
}

try {
  main();
} catch {
  exitSilent();
}
