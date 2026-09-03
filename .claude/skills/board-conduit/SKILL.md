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

## `maxInFlight` counts `review`, so clearing a blocker can cost a lane

Measured 2026-09-03. OpenClinXR runs `maxInFlight: 2`, `maxIntegrating: 1`. A card sitting in
`review` — worker finished, awaiting attestation, nobody working — occupies one of those two slots
exactly as a `claimed` card does. Four Planted, dependency-free, ready cards were queued behind two
in-flight ones, and one of the two was a card I had moved `blocked -> review` myself after measuring
its blocker stale. The premise change was right; the throughput cost was invisible and unbudgeted.

**Before any status change that lands a card in the in-flight set, read the occupancy.** If the board
is at its cap, moving a card into `review` or `claimed` takes a lane away from work that could
actually run. Say so on the card when you do it, so the person who owns the close knows their
decision now has a cost attached.

Do not quietly flip it back to free the slot. `review` is honest when a worker has finished, and a
state that gets edited for throughput stops describing anything. Attach the cost, or close the card.

## Read `readyIds` from a project-scoped source, never bare `sync`

`bothy-board.sync` returns a MIXED-PROJECT payload whose `project` (singular) is whatever the
credential defaults to — Harbor here, not the repo you are standing in — and it accepts **no project
scope**: passing `projectId` or `project` changes nothing in the response. So a bare `sync` can hand
you `readyIds: []` while the project you care about has four ready cards.

That empty array reads exactly like a board defect, and it is not one. Join `readyIds` against
`tasks[]` filtered to your explicit `projectId`, which is what the Codex monitor already does
(`codex-bothy-event-monitor.ts` — "sync only as a mixed-project hint").

Related: `tasks.next` returning `{task: null, unchanged: true}` while `tasks.get` reports a card
`ready` is **not** an inconsistency either — it is the in-flight cap reached, reported without a
reason. Check occupancy before concluding the dequeue is broken. Two separate agents reconstructed
this the slow way before it was written down.

## A reaped claim offers a LIVE branch to the next dequeuer

Measured 2026-09-03. A card claimed at 03:29:07 was reaped at 03:52:04 — about 23 minutes — while
its worker was demonstrably alive: pid running, 32 min elapsed, transcript written five seconds
earlier, token count climbing, tool calls firing.

**The reap clears `assigneeAgentId` and nothing else.** `grokSessionId`, `branch` and `worktreePath`
all stay on the card, so it goes back to `ready` still carrying the identity of the process that is
writing to that branch right now. The next `tasks.next` will hand it out. With a 15-second monitor
poll, the window between the reap and a second worker landing on the same worktree is about fifteen
seconds.

The TTL is roughly ten minutes and **only the dispatch spawn path renews it**. Any worker started
outside that path — a hand-run `grok -p`, a resumed session — never renews, so a run longer than the
TTL is guaranteed to be reaped mid-flight. Nothing warns anybody: the worker does not learn it lost
its claim and keeps going.

**When you see a `ready` card whose `worktreePath` and `grokSessionId` are still populated, check for
a live process before letting it be dequeued.** Liveness is the process and the transcript, never a
`find` sweep over `~/.grok/sessions` — the URL-encoded session directories make those sweeps return
false negatives, which is how a live worker reads as dead.

    pgrep -f "<sessionId>"
    ls -la ~/.grok/sessions/*<slice>*/<sessionId>*/updates.jsonl

If it is alive: restore `status: "claimed"`, re-stamp `grokSessionId` / `branch` / `worktreePath`,
and put the reason in `blockedReason` so the intervention is auditable rather than quiet. **Do not
set an assignee you are not** — forging that is worse than the reap. It costs a lane, and that is the
right trade: a queued card only waits, while two workers on one branch corrupt each other.

Read the worker's own transcript before deciding it is stuck; a long run with a clean worktree is
often a model reading before it writes, and killing it discards real context.

## Dispatched workers have NO board tools — mailbox steering is inert on that path

Measured 2026-09-03 across a worker's full transcript: 67 tool_call events, and the complete distinct
set was `todo_write, list_dir, read_file, run_terminal_command, grep, write, search_replace,
web_fetch, get_command_or_subagent_output`. **Not one bothy-board call.** No `mailbox.poll`, no
`agents.heartbeat`, no `tasks.get`, no `tasks.update`.

The worker noticed before I did. From its own reasoning: *"the skill 'bothy-board' mentions BothyBoard
MCP — but MCP tools available are dra…"* It went looking and they were not in its harness.

This is structural, not one odd worker:

- The generated spawn prompt under `.openclinxr/slices/<id>/prompt-<id>.md` contains **zero** mentions
  of mailbox, bothy, heartbeat or `tasks.release`. The worker is never told to poll.
- `dispatch-worker.ts` calls `bothy-board.worktrees.register` and `bothy-board.agents.heartbeat`
  **itself**, at spawn. The PARENT registers and heartbeats, once.

Three consequences, each of which cost time before this was written down:

1. **`mailbox.post` does not reach a worker on this path.** The skill's "mid-run steer is only
   mailbox.post" is true of workers that HAVE the tools; a dispatched one does not. Steering it
   requires the harness — kill and re-dispatch with the finding baked into the prompt, or resume the
   session directly.
2. **The claim reap is guaranteed, not incidental.** The dispatcher heartbeats once at spawn and never
   again, and the child cannot heartbeat at all, so any run longer than the TTL is reaped mid-flight
   every time. Restoring `status: claimed` is the only protection and must be re-applied for as long
   as the run lasts.
3. **The worker cannot end itself cleanly.** No `tasks.release`, no `status=review`. Its only exits
   are max-turns or someone else acting — so a brief that says "release the card if you get stuck" is
   asking for something the agent cannot do.

**The trap to avoid, which I walked into twice:** a deliverable appearing shortly after you post a
steer is NOT evidence the steer landed. Check for a `mailbox.poll` in the transcript before claiming
any causal effect. I reported "the steer took" on two separate ticks about a worker that had never
read a word of it.
