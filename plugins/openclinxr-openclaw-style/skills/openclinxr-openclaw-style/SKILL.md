---
name: openclinxr-openclaw-style
description: Use when operating OpenClinXR's OpenClaw-style / OpenClaw-inspired repo-native workflow in Codex, including role consultation, run-next, leases, hooks, and canonical state updates.
---

# OpenClinXR OpenClaw-Style Bridge

This skill packages the repo-native OpenClaw-style / OpenClaw-inspired workflow for Codex. It is not an external OpenClaw runtime.

## Start

1. Read `AGENTS.md`.
2. Read the snapshot heads of `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, and `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
3. Use `pnpm openclaw:run-next` to select a real approved slice when continuation is needed.
4. Acquire a lease before edits with `pnpm openclaw:lease -- acquire --owner <owner> --slice "<slice>" --ttl-minutes 60`.
5. Use Codex custom agents from `.codex/agents/*.toml` only when explicitly asked for subagents/delegation or when the repo instructions require role consultation.

## Guardrails

- Treat `agents/**/charter.md`, `agents/**/memory.md`, and `.agent-factory/memory-index.json` as file-backed role memory.
- Keep canonical state in the repo files named by `AGENTS.md`, not chat-only summaries.
- Run focused verification for touched code and `pnpm agent:alignment && pnpm docs:drift-check` after coordination/OpenClaw-style changes.
