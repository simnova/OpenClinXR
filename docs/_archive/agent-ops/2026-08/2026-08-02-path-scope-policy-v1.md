# Path-scope policy v1 — revision record

**Date:** 2026-08-02  
**Slice:** `path-scope-policy-v1`  
**Reviewer:** hrbp (agent roster governance)  
**BOD decision:** Option 1 APPROVED — structured `pathScope` in `role-harness-policy.ts`

## Verdict

**ROSTER_HEALTHY** — docs, charter, and memory updated for path-scope policy. Structured `pathScope` field pending implementer.

## What changed

| Artifact | Delta |
|---|---|
| `docs/agent-ops/PATH-SCOPE.md` | **Created** — path-scope SSOT: why, source of truth (`role-harness-policy.ts` → `pathScope`), ATL parity, spawn bake, enforcement phases, HRBP review checklist |
| `docs/agent-ops/README.md` | **Updated** — linked `PATH-SCOPE.md` in governance table |
| `agents/coordinator/hrbp/charter.md` | **Updated** — added "Path scope" review dimension (writeRoots present, disjoint SoD, etc.); severity line now includes `pathScope.writeRoots overlap → critical` |
| `agents/coordinator/hrbp/memory.md` | **Appended** — lesson summarizing BOD decision, SSOT location, implementer action needed, next-roster-review scoring |

## Enforcement phases

| Phase | Status |
|---|---|
| Option 1 — prose `writeScopeNote` in charter + policy | **IN FORCE** (current) |
| Option 1+ — structured `pathScope` in `role-harness-policy.ts` | **Pending implementer** — add `pathScope: { writeRoots, forbiddenRoots, outputRoots }` to `RepoRoleHarnessPolicy` type + each policy entry; then `pnpm agent:harness:sync` |
| Option 2 — per-slice handoff audit | Deferred (after 3+ slices post-implementer) |

## Residual

- `pathScope` structured field not yet in `role-harness-policy.ts` — **sync after implementer**. Until then, `writeScopeNote` (free-text) is the precursor.
- After implementer lands: regenerate `.grok/agents/*.md` with path-scope tables via `pnpm agent:harness:sync`; update `grok-repo-agent-spawn.ts` `buildRepoAgentSpawnPrompt` to inject `pathScope` as structured bullet; next HRBP roster review scores all write-capable roles on `pathScope` presence + disjoint SoD.
