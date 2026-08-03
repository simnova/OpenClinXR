---
name: large-task-orchestration
description: Decompose large multi-file tasks into N disjoint file-scoped workstreams with worktree isolation, distinct portless ports, and per-job temp paths. Use when fan-out, parallel workers, large refactors, multi-package builds, Blender/mesh batches, or when the agent would otherwise solo a large task on the frontier model.
when-to-use: large task, parallelize, fan-out, worktree workers, multi-file, decompose, spawn deepseek, batch Blender, multi-package
---

# Large-task orchestration (reliable fan-out)

Grok self-parallelizes to cheaper models mainly on *large* tasks. For medium/large product work, **force** decomposition so work does not stay solo on the expensive frontier model.

## Required decomposition (before coding)

1. Split the goal into **N ≥ 2 disjoint workstreams** with **non-overlapping write scopes** (paths, packages, or mesh/role ids).
2. Each stream gets:
   - Own **worktree** (`isolation=worktree` or `git worktree add` under `~/.grok/worktrees/…`)
   - Own **portless / dev port** (never share a fixed port across jobs)
   - Own **temp directory** (never share `/tmp/openclinxr_*.png` or similar fixed names)
3. Prefer **deepseek-v4-pro** (bounded write) / **deepseek-v4-flash** (scout) via `spawn_subagent` or `OPENCLINXR_WORKER=1 grok -p … --model deepseek-v4-pro --yolo`. Parent keeps orchestration + integration.
4. Parent integrates: verify, merge worktrees, update SSOT once — **workers do not** touch `PROJECT_STATUS.md`, `docs/openclinxr/*registry*`, `docs/_archive/**`, or AGENTS.md.

## Worker session env (required for headless / --yolo)

```bash
export OPENCLINXR_WORKER=1
# Optional alias signal: GROK_SUBAGENT=1
grok -p "<scoped task>" --model deepseek-v4-pro --yolo --cwd <worktree> --max-turns 40
```

`OPENCLINXR_WORKER=1` makes repo-mutating SessionStart hooks (docs hygiene auto-run, CEO rehydrate, post-slice Stop) **NO-OP** so workers stay in pathScope files. See spawn-spec bake in `packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.ts`.

## Per-job temp-file convention (anti-race)

**Never** use a fixed path like `/tmp/openclinxr_skin_albedo_mixed.png` across parallel jobs.

```bash
# Per-process unique root
export OPENCLINXR_JOB_TMP="${TMPDIR:-/tmp}/openclinxr-job-${USER:-u}-$$-$(date +%s)-${OPENCLINXR_JOB_ID:-job}"
mkdir -p "$OPENCLINXR_JOB_TMP"

# Per-mesh / per-artifact names
#   $OPENCLINXR_JOB_TMP/<meshId>_albedo.png
#   $OPENCLINXR_JOB_TMP/<meshId>_<stage>_<pid>.png
# Prefer mktemp when writing single files:
ALBEDO=$(mktemp "${OPENCLINXR_JOB_TMP}/${MESH_ID:-mesh}_albedo.XXXXXX.png")
```

Rules:

| Do | Don't |
|----|--------|
| `$OPENCLINXR_JOB_TMP/<mesh>_<stage>_$$.ext` | `/tmp/openclinxr_skin_albedo_mixed.png` |
| `mktemp` / unique suffix per write | Shared fixed basename across Blender/Python jobs |
| Job-local caches under worktree `.tmp/` | Writing sibling job outputs into the same path |

## Ports (portless / dev servers)

- Each workstream claims a **distinct** port or portless identity.
- Pattern: derive from job id / pid (`BASE_PORT + ($$ % 1000)` or portless project name `openclinxr-w-$$`).
- Never hardcode a single shared `5173` / `8787` for parallel workers.

## Fan-out recipe (parent)

1. List N streams with writeRoots + done_when.
2. Spawn N workers in parallel (`background=true` + `isolation=worktree`, or N headless `OPENCLINXR_WORKER=1` processes in distinct worktrees).
3. Wait / merge; run focused verify once.
4. Parent (CEO) updates `PROJECT_STATUS.md` + post-slice — not workers.

## Skill cross-links

- Worker scoped session: `.grok/skills/worker-scoped-session/SKILL.md`
- Temp paths detail: `.grok/skills/per-job-temp/SKILL.md`
- Headless regen loop: `.grok/skills/regen-score-report/SKILL.md`
- Docs: `~/.grok/docs/user-guide/16-subagents.md` (isolation/worktree), `14-headless-mode.md` (`--yolo`, `--max-turns`), `20-background-tasks.md`
