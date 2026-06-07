---
name: openclinxr-openclaw
description: Use when working in /Volumes/files/src/openclinxr on OpenClaw-style / OpenClaw-inspired autonomy, repo-agent consultation, case-definition-driven XR factory slices, coordination files, heartbeat replacement, or cross-harness Codex/Grok alignment.
---

# OpenClinXR OpenClaw-Style Bridge

## Purpose

Use this as Codex's bridge into the same repo-native OpenClaw-style / OpenClaw-inspired operating pattern that Grok uses. This is not an external OpenClaw runtime. The canonical sources stay in the repo; do not duplicate their contents into Codex config.

## Required Start

1. Read `AGENTS.md` + `PROJECT_STATUS.md` (first ~40 lines).
2. Load active slice brief: `.openclinxr/slices/<slice-id>/brief.json`.
3. Spawn parallel team: `pnpm openclaw:team-spawn -- --slice-id <id> --phase scout|execute`.
4. Verify completion: `pnpm openclaw:slice:verify -- --slice-id <id>`.
5. Acquire lease before integrator merges: `pnpm openclaw:lease -- acquire --owner integrator --slice "<slice>" --ttl-minutes 60`.

New slice from template: `pnpm openclaw:slice:init -- --template real-garment-v1 --slice-id <id>`.
Autonomous execution: `pnpm openclaw:run-next` or `pnpm grok:automation-prompt` for scheduler-based heartbeat loops.

Legacy `PROJECT_COORDINATION_INDEX.md` / `AUTONOMOUS_WORK_PLAN.md` are historical audit ledgers — do not append per-slice checkpoints there. Canonical state is in `PROJECT_STATUS.md`.

## Repo-Agent Consultation

- Coordinator first: read `agents/coordinator/chief-coordinator/charter.md` and `memory.md` for orchestration/drift-sensitive work.
- Drift concerns: read `agents/adversarial/openclaw-drift-police/charter.md` and `memory.md`.
- Planning gaps: read `agents/core/implementation-planning-lead/` and `agents/adversarial/implementation-plan-gap-attacker/` when selecting slices or repairing drift.
- XR/assets: read XR Systems Architect and Asset Pipeline Lead role files before runtime, humanoid, asset, IWSDK, or visual evidence changes.

Use live subagents only when available and materially useful. Otherwise perform local role consultation and record only durable outcomes.

## Shared Guardrails

- Rules live canonically in `agents/rules/*.md`; Grok mirrors them via `.grok/rules`.
- Grok hooks live in `.grok/hooks`; Codex lifecycle hooks live in `.codex/hooks.json` and route through `pnpm codex:hook`.
- Codex project hooks must be reviewed/trusted with `/hooks` when their hash changes.
- No canonical state update for no-op readiness checks. Routine runner output belongs in `.openclinxr/openclaw/run-next-report.json`.
- Canonical state updates are for product changes, verification evidence, or real blockers.

## Model routing (harness-specific)

- **Grok:** prefer direct DeepSeek (`deepseek-v4-flash` for scouts, `deepseek-v4-pro` for implementation/review) and `grok-build` for frontier synthesis. Do not use Moonbridge as the primary Grok subagent route when direct DeepSeek is available.
- **Codex Desktop:** cannot select DeepSeek in the native model picker. Use tier-appropriate models from generated `.codex/agents/*.toml`. Moonbridge (`pnpm local:moonbridge:probe`) is **Codex-only optional assist** for bounded first-pass review on scout/expert roles—not for implementation or readiness judgment.
- **Production pipeline:** asset generation and scene optimization may require agentic evaluation behind a swappable `ModelAssistProvider` (Moonbridge today; approved online models later). Procedural-only pipelines are the goal, but online AI is permitted behind explicit gates.

See `docs/agent-factory/model-assignment-policy.md` and `packages/openclinxr/agent-loop/src/role-harness-policy.ts`.

## Memory write-back

When a slice yields a durable role lesson:

```bash
pnpm agent:memory:append -- --role <role-id> --topic <topic> --lesson "<text>"
```

## Verification

After **coordination file** edits (PROJECT_STATUS.md, teams/, AGENTS.md) run:

```bash
pnpm docs:drift-check
pnpm agent:alignment
```

Per-slice completion uses machine verify (not MD ritual):

```bash
pnpm openclaw:slice:verify -- --slice-id <id>
```

For product code, also run focused tests for touched packages before broader gates.
