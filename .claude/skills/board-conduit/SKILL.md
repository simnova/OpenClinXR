---
name: board-conduit
description: "Board-as-conduit protocol: GitHub project 7 cards are the owner-authored instruction SSOT consumed unaltered via briefFromIssue - card anatomy, lane definitions (A learner/XR, B API/admin), parent/child decomposition, concurrency N-gate criteria, worker staging limits (<300 turns), and the delegator/owner division of every dispatch step. Load BEFORE creating any project-7 issue/card, dispatching any worker, or changing concurrency."
when-to-use: "board card, project 7, create issue, briefFromIssue, dispatch plan, lane A, lane B, concurrency, parallel workers, factory field, planted dispatched landed graded, parent card, decompose task"
---

# Board conduit (project 7 = instruction SSOT)

Cards are authored ONLY by the product owner (ox thread). The delegator executes
them verbatim through `briefFromIssue` -> `dispatch`; no rewrite path exists.
This removes paraphrase surface to zero for instructions.

## Card anatomy (issue body; all sections required)

```
## factory_step: <enum>            # existing requirement; instrument needs unblocks:
## lane: A|B                       # A=learner/XR+assets  B=API/admin/review
## write-roots: <full consumer closure>   # grep transitive reads of entry files;
                                   # name resolver/constants/helpers main.ts reads
## objective: <one sentence>
## known-good: <in-tree reference, path:line>
## failed-treatments: <named rows with what each produced>
## done_when:
   - run:/exists:/changed: proofs on TRACKED paths only
## out-of-scope slot + expected NOT TESTED line
```

A card enters Factory=Planted only when its RED + contract are committed to main.
Dispatch order follows the parent card's child list, adjusted for lane disjointness.

## Decomposition

One parent card holds objective + prioritized child-card list. Each child carries
one proof group. Children in the same lane stay serialized; different lanes may
run concurrently after the N-gate below.

## Concurrency gate

- N=2 baseline: one lane-A + one lane-B slice, disjoint write roots.
- Measure across 3 ticks: inference_retry counts (unified.jsonl), wall-clock per
  phase, port/temp collisions (workers take distinct portless ports).
- N=3 only on zero cross-worker interference AND no retry storms.
- Integrate stays SERIAL at any N (index contention); slices >> integrate, so it
  does not bind until slice duration drops ~10x.
- Workers staged to return under ~300 turns (ox-alpha empty_response danger zone).

## Division at dispatch

OWNER: card authorship, slice selection, done-gates, grades, N-gate decisions.
DELEGATOR: `board -- next`, dispatch unchanged, mechanical tree verification,
serial integrate, captures, WAKE re-arm, TICK reports.

## Failure posture

Free-tier termination risk: test grok-4.5 fallback routing once before running
hot. Two consecutive integrate refusals => land nothing further, page owner
thread. Weekly worktree prune (~1.3 GB each). Owner-thread decay: consults kept
small; proactive re-open before ox-alpha context ceiling.
