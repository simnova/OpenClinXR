# Context-opt higher options v1 — revision record

**Date:** 2026-08-02
**Slice:** `context-opt-higher-v1`
**Reviewer:** hrbp (agent roster governance)
**BOD decision:** Continue higher options if wins evident — 6h autonomous multi-agent (deepseek) (from brief `bod`)

## Verdict

**ROSTER_HEALTHY** — governance docs updated for higher context options: worktree isolation default for writers, sole-author locks, preferredCli, composition-roots lite SSOT. Implementer work (role-harness-policy.ts / spawn-spec / tests) is tracked separately; docs reference its contracts.

## What changed

| Artifact | Delta |
|---|---|
| `docs/agent-ops/COMPOSITION-ROOTS.md` | **Created** — OCX lite composition doctrine: apps = composition hosts / runtime shells; packages = features; tools = factory/pipeline CLIs. Agent implication: route writes via pathScope writeRoots; do not dump features into apps unless the role's writeRoots allow it; SoD guard = `assertTouchedWithinWriteRoots` / `auditHandoffsPathScope`. Links PATH-SCOPE.md. |
| `docs/agent-ops/PATH-SCOPE.md` | **Updated** — new "Higher options" section: worktree isolation default for writers (spawn-spec *recommendation*; parent must pass `isolation=worktree` to harness), sole-author locks table, preferredCli; composition doctrine cross-link to COMPOSITION-ROOTS.md; Related list updated |
| `docs/agent-ops/README.md` | **Updated** — governance table links COMPOSITION-ROOTS.md, PATH-SCOPE.md higher-options scope, revision records row |
| `agents/coordinator/hrbp/memory.md` | **Appended** — lesson on higher options + isolation-is-parent-enforced nuance |

## Higher options status

| Option | Policy status | Implementer status |
|---|---|---|
| Worktree isolation default for writers | **IN FORCE** (spawn-spec recommendation: `GrokRepoAgentSpawnSpec.isolation` + `spawnSubagentCall.isolation` = `"worktree"` for workspace-write + read-write native spawns; parent passes `isolation=worktree` to harness) | IN FORCE in `grok-repo-agent-spawn.ts` (implementer) |
| Sole-author locks | **IN FORCE** (governance table in PATH-SCOPE.md; roster review scores silent overlap → critical) | Pending policy field if desired (`soleAuthorLocks` in `role-harness-policy.ts` optional) |
| preferredCli | **IN FORCE** (`pathScope.preferredCli`; baked into generated `.grok/agents/*.md` + spawn prompt) | IN FORCE (`role-harness-policy.ts` entries for chief-coordinator, asset-pipeline-lead, xr-systems-architect) |

## Residual

- `soleAuthorLocks` exists as a governance table in agent-ops; a structured policy field is optional (not required for enforcement — `writeRoots` disjointness + roster review already cover it).
- Implementer to confirm spawn-spec tests green + `pnpm agent:harness:sync` regenerated `.grok/agents/*.md` reflect isolation/preferredCli; next roster review re-scores path-scope checklist incl. higher options.
