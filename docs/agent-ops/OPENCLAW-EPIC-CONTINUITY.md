# OpenClaw epic continuity (multi-hour outer loop)

**Owner:** chief-coordinator / orchestrator · **CLI:** `pnpm openclaw:epic`  
**Schema:** `openclinxr.epic-brief.v1` under `.openclinxr/epics/<id>/brief.json`  
**Active pointer:** `.openclinxr/epics/ACTIVE`

## Why

Single-slice `run-next` + chat turns false-halt multi-hour work. Epics bind **ordered slices**, **write surfaces**, **stop conditions**, and **header advancement** so the loop continues from files after compaction or session restart.

## What this kit is / is not

| Is | Is not |
|----|--------|
| Epic brief + cursor + apply Next dequeue | External OpenClaw daemon |
| Printed command sequence for orchestrator | Automatic `spawn_subagent` (host still spawns) |
| Path-scope coverage for root docs promote | Unlimited unattended force-push |
| Continuity contract for long runs | Product feature implementation |

## Epic brief (fields)

| Field | Purpose |
|-------|---------|
| `goal` / `doneWhen` | Observable completion |
| `outOfScope` | Claim + product boundaries |
| `writeSurfaces` | Path-scope audit checklist for the epic |
| `slices[]` | Ordered sliceId + goal (+ optional templateId) |
| `cursor` | Index of current slice |
| `autonomy.mayCommit` / `mayPush` | Land policy for the run |
| `stopConditions` | PAUSED, maxHours, maxEstimatedUsd, allLanesBlocked, **maxAgenticToilMinutesPerSlice** (default 60), maxExecuteRetriesPerSlice |
| Thrash rule | **>1 hour of agentic (token-burning) toil on the same slice task** → stop, handoff, escalate or pivot. Long **scripted** work (tests, builds, captures, WASM installs) that is **not** burning model tokens does **not** count toward the hour. |

## Commands

```bash
# Scaffold example epic + set ACTIVE
pnpm openclaw:epic -- init --example --epic-id pre-epic-continuity-dry-run

pnpm openclaw:epic -- status
pnpm openclaw:epic -- plan          # print next command sequence

# After slice:verify ok=true:
pnpm openclaw:epic -- advance
pnpm openclaw:epic -- apply-header  # writes PROJECT_STATUS **Next dequeue:**

# Or explicit:
pnpm openclaw:epic -- apply-header --next "wire-api-durableStore-consumer-v1 (Q4) — …"
```

## Orchestrator loop (multi-hour)

```
rehydrate PROJECT_STATUS + ACTIVE epic
→ lease
→ openclaw:epic plan
→ slice-token:start
→ team-spawn / spawn_subagent (writers: isolation=worktree)
→ promote writers
→ slice:verify
→ slice-token:finish  (Token + Cost lines)
→ epic advance (if verify ok)
→ epic apply-header
→ post-slice
→ commit if autonomy.mayCommit
→ repeat until epic completed | PAUSED | blocked | budget
```

**False-halt recovery:** do not ask “should I continue?” — rehydrate → `pnpm openclaw:epic -- plan` → run next command.

## Unattended land policy

| Action | Default |
|--------|---------|
| Commit | Only if epic `autonomy.mayCommit` **and** human epic BOD approved land **or** standing “autonomous commit” for this epic |
| Push | Only if `mayPush` + explicit BOD (this kit default `mayPush: false`) |
| Hooks red | Fix and retry; do not `OPENCLAW_SKIP_HOOKS` unless BOD emergency |
| Dirty tree | Prefer finish promote / commit mid-slice over starting parallel epic |

## Agentic thrash circuit-breaker (1 hour)

**Sense:** “Are we still paying for model turns on the same stuck task?”

| Counts toward 1h toil | Does **not** count |
|----------------------|---------------------|
| Subagent / Composer **model** work on same slice goal | `vitest` / `turbo` / install / long capture CLI with no model turns |
| Re-planning, re-spawning, thrash fix loops | Waiting on human Quest headset |
| Same adapter failing C6 after repeated agent edits | Background `pnpm` / WASM compile |

**On trip:** set slice/epic `blocked` or advance only with explicit pivot handoff; record in `PROJECT_STATUS.md` + handoff; do **not** “one more hour.” Prefer eliminate candidate (physics epic) or escalate UNABLE.

## Path-scope note

Root `README.md` and `docs/index.html` are on **chief-coordinator** writeRoots so worktree promote can land public docs. Product apps stay on specialist roots.

## Related

- `pnpm openclaw:run-next` — single-slice selection (still valid)
- `pnpm openclaw:watchdog` — idle re-entry hint
- `docs/agent-ops/TASK-COST-ROLLUP.md` — estimate cost per slice
- `docs/agent-ops/TEMPORAL-DECISIONS.md` — periodic revisits (not the product queue)
