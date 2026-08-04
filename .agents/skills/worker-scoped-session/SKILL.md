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

## TRUST reality (agent `tools:` allowlist)

Proven 2026-08-04: agent frontmatter `tools:` / `disallowedTools` **only loads if the worktree is TRUSTED**. An untrusted headless worktree worker does **not** get the agent config allowlist.

A headless worktree worker must **either**:

1. **Trusted (recommended for full config load)** — append the worktree path to `~/.grok/trusted_folders.toml` before launch so agent config + tools allowlist load; **or**
2. **Bounded without trust** — rely on `--deny` + `--cwd` via `formatWorkerHeadlessDispatchFlags()` (deterministic blast-radius; `--sandbox workspace` best-effort only).

```bash
# One-line: trust this worktree so agent tools: allowlist loads (prefer before multi-turn workers)
printf '\n"%s"\n' "$(pwd)" >> ~/.grok/trusted_folders.toml
```

Native `[subagents.personas]` do **not** bind in `-p`; project `.grok/config.toml` `[subagents.*]` does **not** merge. Tone is baked via `WORKER_TONE_DIRECTIVE` in `grok-repo-agent-spawn.ts`. Role `prompt_file` (ABSOLUTE) binds tone only for grok-spawned children in a TRUSTED folder.

## Launch pattern

```bash
export OPENCLINXR_WORKER=1
export GROK_SUBAGENTS=1
export OPENCLINXR_JOB_TMP="${TMPDIR:-/tmp}/openclinxr-job-$$"
mkdir -p "$OPENCLINXR_JOB_TMP"

# Prefer spawn-spec prompt for role bake:
# pnpm grok:agent:spawn-spec -- --role asset-pipeline-lead --task "..."
# Shell prefix: formatWorkerHeadlessEnvPrefix (OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 …)
# Flags: formatWorkerHeadlessDispatchFlags() — do not invent ad-hoc --yolo
OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 grok -p "<pathScope-bounded task only>" \
  --model deepseek-v4-pro \
  --always-approve --sandbox workspace \
  --deny 'Bash(rm -rf *)' --deny 'Bash(sudo *)' --deny 'Bash(git push *)' \
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

## Programmatic `grok` callers (audit — flags documented, not wired)

Repo-wide audit of `spawn`/`spawnSync`/`exec` of `grok` / `~/.grok/bin/grok` under `tools/`, `scripts/`, `packages/`, `apps/`:

| Caller | Kind | Uses worker flags? |
|--------|------|--------------------|
| `tools/openclinxr/evidence/humanoid-vision-score.ts` | **Single-turn scorer** (`--max-turns 1`, `--prompt-json`) | No — not a multi-turn worker; do not wrap with `WORKER_HEADLESS_DISPATCH_FLAGS` |
| `tools/agent-factory/prove-grok-harness.ts` | `grok inspect --json` only | No — not a worker launch |

**No programmatic multi-turn worker launcher exists today.** `formatWorkerHeadlessDispatchFlags()` + `formatWorkerHeadlessEnvPrefix()` remain the **reference helpers for manual/skill dispatch** (this skill + spawn-spec writer brief env). When a manager script is added that launches `grok -p` multi-turn workers, it **must** emit those flags (not blanket `--yolo`).

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

OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 grok -p "echo only; no edits" \
  --always-approve --sandbox workspace \
  --deny 'Bash(rm -rf *)' --deny 'Bash(sudo *)' --deny 'Bash(git push *)' \
  --max-turns 2

# After: registries / PROJECT_STATUS / _archive untouched
git status --short docs/openclinxr PROJECT_STATUS.md docs/_archive
```

Hooks doc: `~/.grok/docs/user-guide/10-hooks.md` (SessionStart). Headless: `14-headless-mode.md`.
