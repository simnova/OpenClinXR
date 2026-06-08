---
authority: agent-methodology
---

# Subagent Protocol and Orchestration

## Core Rule
- Subagent rule: orchestration coordinator (chief-coordinator role) first (read-only explorer or local chief-coordinator embodiment), then narrow specialists/adversarial only where they materially cut drift/review cost. See agentic-lexicon.md for full definition of role-mapped subagent delegation (coordinator-first).
- Map to repo roles (assets/** charters/memories).
- Main worker owns implementation + integration + state updates.
- **CHUNK VISIBILITY / NOTICEABILITY MANDATE (orchestration coordinator-enforced; part of chief-coordinator ruleset; see LEX_AGENTIC.md and MANDATE_VISIBILITY.md)**: Every slice/chunk assigned MUST produce a change noticeable in the tester app (Model Vetting Studio cagematch: front/three_quarter/body_motion artifacts) **or** the sample scene (UI-XR peds sample / comparator capture / garmentGeometry / sleeveDeform evidence). If evidence shows no visible delta, the orchestration coordinator MUST expand scope (geometry density, contrast, motion, exposure, re-gen) and re-delegate until visible skeptic/runtime difference is present. Do not close a chunk on sub-pixel, hidden, or fixture-only results. Ties directly to blueprint Q1 (visible case-driven runtime) + Q5 (verifiable factory output). Anti-toil: after 1 evidence-only slice, next must be product-visible or coordinator+drift review.

## When to Use Subagents
- After any context compaction, suspected drift, or two consecutive evidence/gate-only slices, consult at least the Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, and VP Engineering Delivery memories/charters before selecting the next slice.
- When suspected drift involves scattered artifacts, one-off encounter work, evidence toil, weakened guardrails, wrong-cwd subagents, or noncanonical process, consult `agents/adversarial/openclaw-drift-police/charter.md` and `agents/adversarial/openclaw-drift-police/memory.md`.
- For XR/humanoid/asset work, also consult XR Systems Architect and Asset Pipeline Lead memory/charter.
- For scenario-bank, clinical, scoring, review, or safety language changes, consult the relevant physician/simulation, psychometric, clinical-safety, legal/compliance, and security/privacy agents.
- When live subagent tools are available, spawn narrow non-overlapping agents for independent review or implementation only when they materially reduce drift, review cost, or implementation risk.
- When live subagent tools are unavailable or more expensive than local work, perform a "repo-agent consultation" locally by reading the relevant role memory/charter and writing the role decision into `PROJECT_STATUS.md` or the worker backlog.
- Do not run the full agent-factory loop for routine implementation. Run or dry-run `pnpm agent:loop` only when broad planning, leadership/adversarial synthesis, plateau recovery, or major direction changes are needed.

## Sub-Agent Work Order Template
Target repo: /Volumes/files/src/openclinxr.
Confirm AGENTS.md, PROJECT_STATUS.md, docs/agent-factory/**, agents/**, and tools/agent-factory/** exist.
Role/nickname:
Scope:
Read-only or write scope:
Return: concise findings, blockers, and recommended next slice.

**Terse persona contract (all agents):** See agentic-lexicon.md (Persona-constrained BLUF). Prefix every prompt with the role's Persona (see charter). Agents MUST be terse: ≤100 words, bullets only with `file:line` + domain jargon, end exactly "Recommended next: <slice> (Q#)". No prose, no recap. Orchestration coordinator (chief-coordinator role) spawns must use `pnpm grok:agent:spawn-spec` to guarantee tiered model (flash for explore scouts / slice scoping) + Persona + ESCALATION GUARD + visibility/noticeability + sizable collaborative vertical slice mandate bake (multi-role body, functional area provable by interaction in Model Vetting / UI-XR / asset pipeline, skeptic assesses collaboration + website evidence); never grok-build for routine. Scope each to contribute to an integrated team body-of-work, not isolated micro-tasks.

## Best Practices
- Scope each agent to contribute to one sizable collaborative vertical slice (see agentic-lexicon.md) — a multi-role body of work targeting a functional area (asset factory, exam running, model proving ground) that is provable by interacting/showcasing in the tangible apps and sufficient for the productivity-skeptic to assess teamwork + forward movement + website evidence. Reject or escalate if the assigned scope is minor/isolated.
- Avoid overlapping write scopes.
- Tell agents the repo is shared and they must not revert unrelated changes.
- Tell agents to respect approved boundaries in `PROJECT_STATUS.md`.
- Continue local non-overlapping work while agents run.
- Integrate agent results into the plan/status docs before moving on.
- Worker roles in `docs/openclinxr/worker-backlog-and-validation-matrix.md` are always useful as an ownership map.
