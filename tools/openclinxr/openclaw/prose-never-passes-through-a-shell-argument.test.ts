import { describe, expect, it } from "vitest";
import { evaluateProseCommand, unsafeProseForm } from "./shell-prose-chokepoint.js";

/**
 * **OBSERVABLE: prose cannot reach git or gh through a shell-evaluated argument.**
 *
 * MEASURED — three incidents, two agents, one mechanism. Backticked code spans inside prose were
 * evaluated as COMMAND SUBSTITUTION by zsh before the program received the argument. The substituted
 * commands failed; the surrounding operation SUCCEEDED; the spans vanished:
 *
 *   6a52e755         "the early return on skipFraming turned"  ->  "neutering  turned"
 *   gh issue comment  seven spans executed (headCenterY, flat_baseline, matrixWorld[13])
 *   issue #576 body   every backticked identifier stripped
 *
 * A rule already existed and did not bind: `.agents/skills/gh-body-file` names this exact hazard in
 * its own description, and is ABSENT from `.claude/skills`, so a Claude-side agent never had it
 * available. The follow-up fix was 11 lines of Markdown in one skill — no hook, no test.
 *
 * claimScope: the argument FORM in shell-tool command text.
 * notEvidenceFor: containment. Computed argv, helper scripts and direct API calls still escape.
 */
describe("prose never passes through a shell argument", () => {
  it("(1) refuses the exact forms that corrupted real artifacts", () => {
    for (const cmd of [
      `git commit -m "the early return on skipFraming turned"`,
      `git commit --message "prose with \`backticks\`"`,
      `git commit --message="prose"`,
      `git commit -am "bundled short flags still carry a message"`,
      `gh issue comment 619 --body "measured \`headCenterY\` at 0.309"`,
      `gh issue comment 619 -b "short form"`,
      `gh issue edit 576 --body="inline"`,
      `gh api graphql -f body=literal-prose-here`,
    ]) {
      const v = evaluateProseCommand(cmd);
      expect(v.refuse, `must refuse: ${cmd.slice(0, 52)}`).toBe(true);
      if (v.refuse) expect(v.message).toMatch(/--body-file|-F <file>|body=@/u);
    }
  });

  it("(2) COUNTERWEIGHT: the safe opaque paths are ALLOWED", () => {
    // Without this, a matcher refusing everything satisfies clause (1) and blocks all publishing —
    // which is how a gate gets disabled wholesale instead of obeyed.
    for (const cmd of [
      `git commit -F /tmp/msg.txt`,
      `git commit -F -`,
      `gh issue comment 619 --body-file /tmp/c.md`,
      `gh issue create --title x --body-file /tmp/b.md`,
      `gh api graphql -F body=@/tmp/b.md`,
      `gh api graphql -F body=-`,
      `gh issue view 619 --json body`,
      `gh project item-list 7 --owner simnova --limit 5000 --format json`,
      `git log --format="%h %s"`,
    ]) {
      expect(evaluateProseCommand(cmd).refuse, `must allow: ${cmd.slice(0, 52)}`).toBe(false);
    }
  });

  it("(3) it refuses the TRANSPORT, not the characters", () => {
    // Deliberate: scanning for backticks/$/! recreates the escaping bug this exists to remove.
    // A -m with entirely innocent text is still refused, because the form is the hazard.
    expect(unsafeProseForm(`git commit -m "no special characters at all"`)).toBe("-m");
    // And a --body-file whose PATH contains a backtick is still allowed — the value is never evaluated.
    expect(evaluateProseCommand("gh issue comment 1 --body-file /tmp/odd.md").refuse).toBe(false);
  });

  it("(4) finds it in chained commands and behind env assignments", () => {
    expect(evaluateProseCommand(`cd /repo && git commit -m "x"`).refuse).toBe(true);
    expect(evaluateProseCommand(`FOO=1 gh issue comment 5 --body "x"`).refuse).toBe(true);
    expect(evaluateProseCommand(`echo 'git commit -m is refused'`).refuse, "quoted prose is not a command").toBe(false);
  });

  it("(5) a non-git non-gh command is not this gate's business", () => {
    expect(evaluateProseCommand(`docker run -m 512m image`).refuse).toBe(false);
    expect(evaluateProseCommand(`curl -F body=inline https://example.com`).refuse).toBe(false);
  });

  it("(6) a QUOTED heredoc is allowed; an UNQUOTED one is not", () => {
    // Measured in the shell: <<'EOFX' preserves backticks literally, so the value reaching -m was
    // never evaluated. Refusing it would block this repo's dominant safe commit form and teach
    // everyone to bypass the gate. An unquoted <<EOF DOES expand and stays refused.
    const quoted = "git commit -q -m \"$(cat <<'EOF2'\nfix: a `backticked` span\nEOF2\n)\"";
    expect(evaluateProseCommand(quoted).refuse, "the safe heredoc form must pass").toBe(false);

    const unquoted = "git commit -q -m \"$(cat <<EOF2\nfix: a `backticked` span\nEOF2\n)\"";
    expect(evaluateProseCommand(unquoted).refuse, "an unquoted heredoc still expands").toBe(true);

    const bodyFileHeredoc = "gh issue comment 619 --body-file - <<'EOF2'\ntext\nEOF2";
    expect(evaluateProseCommand(bodyFileHeredoc).refuse).toBe(false);
  });
});
