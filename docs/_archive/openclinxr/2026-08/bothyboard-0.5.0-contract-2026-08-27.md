---
id: BOTHY_0_5_0_CONTRACT
audience: bothy-board-dev-agent + openclinxr-orchestrator
from: simnova/bothy-board 54c918c (copied verbatim intent; live serverInfo must be 0.5.0)
date: 2026-08-27
---

# SOURCE (BothyBoard agent, 54c918c)

Do not treat as real until live `serverInfo.version === "0.5.0"`. Do not rank GitHub on a 0.4.x next shape.

## tasks.next

```
tasks.next { machineName, cacheToken }
→ { task, spawnCommand, grokSessionId, cacheToken, unchanged }
```

- `{ task: null }` and `{ unchanged: true }` are success.
- Run `spawnCommand`. Do not invent `grok -p`. Session mint is inside `next` when the card has no `grokSessionId`.
- Persist `cacheToken`. Same hop, unchanged ready set → no payload (client replays last snapshot).
- Next **skips** Planted cards whose `write_roots` overlap in-flight work (prefix match). N-cap is still a count; disjoint roots are factory N=2. Claim CAS stays.

## Steer

Mid-run is **only** `mailbox.poll` / `mailbox.post`. `tasks.comment` is audit. GitHub issue comments are not a substitute.

## Claim / worktree

Claim requires `machineName`. `worktrees.register` must match that machine and the claimed path. Register is after spawn (spawn creates the checkout). Exclusive machine + roots at claim kills two-workers-one-tree.

## Priority / proofs / import

- Priority int; create/update accept `"P0"`/`"P1"`/`"P2"` (P0=0=highest). No parse from titles.
- `proofs.set { proofsOk, headSha, reportPath, reportSha256 }`. Path without 64-char hex refused. Attestation. No exec `run:`/`exists:`.
- `tasks.import { projectId, cards[] }` cap 200. Idle, fail-closed per card, no auto-plant. Owner/`factory:plant`. Dual-queue until OpenClinXR selector commit.

## Human

`/board` Idle/Planted/Claimed/Review/Land. Public `/p/$id` if project public. No grade PNG blob this slice.

## Cutover 1–6

1. next = Planted + ready + deps done + not parent + non-overlapping roots
2. `## factory_step:` underscore
3. clothing/instrument requiredWhen refuse-closed at create
4. Worker PAT cannot plant/land/fields.set/applyTemplate/import/delete
5. Owner write 90/min; cancel is a write
6. `proofs.set` needs review + factory:land + serial integrate + reportSha256 if path

After 0.5.0 live: one tick `machineName` + stored `cacheToken`, confirm `spawnCommand`, dual-root skip, 10-write plant/cancel without 5-minute 429. Then selector. Ping only on fail.
