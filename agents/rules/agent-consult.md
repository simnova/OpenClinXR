---
title: Agent Consult and Repo-Agent Consultation Protocol
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-04
relates-to: AGENTS.md (subagent-protocol, OpenClaw-Style Repo-Agent Activation, Mandatory agent use rules), agents/rules/subagent-protocol.md, agents/rules/repo-defined-agents-worker-roles.md, .agent-factory/memory-index.json, agents/**/charter.md + memory.md
---

# Agent Consult and Repo-Agent Consultation Protocol

When task selection feels unfocused, after compaction, suspected drift, or before major slices: perform "repo-agent consultation" locally (or via live subagent) by reading the relevant role charter + memory.

## Steps (LOW_TOKEN)
1. Identify mapped role from worker-backlog-and-validation-matrix.md or queue (e.g. chief-coordinator for orchestration, openclaw-drift-police for drift, implementation-planning-lead for plan, xr-systems-architect for XR, pediatrics-physician for clinical peds, clinical-safety-critic for safety).
2. Read (with limit): agents/<role-dir>/charter.md (first 30-50 lines) + memory.md (lessons, risks, heuristics).
3. Consult .agent-factory/memory-index.json for entries by agent_id or topic (use grep or node -e snippet for active).
4. Cross with current state snapshots (PROJECT_STATUS.md) and source-of-truth order.
5. Record the lens/decision in PROJECT_STATUS.md or worker matrix (e.g. "consulted chief-coordinator memory: ... ; chose slice X").
6. Only then spawn live subagent (if available) as narrow read-only explorer mapped to that role, with explicit prompt including "Target repo: /Volumes/files/src/openclinxr. Confirm AGENTS.md + states + agents/** + tools/agent-factory exist. Return concise findings + recommended next slice."

## Live Subagent Rule (from AGENTS)
- Orchestration coordinator (chief-coordinator role) first (read-only explorer or local chief-coordinator embodiment; see agentic-lexicon.md).
- Then narrow specialists/adversarial only where they materially cut drift/review cost.
- Map to repo roles.
- Orchestration agent does NOT implement product code, patch, or own slice.
- Main worker owns integration + state updates + closing threads.
- Every prompt must name the full repo path and confirm files.

## When to Consult (Mandatory)
- After compaction or suspected drift or 2+ evidence/gate-only.
- For XR/asset: consult xr-systems-architect + asset-pipeline-lead.
- For clinical/scenario/review/safety: pediatrics-physician + clinical-safety-critic + ...
- For harness/OpenClaw: chief-coordinator + openclaw-drift-police + implementation-planning-lead + vp-engineering-delivery.

## Memory Injection
SessionStart hooks + [memory] in .grok/config.toml provide initial context from index/role memory. Use `GROK_MEMORY=1` if needed for cross-session.

## Memory Write-Back
When a slice yields a durable lesson for a consulted role, append it to role memory and rebuild the index:

```bash
pnpm agent:memory:append -- --role <role-id> --topic <topic> --lesson "<text>"
```

Prefer this over leaving lessons only in per-slice state records.

## Grok Composer entrypoint

The primary Grok session (Composer) is the orchestration entrypoint. Embody orchestration coordinator (chief-coordinator role) for slice selection, integration, lease, and state updates. Spawn `explore` subagents (mapped to chief-coordinator / openclaw-drift-police per agentic-lexicon.md) for read-only consults on `deepseek-v4-flash` instead of expanding Composer context. See `agents/rules/grok-harness-usage.md` and subagent-protocol.md.

## Harness Model Routing
- Per-role tiers and Codex TOML generation: `packages/openclinxr/agent-loop/src/role-harness-policy.ts` + `pnpm agent:harness:sync`.
- **Grok tier ladder (harness-only):** `agents/rules/grok-tier-routing.md` + `pnpm grok:tier:introspect`. Scout via native `spawn_subagent explore` (flash), not Cursor Task.
- **Grok repo agent spawn:** `pnpm grok:agent:spawn-spec -- --role <role-id>` maps `agents/**` + `role-harness-policy.ts` to subagent_type + model. Regenerate via `pnpm agent:harness:sync`.
- **Grok:** direct DeepSeek (`deepseek-v4-flash` / `deepseek-v4-pro`) and `grok-build` for frontier work. Do not use Moonbridge as primary Grok routing.
- **Codex Desktop:** tier models from generated `.codex/agents/*.toml`. Moonbridge (`pnpm local:moonbridge:probe`) is **Codex-only optional first-pass assist** when DeepSeek cannot be selected in the model picker.
- **Production pipeline:** swappable `ModelAssistProvider` bridges (Moonbridge today; approved online models later) may support bounded agentic evaluation/optimization behind gates. Procedural-only asset/scene pipelines remain the goal; online AI is permitted where gates allow.

See `docs/agent-factory/model-assignment-policy.md`.

See subagent-protocol.md for spawn details and AGENTS.md "OpenClaw orchestration-agent rule" + "Mandatory agent use rules".

This rule + the memory/role hooks make persistent indexed memory (agents/** + .agent-factory/) first-class for AgenticEx.
