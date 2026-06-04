---
title: Persistent Memory And Scoring (Rubric)
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-04
relates-to: AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, .agent-factory/memory-index.json, agents/**/memory.md
---

# Persistent Memory And Scoring

Persistent memory for this repo is file-backed and indexed through the planning/status documents. Keep it concise, searchable, and actionable.

Primary memory files:

- `AGENTS.md`: durable agent operating contract.
- `AUTONOMOUS_WORK_PLAN.md`: current state, continuation defaults, completed slices, and next work.
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`: worker ownership, validation matrix, evidence, and done conditions.
- `operator-steering-needed-questions.md`: true operator blockers and approved scope.
- `operator-open-questions.md`: nonblocking questions with recommended defaults.
- `operator-suggestion-backlog.md`: remembered suggestions that are not yet approved scope.

Each meaningful iteration should leave behind:

- What changed.
- What evidence passed.
- What risk remains.
- What next slice is recommended.
- Which agent/team role would own it.

Use an improvement rubric when producing or revising architecture/design/spec outputs:

- Mission alignment: advances the sequenced XR clinical-skills exam goal.
- Evidence quality: grounded in repo artifacts, tests, approved proposals, and cited research where needed.
- Feasibility: executable on current stack/hardware without unapproved cloud, paid APIs, or production claims.
- Safety and claim control: avoids licensure, diagnosis, exam-equivalence, or validation overclaims.
- Architecture completeness: covers UX, data, state, sequence, persistence, agents, assets, QA, and observability.
- Testability: has deterministic local tests, benchmark gates, or evidence artifacts.
- Asset realism path: accounts for characters, skin, clothing, equipment, animation, optimization, provenance, and licensing.
- Quest/WebXR performance posture: keeps frame pacing, comfort, locomotion, input, and headset evidence separate from emulation.
- Maintainability: clean package boundaries, small slices, and clear worker ownership.

If a slice does not improve at least one rubric dimension, choose a better slice.

See also agents/rules/ for other methodology, and .agent-factory/ + agents/** for indexed memory.

Extracted from AGENTS.md for targeted consultation by workers and subagents (chief-coordinator, gap-attacker, etc.).
