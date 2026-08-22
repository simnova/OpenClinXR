---
name: autonomy-boundaries
description: The pre-approved actions never to ask permission for again - install tooling, push main, publish, merge verified work - plus escalate-last routing through the repo and the peer thread before any question reaches the operator. Read before asking the operator ANY question.
when-to-use: asking permission, do I need approval, may I, install, pip, pnpm add, clone, push to main, publish, merge to main, what do you need from me, question for operator, escalate, blocked on approval
---

# Autonomy already granted

Seven corrections in one session were the same sentence: the operator re-granting permission that was
already granted. The tell is verbatim - *"istall as needed - **you know** you don't need permission to
install"*. The "you know" is the audit finding.

## 1. The pre-approved list - asking again IS the failure

| action | grant on record, verbatim |
|---|---|
| install any tooling (pip, pnpm add, brew, clone a provider) | *"you don't need permission to install"* |
| push to main / origin | *"you may push to main"*, *"welcome to keep pushing main to origin without any operator approval"* |
| publish the website / public surfaces | *"Stop asking me for permission to publish, you have rights to"* |
| merge verified work to main | *"please merge to main and publish"* |

**Each is granted ONCE, permanently.** Before composing any "may I", check this table. If the action is
on it: do it, and record it in the wake BLUF. **If you catch yourself drafting a permission request for
a row above, that request is the mistake.**

**The re-ask trap.** Do not re-request approval for a transition already directed. Measured: I asked
what approval was needed to move from Anny to MPFB *after the same transition had been directed three
times.* **Directed work needs a status, not an approval.**

## 2. Escalate-last

Verbatim, and said twice: *"confirm with the superagent before you ever ask me"*, and *"questions that
you asked me - ask the superagent and take their advise"*.

Every question passes three gates, in order:

1. **The repo** - SSOT, MADRs, PROJECT_STATUS, the code. Most questions die here.
2. **The peer / superagent thread** - judgment, verification, alternatives.
3. **The operator** - only what gates 1-2 cannot answer, **bundled**: one message, all questions, each
   with a recommended default.

Also standing: before responding to the operator on a contested position, check the position with
another agent first.

## 3. What still genuinely requires the operator

This skill is not "never ask". These stay reserved:

- scope expansion beyond approved boundaries - paid or cloud services, new providers
- clinical-validity, scoring, licensure or exam-equivalence claims of any kind
- destructive operations on shared state I did not create - another agent's worktree, force-pushes,
  protected-registry rewrites
- changing an explicit operator directive

**The test for everything else: reversible? local? in-kind with something already granted?** Three yeses
means do it, record it, move on.
