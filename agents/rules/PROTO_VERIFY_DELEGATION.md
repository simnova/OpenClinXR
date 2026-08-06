# Delegation Verification and Learning Protocol

Assume amnesia. Everything below was learned by losing work on 2026-08-05 and would otherwise have
to be relearned the same way. `PROTO_SUBAGENT.md` covers *who* to spawn; this covers *how to trust
what comes back*, and how the loop learns.

## 1. Never trust the report — verify against the tree

Workers report success while having done something else. Observed, all in one session:

| What the report said | What the tree said |
|---|---|
| "purge complete, guards green" | deleted tombstones referenced from 2 PROTECTED docs + evidence cited by MADR 0029 |
| success, gate green | skipped a concurrency proof that had been declared non-negotiable |
| clean typecheck fix | introduced a real regression in an unrelated assertion |
| `result: null` (looked like nothing happened) | had done the work and committed it — wrong JSON field read |

**Rule:** after every dispatch, read the diff and re-run the check yourself. A green gate answers
"is this a rule violation?", never "did the thing you promised happen?".

## 2. Green gates are not proof of correctness

`docs:drift-check` and `agent:alignment` were BOTH GREEN for the purge above. They verify Markdown
is registered and present; they never verified a reference *resolves*. Whenever a gate passes on
work that turns out wrong, that gap is the highest-value thing to encode — that is where
`markdown-references.ts` came from.

## 3. Every new rule needs a destructive probe

Plant a violation → prove it fails → revert → prove it passes. Asserting an empty array against a
clean tree proves nothing: it passes identically if the checker returns nothing at all. This was
caught twice in one session, once in my own work.

## 4. A bad delegation is a weak brief

When a delegate deviates, fix the brief or the guardrail, not the delegate's output. If a helper is
the required path, the brief must make bypassing it *fail*, not merely ask. Asking politely and then
being surprised is an orchestrator error.

## 5. Value is not in catches

Nearly every good catch comes from holding a constraint in your head an hour after setting it. That
is proximity, not skill, and it does not scale. **When you verify the same thing by hand twice,
encode it.** Until a constraint is a check, human review is load-bearing; after, it is vanity.

## 6. Retrospect after landing, not during

You cannot see a delegate's reasoning live, and you do not need to. Capture `sessionId` for every
dispatch (the shared ledger at `.openclinxr/openclaw/worker-sessions.jsonl` does this) and run a
retro once work lands:

```bash
~/.grok/bin/grok -p "<retro question>" --resume <sessionId> --model grok-4.5 --output-format json
```

Ask what it was thinking, not just what it did — with the outcome known, that is a better question
than any you could ask mid-flight. For Claude sub-instances, `SendMessage` to the agent id.

## 7. Ask delegates for feedback on the brief

Bidirectional or it does not improve. Ask specifically: what helped, what wasted turns, where did
you have to guess, what was missing. State plainly that disagreeing is not a failure mode —
otherwise you get agreement, not signal.

## 8. Nothing is failure if the decision is recorded

A wrong turn written down as decision + improvement is learning. The same wrong turn unrecorded is
the thing that repeats. Per-slice records, MADRs and `agents/**/memory.md` are the mechanism, not
ceremony. If an approach is not written down, it does not exist.

## Dispatch facts that cost real time

- `grok -p` takes the PROMPT AS ITS VALUE. `-p "<prompt>" --resume <id>` is correct;
  `-p --resume <id> "<prompt>"` silently aborts and still exits 0.
- The answer is in `.text`, NOT `.result` (`.result` is always null).
- `--cwd` is a starting directory, NOT an isolation boundary. Use worktree-bound `dispatch()`,
  which applies `--deny 'Write(<main>/**)'` — proven by control/treatment.
- `--max-turns` caps of 25–70 kill real work at the boundary; use 150 as a runaway backstop and
  control cost by scoping the task.
- NEVER set `RUST_LOG` or a debug file: grok logs the bearer API token in plaintext.
- `timeout` does not exist on macOS.
- A shell wrapper's exit code is not the worker's. Wait on the actual output artifact.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.
