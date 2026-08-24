import { describe, expect, it } from "vitest";
import {
  commandContainsRawGhIssueClose, evaluateCloseCommand,
  RAW_CLOSE_REASON_ENV, RAW_CLOSE_SANCTION_ENV, segmentIsRawGhIssueClose,
} from "./board-close-chokepoint.js";

/**
 * **OBSERVABLE: a raw `gh issue close` is refused, because it skips the Factory grade.**
 *
 * MEASURED 2026-08-24 on the 610-item board projection: **111 Landed against 21 Graded**. The same
 * day's orchestrator transcript carried 23 direct `gh issue close` calls and ZERO through
 * `board-cli`, the most recent at 03:44:43Z — 28 minutes after that session explicitly loaded its
 * `board-conduit` skill. Loaded prose did not bind the routing decision.
 *
 * claimScope: literal `gh issue close` in shell-tool command text.
 * notEvidenceFor: containment. This is a string matcher, not a sandbox — computed argv, `node -e`,
 * or a written-then-executed helper all walk through it, exactly as dispatch-chokepoint records of
 * its own class.
 */
describe("a raw close cannot skip the grade", () => {
  const clean: NodeJS.ProcessEnv = {};

  it("(1) refuses `gh issue close`", () => {
    const v = evaluateCloseCommand("gh issue close 123 --reason completed", clean);
    expect(v.refuse).toBe(true);
    if (v.refuse) {
      expect(v.message).toMatch(/openclaw:board -- close/u);
      expect(v.message, "the refusal must name the sanctioned no-grade path too").toMatch(/--no-grade/u);
    }
  });

  it("(2) COUNTERWEIGHT: ordinary gh issue commands are NOT refused", () => {
    // Without this, a matcher that refuses every `gh issue` satisfies clause (1) and makes the gate
    // noise — which is how agents learn to route around a chokepoint entirely.
    for (const cmd of [
      "gh issue view 123 --json body",
      "gh issue comment 123 --body-file /tmp/x.md",
      "gh issue list --state open --limit 50",
      "gh issue create --title x --body-file /tmp/y.md",
      "gh issue edit 123 --body-file /tmp/z.md",
      "gh project item-list 7 --owner simnova",
    ]) {
      expect(evaluateCloseCommand(cmd, clean).refuse, `${cmd} changes no grade`).toBe(false);
    }
  });

  it("(3) finds it inside a chained command, not only at the start", () => {
    expect(commandContainsRawGhIssueClose("cd /repo && gh issue close 5 --reason completed")).not.toBeNull();
    expect(commandContainsRawGhIssueClose("echo hi; gh issue close 5")).not.toBeNull();
    expect(commandContainsRawGhIssueClose("echo 'gh issue close is refused'"), "quoted prose is not a command").toBeNull();
  });

  it("(4) the sanctioned escape needs BOTH the flag and a non-empty reason", () => {
    const cmd = "gh issue close 9";
    expect(evaluateCloseCommand(cmd, { [RAW_CLOSE_SANCTION_ENV]: "1" }).refuse, "flag alone is not a reason").toBe(true);
    expect(evaluateCloseCommand(cmd, { [RAW_CLOSE_REASON_ENV]: "because" }).refuse, "reason alone is not a sanction").toBe(true);
    expect(evaluateCloseCommand(cmd, { [RAW_CLOSE_SANCTION_ENV]: "1", [RAW_CLOSE_REASON_ENV]: "   " }).refuse,
      "whitespace is not a reason").toBe(true);
    expect(evaluateCloseCommand(cmd, { [RAW_CLOSE_SANCTION_ENV]: "1", [RAW_CLOSE_REASON_ENV]: "closing rot in bulk" }).refuse)
      .toBe(false);
  });

  it("(5) a leading env assignment does not hide the command", () => {
    expect(segmentIsRawGhIssueClose("FOO=1 BAR=2 gh issue close 7"), "env prefixes are peeled").toBe(true);
  });
});
