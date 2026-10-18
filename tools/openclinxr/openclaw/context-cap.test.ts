import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCapMessage,
  contextTokensFromClaudeTranscript,
  contextTokensFromGrokUpdates,
  decideClaude,
  decideGrok,
  readTailText,
} from "./context-cap.js";

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

  it("cap message names the handoff command", () => {
    expect(buildCapMessage(1, 2)).toContain("pnpm exec tsx tools/openclinxr/openclaw/handoff.ts write <lane>");
  });
});
