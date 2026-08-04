---
name: worker-scoped-session
description: Run delegated headless/--yolo workers with OPENCLINXR_WORKER=1 so SessionStart docs hygiene and CEO coord hooks NO-OP. Use when spawning worktree workers, deepseek execute sessions, or any non-CEO agent that must not mutate registries/PROJECT_STATUS.
when-to-use: OPENCLINXR_WORKER, yolo worker, worktree worker, delegated headless, subagent session, no docs hygiene
---

# Worker-scoped session

## Problem

Project SessionStart hooks (especially `session-start-docs-hygiene.json` with `--auto-run`) run on **every** Grok session, including delegated `--yolo` workers. Workers then mutate `docs/openclinxr/*registry*`, `PROJECT_STATUS.md`, `docs/_archive/**`, temporal-review renames — outside pathScope.

`--rules` cannot disable project hooks. Use an **env flag** instead.

## Flag (required for workers)

| Variable | Value | Effect |
|----------|-------|--------|
| `OPENCLINXR_WORKER` | `1` or `true` | NO-OP mutating SessionStart/Stop/PostToolUse coord hooks |
| `GROK_SUBAGENT` | any non-empty | Same NO-OP (optional signal) |
| `GROK_SUBAGENTS` | `1` | Expose `spawn_subagent` in headless `grok -p` (required for multi-level tiering; absent without it) |

CEO / main orchestrator sessions: **do not** set `OPENCLINXR_WORKER` (hygiene + lease banners stay active). Manager-launched headless workers that may spawn children **must** set `GROK_SUBAGENTS=1`.

## Launch pattern

```bash
export OPENCLINXR_WORKER=1
export GROK_SUBAGENTS=1
export OPENCLINXR_JOB_TMP="${TMPDIR:-/tmp}/openclinxr-job-$$"
mkdir -p "$OPENCLINXR_JOB_TMP"

# Prefer spawn-spec prompt for role bake:
# pnpm grok:agent:spawn-spec -- --role asset-pipeline-lead --task "..."
# Shell prefix: formatWorkerHeadlessEnvPrefix (OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 …)
OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 grok -p "<pathScope-bounded task only>" \
  --model deepseek-v4-pro \
  --always-approve --sandbox workspace \
  --deny 'Bash(rm -rf *)' --deny 'Bash(git push *)' \
  --cwd <worktree-path> \
  --max-turns 40
```

> Bounded autonomy over blanket `--yolo`: `--always-approve` avoids interactive hangs. `--deny`
> rules are the DETERMINISTIC control (VERIFIED: `--deny 'Bash(rm *)'` blocked an `rm`
> non-interactively). `--sandbox workspace` is BEST-EFFORT only — it fenced out-of-cwd writes when
> shell-launched but failed OPEN once under a nested spawn, so don't rely on it as a hard boundary.
> `--cwd` alone is NOT a boundary either (a bare `--always-approve` worker wrote outside it). Real
> safety = `--deny` + intended-files-only integration. Proofs: agentic-eval `permission-bounds.test.ts`;
> see `formatWorkerHeadlessDispatchFlags()` in `packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.ts`.

## Worker hard denies (tighter, not looser)

Workers **must not** edit:

- `PROJECT_STATUS.md`
- `docs/openclinxr/*registry*`
- `docs/_archive/**`
- Protected guardrail docs / Q-gate meaning
- AGENTS.md / GUARD_* / LEX_* rule meaning

Stay inside role `pathScope.writeRoots` from spawn-spec. Parent/CEO owns SSOT + post-slice.

## Verify

```bash
# Before worker
git status --short docs/openclinxr PROJECT_STATUS.md docs/_archive | tee /tmp/before-worker.txt

OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 grok -p "echo only; no edits" --yolo --max-turns 2

# After: registries / PROJECT_STATUS / _archive untouched
git status --short docs/openclinxr PROJECT_STATUS.md docs/_archive
```

Hooks doc: `~/.grok/docs/user-guide/10-hooks.md` (SessionStart). Headless: `14-headless-mode.md`.
