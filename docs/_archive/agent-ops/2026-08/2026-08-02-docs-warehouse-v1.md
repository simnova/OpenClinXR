# Docs warehouse v1 — revision record

**Date:** 2026-08-02  
**Slice:** `docs-warehouse-v1`  
**Reviewer:** hrbp (agent roster governance)  
**Track:** optimization only (not product authoring)  
**BOD decision:** APPROVED **Option 1** 2026-08-02 (ODS/hot vs cold warehouse + freeze process + archivist)

## Verdict

**ROSTER_HEALTHY** (process SSOT) — warehouse process + archivist role on roster path; living agent-ops SSOT stays **hot**; dated revision records freeze to **cold** `docs/_archive/**`. Implementer residual: CLI freeze + authority reclass + harness policy for archivist must complete before count **16** is claimable on live policy.

## BOD Option 1 (in force)

| Element | Contract |
|---------|----------|
| Hot ODS | Living SSOT + protected 6 + TOOLING — never archive |
| Warm | REVISION-INDEX, last N checkpoints, capability-requests queue |
| Cold warehouse | `docs/_archive/**`, `.openclinxr/slice-archive/**` |
| Freeze CLI | `pnpm docs:archive` plan / freeze / status |
| Archivist | Dual-stack read-only retrieval; no hot-law rewrite |
| Authority | Living agent-ops → `current-reference`; dated + archive → `historical-synthesis` |
| Rehydrate | **Never** open `docs/_archive/**` on normal rehydrate |

## What changed (HRBP / docs)

| Artifact | Delta |
|---|---|
| `docs/agent-ops/DOC-WAREHOUSE.md` | **Present** — process SSOT (ODS tiers, never-archive, freeze, manifest, archivist) |
| `docs/agent-ops/REVISION-INDEX.md` | **Created** — warm batch catalog |
| `docs/agent-ops/PATH-SCOPE.md` | **Updated** — §docs-warehouse-v1 + roster checklist rows (archivist, rehydrate exclusion, hot stays hot) |
| `docs/agent-ops/README.md` | **Updated** — DOC-WAREHOUSE, REVISION-INDEX, archivist links |
| `docs/agent-ops/2026-08-02-docs-warehouse-v1.md` | **Created** — this revision record (may freeze on a later warehouse pass) |
| `agents/coordinator/hrbp/{charter,memory}.md` | **Updated** — warehouse process + archivist on roster |

## Implementer / archivist-role surfaces (not HRBP write of policy code)

| Surface | Expected |
|---|---|
| `tools/openclinxr/openclaw/docs-archive-cli.ts` + `pnpm docs:archive` | plan / freeze / status |
| `tools/agent-factory/build-doc-authority-registry.ts` | hot agent-ops current-reference; dated + `_archive` historical |
| First freeze `context-opt-2026-08-02` | dated `2026-08-02-*.md` → `docs/_archive/agent-ops/2026-08/` + stubs + manifest |
| `agents/coordinator/archivist/` + `role-harness-policy.ts` | dual-stack archivist; roster **16** post-sync |
| `pnpm docs:authority` / tests | reclass + freeze pure functions |

## Post-freeze verify (HRBP)

After implementer freeze, confirm:

1. **Hot still hot:** `PATH-SCOPE.md`, `CEO-VOICE.md`, `COMPOSITION-ROOTS.md`, `DOC-WAREHOUSE.md`, `REVISION-INDEX.md`, `WORKTREE-PROMOTE.md`, README, MAIN-SESSION, RACI, REVIEW-CADENCE, CAPABILITY-EVOLUTION — full living files (not stubs).
2. **Cold after freeze:** warehouse bodies under `docs/_archive/agent-ops/2026-08/`; stubs at old dated paths; `ARCHIVE-MANIFEST.json` present.
3. **This revision record** may remain hot briefly; freeze later with next warehouse batch if desired.

## Relation to prior opts

| Slice | Focus |
|---|---|
| path-scope + Waves A–C | Living PATH-SCOPE / composition / promote law |
| **docs-warehouse-v1** | Offload dated revision peers so living law stays thin |

## Not in scope

- Product `apps/**` / clinical doc warehouse
- Archiving protected 6 or living SSOT basenames
- Full evidence JSON warehouse under `docs/openclinxr/**` (later pass)

## Roster note

| State | Count | Notes |
|---|---|---|
| Pre–warehouse | **15** (architect Wave C) | — |
| **docs-warehouse-v1 target** | **16** (+ `archivist`) | charter + policy pathScope + harness sync |

## Residual

- Implementer freeze + authority reclass + tests
- Archivist dual-stack policy registration
- Parent: spawn archivist for historical digs; rehydrate excludes warehouse
