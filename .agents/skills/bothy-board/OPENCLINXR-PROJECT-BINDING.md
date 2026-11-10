# BothyBoard — OpenClinXR project binding

Repo-local addendum to `SKILL.md`. That file is vendored from upstream with one local amendment
(see `PROVENANCE.md`) and must not be hand-edited; anything specific to this repo lives here.

## Project ids

```
prj_9b390b99b443a964     OpenClinXR      <- ours
prj_00cce0fc9b89992e     Harbor          northline/harbor, NOT ours
prj_54713dade1ecd1fc     BothyBoard      the board's own repo, NOT ours
```

Pass `projectId: prj_9b390b99b443a964` on every call that accepts it (`sync`, `tasks.next`),
as upstream `SKILL.md` § Scope now requires.

## Scoping — measured 2026-11-09 (supersedes the 2026-08-29 sections)

The repo PAT (`BOTHY_BOARD_PAT`, loaded by mise from the repo `.env.local`) is now a
single-project token. `projects.list` returns one row:
`{id: prj_9b390b99b443a964, name: OpenClinXR, role: owner}`.

Three `sync` calls through `board-bothy-dequeue.ts` `bothyMcpCall`, one request each:

| call | HTTP | bytes | result |
|---|---:|---:|---|
| `sync {projectId: OpenClinXR}` | 200 | 4,560,812 | `scoped:true`, project OpenClinXR, 1,468 tasks all `prj_9b390b99b443a964`, `cacheToken bb-r16055-e3297d40` |
| same + that `cacheToken` | 200 | 83 | `{unchanged:true, scoped:true, revision:16055}` |
| `sync {}` (no `projectId`, no token) | 200 | 4,560,812 | `scoped:true`, project OpenClinXR, same payload |

So with this PAT an unscoped `sync` returns OpenClinXR, matching upstream's "a single-project
PAT is already scoped". The `{scoped:false, tasks:[]}` reply upstream describes applies only to a
multi-project PAT and was not observed here. A cacheToken minted by a scoped call also answered
an unscoped call with the same `unchanged` reply.

Retired by this measurement:

- 2026-08-29 "`sync` ignores `projectId`": three project ids returned one Harbor payload. That
  PAT reached all three projects. The current token reaches one, and `sync` reports
  `scoped:true` with `projectId` echoed.
- 2026-08-29 "unscoped `sync` silently returns Harbor" (98 OpenClinXR, 17 Harbor, 4 BothyBoard
  tasks under a Harbor header). Not reproducible with this PAT.

The lesson from those incidents still holds for any multi-project token: a foreign card can
look like an explanation. Two Harbor cards (`tsk_79c85630080ca916`, `tsk_a1ec2c4cf3c8bac2`) were
posted to three mailboxes as the cause of a `lane_busy` refusal they did not cause, and a Harbor
roster was read as ours ("Codex orchestrator not heartbeating"; `agt_d85152e0024f10cd` was).
If a PAT ever reaches more than one project again, re-run the three calls above before trusting
any roster, count, or absence derived from `sync`.

## Checks before acting on any card

1. `task.projectId === "prj_9b390b99b443a964"`. If it is not, it is not our work.
2. `writeRoots` name paths that exist in this repo. Harbor cards name `northline/harbor` paths.
3. Before naming a card as a CAUSE of anything, check its `projectId` and its `updatedAt`. A
   card last touched days ago in another project is not explaining today's refusal.

## Do not act on another project's cards

Harbor and BothyBoard cards belong to other teams. Do not claim, comment on, resolve, or
"unblock" them, even when they appear to be holding something of ours. Report and let the
owning team act.

## Verify the binding cheaply

`projects.list` is a few hundred bytes; `sync` without a cacheToken is 4.5 MB.

```sh
curl -s -X POST https://bothyboard.com/api/mcp \
  -H "Authorization: Bearer $BOTHY_BOARD_PAT" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"bothy-board_projects_list","arguments":{}}}'
```

More than one row means the token is multi-project and every `sync`/`tasks.next` must carry
`projectId`.

## Create-only fields — get them right at create

Moved here from `SKILL.md` on 2026-11-09; upstream does not carry it.

`done_when`, `writeRoots` and `depIds` are **create-only**, and not merely frozen after Planted.
Measured 2026-09-10 on a `backlog`/`Idle` card: `tasks.update` with a `doneWhen` array accepted the
call, returned success, and left `doneWhen: []`. Five cards were created without proofs, could
never be planted, and had to be cancelled and recreated.

- Pass `done_when`, `writeRoots` and `depIds` in the `tasks.create` call.
- Read the card back after create and confirm the field is populated. A success response is not
  evidence the field was written.
- A card already created without them is corrected by a NEW card that supersedes it, then cancelling
  the original. Do not try to edit it.

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

Upstream `SKILL.md` now lists `tasks.next` as `{ projectId, machineName, cacheToken }`. The
dequeue still omits `projectId`; with the current single-project PAT that is harmless, with a
multi-project PAT it would get the unscoped reply.

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
| `sync` (2026-11-09, scoped) | 4,560,812 B | **83 B** with `cacheToken` | 54950x |
| `mailbox.poll` | 339,390 B | **308 B** with `since` | 1101x |
| `tasks.get` | 6,747 B | 6,747 B | already targeted |

`sync` returns its own next token as `cacheToken: "bb-r<revision>-<hash>"`. Pass it back and an
unchanged board answers `{"unchanged":true,"cacheToken":…,"revision":…}` and nothing else — the
revision is embedded in the token, so a change is detectable from the string alone.

`mailbox.poll` takes `since` (ISO-8601). Without it you pull the entire thread; the coordination
card was 111 messages at 339 KB when the useful content was the last one.

**JSON-RPC batching is NOT supported.** An array of three `tasks.get` calls returns
`-32601 unknown method` (measured 2026-08-29; upstream `SKILL.md` now names `-32600`), so a per-id
loop is the only available shape. For mailbox reads, `mailbox.poll` accepts `taskIds` (max 16) with
`sinceByTaskId`, which replaces the loop.

### The actual lesson, which is not about bytes

Both parameters were already documented in the vendored `SKILL.md` (§ Connect cacheToken, § Worker since),
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

## Machine-to-machine messaging — added 2026-11-10

Each machine has one inbox card and every machine shares one broadcast card. Both are `kind: channel`,
Idle, never planted, so `tasks.next` never returns them. Ids live in
`tools/openclinxr/openclaw/machine-inboxes.json`. The machine name is `BOTHY_MACHINE_NAME`, else the
hostname without `.local`.

| command | does |
|---|---|
| `pnpm openclaw:inbox machines` | list inboxes |
| `pnpm openclaw:inbox register` | create this machine's inbox card, read it back, write the registry (commit it) |
| `pnpm openclaw:inbox send <machine\|all> <text>` | `mailbox.post` with a `from::<machine>` first line |
| `pnpm openclaw:inbox watch [--once] [--mode monitor]` | long-poll own inbox + broadcast; log to `.openclinxr/openclaw/machine-inbox.jsonl` |
| `pnpm openclaw:inbox read [--all]` | print logged messages not yet read |

The watcher holds one `mailbox.message` subscription (`events/subscribe`, `taskIds` = own inbox +
broadcast) and polls with `waitMs: 20000`. It keeps the cursor in
`.openclinxr/openclaw/machine-inbox-state.json`, writes it only after a batch is logged, and resumes
from it after a restart. The event payload has no author name, so the `from::` line identifies the
sender and drops the watcher's own broadcasts. 401/403 exits 2 (`FAILED` in monitor mode); 5xx and
network errors back off 1 s to 30 s and stay up.

Measured 2026-11-10 on Patricks-MacBook-Pro: a post reached a held poll 1,110 ms after the send
started; an empty hold returned after 8,110 ms for `waitMs: 8000` with `nextPollMs: 0`.

The poll cursor is inclusive. Polling with cursor C re-returns the event at C at once, with the same
cursor and `nextPollMs: 0` (measured 2026-11-10; the first watcher logged one message 165 times in
about 20 s and drew a 429). Once any message exists, the hold therefore never waits. The watcher keeps
the event ids seen at its cursor in `seenEventIds`, drops them, and waits 5 s after a page of only
seen events. Delivery latency is up to about 5 s until the server cursor is exclusive; a live send
arrived in 3 s and was logged once.

Wakes per harness: Grok arms `monitor(command = "pnpm openclaw:inbox watch --mode monitor", persistent = true)`
and runs `read` on `DONE`; Claude runs `watch` under the `Monitor` tool, one notification per message
line; Codex starts one `codex exec` per batch, as in `CODEX-HARNESS.md`.
