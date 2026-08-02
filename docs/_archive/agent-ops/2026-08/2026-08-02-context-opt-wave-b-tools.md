# Context-opt Wave B tools — revision record

**Date:** 2026-08-02  
**Slice:** `context-opt-wave-b-tools`  
**Reviewer:** hrbp (agent roster governance)  
**Track:** optimization only (not product authoring)  
**BOD decision:** APPROVED Wave B 2026-08-02  
**B3 decision (authoritative):** **KEEP CEO write/shell tools** with CEO write-roots discipline (OCX hygiene carve-out). **Not** a tool strip.

## Verdict

**ROSTER_HEALTHY** — tool-surface hygiene SSOT published under PATH-SCOPE **§Wave B tool-surface hygiene**: soft vs hard for tools, preferredCli soft-only, image tools disallowed for non-visual roles, **B3 KEEP** CEO write+shell (vs ATL pure no-shell CEO). Implementer may later hard-encode image `disallowedTools` for non-visual specialists in the generator; governance SSOT is this record + PATH-SCOPE §Wave B.

## What changed (HRBP / docs)

| Artifact | Delta |
|---|---|
| `docs/agent-ops/PATH-SCOPE.md` | **Updated** — section **Wave B tool-surface hygiene**: soft/hard tool table, preferredCli soft, image tools non-visual vs visual, B3 KEEP standing rules, parent/HRBP checklist; roster-review rows + Related |
| `docs/agent-ops/README.md` | **Updated** — PATH-SCOPE note + revision-records row includes this file |
| `docs/agent-ops/2026-08-02-context-opt-wave-b-tools.md` | **Created** — this revision record |
| `agents/coordinator/hrbp/charter.md` | **Updated** — review dim **tool surface matches mission** |
| `agents/coordinator/hrbp/memory.md` | **Appended** — Wave B / B3 KEEP lesson |

## B3 decision detail

| Fork | Outcome |
|---|---|
| Strip CEO write + shell (ATL-style pure spawn-only CEO) | **Rejected** |
| **KEEP** `run_terminal_command` + `write` / `search_replace` on orchestrator | **APPROVED** |
| Discipline mechanism | Soft write-roots + self-test + orchestrator-only-main — not frontmatter tool removal |
| Image/video on CEO | Remain **disallowed** (already in orchestrator `disallowedTools`) |
| Research tools | `web_search` / `web_fetch` kept for BOD RESEARCH BASIS |

**Why keep:** OpenClinXR main session owns OpenClaw hygiene CLIs and coordination SSOT without requiring an IC escape hatch for every `pnpm openclaw:*` / alignment / lease / spawn-spec turn.

## Soft vs hard (tools) — copy of SSOT

| Control | Soft | Hard | Where |
|---|---|---|---|
| preferredCli | soft | — | pathScope + generated agents |
| CLI-first vs disabled MCP | soft (roster major if required) | — | TOOLING.md + Prefer/Avoid |
| CEO write roots | soft discipline | — | orchestrator body + law |
| B3 KEEP CEO write/shell | soft standing rule | — | PATH-SCOPE §Wave B |
| Image tools non-visual | soft score → | hard when `disallowedTools` encodes | orchestrator hard today; generator target |
| mcpInheritance none | — | hard | generator |
| Specialist no spawn_subagent | — | hard | generator |

## Contracts (Wave B)

| # | Contract | Enforcement surface | Policy status | Implementer status |
|---|---|---|---|---|
| 1 | Soft/hard tool matrix published | PATH-SCOPE.md §Wave B | **IN FORCE** (SSOT) | N/A (docs) |
| 2 | B3 KEEP CEO write/shell | orchestrator frontmatter + law + this record | **IN FORCE** | Do **not** strip tools as opt |
| 3 | preferredCli soft only | generated agents + spawn | **IN FORCE** | No hard gate by design |
| 4 | Image tools disallowed non-visual | roster + orchestrator already; generator optional | **IN FORCE** (SSOT); generator hard = optional residual | May add image_* to specialist `disallowedTools` for non-visual roles |
| 5 | Visual roles may use image tools for evidence | mission fit / spawn | **IN FORCE** (soft allow) | No blanket ban |
| 6 | No disabled MCP as required agent tool | Prefer/Avoid + env:doctor | **IN FORCE** | Standing CLI-first |

## Relation to prior opts

| Slice | Focus |
|---|---|
| `path-scope-policy-v1` | Option 1 structured pathScope + Option 2 handoff audit |
| `context-opt-higher-v1` | Worktree isolation default, sole-author locks, preferredCli, COMPOSITION-ROOTS |
| `context-opt-grok45-v2` | team-spawn PATH SCOPE bake + path constraint + isolation top-level |
| `context-opt-charter-agentsmd-v3` | Dual-stack path pointer + specialist agents_md false + slim rehydrate |
| `context-opt-wave-a-enforce` | Soft/hard **path** enforcement matrix + CEO isolation forward |
| **`context-opt-wave-b-tools`** | Soft/hard **tool surface** + B3 KEEP CEO tools + image non-visual |

## Residual

- Optional implementer: generator encodes `image_gen` / `image_edit` / `image_to_video` / `reference_to_video` in `disallowedTools` for non-visual specialists (orchestrator already hard).
- Do not open Wave C (ATL FE/BE RIF) unless measured thrash after A+B.
- Next roster review: score **tool surface matches mission**, preferredCli soft, image non-visual, B3 KEEP.
- Product dequeue remains separate; this track is optimization-only.
