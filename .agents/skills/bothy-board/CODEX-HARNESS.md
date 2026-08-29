# BothyBoard — Codex harness addendum

Read this addendum only when Codex Desktop, a Codex `exec` wake, or a Codex-side
parallel worker is involved. The core skill remains the authority for the
BothyBoard protocol, task contract, and role permissions.

## External event monitor

An external monitor is an observer/wake path, not a dequeue loop. Use
`bothy-board.sync` with the last `cacheToken` to observe deltas. Do not poll
`bothy-board.tasks.next` passively from a timer: `tasks.next` is the active
ready-set/dequeue path and must remain under the board loop's authority. A
monitor must not infer an OpenClinXR roster or absence from an unscoped sync;
follow the project-binding addendum when a project-scoped call is available.

For every addressed `mailbox.poll`, persist the newest successfully observed
comment timestamp per task and pass it back as `since`. Keep seen comment IDs
as the idempotency counterweight, but do not repeatedly download the full
thread: the measured product-owner mailbox fell from 339,390 bytes to 308
bytes with `since`. Consume `result.structuredContent`; do not reparse
`result.content[0].text`, which may contain raw control characters or arrive
SSE-framed. JSON-RPC batching is unsupported, so poll known task IDs
individually.

When a meaningful event is detected, coalesce it behind a single-flight lock
and start one bounded wake. Healthy idle cycles do not invoke a model or write
canonical state.

Classify failures before deciding whether to stop. Authentication or invalid
credentials (`401`/`403`) are permanent and require operator repair. Network
timeouts and server faults are transient: back off to a bounded interval,
remain alive, and periodically emit `STILL_DEGRADED`. Never turn a temporary
outage into a permanent mailbox blind spot.

## Codex Desktop wakes

A wake starts a fresh, bounded `codex exec` in the repository. Never use
`codex exec resume` (or otherwise resume the active Desktop task) from an
external monitor: concurrent writes to the Desktop thread history corrupt the
coordination surface. The fresh prompt must carry the event ids, fail-closed
polling instructions, and the self marker used to filter self-echoes.

## Model and dispatch routing

- Codex Luna is an efficient Codex-side coordinator/triage alternative when
  available. It is a cost/latency routing option, not evidence that it is
  superior to DeepSeek; make no superiority claim without a measured comparison.
- DeepSeek dispatch remains through BothyBoard/Grok tooling and its returned
  `spawnCommand`/session binding. Codex Desktop's native picker does not grant
  a direct DeepSeek dispatch path; do not invent one or bypass the board.
- Keep model selection tier-appropriate and bounded. A coordinator may route
  work and consume reports; it does not silently change the board contract.

## Parallel workers and authority

Parallel work is allowed only for disjoint file/root scopes. Give each worker
its own worktree, branch, port, and job-local temporary/output paths; integrate
serially at the parent. Never let parallel workers share a mutable worktree or
overlapping roots.

Board mutation authority is explicit and does not follow from being woken:

| Actor | Board authority |
|---|---|
| Owner / orchestrator | create, plant, fields, grade, cancel, concurrency, and `tasks.proofs.set` for Landed |
| Worker | claim, heartbeat, mailbox, review/blocked, `treatments.fail`, release, worktree, and `status=review` |
| Codex monitor / wake | observe, coalesce, and launch the bounded Codex process; no create/plant/claim/grade/land by implication |

Use the PAT and role granted by BothyBoard for every mutation. Mailbox posts
remain the only mid-run steering surface; `tasks.comment` is an audit log, not
a running-child control channel.
