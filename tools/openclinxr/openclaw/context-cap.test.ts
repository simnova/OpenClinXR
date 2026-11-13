import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildCapMessage,
  contextTokensFromClaudeTranscript,
  contextTokensFromGrokUpdates,
  countCompactionsInFile,
  decideClaude,
  decideGrok,
  overCapReport,
  readTailText,
} from "./context-cap.js";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

const CAP = 180000;

function claudeTranscript(total: number): string {
  const usage = {
    input_tokens: 2,
    cache_creation_input_tokens: 100000,
    cache_read_input_tokens: total - 100002,
  };
  const older = {
    type: "assistant",
    message: { usage: { input_tokens: 5, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 } },
  };
  const newest = { type: "assistant", message: { usage } };
  return [JSON.stringify(older), JSON.stringify(newest)].join("\n");
}

function grokUpdates(total: number): string {
  const meta = (t: number) => ({ totalTokens: t, eventId: `evt-${t}`, updateType: "AgentMessageChunk" });
  const line = (t: number) => JSON.stringify({ params: { sessionId: "s1", _meta: meta(t) } });
  return [line(1000), line(total)].join("\n");
}

describe("context-cap", () => {
  it("synthetic transcript at cap-1 prints nothing", () => {
    expect(contextTokensFromClaudeTranscript(claudeTranscript(CAP - 1))).toBe(CAP - 1);
    expect(
      decideClaude({ tokens: CAP - 1, cap: CAP, hookEvent: "UserPromptSubmit", stopHookActive: false, handoffRecent: false }),
    ).toBeNull();
  });

  it("transcript at cap+1 prints the additionalContext JSON naming the token count", () => {
    const out = decideClaude({ tokens: CAP + 1, cap: CAP, hookEvent: "UserPromptSubmit", stopHookActive: false, handoffRecent: false });
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(String(CAP + 1));
    expect(parsed.hookSpecificOutput.additionalContext).toContain(String(CAP));
  });

  it("missing transcript exits 0 silent", () => {
    expect(contextTokensFromClaudeTranscript("")).toBeNull();
    expect(contextTokensFromClaudeTranscript("not json\n{{{\n")).toBeNull();
    expect(
      decideClaude({ tokens: null, cap: CAP, hookEvent: "UserPromptSubmit", stopHookActive: false, handoffRecent: false }),
    ).toBeNull();
  });

  it("Stop with stop_hook_active true prints nothing", () => {
    expect(
      decideClaude({ tokens: CAP + 1, cap: CAP, hookEvent: "Stop", stopHookActive: true, handoffRecent: false }),
    ).toBeNull();
  });

  it("Stop above cap blocks without a recent handoff, stays silent with one", () => {
    const blocked = decideClaude({ tokens: CAP + 1, cap: CAP, hookEvent: "Stop", stopHookActive: false, handoffRecent: false });
    expect(blocked).not.toBeNull();
    const parsed = JSON.parse(blocked!);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain(String(CAP + 1));
    expect(
      decideClaude({ tokens: CAP + 1, cap: CAP, hookEvent: "Stop", stopHookActive: false, handoffRecent: true }),
    ).toBeNull();
  });

  it("Grok updates.jsonl fixture at cap+1 warns", () => {
    expect(contextTokensFromGrokUpdates(grokUpdates(CAP + 1))).toBe(CAP + 1);
    const out = decideGrok({ tokens: CAP + 1, cap: CAP, isStop: false, stopHookActive: false, handoffRecent: false });
    expect(out).not.toBeNull();
    expect(out!.text ?? out!.json ?? "").toContain(String(CAP + 1));
  });

  it("a truncated trailing line does not silence a cap+1 transcript", () => {
    const text = `${claudeTranscript(CAP + 1)}\n{"type":"assistant","message":{"usage":{"input_tokens":`;
    expect(contextTokensFromClaudeTranscript(text)).toBe(CAP + 1);
    expect(
      decideClaude({
        tokens: contextTokensFromClaudeTranscript(text),
        cap: CAP,
        hookEvent: "UserPromptSubmit",
        stopHookActive: false,
        handoffRecent: false,
      }),
    ).not.toBeNull();
    const grokText = `${grokUpdates(CAP + 1)}\n{"params":{"_meta":{"totalTokens":`;
    expect(contextTokensFromGrokUpdates(grokText)).toBe(CAP + 1);
  });

  it("readTailText drops the first partial line", () => {
    const root = join(tmpdir(), `ocxr-tail-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const path = join(root, "t.jsonl");
    writeFileSync(path, "0123456789\nsecond\n");
    expect(readTailText(path, 100)).toEqual({ text: "0123456789\nsecond\n", truncated: false });
    const tail = readTailText(path, 8);
    expect(tail?.truncated).toBe(true);
    expect(tail?.text).toBe("second\n");
  });

  it("overCapReport ignores handoff suppression: over cap reports, under cap and unknown stay silent", () => {
    const over = overCapReport(CAP + 1, CAP);
    expect(over).not.toBeNull();
    const parsed = JSON.parse(over!);
    expect(parsed.tokens).toBe(CAP + 1);
    expect(parsed.cap).toBe(CAP);
    expect(overCapReport(CAP - 1, CAP)).toBeNull();
    expect(overCapReport(CAP, CAP)).toBeNull();
    expect(overCapReport(null, CAP)).toBeNull();
  });

  it("--probe-over-cap reports over cap even with a recent handoff and stop_hook_active", () => {
    const require = createRequire(import.meta.url);
    const node = process.execPath;
    const tsxCli = require.resolve("tsx/cli");
    const script = fileURLToPath(new URL("./context-cap.ts", import.meta.url));
    const root = mkdtempSync(join(tmpdir(), "ocxr-cap-probe-"));
    try {
      mkdirSync(join(root, ".openclinxr", "handoffs"), { recursive: true });
      writeFileSync(join(root, ".openclinxr", "handoffs", "lane1.md"), "handoff\n");
      const transcript = join(root, "transcript.jsonl");
      const runProbe = (total: number) => {
        writeFileSync(transcript, `${claudeTranscript(total)}\n`);
        return execFileSync(node, [tsxCli, script, "--probe-over-cap"], {
          cwd: root,
          input: JSON.stringify({
            hook_event_name: "Stop",
            stop_hook_active: true,
            transcript_path: transcript,
          }),
          encoding: "utf8",
          env: { ...gitEnvWithoutInheritedRepoVars(), OPENCLINXR_CONTEXT_CAP: String(CAP) },
        }).trim();
      };
      const runNormalStop = (total: number) => {
        writeFileSync(transcript, `${claudeTranscript(total)}\n`);
        return execFileSync(node, [tsxCli, script], {
          cwd: root,
          input: JSON.stringify({
            hook_event_name: "Stop",
            stop_hook_active: true,
            transcript_path: transcript,
          }),
          encoding: "utf8",
          env: { ...gitEnvWithoutInheritedRepoVars(), OPENCLINXR_CONTEXT_CAP: String(CAP) },
        }).trim();
      };
      // Over cap with suppression inputs: normal Stop stays silent, probe emits.
      expect(runNormalStop(CAP + 1)).toBe("");
      const over = runProbe(CAP + 1);
      expect(JSON.parse(over).tokens).toBe(CAP + 1);
      // Under cap: both silent.
      expect(runNormalStop(CAP - 1)).toBe("");
      expect(runProbe(CAP - 1)).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cap message names the handoff command", () => {
    expect(buildCapMessage(1, 2)).toContain("pnpm exec tsx tools/openclinxr/openclaw/handoff.ts write <lane>");
  });
});

describe("context-cap compaction counting", () => {
  const node = process.execPath;
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const script = fileURLToPath(new URL("./context-cap.ts", import.meta.url));

  const boundary = (preTokens: number) =>
    JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      timestamp: "2026-11-10T08:08:37.754Z",
      compactMetadata: { trigger: "auto", preTokens, durationMs: 39397 },
    });
  const assistant = (total: number) =>
    JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: total - 1002 } },
    });

  // Runs the real hook over a transcript; returns stdout (empty string = silent).
  // padBytes > 0 inserts filler after the first line so that line falls outside the 4 MiB tail.
  function runHook(lines: string[], env: Record<string, string> = {}, padBytes = 0): string {
    const root = mkdtempSync(join(tmpdir(), "ocxr-cap-compact-"));
    try {
      const transcript = join(root, "t.jsonl");
      const filler = `${JSON.stringify({ type: "user", message: { content: "x".repeat(900) } })}\n`;
      const [first, ...rest] = lines;
      const text =
        padBytes > 0
          ? `${first}\n${filler.repeat(Math.ceil(padBytes / filler.length))}${rest.join("\n")}\n`
          : `${lines.join("\n")}\n`;
      writeFileSync(transcript, text);
      const base: Record<string, string | undefined> = { ...gitEnvWithoutInheritedRepoVars() };
      delete base.OPENCLINXR_CONTEXT_CAP;
      delete base.OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF;
      delete base.OPENCLINXR_ROLE;
      return execFileSync(node, [tsxCli, script], {
        cwd: root,
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", transcript_path: transcript }),
        encoding: "utf8",
        env: { ...base, ...env } as NodeJS.ProcessEnv,
      }).trim();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("C1: no compaction and context above the 600000 backstop prints the cap message", () => {
    const out = runHook([assistant(650000)], { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2" });
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("650000");
  });

  it("C2: one compaction and 350000 tokens stays silent", () => {
    expect(runHook([boundary(315186), assistant(350000)], { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2" })).toBe("");
  });

  it("C3: two compactions print a cap message naming the count", () => {
    const out = runHook([boundary(315186), assistant(120000), boundary(320000), assistant(110000)], {
      OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2",
    });
    const msg = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(msg).toContain("2 compactions");
    expect(msg).toContain("handoff.ts write <lane>");
  });

  it("C3: OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF=3 keeps two compactions silent", () => {
    expect(
      runHook([boundary(1), assistant(120000), boundary(2), assistant(110000)], { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "3" }),
    ).toBe("");
  });

  it("C4/F5: COMPACTIONS_BEFORE_HANDOFF=0 restores the 300000 cap with the old message and no counting", () => {
    const env = { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "0" };
    expect(runHook([boundary(1), boundary(2), boundary(3), assistant(250000)], env)).toBe("");
    const over = runHook([boundary(1), boundary(2), boundary(3), assistant(350000)], env);
    expect(JSON.parse(over).hookSpecificOutput.additionalContext).toBe(buildCapMessage(350000, 300000));
    expect(JSON.parse(over).hookSpecificOutput.additionalContext).not.toContain("compactions");
    expect(runHook([assistant(350000)], { ...env, OPENCLINXR_CONTEXT_CAP: "400000" })).toBe("");
  });

  it("C4: OPENCLINXR_CONTEXT_CAP still overrides the token cap with counting on", () => {
    const out = runHook([assistant(250000)], {
      OPENCLINXR_CONTEXT_CAP: "200000",
      OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2",
    });
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("250000");
  });

  it("C5: compact_boundary text inside tool_result and user content is not counted", () => {
    const tool = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: '{"type":"system","subtype":"compact_boundary"}' }] },
    });
    const user = JSON.stringify({ type: "user", message: { content: 'grep "subtype":"compact_boundary"' } });
    expect(
      runHook([tool, user, tool, user, assistant(350000)], { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2" }),
    ).toBe("");
  });

  it("C5: a malformed last line does not silence the cap", () => {
    const out = runHook(
      [
        boundary(1),
        assistant(120000),
        boundary(2),
        assistant(110000),
        '{"type":"assistant","message":{"usage":{"input_tok',
      ],
      { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2" },
    );
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("2 compactions");
  });

  it("C5: a boundary outside the 4 MiB tail is still counted", () => {
    const env = { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2" };
    const out = runHook([boundary(1), boundary(2), assistant(120000)], env, 5 * 1024 * 1024);
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("2 compactions");
    expect(runHook([boundary(1), assistant(120000)], env, 5 * 1024 * 1024)).toBe("");
  });

  it("F1: grok keeps the 300000 cap with no counting", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ocxr-cap-grok-")));
    try {
      const dir = join(root, ".grok", "sessions", encodeURIComponent(root), "s1");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "updates.jsonl"), `${grokUpdates(350001)}\n`);
      const base: Record<string, string | undefined> = { ...gitEnvWithoutInheritedRepoVars(), HOME: root };
      delete base.OPENCLINXR_CONTEXT_CAP;
      delete base.OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF;
      const out = execFileSync(node, [tsxCli, script, "--grok"], {
        cwd: root,
        input: JSON.stringify({ sessionId: "s1" }),
        encoding: "utf8",
        env: base as NodeJS.ProcessEnv,
      }).trim();
      expect(out).toBe(buildCapMessage(350001, 300000));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("F2: two boundaries with no assistant usage line still fire", () => {
    const out = runHook([boundary(1), boundary(2)], { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: "2" });
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("2 compactions");
  });

  it("D0: default (env unset) 350000 tokens triggers the plain cap", () => {
    const out = runHook([assistant(350000)]);
    expect(out).not.toBe("");
    const msg = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(msg).toContain("350000");
    expect(msg).not.toContain("compactions");
  });

  it("D0: default (env unset) two compactions under the cap stay silent", () => {
    expect(runHook([boundary(1), boundary(2), assistant(250000)])).toBe("");
  });

  it.each(["abc", "-1", ""])("F6: invalid OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF %j falls back to 0", (value) => {
    const env = { OPENCLINXR_COMPACTIONS_BEFORE_HANDOFF: value };
    const over = runHook([boundary(1), boundary(2), assistant(350000)], env);
    const overMsg = JSON.parse(over).hookSpecificOutput.additionalContext as string;
    expect(overMsg).toContain("350000");
    expect(overMsg).not.toContain("compactions");
    expect(runHook([boundary(1), boundary(2), assistant(250000)], env)).toBe("");
  });

  describe("F4: countCompactionsInFile", () => {
    const count = (text: string): number | null => {
      const root = mkdtempSync(join(tmpdir(), "ocxr-count-"));
      try {
        const file = join(root, "t.jsonl");
        writeFileSync(file, text);
        return countCompactionsInFile(file);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };

    it("a 50 MiB single user line followed by a boundary counts 1", () => {
      const huge = JSON.stringify({ type: "user", message: { content: "y".repeat(50 * 1024 * 1024) } });
      const started = Date.now();
      expect(count(`${huge}\n${boundary(1)}\n`)).toBe(1);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("a boundary line split exactly at the 1 MiB chunk edge counts", () => {
      const chunk = 1024 * 1024;
      const b = boundary(1);
      const prefixLen = chunk - 10;
      const filler = `${JSON.stringify({ type: "user", message: { content: "z".repeat(prefixLen - 60) } })}`;
      const pad = " ".repeat(prefixLen - filler.length - 1);
      const text = `${filler}${pad}\n${b}\n${b}\n`;
      expect(Buffer.byteLength(text.slice(0, text.indexOf(b)))).toBe(prefixLen);
      expect(count(text)).toBe(2);
    });
  });
});
