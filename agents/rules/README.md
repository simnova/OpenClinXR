---
authority: agent-methodology
---

# Agent Rules (Modular Project Instructions)

This directory contains modular, focused rule files for agentic workflows in this repo.

## Purpose

- Avoid dumping everything into a single giant `AGENTS.md`.
- Enable better organization, reuse across harnesses, and easier maintenance.
- Parallel to `.agents/skills/` (canonical source for skills, pointed to via `.grok/config.toml`).

## Structure

- `agents/rules/` : Canonical source of truth (non-dot `agents/` to align with the project's role definitions in `agents/**` and internal agent system).
- `.grok/rules/` : Symlinked content for native Grok discovery (Grok always scans `<cwd>/.grok/rules/*.md` and appends to system prompt).
- Similar symlinks can be added to `.claude/rules/` and `.cursor/rules/` for other harnesses.

Grok loads:
- `AGENTS.md` (and variants) from repo root down to CWD (accumulating, deeper wins).
- All `*.md` files from the rules directories above.

Deeper/more specific rules take precedence.

## How to Add Rules

1. Create a focused `something-specific.md` in `agents/rules/`.
2. The symlink in `.grok/rules/` will make it available to Grok immediately (or recreate symlinks if adding many).
3. Update `AGENTS.md` high-level sections to reference or defer to the modular rules where appropriate.
4. For the project's custom agent roles (in `agents/**`), update their charters/memories or the agent-loop code to also consult `agents/rules/` for consistency.

## Benefits for AgenticEx

- Modular instructions are easier for agents (and humans) to process.
- Better multi-harness support (Grok, Claude, Cursor, custom OpenClaw agents, etc.).
- Keeps high-level contract in `AGENTS.md` while detailed conventions live here.
- Aligns with the "LOW_TOKEN_AUTONOMY", "targeted reads", and "source-of-truth order" principles in AGENTS.md.

See also:
- `AGENTS.md` (main operating contract)
- `.grok/config.toml` (skills + other agentic tuning)
- `docs/agent-factory/workflow-skill-policy.md` (for the skills parallel)
- `agents/**/charter.md` and `memory.md` for role-specific guidance.
- Specific rules in this dir:
  - rehydration-low-token.md (resume + low-token targeted reads/greps)
  - subagent-protocol.md (coordinator first, map to repo roles, live subagent discovery)
  - drift-toil-prevention.md (anti-toil gate, after 1-2 evidence pivot to product or coordinator+drift-police)
  - source-of-truth.md (AGENTS > states > operator-*.md > docs/agent-factory + agents/**)
  - long-running-autonomy.md (days-long unattended, heartbeat continuation, no chat summaries)
  - platform-autonomy-override.md (repo contract wins over platform task-complete/summary/stop defaults)
  - grok-harness-usage.md (the .grok/config + hooks + plugins + multi-harness setup)
  - hyper-token-efficient-long-run-practices.md (snapshots-first, commands for longevity, token-saving, M1 Max posture)
  - blueprint-factory-guardrails.md (protected 6 files + Q1/Q4/Q5 slice gate; "do not weaken")
  - repo-defined-agents-worker-roles.md (ownership from worker matrix; when + how to use/consult agents/** + subagents)
  - persistent-memory-scoring.md (file-backed primary memory files + iteration record + rubric for architecture outputs)

Run `./scripts/sync-harness-agent-files.sh` after adding. Then `pnpm docs:authority` (to register new agent-methodology MDs) + `pnpm agent:alignment && pnpm docs:drift-check`.
