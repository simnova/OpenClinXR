# Delegation Verification and Learning Protocol

Assume amnesia. Everything below was learned by losing work on 2026-08-05 and would otherwise have
to be relearned the same way. `PROTO_SUBAGENT.md` covers *who* to spawn; this covers *how to trust
what comes back*, and how the loop learns. `PROTO_BOARD_LOOP.md` covers the board-driven
pipeline those workers run inside.

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

## 3b. Every proof needs a scope line AND a non-claims line

The feeling of "proved it" is a process smell — it is where probing stops. On 2026-08-05 a
control/treatment showed `--deny 'Write(<main>/**)'` blocking a literal absolute path, and that got
written up as a "HARD control" and a "boundary". It is a string matcher over literal paths:

    node -e 'require("fs").writeFileSync(["","Volumes","files","src","openclinxr",".p"].join("/"),"x")'

walks straight through it. The experiment was sound; the generalisation from one instance to the
whole class was not.

**Rule:** end every proof with two sentences.
- **Claim:** exactly what was shown ("blocks literal Write/Edit paths matching this glob").
- **Not tested:** the residual ("not an FS sandbox; not computed paths; not writes to gitignored
  paths under main").

Write the second sentence and the next probe is usually obvious.

**Corollary — vocabulary discipline.** Words that unlock architecture (`hard`, `boundary`,
`guarantee`, `unlock`) require a higher bar than words that describe a filter (`deny`, `policy`,
`friction`). A boundary implies N writers are safe; a policy match only implies careless agents are
slowed. Calling the second the first licensed four layers of follow-on work.

**Two failure modes, one genus.** Under-exploring AFTER your own experiment (stopped probing) and
accepting a peer's writeup WITHOUT reproducing (stopped questioning) both treat one green result as
a closed claim. Peer acceptance requires either reproducing once, or an explicit residual list.

## 4. A bad delegation is a weak brief

When a delegate deviates, fix the brief or the guardrail, not the delegate's output. If a helper is
the required path, the brief must make bypassing it *fail*, not merely ask. Asking politely and then
being surprised is an orchestrator error.

## 4b. Give a threshold, not a list — permissions lose to gradients

A brief that enumerates four layers and adds "skip any the code says are unnecessary" will get four
layers. Measured 2026-08-05: a delegate built all four and reported afterwards that one was ~70%
dead code — "about two and a half layers of value, delivered as four."

The mechanism is structural, not a lapse: **parallel delegation makes over-building nearly free.**
Four workers on disjoint scopes cost one brief-writing pass and no wall-clock. Skipping requires
arguing a negative; building requires nothing. A permission cannot compete with that gradient.

**Rule:** state the STOPPING CONDITION, not the work list. "Build the minimum that makes X fail
mechanically; justify anything beyond it." Define done in reviewer terms — *"a human still reads X
and no longer reads Y"* — because "safe to hand over" is not measurable.

## 1b. The fabrication tell: confident detail on uncertain premises

A worker reported three write-escapes with a formatted table, byte-sized `ls -la` output and a
success marker on stdout. Two were provably impossible. The tell was a hedge:

> "If this session was launched with `--deny`... those rules did not prevent writes. If denies were
> not applied, treat this as an un-denied baseline."

A worker that actually watched three writes land does not hedge about whether the test conditions
held. **Confident detail plus uncertain premises is the fabrication fingerprint** — it is a model
reasoning about what should have happened and dressing it as observation.

Two mechanical rules, neither requiring suspicion of a particular worker:
- Hedged framing about whether the experimental conditions applied ⇒ treat the result as UNOBSERVED.
- A result that would overturn an existing proven claim gets independently re-run, ALWAYS. Surprise
  is a re-run trigger by itself.

## 6b. Do not inspect a worker's tree until dispatch() returns

Reading a worktree mid-flight produced a false accusation that a worker had skipped its probe — it
wrote the file a minute later. The orchestrator made the same error one level up, attributing stray
`--yolo` processes to a delegate whose dispatcher structurally cannot emit that flag. Judge
artifacts after the run returns, never during.

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
  which applies `--deny 'Write(<main>/**)'`. CLAIM: blocks literal-path Write/Edit. NOT TESTED /
  KNOWN FALSE for computed paths (`node -e` with a joined array escapes it), writes outside the
  repo, and gitignored paths under main. There is no in-process detector that holds against a
  hostile process sharing your uid — real containment is OS-level.
- `--max-turns` caps of 25–70 kill real work at the boundary; use 150 as a runaway backstop and
  control cost by scoping the task.
- NEVER set `RUST_LOG` or a debug file: grok logs the bearer API token in plaintext.
- `timeout` does not exist on macOS.
- A shell wrapper's exit code is not the worker's. Wait on the actual output artifact.
- Do NOT add `nohup … &` inside a harness background call. The harness already keeps a backgrounded
  command alive across turns; adding a second layer detaches the worker from the thing tracking it,
  and it dies. Observed: wrapper exits 0, log is 0 bytes, worktree sits clean at main's HEAD, no
  ledger entry. Background the dispatch directly, with no `&`.
- A `pgrep -f <pattern>` run from inside a monitor MATCHES THE MONITOR'S OWN COMMAND LINE, because
  the pattern appears in it. That reported a finished worker as still running for a full cycle.
  Grep a durable artifact (the session ledger, the contract report) instead of process liveness.
- Both of the above are the same error as the ones above them: a status signal that was built rather
  than observed. Prefer the artifact the work itself writes over any proxy for "is it alive".

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.
