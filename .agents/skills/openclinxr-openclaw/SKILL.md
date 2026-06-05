---
name: openclinxr-openclaw
description: Use when working in /Volumes/files/src/openclinxr on OpenClaw-style / OpenClaw-inspired autonomy, repo-agent consultation, case-definition-driven XR factory slices, coordination files, heartbeat replacement, or cross-harness Codex/Grok alignment.
---

# OpenClinXR OpenClaw-Style Bridge

## Purpose

Use this as Codex's bridge into the same repo-native OpenClaw-style / OpenClaw-inspired operating pattern that Grok uses. This is not an external OpenClaw runtime. The canonical sources stay in the repo; do not duplicate their contents into Codex config.

## Required Start

1. Read `AGENTS.md`.
2. Read the current snapshots in `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, and `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
3. Prefer `pnpm openclaw:run-next` to select a slice. Use `pnpm openclaw:watchdog` only as a quiet local idle check.
4. Acquire a lease before real edits: `pnpm openclaw:lease -- acquire --owner openclaw-run-next --slice "<slice>" --ttl-minutes 60`.

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

## Verification

After coordination or OpenClaw-style changes run:

```bash
pnpm openclaw:post-slice
pnpm agent:alignment
pnpm docs:drift-check
```

For product code, also run focused tests for touched packages before broader gates.
