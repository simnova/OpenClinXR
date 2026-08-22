---
name: autonomy-boundaries
description: "Gate for EVERY question, permission request, or 'may I / should I / which option / am I blocked' impulse, and for install / push / publish / merge impulses - the pre-approved table that means ACT, DO NOT ASK (install tooling, push main, publish, merge verified work - asking again IS the failure), then the escalate-last chain repo -> standing ox advisory thread -> one bundled operator message. Carries the live thread id, --resume invocation, recall verification, and thread-loss recovery. Load at the URGE to compose any operator question, not at the send."
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
times.* **Directed work needs a status, not an approval.** When you catch a permission draft for directed
work, DELETE it and emit the status line instead, verbatim shape:

> `<Transition> was directed on <date>. Status: <stage>. Proceeding; redirect if wrong.`

**A draft containing a question mark, for a row above or a directed transition, IS the failure - not
the send.**

## 2. Escalate-last

Verbatim, and said twice: *"confirm with the superagent before you ever ask me"*, and *"questions that
you asked me - ask the superagent and take their advise"*.

**The mechanics now live in `ask-the-superagent`** - one persistent ox thread with a stored
conversation id, so context accumulates instead of restarting. Load it the moment you catch yourself
drafting a question for the operator.

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

---

# The standing thread (merged from ask-the-superagent)

# Ask the superagent, not the operator

Operator standing directive, verbatim: *"every time you think about asking me a question, ask the
superagent (ox now) in a special continuing conversation where you keep the conversation id around."*

**The trigger is the URGE, not the send.** The moment you notice yourself composing a question for the
operator, that is the cue to open this skill. The question goes here first.

## The standing thread

```
SESSION ID: 01a02796-b864-7500-b4a5-6cc66b3507c2      (machine-local: ~/.grok/sessions/)
MODEL:      ox-alpha
OPENED:     2026-08-21
```

```bash
export OPENROUTER_API_KEY="$OPENROUTER_API_KEY"   # already in ~/.zshrc
OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1 \
  ~/.grok/bin/grok -p "<your question, with MEASUREMENTS>" \
  --resume 01a02796-b864-7500-b4a5-6cc66b3507c2 \
  --model ox-alpha --output-format json --max-turns 16 \
  --cwd /Volumes/files/src/openclinxr
```

**Always `--resume` this id.** A fresh session re-explains the project, loses every prior ruling, and
costs the accumulated context that makes this thread worth more than a cold consult.

## Why ONE thread and not a new consult each time

The thread already holds: who I am and how the loop runs; the standing constraints (D1/D2/D9/D12, the
CC0/CC-BY licence bar, CMU-is-conditional, Animato refused, the parked list, rooms closed); and - most
usefully - **the five self-governance failures it was asked to hold me to**: loop lapse, asking for
already-granted permission, deprecated-rail drift, publishing status only when asked, and
hand-authoring where a proven tool exists.

Verified on open: resuming returned the same session id and recalled all five unprompted.

## Verify recall before trusting an answer

**A wrong-but-existing session id CONFABULATES rather than erroring** - it loads project memory and
answers confidently about someone else's work. So, on the first resume of any session, or any time the
answer feels generically right:

1. Confirm the returned `sessionId` matches the id you passed.
2. Confirm `Session ... found locally` appeared on stdout.
3. Ask one recall question whose answer only this thread holds. If it cannot answer, you are talking to
   a stranger - discard the reply.

## What to send

- **Measurements, never narrative.** File paths, counts, hashes, quotes. A question without numbers
  gets an answer without grounding.
- **A concrete proposal to attack**, not an open question. "Attack this" beats "what should I do".
- **Ask for alternatives you did not list**, ranked, and for the ONE thing you are most likely to get
  wrong next.
- Say plainly when you want it to tell you the direction is wrong.

## What to do with the answer

- **Verify tree claims before acting.** It is reliably right about structure and unreliably right about
  mechanism. A recommendation whose precondition is false is worse than none - one of its best-argued
  picks rested on a staged asset that did not exist, and one grep killed it.
- A **VERIFIED** finding supersedes the plan. An **INFERRED** one is a lead.
- **NOT FOUND is a result** - record it so the next cycle does not re-search the same ground.

## What still reaches the operator

Only what this thread cannot answer - and then **bundled**: one message, all questions, each with a
recommended default and what happens if they stay silent. Never a soft menu.

Reserved regardless: scope expansion beyond approved boundaries (paid/cloud/new providers), any
clinical-validity or licensure claim, destructive operations on shared state I did not create, and
changing an explicit operator directive. See `autonomy-boundaries` for the pre-approved list that needs
no question at all.

## If the thread is lost

Session ids are machine-local and do not survive a wiped `~/.grok/sessions`. If `--resume` 404s:

1. `ls -dt ~/.grok/sessions/*/*/ | head` and grep candidates' `updates.jsonl` for a distinctive phrase
   from the opener ("STANDING ADVISORY THREAD").
2. If genuinely gone, re-open with a fresh opener carrying: my role and the loop; how it should behave
   (attack, ground, label INFERRED, alternatives, name my next likely error, be terse); the standing
   constraints; and the five self-governance failures.
3. **Update the SESSION ID at the top of this file in the same change.** A skill carrying a dead id is
   worse than one carrying none, because it will be used.
