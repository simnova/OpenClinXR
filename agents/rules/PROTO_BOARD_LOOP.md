# Board-Driven Slice Loop

Assume amnesia. This is the pipeline that took GitHub issue #32 from board to main with no
hand-written brief, on 2026-08-05. `PROTO_SUBAGENT.md` covers who to spawn; `PROTO_VERIFY_DELEGATION.md`
covers how to trust what comes back; this covers the loop itself.

## The shape

```
issue (with ## done_when)
  → briefFromIssue()            tools/openclinxr/openclaw/board-brief.ts
  → dispatch({ worktree, proofs })  tools/openclinxr/openclaw/dispatch-worker.ts
  → contract verified by the ORCHESTRATOR after the worker exits  (proofsOk)
  → integrate()                 tools/openclinxr/openclaw/integrate.ts   (merge-kill first)
  → integration event           .openclinxr/openclaw/integration-events.jsonl
```

Each arrow fails closed. A worker's report is never an input.

## An issue is not dispatchable until someone decides what would prove it done

Board → brief is mostly about REFUSING. Run against the live board on 2026-08-05: **15 of 15 open
issues refused**, all for "no `## done_when`". The wiring took twenty minutes; the board was the
blocker. Issues hold work written for a human reader.

`## done_when` must contain machine-checkable rules (`run:`, `changed:`, `exists:`, `min-bytes:`) and
at least one must inspect the TREE. Narrative rules (`handoff:`, `skeptic:`) read the worker's own
handoff JSON — its account of itself — which is what the contract exists not to trust.

**Never invent a `done_when` to make a dispatch possible.** Synthesising plausible proofs from a
title makes the contract layer decorative: a worker judged against criteria nobody chose, which is
worse than no contract because it looks like one. Deciding what would prove an item done is the
orchestrator's judgment and cannot be delegated to the pipeline.

## Commit the RED before the issue exists

Otherwise a green result cannot be distinguished from green-by-construction.

The first item picked for this loop (#31) was chosen for being "small and clearly provable". It was
clearly provable because it was **already shipped** — the issue body quoted code that main no longer
contained. A peer review checked main rather than the issue text and refused the pick. Dispatching it
would have been a loop congratulating itself.

**Before dispatching any issue: read the current code, not the issue text.** Then commit a failing
test that describes the missing behaviour. After the run, confirm the diff did not touch it.

## The recurring failure class: pieces built, left unconnected

Hit three times in one session, in code written that same day:

| Built | Not connected to |
|---|---|
| `merge-kill` (exits 2 correctly) | anything — nothing called it |
| contract report (`proofsOk`, path recorded) | `integrate`, which passed `contract: null` and refused a slice whose proofs all passed |
| `DONE_WHEN_RULE_VOCABULARY` ("single source of truth") | the evaluator, which dispatched on its own if-chain |

Building the mechanism feels like completing the work; wiring it is a separate act that nothing
prompts. **When a mechanism lands, the next question is "what calls it?" — and if the answer is
"nothing yet", it is not done.** An unwired gate is documentation.

## Refactor with a peer, and expect the refactor step to find the bug you just wrote

Red → green → refactor, with a second agent attacking the design. Two rounds where the third step
paid:

- A `handoffs:all-done` rule was matched exactly rather than by prefix, so a validator added minutes
  earlier rejected a legitimate contract. All tests were green; only a correspondence test found it.
- The "obvious" cleanup — sharing a constant across a module boundary — was **wrong**, and the
  boundary I invoked to justify keeping the duplication **did not exist**: the same file already
  imported that package by relative path, three lines above my edit.

Bring the peer a concrete design and ask it to attack, rather than asking an open question. Then
verify its claims against the tree: in one session it was right about structure and wrong about
mechanism three separate times.

## The meta-pattern to watch for

Every serious error in this session had one shape: **assert a constraint, do not test it, build on
it.** `--cwd` isolates writes. The deny is a boundary. Disk costs 1.3 GB per worktree. `tools/`
cannot import agent-loop. The vocabulary has two copies. Each was refuted in under a minute once
tested, and each had already shaped work built on top of it.

When you notice yourself constructing an argument about what will happen — run it instead.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.
