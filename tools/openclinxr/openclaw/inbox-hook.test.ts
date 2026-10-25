import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

// inbox-hook: spawns the real `.claude/hooks/inbox.js` (plain node, no deps) against a
// throwaway OPENCLINXR_INBOX_ROOT. No git fixture repos are created, and the hook runs
// no git while the root override is set, so the host repo cannot be touched; every
// spawn below still strips inherited GIT_* vars as R6 requires.
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const HOOK = join(REPO_ROOT, ".claude", "hooks", "inbox.js");

type InboxEntry = {
  id: string;
  from?: string;
  priority?: string;
  needsReply?: string;
  body?: string;
};

function entryText(e: InboxEntry): string {
  return (
    `<!-- msg id=${e.id} from=${e.from ?? "grok-bot"} to=lane1 ` +
    `at=2026-10-19T09:30:00-04:00 priority=${e.priority ?? "normal"} ` +
    `needs-reply=${e.needsReply ?? "no"} -->\n${e.body ?? `body of ${e.id}`}\n<!-- /msg -->\n`
  );
}

function makeInbox(entries: InboxEntry[], sessions?: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "inbox-hook-test-"));
  writeFileSync(join(root, "lane1.md"), entries.map(entryText).join(""), "utf8");
  if (sessions) writeFileSync(join(root, "sessions.json"), JSON.stringify(sessions), "utf8");
  return root;
}

function runHook(
  stdin: Record<string, unknown>,
  envExtra: Record<string, string | undefined> = {},
  inboxRoot?: string,
): { stdout: string; stderr: string; status: number | null } {
  const env: Record<string, string> = { ...gitEnvWithoutInheritedRepoVars() };
  for (const [k, v] of Object.entries(envExtra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  if (inboxRoot) env.OPENCLINXR_INBOX_ROOT = inboxRoot;
  env.CLAUDE_PROJECT_DIR = REPO_ROOT;
  const res = spawnSync("node", [HOOK], {
    input: JSON.stringify(stdin),
    encoding: "utf8",
    env,
  });
  return {
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    status: res.status,
  };
}

function readIds(root: string): string[] {
  const p = join(root, "lane1.read");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
}

const UPS = { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: REPO_ROOT };
const STOP = { hook_event_name: "Stop", session_id: "s1", cwd: REPO_ROOT };

describe("inbox hook", () => {
  it("(a) UserPromptSubmit injects all unread, then goes silent; ids land in .read", () => {
    const root = makeInbox([
      { id: "a-low", priority: "low" },
      { id: "a-high", priority: "high", needsReply: "yes" },
    ]);
    const first = runHook(UPS, { OPENCLINXR_LANE: "lane1" }, root);
    expect(first.status).toBe(0);
    const payload = JSON.parse(first.stdout);
    const ctx: string = payload.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("a-low");
    expect(ctx).toContain("a-high");
    const second = runHook(UPS, { OPENCLINXR_LANE: "lane1" }, root);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe("");
    expect(readIds(root).sort()).toEqual(["a-high", "a-low"]);
  });

  it("(b) Stop with only normal/low unread stays silent and leaves them unread", () => {
    const root = makeInbox([
      { id: "b-normal", priority: "normal" },
      { id: "b-low", priority: "low" },
    ]);
    const res = runHook(STOP, { OPENCLINXR_LANE: "lane1" }, root);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(readIds(root)).toEqual([]);
  });

  it("(c) Stop with a high unread blocks naming the id, once per batch", () => {
    const root = makeInbox([{ id: "c-high-1", priority: "high", needsReply: "yes" }]);
    const first = runHook(STOP, { OPENCLINXR_LANE: "lane1" }, root);
    expect(first.status).toBe(0);
    const payload = JSON.parse(first.stdout);
    expect(payload.decision).toBe("block");
    expect(String(payload.reason)).toContain("c-high-1");
    const second = runHook(STOP, { OPENCLINXR_LANE: "lane1" }, root);
    expect(second.stdout).toBe("");
    expect(readIds(root)).toEqual(["c-high-1"]);
  });

  it("(d) unmapped session, missing inbox file, and empty inbox file are silent exit 0", () => {
    const root = makeInbox([{ id: "d-1", priority: "high" }], { other: "lane1" });
    const unmapped = runHook(
      { ...STOP, session_id: "nope" },
      { OPENCLINXR_LANE: undefined },
      root,
    );
    expect(unmapped.status).toBe(0);
    expect(unmapped.stdout).toBe("");

    const missingRoot = mkdtempSync(join(tmpdir(), "inbox-hook-missing-"));
    const missing = runHook(STOP, { OPENCLINXR_LANE: "lane1" }, missingRoot);
    expect(missing.status).toBe(0);
    expect(missing.stdout).toBe("");

    const emptyRoot = mkdtempSync(join(tmpdir(), "inbox-hook-empty-"));
    writeFileSync(join(emptyRoot, "lane1.md"), "", "utf8");
    const empty = runHook(
      { ...UPS, session_id: "s9" },
      { OPENCLINXR_LANE: "lane1" },
      emptyRoot,
    );
    expect(empty.status).toBe(0);
    expect(empty.stdout).toBe("");
  });

  it("(e) Stop skips delivery when the real context cap fires, blocks when it does not", () => {
    const transcript = join(tmpdir(), `inbox-hook-transcript-${Date.now()}.jsonl`);
    writeFileSync(
      transcript,
      `${JSON.stringify({
        type: "assistant",
        message: {
          usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      })}\n`,
      "utf8",
    );
    const stdin = { ...STOP, transcript_path: transcript };
    const root = makeInbox([{ id: "e-high", priority: "high" }]);
    const over = runHook(
      stdin,
      { OPENCLINXR_LANE: "lane1", OPENCLINXR_CONTEXT_CAP: "1" },
      root,
    );
    expect(over.status).toBe(0);
    expect(over.stdout).toBe("");
    expect(readIds(root)).toEqual([]);
    const under = runHook(
      stdin,
      { OPENCLINXR_LANE: "lane1", OPENCLINXR_CONTEXT_CAP: "999999999" },
      root,
    );
    expect(under.status).toBe(0);
    expect(JSON.parse(under.stdout).decision).toBe("block");
    expect(readIds(root)).toEqual(["e-high"]);
  }, 120000);

  it("(e2) Stop with hook cwd in a subdirectory still blocks when the cap does not fire", () => {
    const root = makeInbox([{ id: "e2-high", priority: "high" }]);
    const subdir = join(REPO_ROOT, "tools");
    const res = runHook(
      { ...STOP, cwd: subdir },
      { OPENCLINXR_LANE: "lane1", OPENCLINXR_CONTEXT_CAP: "999999999" },
      root,
    );
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).decision).toBe("block");
    expect(String(JSON.parse(res.stdout).reason)).toContain("e2-high");
    expect(readIds(root)).toEqual(["e2-high"]);
  }, 120000);

  it("(f) Stop with stop_hook_active stays silent and leaves the batch unread", () => {
    const root = makeInbox([{ id: "f-high", priority: "urgent" }]);
    const res = runHook(
      { ...STOP, stop_hook_active: true },
      { OPENCLINXR_LANE: "lane1" },
      root,
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(readIds(root)).toEqual([]);
  });

  it("(g) hook output never leaks env secrets; source reads only the two allowed names", () => {
    const probe = `hunter2-${randomBytes(8).toString("hex")}`;
    const root = makeInbox([{ id: "g-high", priority: "high" }]);
    const res = runHook(
      UPS,
      { OPENCLINXR_LANE: "lane1", SECRET_PROBE: probe },
      root,
    );
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain(probe);
    expect(res.stderr).not.toContain(probe);
    const src = readFileSync(HOOK, "utf8");
    const names = new Set<string>();
    for (const m of src.matchAll(/process\.env(?:\.([A-Za-z0-9_]+)|\[['"]([^'"]+)['"]\])/g)) {
      names.add(m[1] ?? m[2]);
    }
    expect(names).toEqual(new Set(["OPENCLINXR_INBOX_ROOT", "OPENCLINXR_LANE"]));
  });

  it("(h) settings.json wires inbox.js after context-cap on Stop and keeps prior entries", () => {
    const settings = JSON.parse(readFileSync(join(REPO_ROOT, ".claude", "settings.json"), "utf8"));
    type HookEntry = { command: string };
    const ups: string[] = settings.hooks.UserPromptSubmit[0].hooks.map((h: HookEntry) => h.command);
    const stop: string[] = settings.hooks.Stop[0].hooks.map((h: HookEntry) => h.command);
    const inboxCmd = 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/inbox.js"';
    const capCmd =
      'cd "${CLAUDE_PROJECT_DIR}" && pnpm exec tsx tools/openclinxr/openclaw/context-cap.ts';
    expect(ups).toContain(inboxCmd);
    expect(stop).toContain(inboxCmd);
    expect(stop.indexOf(inboxCmd)).toBeGreaterThan(stop.indexOf(capCmd));
    expect(ups.some((c) => c.includes("skill-preflight.js"))).toBe(true);
    const pre: string[] = settings.hooks.PreToolUse[0].hooks.map((h: HookEntry) => h.command);
    const post: string[] = settings.hooks.PostToolUse[0].hooks.map((h: HookEntry) => h.command);
    expect(pre.some((c) => c.includes("bothy-board-token-guard.js"))).toBe(true);
    expect(post.some((c) => c.includes("bothy-board-token-guard.js"))).toBe(true);
  });
});
