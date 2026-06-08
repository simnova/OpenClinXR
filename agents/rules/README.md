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

## Current Focused Rules (relevant to orchestration)

**Core for Orchestrator High-Level View (read these on every rehydrate for the forest perspective; see "Orchestrator High-Level View Protocol" in LEX_AGENTIC.md):**
- LEX_AGENTIC.md: The single source of truth (was agentic-lexicon.md). Authoritative glossary + all stable terms/mandates/principles (orchestration coordinator role, sizable collaborative vertical slice mandate, persona-constrained BLUF, Q-gate filter, visibility/noticeability, tiered routing + self-escalation, LOW_TOKEN rehydration via 60-80 line snapshots of PROJECT_STATUS.md + worker-backlog only, anti-toil, protected guardrails, Guidance Stability vs Current WIP, AI-First Foundational Principle with ai_parse/drift metrics). Every other file + AGENTS.md + charters defer to this. (authority: agent-methodology; ai_parse baseline 0.93)
- MANDATE_VISIBILITY.md (was chunk-visibility-noticeability.md): Orchestration coordinator ruleset – every chunk must be a sizable collaborative vertical slice (multi-role body on functional area, provable by interacting in Model Vetting tester or UI-XR sample) and noticeable (expand until skeptic-visible delta in tester app or sample scene). Non-negotiable for Q1/Q5 + anti-toil. See chief charter/Persona + PROTO_SUBAGENT.md + spawn bake.
- GUARD_BLUEPRINT.md (was blueprint-factory-guardrails.md) + PROTO_SUBAGENT.md + TIER_GROK.md (was grok-tier-routing.md) + GUARD_DRIFT.md (was drift-toil-prevention.md): The core operational gates (Q1/Q4/Q5 slice filter + "do not weaken" the 6 protected files; coordinator-first delegation + BLUF; cheap-first tiering + self-escalation; anti 2+ evidence-only without coordinator+drift-police review + product pivot).

**Supplemental / Detailed (read with strict limits/grep only when delegating to a specific role or auditing one slice; never for daily high-level orchestration):**
- drift-toil-prevention.md, long-running-autonomy.md, hyper-token-efficient-long-run-practices.md, source-of-truth.md, rehydration-low-token.md, grok-harness-usage.md, agent-consult.md, repo-defined-agents-worker-roles.md, persistent-memory-scoring.md, platform-autonomy-override.md (and others). All reference agentic-lexicon.md for core terms. Use these only for role-specific or edge-case detail.

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

**Orchestrator discipline (enforced in agentic-lexicon.md "Orchestrator High-Level View Protocol" and chief-coordinator charter):** The chief-coordinator / Composer main thread must treat only the "Core for Orchestrator High-Level View" group above (plus the 3 MD snapshots + AGENTS top + worker-backlog matrix) as the daily forest view. All supplemental rules are read with strict limits/grep *only* when delegating a specific role or auditing one slice. This prevents context bloat, keeps the high-level perspective clean, and forces selection of sizable collaborative vertical slices. Violations (pulling too many verbose files) are a drift signal.

Run `./scripts/sync-harness-agent-files.sh` after adding (ensures .grok/rules/ symlinks + .grok/agents/ pointers). Then `pnpm docs:authority` (to register new agent-methodology MDs such as agentic-lexicon.md) + `pnpm agent:alignment && pnpm docs:drift-check`.
