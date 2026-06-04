---
authority: agent-methodology
---

# Subagent Protocol and Orchestration

## Core Rule
- Subagent rule: coordinator/orchestration first (read-only explorer or local chief-coordinator), then narrow specialists/adversarial only where they materially cut drift/review cost.
- Map to repo roles.
- Main worker owns implementation + integration + state updates.

## When to Use Subagents
- After any context compaction, suspected drift, or two consecutive evidence/gate-only slices, consult at least the Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, and VP Engineering Delivery memories/charters before selecting the next slice.
- When suspected drift involves scattered artifacts, one-off encounter work, evidence toil, weakened guardrails, wrong-cwd subagents, or noncanonical process, consult `agents/adversarial/openclaw-drift-police/charter.md` and `agents/adversarial/openclaw-drift-police/memory.md`.
- For XR/humanoid/asset work, also consult XR Systems Architect and Asset Pipeline Lead memory/charter.
- For scenario-bank, clinical, scoring, review, or safety language changes, consult the relevant physician/simulation, psychometric, clinical-safety, legal/compliance, and security/privacy agents.
- When live subagent tools are available, spawn narrow non-overlapping agents for independent review or implementation only when they materially reduce drift, review cost, or implementation risk.
- When live subagent tools are unavailable or more expensive than local work, perform a "repo-agent consultation" locally by reading the relevant role memory/charter and writing the role decision into `AUTONOMOUS_WORK_PLAN.md` or the worker backlog.
- Do not run the full agent-factory loop for routine implementation. Run or dry-run `pnpm agent:loop` only when broad planning, leadership/adversarial synthesis, plateau recovery, or major direction changes are needed.

## Sub-Agent Work Order Template
Target repo: /Volumes/files/src/openclinxr.
Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, and tools/agent-factory/** exist.
Role/nickname:
Scope:
Read-only or write scope:
Return: concise findings, blockers, and recommended next slice.

## Best Practices
- Scope each agent to one independent worker slice or one focused review question.
- Avoid overlapping write scopes.
- Tell agents the repo is shared and they must not revert unrelated changes.
- Tell agents to respect approved boundaries in `AUTONOMOUS_WORK_PLAN.md`.
- Continue local non-overlapping work while agents run.
- Integrate agent results into the plan/status docs before moving on.
- Worker roles in `docs/openclinxr/worker-backlog-and-validation-matrix.md` are always useful as an ownership map.
