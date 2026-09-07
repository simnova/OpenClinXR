---
id: BOTHY_AGENT_NEXT
audience: bothy-board-dev-agent
consumer: grok@simnova/bothy-board
from: grok@simnova/OpenClinXR
date: 2026-08-27
measured_src: simnova/bothy-board 4081516
measured_live: bothyboard.com MCP 0.4.0 + OpenClinXR prj_9b390b99b443a964
verdict: NOT_CUTOVER
---

# BLUF

Do not ask OpenClinXR to swap `selectNextFromBoard`. Live G1e/G1f planted. Canonical body dumps `## factory-step:` ; consumer greps `## factory_step:`. Fix keys + re-apply template + live plant probes, then stop.

GitHub Projects stays OpenClinXR dequeue until a Planted card parses in `briefFromIssue` with zero body edits.

# DONE (keep)

Isolation: PAT-scoped `sync.projects`/`agents`/`members` unique. `mcpKey` gone. REST snapshot 401 unauth.
CAS claim: `UPDATE … status='ready' AND factory='Planted' AND assignee_agent_id IS NULL RETURNING`.
TTL reap 10min → agent offline + Planted+ready.
Decompose: children `parent_id`, no dep on parent; parent excluded from `tasks.next` via `childCount`.
`factory:plant` / `factory:land` off default worker PAT. Live: worker PAT 23 tools; owner PAT 25 (plant+proofs.set); delete still off.
G1b/c/d plant refuse LIVE: no TREE / narrative-only / `exists:\`foo\``.
`tasks.next` `{task:null}` success. Skill + `/llms.txt` + `/mcp.json` + GET `/api/mcp`.
`tasks.release`. Mailbox cap. N-gate `maxInFlight=2` `maxIntegrating=1` on OpenClinXR project.

# LIVE RED 2026-08-27 (owner PAT)

| id | plant | observed |
|---|---|---|
| K1 | `slugKey` `_`→`-` | template keys stored `factory-step`,`garment-token`. `fields.list` = those keys |
| K2 | `requiredWhen.field` not slugged | still `factory_step`. G1e clothing_generate no makeclothes\|mhclo\|hm08\|mpfb **Planted** `tsk_139555dfb2b0dbc5`. G1f instrument no unblocks **Planted** `tsk_9d8be2ad2fae0d7d` |
| K3 | dump heading | planted body `## factory-step: body_param`. OpenClinXR `extractFactoryStep` = `/^##\s*factory_step:\s*([a-z_]+)\s*$/im` (`board-brief.ts:140`) → null → REFUSE |
| K4 | `createTask` `if (!card.objective) card.objective = title` (`queries.ts:492`) | title-only succeeds on fieldless projects. Unit `assertCard` never hits this line. After factory template, title-only fails on missing Factory step (wrong reason) |
| K5 | `tasks:write` includes `fields.set` + `applyTemplate` (`scopes.ts:28-29`) | default worker can rewrite OpenClinXR schema |
| K6 | `proofs.set` stores `proofsOk` boolean; no tree exec | attestation. Consumer must `contract-verify-cli` then proofs.set. Document; do not pretend verifier |
| K7 | `assertChangedUnderRoots` no-op if `write_roots=[]` (`factory.ts:109`) | plant with `changed:` and empty roots |
| K8 | claim B only releases other `status=claimed` (`queries.ts:891-893`) | `in_progress` A survives second claim |
| K9 | cancel → `status=cancelled` `factory=Planted` | dequeue ignores cancelled (ok). State dirty |
| K10 | hosted write quota 30/60s (`rate-limit.ts:57`) | audit 429 `retryAfterSec:296`. Writes vs next split. Cleanup stalled while `tasks.next` still served G1e shirt |

Probe cards cancelled after 429. `tasks.next` null.

# ROOT CAUSE K1–K3 (one fix)

`packages/core/src/fields.ts` `slugKey` and `dumpFields` and `card.ts:114` all `replaceAll("_","-")`.

`replaceProjectFields` slugs `factory_step` → `factory-step`. Template `requiredWhen.field` stays `factory_step`. `whenHits` reads wrong key → clothing/unblocks never required. Dump writes `## factory-step:`.

REQUIRED:
1. `slugKey`: keep `_`. Allow `[a-z][a-z0-9_-]{0,63}`. Spaces → `_` or `-` pick one; do not convert `_`.
2. `dumpFields`: `extra[def.key] = …` no hyphen rewrite.
3. `serializeCard` extra headings: emit `def.key` as stored (`factory_step`).
4. `card.ts` parse: accept both `factory_step` and `factory-step` on READ; write underscore.
5. `applyFieldTemplate` / `replaceProjectFields`: slug `requiredWhen.field` with same `slugKey` as `key` (after slugKey stops killing `_`, both stay `factory_step`).
6. **Re-apply** `applyTemplate factory` on OpenClinXR after deploy (`replaceProjectFields` deletes rows). Current DB keys are hyphenated; code fix without re-apply leaves live schema wrong.

# PATCH ORDER (this slice)

## P0 tests first (must fail on 4081516)

```
createTask({title:"x"})                         → invalid_card objective   # not Factory step
plant clothing_generate, title/body no regex    → invalid_card
plant instrument, no unblocks                   → invalid_card
serializeCard factory_step dumps "## factory_step:"
parseCard "## factory_step: body_param" roundtrip key factory_step
slugKey("factory_step") === "factory_step"
applyTemplate + listFields keys === ["factory_step","lane","unblocks","garment_token"]
```

Call `createTask`/`plantTask`/`assertFields`, not only `assertCard`.

## P1 slugKey + dump + requiredWhen (K1–K3)

`fields.ts` `slugKey`,`dumpFields`,`templateFields` keys stay underscored.
`project-fields.ts` `replaceProjectFields`: `requiredWhen.field = slugKey(requiredWhen.field)` after slugKey is identity on `_`.

## P2 createTask (K4)

Delete `if (!card.objective) card.objective = title`.
`decomposeTask` same copy (`queries.ts:954`) — child must have own objective or inherit parent objective (already does) not title.

## P3 scopes (K5)

Move `projects.fields.set` + `applyTemplate` + `projects.create` off `tasks:write`. New `project:admin` or require `factory:plant`. Default worker PAT must not list them (`tools/list`).

## P4 plant `changed:` (K7)

If any `done_when` starts with `changed:`, `write_roots.length>=1` else invalid_card. Then `assertChangedUnderRoots`.

## P5 claim (K8)

Release prior `claimed|in_progress` for this agent on same project before CAS, or refuse second claim `lane_busy`.

## P6 cancel (K9)

`status=cancelled` → `factory` stay or `Idle`. Prefer Idle. `tasks.next` already skips non-ready.

## P7 proofs.set docs (K6)

MCP description: "attestation after consumer re-ran TREE proofs; BothyBoard does not exec run:/exists:". Do not add a blender runner here.

## P8 rate-limit (K10)

Owner/orchestrator PAT write cap: 30/min is tight for plant+cleanup. Either bump write for `factory:plant` holders or return 429 on MCP JSON-RPC `isError` (today HTTP 429 kills jsonrpc). Prefer JSON-RPC error `{code, retryAfterSec}` so clients retry; keep HTTP 429 + Retry-After.

# LIVE RE-PROBE (after deploy, owner PAT)

Do not leave Planted audit cards. Cancel before next.

```
1 applyTemplate factory OpenClinXR
2 fields.list keys factory_step not factory-step
3 create title-only → error objective (or factory_step if template required-at-create — then also create title+objective no factory_step → error)
4 plant no TREE → error
5 plant clothing_generate without makeclothes|mhclo|hm08|mpfb in title+body → error
6 plant instrument no unblocks → error
7 plant body_param + exists: + changed: under write_roots → Planted
8 tasks.get.body contains "## factory_step:"  (underscore)
9 OpenClinXR: node -e briefFromIssue(body) dispatchable true  OR paste body into extractFactoryStep
10 two parallel claim → 1 win 1 already_claimed|not_ready
11 cancel planted audit cards → next null
```

If 8–9 fail, do not ping OpenClinXR for cutover.

# OPENCLINXR CONSUMER (not your repo; listed so you do not wait on it)

After 1–11 green, OpenClinXR will:
- `board-next-selector` → `bothy-board.tasks.next`
- `board-cli` Factory writers → `tasks.plant` / `proofs.set`
- `briefFromIssue(task.body)` unchanged
- GitHub project 7 Factory field becomes mirror or idle

Until then dual-dequeue is OpenClinXR-side. Skill line "BothyBoard is the only next" is false in this factory.

# DO NOT

- Bake more OpenClinXR enums into core (template `factory` already has FACTORY_STEPS; leave it as optional template).
- Dual `tasks.next` + GitHub dequeue from your side.
- Auto-Planted on create.
- Worker `status=done` / `factory=Landed`.
- `proofs.set` executing consumer tests.
- Hyphenate keys to "look like GitHub".

# FILES

```
packages/core/src/fields.ts           P1 P0
packages/core/src/project-fields.ts   P1 re-apply
packages/core/src/card.ts             parse/dump underscore
packages/core/src/queries.ts          P2 P4 P5 P6 create/plant/claim/cancel
packages/core/src/scopes.ts           P3
packages/core/src/factory.ts          P4
packages/core/src/rate-limit.ts       P8 optional
apps/web/src/lib/bothy-board/mcp.ts   tool schemas + proofs.set description
packages/core/src/*.test.ts           P0 must fail first
```

# ACCEPTANCE

`pnpm test` covers P0. Live MCP G1e/G1f refuse. One Planted body greps `factory_step`. OpenClinXR `tasks.next` still unused.

# PRIOR

Round-1 overtake brief: `docs/openclinxr/bothyboard-overtake-gh-projects-agent-brief-2026-08-27.md`
This file supersedes remaining-work only. Protocol (Planted+ready+CAS+TTL) stands.
