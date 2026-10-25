---
name: "context-handoff"
description: "Write a mechanical lane handoff when the context-cap hook fires, before a long wait, or before a session limit. handoff.ts gathers worktrees, workers, RESULT lines, cards; you fill Decisions, Gates, Store paths. Load when resuming a lane."
when-to-use: "context cap message, write handoff, session limit approaching, long wait before resume, resuming a lane, handoff file, context warning, over the cap"
---

# Context handoff

A long session ends mid-task with no record unless the handoff exists on disk.
The cap hook (`tools/openclinxr/openclaw/context-cap.ts`) tells you when;
this skill tells you what to do.

## When to write

- The cap message arrives (context N tokens is over the cap C): write the
  handoff immediately, fill its slots, start no new work.
- Before a long wait (a bake, a suite, a worker you will poll later).
- Before a session limit: compact, token budget, or shift end.

## How to write

Run the writer; it gathers everything mechanical by command (no model):

```sh
pnpm exec tsx tools/openclinxr/openclaw/handoff.ts write <lane> \
  --result <RESULT path> [--result <another>] [--card <id> ...]
```

Then fill the four template slots in `.openclinxr/handoffs/<lane>.md`:

1. **Decisions and why** — each decision since the last handoff, one line of reason.
2. **Gates and their sources** — gate name plus the command or file that proves
   it. A gate without a source is a claim, not a gate.
3. **Store paths this lane owns** — card-owned paths only.
4. **Next action** — the single command or edit the resumer runs first.

Store rule, verbatim:

"A new store output goes to a new card-owned path; an existing store path cited by a tracked report is read-only."

## How to resume from the file

1. Read `.openclinxr/handoffs/<lane>.md`.
2. Verify every mechanical fact with git before acting (branch, HEAD, dirty
   count, commits ahead of origin/main) — the file is a snapshot, not truth.
3. Do Next action.
