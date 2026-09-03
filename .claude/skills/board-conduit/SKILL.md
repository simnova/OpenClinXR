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

## Mid-run steering: the dispatcher reads the BODY, never the comments

`briefFromIssue` builds its prompt from `gh issue view <n> --json number,title,body`. **Body only.**
Comments are not read, so a pre-dispatch correction posted as a comment reaches nobody and nothing
warns you — the brief still validates, because the body's `## done_when` is intact.

Measured: a careful delta naming a freeze ceiling, a gate-is-suspect line, a named renderer and a
known-good column was posted with `gh issue comment` and was invisible to the dispatcher.

**Put pre-dispatch corrections in the BODY** via `gh issue edit --body-file`, then re-read it and grep
for a distinctive phrase from the delta. Comments are for post-close records — retros, verdicts,
corrections to a landed claim — where no worker will read them.

Mid-run steer of a RUNNING worker is `mailbox.post` / `mailbox.poll` only. `tasks.comment` is an audit
log and does not reach a running child.

Incident: `§11b` in `docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md`.

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

Free-tier termination risk: test grok-4.6 fallback routing once before running
hot. Two consecutive integrate refusals => land nothing further, page owner
thread. Weekly worktree prune (~1.3 GB each). Owner-thread decay: consults kept
small; proactive re-open before ox-alpha context ceiling.

## Two ways a card is born broken, both silent, both cost a full recreate

Measured 2026-09-03, in one sitting, on two cards.

**`tasks.create` without `projectId` lands the card in the WRONG PROJECT and returns success.**
The parameter is documented as "required if the token covers more than one project" — it is not
enforced, and nothing in the returned `{id}` says which project it went to. Two cards written for
OpenClinXR were created under Harbor, planted there, and looked entirely healthy: right parent id,
right lane, right `factory_step`, `factory: Planted`, `status: ready`. They were invisible to every
`tasks.next` the actual project would run.

The parent id does not save you. A `parentId` from another project is accepted without complaint,
so the card reads as a child of a parent it cannot be dequeued alongside.

> **Pass `projectId` on every `tasks.create`, and read it back off the response before planting.**
> `projects.list` gives the ids. This costs one line and one glance.

**`tasks.update` cannot patch `doneWhen`.** It patches status, blockedReason, branch, worktree,
session ids, fields — not the contract. So a card created Idle with an empty `done_when`, intending
to add proofs once its RED exists, can never be planted; it has to be recreated with the contract in
the create call. That is not a defect in the board: a card whose contract is decided at dispatch time
is precisely what it refuses. But it means **the decision of what would prove the card done has to be
made before `tasks.create`, not after.**

Recovery for both, in order: recreate with the full contract in the create call, plant the new card,
then `tasks.update` the stray to `status: cancelled` with a `blockedReason` naming the replacement id.
Cancel is the right verb — there is no delete, and an uncancelled duplicate is dispatchable-looking.
Leave a comment on the superseded card saying which id replaced it and why, or the next reader finds
two cards with identical titles and no way to tell which is live.

## Read the audit's findings as leads, not verdicts

`pnpm exec tsx tools/openclinxr/openclaw/audit-board-graph.ts` is the fastest way to find work that
is stuck rather than hard. Two of its finding kinds need a measurement before you act on them, and
both were measured on 2026-09-03.

**`committed_red_idle` does not distinguish a LIVE red from a flipped one.** It reports that a card
is Idle while a test file it names exists in the tree. Four cards carried that finding; two of their
REDs had zero unflipped clauses, so planting them would have produced cards that were green before
any work happened — the by-construction pass this loop exists to prevent. **Count the call sites
first:**

```bash
grep -c "it\.fails(\|planted(" <the test file>     # 0 means the card is already satisfied
```

Then run the file and read the split — `N passed | M expected fail` — because a package that wraps
its plants in `planted()` will not show up under a bare `it.fails` grep in every repo layout.

**`dangling_dep` on a CANCELLED card usually means a duplicate, and the work is often already on
main.** Two cancelled cards were holding eight dependency edges across seven children; both had a
Landed twin with the same title, and every deliverable was on main — measured by running the twin's
test (0 unflipped, all passing) and confirming the write roots exist as files. Seven cards were
waiting on nothing.

Do not assume the reverse either: a cancelled dependency can also be genuinely abandoned work. The
discriminator is cheap — look for a Landed card with the same title, then verify its deliverable in
the tree rather than in the card text.

**You cannot repair the edge.** `tasks.update` does not accept `depIds`, so the audit keeps reporting
a satisfied dependency forever. Record the measurement in a comment on the parent so the next reader
can treat the finding as noise with evidence behind it, and name both ids.
