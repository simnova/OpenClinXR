---
name: finish-before-done
description: "Turn-end completeness gate. Before reporting an activity done, re-read your own draft for sentences that DESCRIBE work rather than doing it - 'one gap worth naming', 'still needs', 'not yet', 'worth a look', 'I could not confirm', 'carried forward' - and for each ask whether you already have what you need. If yes, do it before sending; naming it instead is handing the operator work you could have finished. Carries the boundary that separates a real blocker from stopping short, and the create-only-field trap that turned one such omission into a rebuild."
when-to-use: about to report done, finishing an activity, writing a summary, one gap worth naming, still needs, not yet, carried forward, could not confirm, leaving work on the table, stopping short, did I finish
---

# Finish before reporting done

Operator direction, 2026-09-10, after five board cards shipped with a closing line reading *"one gap
worth naming: none has doneWhen yet"*:

> *"is there something you can do where you check for incomplete work and complete it prior to saying
> you are done with an activity?"*

The gap was mine to close. The design doc, the proof shapes and the contract rules were all in
context. Reporting it back was handing the operator work finishable in the same turn.

## The check

Before any "done" report, re-read your own draft and flag every sentence that DESCRIBES work rather
than doing it. **The tells are yours, not the user's:**

- *one gap worth naming* / *worth naming* / *worth a look*
- *still needs* / *not yet* / *remains to be*
- *I could not confirm* / *I did not verify*
- *carried forward* / *left for later* / *a later pass*
- *someone should* / *it would be good to*

For each one, ask a single question:

> **Do I already have everything I need to do this right now?**

- **Yes** → do it before sending. No exemption for "small", for "they'll probably want to decide", or
  for "it's really a separate task". If it is one tool call away, it is part of this turn.
- **No** → say precisely what is missing and who holds it. That is a blocker, and stating it is the
  work.

## The boundary, so this does not become scope creep

Everything that legitimately stays open shares one shape: **someone else must decide or supply
something.**

| legitimately open | stopping short |
|---|---|
| a ruling only the operator can make (a licence, a threshold, a release) | a field you know the value of |
| a fix outside the card's write roots | a fix inside them you noticed while passing |
| a capability the environment lacks (no CUDA, no key, no hardware) | a command you did not run |
| a measurement that needs a run you are not authorised to start | a measurement you could take now |

The test is not "is this in scope of the sentence I was given". It is "did the thing I just wrote
about require anything I do not have".

## What this is not

Not a licence to widen the task. The check fires on work **you yourself just named as missing**, not
on everything adjacent you can imagine. If it did not appear in your own draft, it is not in scope.

Not a reason to hide an open item. A real blocker still gets reported, in full, with its numbers. The
change is that a *closable* item gets closed instead of reported.

## The trap that made this expensive

The omission that prompted this was one field on five cards. It cost a rebuild, because
**`doneWhen` is create-only on BothyBoard**: `tasks.update` accepts the call, returns success, and
silently leaves `doneWhen: []` with no error. Five cards were created without it, could never be
planted, and had to be cancelled and recreated.

The general rule that follows, and it is worth more than the specific field:

> **Check a field's create-only / immutable constraint BEFORE the create call, not after an update
> silently drops it.** An API that returns success while ignoring your argument will not teach you
> anything. Read the value back before believing it was written.

Board-specific create-only fields are listed in the `bothy-board` skill.

## Related

- `bothy-board` — the create-only field list and the two-step transitions
- `contract-design` — what a `doneWhen` must contain once you are writing one
- `operator-prose` — how the report is written; this skill is about whether it is honest that the
  work is finished
