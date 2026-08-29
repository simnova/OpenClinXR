# BothyBoard — OpenClinXR project binding

Repo-local addendum to `SKILL.md`. That file is vendored VERBATIM from upstream and must not
be hand-edited (see `PROVENANCE.md`); anything specific to this repo lives here.

## The one rule

**Every BothyBoard call that accepts `projectId` MUST pass it, and the value is:**

```
prj_9b390b99b443a964     OpenClinXR      <- ours
prj_00cce0fc9b89992e     Harbor          northline/harbor, NOT ours
prj_54713dade1ecd1fc     BothyBoard      the board's own repo, NOT ours
```

## Why — measured 2026-08-29, not assumed

`bothy-board.sync` with no `projectId` does **not** error and does **not** return everything
scoped. It silently returns Harbor:

```
sync {}                 -> project: Harbor (prj_00cce0fc9b89992e)
                           tasks: OpenClinXR 98, Harbor 17, BothyBoard 4
```

So an unscoped call hands you a mixed task list under a foreign project header. Nothing about
the response says you asked the wrong question.

**This cost a published wrong root cause.** Two Harbor cards — `tsk_79c85630080ca916`
(`conflict`) and `tsk_a1ec2c4cf3c8bac2` (`waiting`), both `status: blocked` since 2026-08-27 —
appeared in an unscoped read while `tasks.proofs.set` was refusing with `lane_busy`. They were
posted to three mailboxes as a two-day cross-project integrate stall. They were not the lock.
The real cause was ordinary serial contention: three `proofs.set` calls fired back to back
while one OpenClinXR card was mid-integrate. The Harbor cards still read `conflict` and
`waiting` today and the lane cleared anyway.

The lesson is not "check the project field once". It is that **a foreign card can look like an
explanation**, and an unscoped read is what puts it in front of you.

## What is and is not scoped

| call | scoping |
|---|---|
| `sync` | takes `projectId`. **Omitting it silently selects Harbor.** Always pass it. |
| `tasks.next` | takes `machineName`, NOT `projectId`. Verify `task.projectId` on the result before acting. |
| `tasks.get` / `tasks.comment` / `mailbox.*` / `tasks.claim` | addressed by `taskId`, so inherently scoped — but a `taskId` copied from an unscoped `sync` may be foreign. |
| `projects.list` | returns all three. Use it to re-derive the id rather than trusting a remembered one. |

## Checks before acting on any card

1. `task.projectId === "prj_9b390b99b443a964"`. If it is not, it is not our work.
2. `writeRoots` name paths that exist in this repo. Harbor cards name `northline/harbor` paths.
3. Before naming a card as a CAUSE of anything, check its `projectId` and its `updatedAt`. A
   card last touched days ago in another project is not explaining today's refusal.

## Do not act on another project's cards

Harbor and BothyBoard cards belong to other teams. Do not claim, comment on, resolve, or
"unblock" them, even when they appear to be holding something of ours. Report and let the
owning team act. Clearing someone else's blocked integrate to unstick our own queue is the
class of unilateral fix this repo has already paid for.

## Verify the binding cheaply

```sh
curl -s -X POST https://bothyboard.com/api/mcp \
  -H "Authorization: Bearer $BOTHY_BOARD_PAT" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"bothy-board.projects.list","arguments":{}}}'
```

The PAT reaches all three projects with `role: owner`, so scoping is entirely the caller's
responsibility. There is no permission boundary that will stop a cross-project read.

## Where the id lives, and where it does NOT

Measured, after I asserted the wrong thing here and corrected it: **no executable file in
this repo carries `prj_9b390b99b443a964`.** It appears only in three dated briefs under
`docs/openclinxr/bothyboard-*-2026-08-27.md` and in this file.

`tools/openclinxr/openclaw/board-bothy-dequeue.ts` — the repo's own dequeue — calls
`tasks.next` with `{ machineName, cacheToken }` and **no project scoping at all**
(`:180-187`). It relies on `tasks.next` being machine-scoped rather than project-scoped. That
is fine for the dequeue, because a task it returns carries its own `projectId`, but it means
nothing in code pins us to OpenClinXR.

So the binding is carried by callers, one call at a time, and this document is the only
place stating it. If the id ever changes, grep the docs above and update this file; there is
no constant to edit.

**A caller writing a new `sync` has nothing to copy from.** That is the gap that makes the
Harbor default dangerous, and it is why this section exists rather than a pointer to a
constant.
