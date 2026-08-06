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

Each arrow fails closed. A worker's report is never an input. Verified, per arrow:

| Arrow | Fails closed because | Evidence |
|---|---|---|
| issue → brief | no `## done_when`, prose rules, or narrative-only rules are refused | 17/17 live board refused |
| brief → dispatch | a worktree-bound dispatch with no machine-checkable tree proof is refused before a worktree is created | refused its own author mid-session |
| dispatch → contract | proofs are re-run by the ORCHESTRATOR after the worker exits; an unsatisfied proof throws `ContractProofsFailedError` | probed with a proof the worker could not satisfy |
| contract → integrate | `merge-kill` runs first; a kill, a failing contract, or a `null` contract refuses with no tree change | refused a real slice whose contract was not loaded |

## An issue is not dispatchable until someone decides what would prove it done

Board → brief is mostly about REFUSING. Run against the live board: **17 of 17 open issues refused**,
all for "no `## done_when`". The wiring took twenty minutes; the board was the blocker. Issues hold
work written for a human reader.

> This figure was first written as "15 of 15" — a count taken from output piped through `tail -15`,
> so only fifteen lines were ever visible. The ratio was right and the number was wrong, by exactly
> the mechanism this file warns about at the end: asserting from partial evidence without checking.
> Corrected after re-running the scan without truncation.

`## done_when` must contain machine-checkable rules (`run:`, `changed:`, `exists:`, `min-bytes:`) and
at least one must inspect the TREE. Narrative rules (`handoff:`, `skeptic:`) read the worker's own
handoff JSON — its account of itself — which is what the contract exists not to trust.

**Never invent a `done_when` to make a dispatch possible.** Synthesising plausible proofs from a
title makes the contract layer decorative: a worker judged against criteria nobody chose, which is
worse than no contract because it looks like one. Deciding what would prove an item done is the
orchestrator's judgment and cannot be delegated to the pipeline.

## Every iteration must either land work or make work landable

A loop that only consumes ready work stalls the moment the ready queue empties. The first
autonomous schedule written for this pipeline had exactly that shape: dispatch anything with a
`## done_when`, otherwise fall back to a hardcoded two-item list. With 17 board items and none
dispatchable, it would have drained its static list and then gone quiet forever, while the board
stayed exactly as un-runnable as it started.

**Each cycle does one of:**

| | When | What |
|---|---|---|
| **A. Dispatch** | something is dispatchable | run it through the loop and land it |
| **B. Operationalize** | nothing is dispatchable | convert ONE item: read the code, commit a RED, write its `done_when` |
| **C. Stop** | board empty and green | say so in one line; do not invent work |

B is what keeps the loop alive, and it is the step that carries the judgment: deciding what would
prove an item done. Two rules on it, both learned the expensive way:

- **Read the current code, not the issue text.** An item picked for being "small and clearly
  provable" turned out to be clearly provable because it had already shipped. If an item is already
  done, closing it with evidence still counts as the cycle's work.
- **Never invent proofs to make an item dispatchable.** If you cannot state what would prove it, say
  so on the issue and pick another. A worker judged against criteria nobody chose is worse than an
  un-dispatchable issue, because it looks like a contract.

### The operationalize step requires a peer round

Do not write a `done_when` solo. Every task-definition error in the session that produced this file
was caught by the peer, not by the author:

| Error | Caught by |
|---|---|
| Picked an item for being "small and clearly provable" — it was already shipped, so a green would have been by construction | peer read main rather than the issue text |
| Chose a refactor target because 840 lines exceeded a 500 budget — `tools/` is outside the ratchet, so the budget did not apply | peer checked which roots the scan walks |
| Ranked installing a gate last because it was "high friction, not a boundary" | peer: friction that is never installed is zero friction |

Note what these have in common: none is a coding error. They are errors about WHICH WORK TO DO and
WHAT WOULD COUNT AS DONE — the judgment the pipeline cannot check, because no artifact exists yet to
check against.

The shape that works: bring a **concrete proposal to attack**, not an open question. Ask specifically
whether the item is already done, whether it is the right item, and whether the rules are vacuous —
would a trivial pass satisfy them? Then **verify the peer's claims against the tree**: in one session
it was right about structure and wrong about mechanism three separate times, and each wrong claim was
still useful because it pointed at something worth measuring.

Two agents that fail the same way do not check each other; they agree. The peer round earns its place
by being *cheap to falsify*, not by being right.

### One closed, one opened — sourced from discovery, never invented

Close an item, open one drawn from what that work actually revealed. Otherwise the queue drains and
the loop goes quiet with plenty left to do — every slice in this project has surfaced real follow-on
work, and it was captured by hand or lost.

Legitimate sources, in order of preference:

1. **The slice's own NOT TESTED line** — the residual you deliberately did not cover. This is why
   proofs are required to end with one.
2. **Something the peer round flagged** as real but out of scope for that slice.
3. **A mechanism that landed with nothing calling it.** Ask "what calls this?" — if the answer is
   "nothing yet", that is a genuine item. This class has recurred four times.
4. **A gate that fired and exposed a CLASS** of problem rather than a single instance.

**Do not manufacture an item to keep the count up.** If the work genuinely revealed nothing, say so
on the closed issue and let the queue get shorter. An honest empty queue is a signal worth having;
makework is the anti-toil failure this repo already has rules against, and a loop that invents work
to look busy is worse than one that stops.

The new item enters **un-operationalized** — no `done_when`. It earns its rules in a later cycle,
through the peer round, once someone has decided what would prove it done.

**Verify the discovery against the tree before filing it.** This is the one arrow in the loop with no
built-in check: operationalize has the peer round, dispatch has proofs, replenish had nothing. The
item opened after #25 first claimed two symbols had no callers; both were wired, and the grep behind
the claim had walked a single directory rather than the tree. Scope discovery greps to `apps packages
tools`, and confirm a "nothing calls this" claim by finding the callers rather than by failing to.

An unverified item is worse than no item: it is dispatchable-looking, so a later cycle may spend a
worker on a premise nobody checked. The finding survived the correction here and came back sharper —
which is the usual outcome, and not a reason to skip the step.

## Two lanes per cycle, and substrate is not a lane

Operator direction, 2026-08-06, after a stretch that landed five product slices and roughly six
substrate ones. Run two lanes with DISJOINT write scopes so both workers dispatch concurrently:

| Lane | Scope |
|---|---|
| **A — learner-facing / XR** | `apps/ui-xr`, conversation tooling, asset pipeline, scene + actor runtime |
| **B — product API / admin** | `apps/api`, `apps/ui-admin`, `packages/openclinxr` domain / review / scenario |
| **C — cagematch** | unproven tech, bake-off first: voice, lip-sync, garments, environment generation |

### Lane C has a different contract, and forcing it into lane A/B's shape breaks it

A cagematch asks a question nobody knows the answer to. Its deliverable is a DECISION WITH EVIDENCE,
not working code, so `done_when` must prove **the bake-off ran and was recorded** — never that a
candidate won. Existing machinery, use it rather than inventing more: probe scripts ship with a
`--validate-latest` companion (`package.json:131-135`), which makes the artifact machine-checkable,
plus a MADR carrying the Decision.

**A negative result closes the item.** "None of these clear the Quest budget, here is the measured
reason" is a successful cagematch — same rule as "a clean revert with a precise diagnosis is a
success." A lane C item that can only close by adopting something will produce an adoption whether
or not one is warranted.

**`--validate-latest` is necessary and NOT sufficient.** Measured: it validates the probe report's
SHAPE (`anny-skin-cagematch-probe.ts:159-170` → `validateAnnySkinCagematchProbeReport`). A bake-off
nobody really ran produces a schema-valid report and passes. That is the fabricated-`score.json`
class exactly: mechanically green, substantively empty. A lane C `done_when` therefore also needs
artifacts with CONTENT — `min-bytes:` on the rendered png/webm, not merely `exists:` — and a
`claimScope` / `notEvidenceFor` that forbids a readiness claim without naming the evidence files it
rests on.

**The failure mode lane C must not repeat.** Garment work burned four rounds and produced a
fabricated `score.json` (#17). The shape: artifacts pass every mechanical check while being invisible
to a human eye, and an agent grading its own output scored work it had not done. Where a cagematch's
verdict rests on how something LOOKS, a `done_when` made of passing scripts is exactly what the
failed rounds satisfied. Either a human looks, or the grader is not the producer. If neither is
available, the item stays un-operationalized and says so — see #46, which is blocked on its evidence
mechanism rather than on any technical question.

**Blocked on LOOKS is not blocked on everything.** #46 freezes visual garment claims; it must not
freeze garment MECHANICS — weights, deform evidence fields, traverse tags, motion probes — which are
ordinary lane A engineering with non-visual REDs. Two symmetric errors to avoid: relabelling
engineering as a cagematch to dodge the visual bar, and using the fabrication history as grounds to
do no garment work at all. There is no trustworthy fully-autonomous grader for "does this look
right"; that is a standing cost, and it means a human review slot has to be scheduled rather than
wished for.

**Substrate is overhead, not a lane — but it is a PRIORITY OVERRIDE, not a hard cap.** Default: at
most ONE lane slot, and after a stretch where substrate artifacts outnumber product landings (count
them; without a number the rule is mood) the next cycle is product across the board.

The override: **when land-path integrity is broken, substrate takes a slot immediately**, mid-product
stretch or not. Known members of that class — the land path not running its own tests (#40), a gate
wired to nothing, a test glob silently running 14 of 148 files. Rate-limiting "sharpen the saw
forever" is the point of this rule; rate-limiting "fix the saw while it is broken" would re-earn
every unconnected piece this loop has already paid for. The peer round that produced this paragraph
put it plainly: what breaks first under a hard ban is unguarded delegation on push.

**Integration is SERIAL even when lanes are parallel.** Workers are isolated by worktree; `integrate`
is not — it runs `git merge --no-ff --no-commit` then `git commit` directly on main with no lease
(`integrate.ts:114-126`). Two integrates at once contend on the index. Dispatch concurrently, verify
concurrently, land ONE AT A TIME. The second land recomputes its own kill report against the main the
first one produced, which is what the gate's tree-hash freshness check exists to force.

Two lanes per cycle is the working default, not three — a cagematch is the most expensive kind of
slice and the least likely to land code. Run lane C when a lane A or B item is blocked on an answer
only a bake-off can give, or when a stretch has produced no new proven capability. Otherwise it
waits; unproven tech does not become urgent by sitting.

If a lane has nothing dispatchable, operationalize FOR THAT LANE rather than doubling up on the
other. Replenishment stays in-lane too — otherwise the queue drifts back toward whichever lane is
easiest to find work in, which is how the imbalance happened.

**Seams belong to neither lane, so name them explicitly.** The most valuable work in this codebase is
repeatedly the cut BETWEEN lanes — B assembles and approves an exam, A loads it for a learner, and
"the runtime never calls the API" (#43) is nobody's ticket under strict in-lane ownership. Disjoint
worktrees do not imply disjoint product ownership of a seam. Mark such an item `integration: A↔B`
with both write roots stated, and either give it one worker holding both or a pair sharing one brief.
A seam left unowned is how three landed API slices reached no learner.

Shared packages (`packages/openclinxr/scenario-runtime`, conversation policy) are libraries BOTH
lanes call, not the property of whichever lane touched them last. Contract changes there need the
consuming lane represented.

**The imbalance hides inside a healthy-looking board.** When this rule was written the board had 19
open items and not one dispatchable XR item — the XR entries were all hardware-gated evidence. The
loop had been selecting correctly from what existed; what existed was lopsided. A lane with no items
is a signal to go read the code for that lane, not evidence that the lane is done. Doing exactly that
surfaced #43 in one pass: `apps/ui-xr` imports `scenarioBank` at build time and never calls the API,
so three landed API slices reach no learner.

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
