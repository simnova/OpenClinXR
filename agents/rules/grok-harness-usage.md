---
title: Grok Harness Configuration and Composer Orchestration
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-06
relates-to: .grok/config.toml, agents/rules/subagent-protocol.md, agents/rules/agent-consult.md, packages/openclinxr/agent-loop/src/role-harness-policy.ts
---

# Grok Harness Configuration and .grok/ Setup for AgenticEx

## Overview

This project uses a `.grok/` directory for harness-specific config to amp up the agentic experience (AgenticEx) while maintaining standardization across tools (Grok, Claude, Cursor, custom agents).

## Composer as orchestration entrypoint

The **primary Grok session (Composer / `grok-composer-*`)** is the OpenClaw orchestration entrypoint for this repo.

| Layer | Responsibility |
| --- | --- |
| **Composer (main thread)** | Rehydrate snapshots, acquire lease, select next slice, integrate subagent results, update canonical state files, run guards |
| **Repo role embodiment** | Act as `chief-coordinator` for orchestration decisions |
| **`explore` subagent** | Read-only consult mapped to `chief-coordinator`, `openclaw-drift-police`, `implementation-plan-gap-attacker`, `productivity-skeptic` |
| **`plan` subagent** | Bounded sequencing consult mapped to `implementation-planning-lead` |
| **Specialist subagents** | Disjoint implementation/review only (`asset-pipeline-lead`, `xr-systems-architect`, physicians, etc.) |

Composer should **not** patch product code during pure orchestration turns. The main thread owns implementation when executing a product slice directly.

### Model routing (Grok)

Configured in `.grok/config.toml`:

- **Composer (parent):** keep frontier composer model for orchestration and integration judgment.
- **`explore` subagents:** `deepseek-v4-flash` (cheap read-only scout/coordinator consult).
- **`plan` subagents:** `deepseek-v4-pro` (bounded planning).
- **Do not** route Grok subagents through Moonbridge when direct DeepSeek is available.
- **Moonbridge** remains Codex Desktop-only optional assist (see `docs/agent-factory/model-assignment-policy.md`).

Do **not** set `[subagents] default_model` in project config — it overrides per-type routing.

### Token efficiency

- Rehydrate using snapshot limits (~60–80 lines), not full coordination ledgers.
- Delegate read-only coordinator/drift consults to `explore` + DeepSeek flash instead of expanding Composer context.
- Prefer `grep` over broad `read_file`.
- Measure sessions with `pnpm agent:harness:prove` (Grok `updates.jsonl` token peaks + `ccusage` for Codex cross-check).

## Key Components

- `.grok/config.toml` — MCP, skills, subagents, memory, hooks
- `.grok/skills/` — via `[skills] paths = [".agents/skills"]`
- `.grok/rules/` — symlinked from `agents/rules/`
- `.grok/agents/` — repo role pointers (canonical content in `agents/**`)
- `.grok/hooks/` — SessionStart, PostToolUse guards, PreCompact rehydrate

## Multi-Harness Sync

`scripts/sync-harness-agent-files.sh` (or `pnpm agent:harness:sync` for Codex TOMLs only).

## Usage in Workflows

1. SessionStart hook reminds chief-coordinator consult + lease status.
2. Composer rehydrates snapshots + `AGENTS.md` top.
3. `pnpm openclaw:run-next` or queue from state files.
4. `pnpm openclaw:lease -- acquire ...` before edits.
5. Spawn `explore` for coordinator/drift consult when it saves Composer context.
6. After slice: state update, `pnpm agent:memory:append` for durable lessons, `pnpm openclaw:post-slice`.

## Proof and measurement

```bash
pnpm agent:harness:prove                 # full proof + Grok session peaks + ccusage
pnpm agent:harness:prove -- --quick      # config/policy/tests only (no ccusage/Grok parse)
pnpm agent:harness:prove -- --runs=5     # repeat suite 5x for stability proof
```

Report path: `.openclinxr/openclaw/grok-harness-proof-latest.json`

ccusage (https://ccusage.com/): `session --json` for Codex cross-check; `openclaw session --json` for OpenClaw. Grok/Composer peaks are parsed from `~/.grok/sessions/.../updates.jsonl` (`params._meta.totalTokens`).

Run `grok inspect` to verify loaded rules, skills, subagents, hooks.