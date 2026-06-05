import { describe, expect, it } from "vitest";

import { buildCodexLifecycleHookDecision, isCodexLifecycleHookMode } from "./codex-lifecycle-hook.js";

describe("codex lifecycle hook", () => {
  it("keeps session-start advisory and tied to run-next", () => {
    const decision = buildCodexLifecycleHookDecision("session-start", "");

    expect(decision.runGuards).toBe(false);
    expect(decision.message).toContain("pnpm openclaw:run-next");
    expect(decision.message).toContain("/hooks trust");
  });

  it("runs guards only when post-tool payload references coordination surfaces", () => {
    const decision = buildCodexLifecycleHookDecision(
      "post-tool-use",
      JSON.stringify({
        tool: "apply_patch",
        input: "*** Update File: AUTONOMOUS_WORK_PLAN.md\n",
      }),
    );

    expect(decision.runGuards).toBe(true);
    expect(decision.guardCommand).toBe("pnpm agent:alignment && pnpm docs:drift-check");
    expect(decision.reason).toContain("coordination paths");
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

    expect(start.message).toContain("map to a repo role");
    expect(start.message).toContain("/Volumes/files/src/openclinxr");
    expect(stop.message).toContain("parent agent owns integration");
  });
});
