---
name: ask-the-superagent
description: Every question you would put to the operator goes to the standing ox advisory thread FIRST, resuming one persistent conversation id so context accumulates. Contains the live thread id, the invocation, how to verify recall before trusting an answer, and how to re-open the thread if it is lost. Read the moment you catch yourself drafting a question for the operator.
when-to-use: ask the operator, question for operator, need approval, what should I work on, am I blocked, consult, superagent, ox, second opinion, escalate, I am unsure, which option, sanity check
---

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
