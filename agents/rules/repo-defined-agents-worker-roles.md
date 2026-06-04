---
title: Repo-Defined Agents And Worker Roles
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-04
relates-to: AGENTS.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, agents/coordinator/chief-coordinator/, agents/adversarial/openclaw-drift-police/, docs/agent-factory/
---

# Repo-Defined Agents And Worker Roles

Use the worker backlog as the source of truth for ownership and slice boundaries.

Use repo-defined agents or spawned subagents only when they materially reduce local exploration, implementation, or review cost. Otherwise continue locally in LOW_TOKEN_AUTONOMY mode.

Repo-defined agent memory and iteration artifacts are not optional background decoration. Use them as the local substitute for persistent multi-agent memory when task selection feels unfocused, after compaction, or when repeated evidence work risks becoming toil.

Minimum repo-native agent context for realignment:

- `docs/agent-factory/README.md`
- `docs/agent-factory/operating-loop.md`
- `docs/agent-factory/model-assignment-policy.md`
- `docs/agent-factory/rubric.md`
- Latest `iterations/iteration-*/07-final-synthesis.md`
- Relevant `agents/**/charter.md` and `agents/**/memory.md` for the active worker slice.

Agent usage should serve the original team-of-agents request. The default mental model is:

- Coordinator/leader agent: maintains mission, boundaries, priorities, plan docs, and final synthesis.
- Specialist implementation agents: own independent worker slices such as schema, domain, fixtures, review, API, XR, provider gateways, assets, MongoDB, security, and test harness.
- Adversarial agents: review outputs for holes, overclaims, unsafe assumptions, feasibility gaps, missing tests, licensing risk, Quest performance risk, persistence issues, UX gaps, and clinical-safety wording problems.
- Senior-leadership agents: challenge the approach on feasibility, efficiency, maintainability, scope control, evidence quality, and whether the next slice advances the original product goal.

Model assignment guidance:

- Use fast/cheap models for targeted repo exploration, mechanical validation, and narrow test/doc patches.
- Use stronger coding models for cross-package implementation, persistence semantics, architecture rules, and high-risk refactors.
- Reserve the strongest/highest-reasoning models for architecture synthesis, adversarial critique, senior-leadership review, and ambiguous product/technical tradeoffs.
- Do not use subagents when a local targeted read/patch is cheaper and clearer.

When using agents:

- Scope each agent to one independent worker slice or one focused review question.
- Avoid overlapping write scopes.
- Tell agents the repo is shared and they must not revert unrelated changes.
- Tell agents to respect approved boundaries in `AUTONOMOUS_WORK_PLAN.md`.
- Continue local non-overlapping work while agents run.
- Integrate agent results into the plan/status docs before moving on.

Worker roles in `docs/openclinxr/worker-backlog-and-validation-matrix.md` are always useful as an ownership map. They do not require spawning agents unless that is more efficient than local work.

See subagent-protocol.md for live subagent orchestration (coordinator first, read-only explorer, map to repo roles like chief-coordinator / openclaw-drift-police).

Extracted from AGENTS.md . Consult relevant agents/**/charter.md + memory.md when using.
