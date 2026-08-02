# Context-opt charter / agents_md v3 — revision record

**Date:** 2026-08-02  
**Slice:** `context-opt-charter-agentsmd-v3`  
**Reviewer:** hrbp (agent roster governance)  
**Track:** optimization only (not product authoring)  
**BOD decision:** Continue optimization (dual-stack path pointer + specialist agents_md slim)

## Verdict

**ROSTER_HEALTHY** — path-scope governance extended for **dual-stack charter pointers** (no glob copy), **specialist `agents_md: false` / orchestrator `agents_md: true`**, and **slim spawn rehydrate** (no full AGENTS/LEX by default). Implementer owns generator + optional charter code path; this record + PATH-SCOPE.md §v3 are governance SSOT.

## What changed (HRBP / docs)

| Artifact | Delta |
|---|---|
| `docs/agent-ops/PATH-SCOPE.md` | **Updated** — section **context-opt-charter-agentsmd-v3**: dual-stack path pointer, agents_md policy, spawn rehydrate slim, dual-stack map, implementer surfaces, parent checklist; roster-review rows + Related |
| `docs/agent-ops/README.md` | **Updated** — PATH-SCOPE scope note + revision-records row includes this file |
| `docs/agent-ops/2026-08-02-context-opt-charter-agentsmd-v3.md` | **Created** — this revision record |
| `agents/coordinator/hrbp/charter.md` | **Updated** — review dimensions: dual-stack path pointer; agents_md policy; slim spawn rehydrate under Context cost / Path scope |
| `agents/coordinator/hrbp/memory.md` | **Appended** — one-paragraph lesson on v3 |

## Contracts (v3)

| # | Contract | Enforcement surface | Policy status | Implementer status |
|---|---|---|---|---|
| 1 | OpenClaw charters **point** at pathScope SSOT — **no hand-copied** writeRoots/forbidden/outputRoots globs | `agents/**/charter.md` + optional generator path section | **IN FORCE** (SSOT) | Optional charter touch-ups / generator pointer text |
| 2 | Generated specialists **`agents_md: false`** | `generate-harness-agents.ts` → `.grok/agents/*.md` | **IN FORCE** (SSOT) | **Pending** — generator still hardcodes `agents_md: true` (line ~209); flip + `pnpm agent:harness:sync` |
| 3 | Main **orchestrator `agents_md: true`** | `.grok/agents/orchestrator.md` (hand-maintained) | **IN FORCE** | Already true in orchestrator frontmatter |
| 4 | Spawn rehydrate **slim** — PATH SCOPE + persona/charter pointers; no full AGENTS/LEX paste | `grok-repo-agent-spawn.ts` / team-spawn builders | **IN FORCE** (SSOT) | Confirm builders stay pointer-only; do not expand |

## Relation to prior opts

| Slice | Focus |
|---|---|
| `path-scope-policy-v1` | Option 1 structured pathScope + Option 2 handoff audit |
| `context-opt-higher-v1` | Worktree isolation default, sole-author locks, preferredCli, COMPOSITION-ROOTS |
| `context-opt-grok45-v2` | team-spawn PATH SCOPE bake + path constraint + isolation top-level |
| **`context-opt-charter-agentsmd-v3`** | Dual-stack charter **pointer** (not glob copy) + specialist **agents_md false** + orchestrator true + slim spawn rehydrate |

## Residual

- Implementer: set `agents_md: false` for generated specialists in `generate-harness-agents.ts`; keep orchestrator true; run `pnpm agent:harness:sync`; keep agent-loop tests green.
- Optional: add one-line pathScope SSOT pointer to OpenClaw charters that still lack it; strip any hand-maintained writeRoots tables if present.
- Parent/chief-coordinator: specialists must not be instructed to re-read full AGENTS/LEX as default rehydrate — main owns forest view.
- Next roster review: score **Dual-stack path pointer**, **agents_md policy**, **Spawn rehydrate slim** checklist rows.
- Product dequeue remains separate; this track is optimization-only.
