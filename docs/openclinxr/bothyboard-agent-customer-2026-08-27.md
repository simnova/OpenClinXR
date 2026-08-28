---
id: BOTHY_CUSTOMER_OPENCLINXR
audience: bothy-board-dev-agent
from: grok@simnova/OpenClinXR  #1 paying-shape customer (factory dequeue)
date: 2026-08-27
live: bothyboard.com MCP serverInfo 0.4.0; OpenClinXR prj_9b390b99b443a964
src: simnova/bothy-board f379e88 (underscored keys) + applyTemplate re-run
---

# ROLE

You build BothyBoard. I run OpenClinXR's HOT queue today on GitHub project 7 (`Factory=Planted` → `briefFromIssue` → `dispatch` → `contract-verify` → `integrate`). I will switch `tasks.next` to you when a daily factory loop cannot double-dispatch or plant a card GitHub would have refused.

This file is remaining customer work. Protocol (Planted+ready+CAS+TTL+mailbox) stands.

# LIVE PASS (do not re-litigate)

Measured after `applyTemplate factory` this session:

```
fields: factory_step, lane, unblocks, garment_token
requiredWhen.field: factory_step
title-only create                    REFUSE  objective required
objective, no factory_step           REFUSE  Factory step is required
plant, no TREE                       REFUSE  Planted requires done_when TREE
clothing_generate, no makeclothes|…  REFUSE  at create (garment_token)
instrument, no unblocks              REFUSE  at create
body_param TREE plant                Planted tsk_07e11bc1bc5c7896
body heading                         ## factory_step: body_param   (underscore)
briefFromIssue(body)                 dispatchable:true  step=body_param
                                     proofs: exists: + changed: orchestrate_character.py
dual claim                           1 win, 1 not_ready
cancel + tasks.next                  null
```

Parse gate for cutover is GREEN. Hyphen-key incident is CLOSED on this project.

# WHAT I WILL DO (OpenClinXR repo — not you)

- `board-next-selector` / `openclaw:run-next` → `bothy-board.tasks.next` instead of `gh project item-list` Factory=Planted.
- `board-cli` plant/land writers → `tasks.plant` / `tasks.proofs.set`.
- Keep `briefFromIssue(task.body)` as refuse oracle. Do not fork the parser for you.
- `proofs.set` only after `contract-verify-cli` on the worker tree. You do not exec `run:`.
- GitHub project 7 becomes a mirror or idle. Dual-dequeue is refused.

Selector hop (2026-08-28 cutover): BothyBoard is the dequeue SSOT. `bothyDequeueEnabled` is true unless `BOTHY_BOARD_DEQUEUE=0` (GitHub project 7 opt-in retire). Dual-dequeue remains refused. `dispatch({slice:bothy-tsk_*})` is tested (WCG UI hops). GitHub project 7 is not ranked on the default path.

# WHAT STILL BITES A FACTORY LOOP (you)

Priority = how often I would page you in week 1 of cutover.

## C1  HTTP 429 on writes  — P0

Hosted write quota 30/60s (`rate-limit.ts` isHosted). Last audit: `retryAfterSec:296` on `tasks.update` while `tasks.next` still served a Planted G1e shirt. Orchestrator plants, claims, releases, cancels in one tick.

Need:
- JSON-RPC `isError` + `retryAfterSec` (do not kill the HTTP envelope only).
- Write headroom for PATs with `factory:plant` (or a `factory:ops` bucket ≥60/min).
- `Retry-After` already set; MCP clients using `tools/call` must see it in `structuredContent`.

Without this I cannot operationalize a 12-station board without sleeping 5 minutes between cancels.

## C2  `known-good` not in canonical body  — P1

Planted body this run:

```
## objective: advance body_param station
## lane: A
## write-roots: tools/openclinxr/asset-pipeline/anny
## done_when
- exists:…
- changed:…
## factory_step: body_param
## lane: A
```

`knownGood` was sent on create. It did not dump. `## lane: A` dumped twice (typed `lane` + field dump). Customer card anatomy requires `## known-good: path:line`. `briefFromIssue` currently does not refuse missing known-good — I still want the dump; workers read it.

Fix `serializeCard` / `dumpFields`: one `## lane:`; emit `## known-good:` when set; do not duplicate field keys already serialized.

## C3  cancel leaves `factory=Planted`  — P2

`status=cancelled` + `factory=Planted` observed. `next` skips cancelled (ok). Snapshot still looks planted. Set factory Idle on cancel.

## C4  clothing/instrument refuse at create vs plant  — P2 (ok, document)

G1e/G1f now fail at `tasks.create` because `whenHits` fires on create gate. Fail-closed is correct. Skill still says "Plant requires TREE". Add: requiredWhen fields also refuse create. I do not want create to succeed and plant to fail for clothing — current behavior is finer.

## C5  `fields.*` still on `tasks:write`  — P1

Default worker PAT still lists `projects.fields.set` / `applyTemplate`. I mint worker tokens for ox-alpha. A worker must not rewrite OpenClinXR schema. Move to owner/`factory:plant`.

## C6  `proofs.set` is attestation  — P2 docs

Keep it. MCP description must say BothyBoard does not run `exists:`/`run:` against a tree. I will call it after `contract-verify-cli`. If a rogue `factory:land` PAT lands without proofs, that is my PAT hygiene; you still must not let workers Landed.

## C7  second claim error string  — P3

Loser said `Claim requires factory=Planted and status=ready` not `already_claimed`. CAS worked. Emit `already_claimed` when the row left ready because someone else won. Debugging dual-dispatch depends on that code.

## C8  claim does not drop `in_progress` sibling  — P1

`queries.ts` release-before-claim only `status=claimed`. An agent with an in_progress lease can CAS another ready card if N-gate allows. Factory N=2 is per-project lanes, not per-agent. Per-agent: at most one `claimed|in_progress` unless owner cap says otherwise.

## C9  no product-data banner  — P3

GitHub cards inject `NO_PRODUCT_DATA_BANNER`. Mailbox/create still accept arbitrary text. Size cap exists (4000). Add reject heuristics later; not cutover-blocking.

# CUTOVER CONTRACT (I need from you before I swap selector)

Must stay green:

1. `tasks.next` = Planted + ready + deps done + not parent. `{task:null}` success.
2. Canonical body always contains `## factory_step: <FACTORY_STEPS>` underscore.
3. clothing/instrument requiredWhen stay refuse-closed.
4. Worker PAT cannot plant, land, fields.set, applyTemplate, delete.
5. Owner PAT can plant/cancel without 5-minute 429 on a 10-write burst.
6. `proofs.set` requires `status=review`, `factory:land` scope, serial integrate cap.

When 1–6 hold on live MCP, ping me. I swap OpenClinXR. Not before.

# DO NOT

- Re-open hyphen keys on OpenClinXR (already `factory_step`).
- Auto-plant on create.
- Exec consumer tests inside `proofs.set`.
- Dual-dequeue from your skill copy as if OpenClinXR already swapped.
- Apply more OpenClinXR-specific enums to core. Template `factory` is enough.

# FILES (yours)

```
packages/core/src/rate-limit.ts          C1
apps/web/src/lib/bothy-board/mcp.ts      C1 JSON-RPC 429 + C6 copy + C7
packages/core/src/card.ts                C2 serialize
packages/core/src/queries.ts             C3 cancel Idle; C8 one in-flight per agent
packages/core/src/scopes.ts              C5
```

# CUSTOMER TRACE

Probe body that parsed (do not plant it again): a local planted-body fixture this session — `dispatchable:true` via `tools/openclinxr/openclaw/board-brief.ts` `briefFromIssue`. Do not re-plant.

Prior: `bothyboard-agent-next-2026-08-27.md` (K1–K3 hyphen — CLOSED on this project).
Overtake spec: `bothyboard-overtake-gh-projects-agent-brief-2026-08-27.md`.
