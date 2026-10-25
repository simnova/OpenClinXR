import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildCapMessage,
  contextTokensFromClaudeTranscript,
  contextTokensFromGrokUpdates,
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
