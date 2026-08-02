# Context-opt Wave A enforce — revision record

**Date:** 2026-08-02  
**Slice:** `context-opt-wave-a-enforce`  
**Reviewer:** hrbp (agent roster governance)  
**Track:** optimization only (not product authoring)  
**BOD decision:** APPROVED Wave A 2026-08-02

## Verdict

**ROSTER_HEALTHY** — path-scope governance publishes a single **Enforcement matrix (Wave A)**: soft vs hard for writeRoots prompt bake, `touched[]` audit, sole-author locks, isolation=worktree, preferredCli, agents_md, CEO write roots. CEO/parent **must** forward `isolation=worktree` from team-spawn JSON to harness `spawn_subagent` (never strip). Implementer owns any remaining CLI hard-assert deltas; this record + PATH-SCOPE §Wave A are governance SSOT.

## What changed (HRBP / docs)

| Artifact | Delta |
|---|---|
| `docs/agent-ops/PATH-SCOPE.md` | **Updated** — section **Enforcement matrix (Wave A)**: soft/hard table, definitions, parent isolation MUST, relation to prior slices; roster-review rows + Related |
| `docs/agent-ops/README.md` | **Updated** — PATH-SCOPE note + revision-records row includes this file |
| `docs/agent-ops/2026-08-02-context-opt-wave-a-enforce.md` | **Created** — this revision record |
| `agents/rules/orchestrator-only-main.md` | **Updated** — isolation pass-through law bullet |
| `.grok/agents/orchestrator.md` | **Updated** — self-test + spawn discipline: never strip isolation |
| `.grok/personas/orchestrator.toml` | **Updated** — one-line isolation forward duty |
| `agents/coordinator/hrbp/memory.md` | **Appended** — Wave A enforcement-matrix lesson |

## Enforcement matrix (copy of SSOT)

| Control | Soft | Hard | Where |
|---|---|---|---|
| pathScope writeRoots in prompt | soft | — | spawn + team-spawn |
| pathScope touched[] audit | — | hard | verifySliceBrief |
| sole-author locks | — | hard | verifySliceBrief |
| isolation=worktree for writers | soft rec → | hard on team-spawn CLI assert | spawn-spec + slice-team-cli |
| preferredCli | soft | — | prompt only |
| agents_md specialists false | — | hard (generator) | generate-harness-agents |
| CEO write roots | soft discipline | — | orchestrator body |

**Standing rule:** Parent MUST pass `isolation` from team-spawn / spawn-spec JSON into `spawn_subagent`; never strip.

## Contracts (Wave A)

| # | Contract | Enforcement surface | Policy status | Implementer status |
|---|---|---|---|---|
| 1 | Soft/hard matrix published | PATH-SCOPE.md §Enforcement matrix | **IN FORCE** (SSOT) | N/A (docs) |
| 2 | `touched[]` path-scope audit hard-fails | `verifySliceBrief` / `auditHandoffsPathScope` | **IN FORCE** | Already green |
| 3 | Sole-author lock audit hard-fails | `verifySliceBrief` / `auditHandoffsSoleAuthorLocks` | **IN FORCE** | Already green |
| 4 | isolation worktree for workspace-write writers | spawn-spec soft + team-spawn CLI hard assert | **IN FORCE** (SSOT); CLI hard = Wave A target | Confirm CLI assert + tests; parent pass-through always required |
| 5 | Parent isolation forward (never strip) | orchestrator body + orchestrator-only-main + persona | **IN FORCE** | Discipline + self-test |
| 6 | specialists `agents_md: false` | `generate-harness-agents.ts` | **IN FORCE** | Generator already emits false |
| 7 | preferredCli soft only | generated agents + spawn prompt | **IN FORCE** | No hard gate by design |

## Relation to prior opts

| Slice | Focus |
|---|---|
| `path-scope-policy-v1` | Option 1 structured pathScope + Option 2 handoff audit |
| `context-opt-higher-v1` | Worktree isolation default, sole-author locks, preferredCli, COMPOSITION-ROOTS |
| `context-opt-grok45-v2` | team-spawn PATH SCOPE bake + path constraint + isolation top-level |
| `context-opt-charter-agentsmd-v3` | Dual-stack path pointer + specialist agents_md false + slim rehydrate |
| **`context-opt-wave-a-enforce`** | **Soft/hard enforcement matrix** + CEO isolation forward codified |

## Residual

- Implementer: confirm / land hard assert that team-spawn writers with `workspace-write` expose `isolation=worktree` (report + CLI); keep agent-loop tests green.
- Parent/orchestrator: always forward isolation from team-spawn JSON — bake/assert ≠ harness spawn execution.
- Next roster review: score **Enforcement matrix current** + isolation parent-pass checklist rows.
- Product dequeue remains separate; this track is optimization-only.
