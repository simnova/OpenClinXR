---
authority: agent-methodology
---

# Instruction Source-Of-Truth Order and Persistent Memory

See `agents/rules/agentic-lexicon.md` for authoritative terminology used throughout (orchestration coordinator, Q-gate slice filter, visibility/noticeability mandate, etc.).

## Instruction Source-Of-Truth Order
Use this order when repo docs appear scattered or disagree:

1. `AGENTS.md` is the operating contract (high-level; modular detailed conventions in `agents/rules/`).
2. `PROJECT_COORDINATION_INDEX.md` is the coordinator dashboard for active product direction, sub-agent control, and drift correction.
3. `AUTONOMOUS_WORK_PLAN.md` is the active continuation plan. Its active product-advancement queue overrides old chronological "next slice" breadcrumbs.
4. `docs/openclinxr/worker-backlog-and-validation-matrix.md` is the worker ownership and validation map.
5. `operator-steering-needed-questions.md` contains true blockers and hardware/operator instructions.
6. `operator-open-questions.md` contains nonblocking steering questions and recommended defaults.
7. `docs/agent-factory/**`, `agents/**`, and `iterations/**` are persistent multi-agent memory and governance evidence. Use them to realign task selection, not to restart broad planning loops unless the active plan explicitly calls for one.
8. Historical evidence reports, benchmark outputs, and old iteration "go-forward" notes are evidence, not active marching orders.

When an older file says to refresh evidence but the active plan says to build product capability, build product capability unless the evidence refresh unlocks that build. See agentic-lexicon.md for LOW_TOKEN practices that keep rehydration and state updates efficient.

## Persistent Memory And Scoring
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
