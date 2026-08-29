# BothyBoard — OpenClinXR project binding

Repo-local addendum to `SKILL.md`. That file is vendored VERBATIM from upstream and must not
be hand-edited (see `PROVENANCE.md`); anything specific to this repo lives here.

## CORRECTED 2026-08-29 — `sync` IGNORES `projectId`. Passing it does nothing.

The rule below said an unscoped `sync` silently returns Harbor, and told you to always pass
`projectId`. The first half is right and **the remedy does not work**. Measured with three requests
differing only in that argument:

```
sync {projectId: prj_9b390b99b443a964}  (OpenClinXR)  -> sha256 4700a0bc1abb964e
sync {projectId: prj_00cce0fc9b89992e}  (Harbor)      -> sha256 4700a0bc1abb964e
sync {projectId: prj_54713dade1ecd1fc}  (BothyBoard)  -> sha256 4700a0bc1abb964e
```

Byte-identical, and all three report `"project":{"id":"prj_00cce0fc9b89992e"}` — Harbor. The
argument is accepted and discarded.

**So `sync` cannot be scoped at all, and no amount of caller discipline fixes it.** Anything derived
from a `sync` payload is a Harbor answer wearing whatever label you asked for.

**Cost, same day:** I enumerated agents from a `sync` I believed was OpenClinXR-scoped, reported
"31 agents, none registered as openai or codex", and concluded the Codex orchestrator was not
heartbeating. It was; `agt_d85152e0024f10cd` is registered and posting. I had read Harbor's roster
and drawn a conclusion about ours. The operator supplied the id I could not find.

**Until this is fixed board-side, do not derive any roster, count, or absence claim from `sync`.**
Use `tasks.get` on a known id, or `mailbox.poll` on a known task, both of which are addressed by id
and therefore genuinely scoped. **An ABSENCE claim from `sync` is worthless** — you cannot tell a
thing that is missing from a thing that is in another project's payload.

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

## Card schema — the three things that are NOT guessable

Measured 2026-08-29 after four rejected `tasks.create` calls in one sitting. None of this is in the
tool's `inputSchema`; it is enforced server-side and discoverable only by reading a card that
already exists.

**1. `factory_step` is a closed enum and it is not in the schema.** The nine values in use:

```
body_param  clothing_consume  dialogue_runtime  equipment_generate
instrument  lip_sync  motion_retarget  room_generate  staging
```

`review_gate` was rejected as "Factory step is not a valid option." Derive the live set rather than
trusting this list — it is a snapshot, not a constant:

```sh
# sync scoped to the project, then collect distinct fields.factory_step values
```

**2. `factory_step: instrument` REQUIRES `unblocks`, and `unblocks` is itself a factory_step value.**
Not prose. An instrument card must name which production step it unblocks, which is what stops
instrument cards from being unbounded evidence work. `"Unblocks is required."` is the refusal.

**3. `unblocks`, `lane` and `factory_step` live inside `fields`, not at the top level.** Passing
`unblocks` as a sibling of `title` is silently ignored and the card is refused as if it were absent.
`writeRoots`, `doneWhen`, `knownGood`, `outOfScope`, `notTested` and `depIds` ARE top-level.

The general shape, and it has now cost cards twice: **a rejected create tells you a field is wrong,
never where the field belongs.** Fetch an existing card of the same `factory_step` and read its key
layout before re-sending. One `sync` answers all three questions at once.

## Payload cost — measured 2026-08-29, and both fixes were already in SKILL.md

| call | naive | correct | ratio |
|---|---:|---:|---:|
| `sync` | 310,977 B | **248 B** with `cacheToken` | 1254x |
| `mailbox.poll` | 339,390 B | **308 B** with `since` | 1101x |
| `tasks.get` | 6,747 B | 6,747 B | already targeted |

`sync` returns its own next token as `cacheToken: "bb-r<revision>-<hash>"`. Pass it back and an
unchanged board answers `{"unchanged":true,"cacheToken":…,"revision":…}` and nothing else — the
revision is embedded in the token, so a change is detectable from the string alone.

`mailbox.poll` takes `since` (ISO-8601). Without it you pull the entire thread; the coordination
card was 111 messages at 339 KB when the useful content was the last one.

**JSON-RPC batching is NOT supported.** An array of three `tasks.get` calls returns
`-32601 unknown method`, so a per-id loop is the only available shape. Keep the loop; make each call
targeted.

### The actual lesson, which is not about bytes

Both parameters were already documented in the vendored `SKILL.md` (`:39` cacheToken, `:69` since),
and `tools/openclinxr/openclaw/board-bothy-dequeue.ts` already persists `cacheToken` with a test
pinning it at `the-bothy-dequeue-does-not-fall-back-to-github.test.ts:70`. Three sources carried the
answer. None fired, because nothing forced a read, and ad-hoc `curl` against the MCP endpoint was
easier to reach for than the skill.

Adding a fourth document does not fix that — this section is reference, not the mechanism. The
mechanism is `.claude/hooks/skill-preflight.js`, which now force-loads this skill on any board-shaped
prompt, pinned by `tools/openclinxr/openclaw/the-skill-preflight-routes-board-turns.test.ts` with a
counterweight that fails if the pattern matches everything.

**If you are an agent on another harness, you do not have that hook.** Wire the equivalent on your
side rather than trusting yourself to remember: the failure mode is not ignorance, it is that a raw
HTTP call is always the shortest path from where you are standing.
