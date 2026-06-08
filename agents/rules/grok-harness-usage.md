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
| **Composer (main thread)** | Rehydrate snapshots, acquire lease, select next slice, integrate subagent results, update PROJECT_STATUS.md, run guards |
| **Repo role embodiment** | Act as orchestration coordinator (chief-coordinator role) for slice selection, delegation, integration, lease, and state (per agentic-lexicon.md) |
| **`explore` subagent** | Read-only consult mapped to `chief-coordinator`, `openclaw-drift-police`, `implementation-plan-gap-attacker`, `productivity-skeptic` |
| **`plan` subagent** | Bounded sequencing consult mapped to `implementation-planning-lead` |
| **Specialist subagents** | Disjoint implementation/review only (`asset-pipeline-lead`, `xr-systems-architect`, physicians, etc.) |

Composer should **not** patch product code during pure orchestration turns. The main thread owns implementation when executing a product slice directly.

**Supervisor:** `platform-autonomy-override.md`. `Stop`→`pnpm grok:hook -- stop` via `autonomy-stop-continuation.json`.

### Model routing (Grok)

Configured in `.grok/config.toml`:

- **Composer (parent):** keep frontier composer model for orchestration and integration judgment.
- **`explore` subagents:** `deepseek-v4-flash` (cheap read-only scout/coordinator consult).
- **`plan` subagents:** `deepseek-v4-pro` (bounded planning).
- **Do not** route Grok subagents through Moonbridge when direct DeepSeek is available.
- **Moonbridge** remains Codex Desktop-only optional assist (see `docs/agent-factory/model-assignment-policy.md`).

Do **not** set `[subagents] default_model` in project config — it overrides per-type routing.

### Tiered delegation ladder (Grok-only)

Full policy: `agents/rules/grok-tier-routing.md` + `packages/openclinxr/agent-loop/src/grok-tier-routing.ts`.

| Tier | Model | Surface |
| --- | --- | --- |
| Scout | `deepseek-v4-flash` | Native `spawn_subagent` **explore** (read-only) |
| Plan | `deepseek-v4-pro` | Native `spawn_subagent` **plan** |
| Execute | `deepseek-v4-pro` | Native `spawn_subagent` **general-purpose** (bounded) |
| Integrate | Composer | Main thread — lease, state files, post-slice |
| Frontier | `grok-build` | Protected-claim / ambiguous synthesis |

**Never use Cursor `Task` for tier 0–2 scouts** — it only exposes `composer-2.5-fast`. Run `pnpm grok:tier:introspect` before multi-subagent waves and after compaction.

**Per-slice token audit:** `pnpm grok:tier:slice-start` at slice begin, `pnpm grok:tier:post-slice` at end. Uses ccusage daily deltas + Grok session peaks to detect tier-routing violations.

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
6. Per-slice token ritual (required before commit): `pnpm openclaw:slice-token:start -- --slice-id <id> --current-tier <tier>` → work → `pnpm openclaw:slice-token:finish` → paste `stateRecordLine` into latest `PROJECT_STATUS.md` checkpoint. `ccusage` tracks Codex cross-harness; Grok/DeepSeek models tracked via `~/.grok/sessions` peaks in the finish report.
7. After slice: state update (with Token introspection line), `pnpm openclaw:post-slice` (fails if token line missing), then dequeue next slice without final chat.

## Proof and measurement

```bash
pnpm agent:harness:prove                 # full proof + Grok session peaks + ccusage
pnpm agent:harness:prove -- --quick      # config/policy/tests only (no ccusage/Grok parse)
pnpm agent:harness:prove -- --runs=5     # repeat suite 5x for stability proof
```

Report path: `.openclinxr/openclaw/grok-harness-proof-latest.json`

ccusage (https://ccusage.com/): install globally once with `npm install -g ccusage` (recommended for harness prove and slice-cost review); `pnpm agent:harness:prove` prefers the global binary and falls back to `pnpm dlx ccusage`. Use `session --json` for Codex cross-check; `openclaw session --json` for OpenClaw. Grok/Composer peaks are parsed from `~/.grok/sessions/.../updates.jsonl` (`params._meta.totalTokens`).

Run `grok inspect` to verify loaded rules, skills, subagents, hooks.