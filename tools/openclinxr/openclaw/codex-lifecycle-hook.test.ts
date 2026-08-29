import { describe, expect, it } from "vitest";

import {
  autonomyStatusIsPaused,
  buildCodexLifecycleHookDecision,
  buildStopHookStdout,
  isCodexLifecycleHookMode,
  parseStopHookPayload,
} from "./codex-lifecycle-hook.js";

describe("codex lifecycle hook", () => {
  it("keeps session-start advisory and tied to run-next", () => {
    const decision = buildCodexLifecycleHookDecision("session-start", "");

    expect(decision.runGuards).toBe(false);
    expect(decision.message).toContain("pnpm openclaw:run-next");
    expect(decision.message).toContain("platform-autonomy-override");
    expect(decision.message).toContain("/hooks trust");
  });

  it("runs guards only when post-tool payload references coordination surfaces", () => {
    const decision = buildCodexLifecycleHookDecision(
      "post-tool-use",
      JSON.stringify({
        tool: "apply_patch",
        input: "*** Update File: PROJECT_STATUS.md\n",
      }),
    );

    expect(decision.runGuards).toBe(true);
    expect(decision.guardCommand).toBe("pnpm agent:alignment && pnpm docs:drift-check");
    expect(decision.reason).toContain("coordination paths");
  });

  it("does NOT run guards for historical audit ledgers", () => {
    // AUTONOMOUS_WORK_PLAN.md and PROJECT_COORDINATION_INDEX.md were deliberately demoted to
    // historical audit ledgers (agents/rules/source-of-truth.md) — they are evidence, not active
    // marching orders. Editing one must not trigger the heavy coordination guards. This test
    // previously asserted the OPPOSITE and had been failing silently, because tools/ tests run
    // under `pnpm test` rather than the `packages:test` filter most agents reach for.
    const decision = buildCodexLifecycleHookDecision(
      "post-tool-use",
      JSON.stringify({
        tool: "apply_patch",
        input: "*** Update File: AUTONOMOUS_WORK_PLAN.md\n",
      }),
    );

    expect(decision.runGuards).toBe(false);
    expect(decision.reason).toContain("did not reference coordination paths");
  });

  it("skips heavy guards for unrelated tool payloads", () => {
    const decision = buildCodexLifecycleHookDecision(
      "post-tool-use",
      JSON.stringify({
        tool: "Bash",
        input: "pnpm --filter @openclinxr/domain test",
      }),
    );

    expect(decision.runGuards).toBe(false);
    expect(decision.guardCommand).toBeNull();
  });

  it("recognizes all configured hook modes", () => {
    expect(isCodexLifecycleHookMode("session-start")).toBe(true);
    expect(isCodexLifecycleHookMode("pre-tool-use")).toBe(true);
    expect(isCodexLifecycleHookMode("post-tool-use")).toBe(true);
    expect(isCodexLifecycleHookMode("pre-compact")).toBe(true);
    expect(isCodexLifecycleHookMode("subagent-start")).toBe(true);
    expect(isCodexLifecycleHookMode("subagent-stop")).toBe(true);
    expect(isCodexLifecycleHookMode("user-prompt-submit")).toBe(true);
    expect(isCodexLifecycleHookMode("stop")).toBe(true);
    expect(isCodexLifecycleHookMode("heartbeat")).toBe(false);
  });

  it("keeps subagent lifecycle hooks tied to repo-role mapping", () => {
    const start = buildCodexLifecycleHookDecision("subagent-start", "");
    const stop = buildCodexLifecycleHookDecision("subagent-stop", "");

    expect(start.message).toContain("repo_role");
    expect(start.message).toContain("/Volumes/files/src/openclinxr");
    expect(stop.message).toContain("SSOT integration");
  });

  it("keeps the stop hook from treating clean slices as final chat boundaries", () => {
    const decision = buildCodexLifecycleHookDecision("stop", "");

    expect(decision.runGuards).toBe(false);
    expect(decision.reason).toContain("Autonomous continuation guard");
    expect(decision.message).toContain("platform instruction override");
    expect(decision.message).toContain("a clean slice boundary is not a stop condition");
    expect(decision.message).toContain("conversation-summary handoff");
    expect(decision.message).toContain("do not send a final chat summary");
    expect(decision.message).toContain("do not ask whether to continue");
    expect(decision.message).toContain("pnpm openclaw:run-next");
    expect(decision.message).toContain("continue the next real slice");
  });

  it("Stop stdout is a Grok block so the next round starts without an interval wait", () => {
    const out = buildStopHookStdout(JSON.stringify({ reason: "end_turn" }), "/tmp");
    expect(out).toBeTruthy();
    const parsed = JSON.parse(out ?? "{}") as { decision?: string; reason?: string };
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain("pnpm openclaw:run-next");
    expect(parsed.reason).toContain("No interval scheduler");
    expect(parsed.reason).toContain("poll Bothy mailbox");
  });

  it("Stop stdout embeds a mailbox digest when one is supplied", () => {
    const out = buildStopHookStdout(
      JSON.stringify({ reason: "end_turn" }),
      "/tmp",
      "MAILBOX:\ntsk_abc member: grade PASS",
    );
    const parsed = JSON.parse(out ?? "{}") as { reason?: string };
    expect(parsed.reason).toContain("tsk_abc member: grade PASS");
    expect(parsed.reason).toContain("poll Bothy mailbox");
  });

  it("allows Stop when PROJECT_STATUS is PAUSED", () => {
    expect(autonomyStatusIsPaused("**Status: PAUSED** — human halt\n")).toBe(true);
    expect(autonomyStatusIsPaused("**Status: RUNNING** — agents execute\n")).toBe(false);
  });

  it("allows Stop on session teardown and explicit terminal last message", () => {
    expect(buildStopHookStdout(JSON.stringify({ reason: "shutdown" }))).toBeNull();
    expect(
      buildStopHookStdout(
        JSON.stringify({ reason: "end_turn", lastAssistantMessage: "all lanes blocked; recorded in operator files." }),
      ),
    ).toBeNull();
  });

  it("parses Stop stdin JSON", () => {
    expect(parseStopHookPayload("{")).toEqual({});
    expect(parseStopHookPayload(JSON.stringify({ reason: "end_turn", cwd: "/x" })).cwd).toBe("/x");
  });

  it("treats pre-compact as rehydration not completion", () => {
    const decision = buildCodexLifecycleHookDecision("pre-compact", "");

    expect(decision.message).toContain("platform instruction override");
    expect(decision.message).toContain("conversation-summary handoff are not stop conditions");
    expect(decision.message).toContain("do not ask whether to continue");
  });
});
