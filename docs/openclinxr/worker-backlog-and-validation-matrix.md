# Worker Backlog And Validation Matrix

---
id: STATE_BACKLOG
authority: current-reference
ai_parse_score: 0.90
drift_score: 0.03
token_efficiency: high
q_gates: [Q1, Q4, Q5]
visibility: both
strategic_group: orchestration-factory-v1
last_measured: 2026-08-05
parseable_sections: 4
---

## Current State Snapshot

**Stable product north star**: Blueprint-driven encounter factory for Step 2 CS-inspired XR clinical-skills exam platform. Case definitions drive generated runtime (actors, dialogue, emotion, locomotion, assets), review/persistence/replay.

**Functional areas** (sizable collaborative vertical slices): WebXR asset & scene factory, exam running (UI-XR + evidence), Model Vetting tester app, encounter authoring/admin/review.

**Rehydration contract**: Read this header + ownership matrix only (~40 lines). Transient WIP (file:line, subagent IDs, capture logs) lives in `PROJECT_STATUS.md` § Per-Slice Checkpoints or `docs/openclinxr/slice-archive/`. Strategic direction: `PROJECT_STATUS.md` § Strategy.

**Stable emphasis**: Sizable collaborative vertical slices; visibility/noticeability mandate; Q1/Q4/Q5; anti-toil; conversation tooling first-class; cheap-first tiering + self-escalation.

**Next priority**: see the GitHub board (open issues, newest first). As of 2026-08-05 the highest-value open slice is **#25 scenario → runtime handoff** — the runtime can only run one hardcoded scenario, so 12 of 13 authored scenarios never execute and the existing exam-assembly logic has nothing to hand off to. Epic `arena-physics-clinical-touch-realbind-v1` is CLOSED (R1–R6 shipped 2026-08-02; R7 headset deferred by design per OD-4).

**Recent summary**: Garment + Q4 durableStore/admin emission batch closed. Arena physics v1 closed (MADR 0029, candidates). BOD 2026-08-02 pivoted queue to realbind successor (real WASM + factory + UI-XR bind).

## Ownership Matrix

**Ownership, dequeue order, and per-slice status are HOT state and live on the GitHub board**
(`simnova/OpenClinXR` issues + OpenClinXR-Planning project), not in this table.

This is not a formatting preference. A shared markdown table is the one artifact N concurrent
worktree agents cannot all update — every agent writes the same lines and they collide. GitHub
issues are concurrency-safe because each agent writes its OWN card. See
`agents/rules/EXEC_REHYDRATE.md` § State discipline (HOT → GitHub, COLD → files).

The previous table proved the point by rotting: on 2026-08-05 it was 59 days stale, 3 of its 5
rows were factually wrong, both "parked" workers had in fact been the most active areas in the
repo, and ~38% of shipped commits had no row at all. Root cause: `pnpm openclaw:post-slice`
writes to `PROJECT_STATUS.md` and never to this file, so the table had no update path. Recorded
in issue #27.

**Stable role map** (COLD — who leads which functional area; not a queue):

| Functional area | Role lead |
|---|---|
| WebXR asset & scene factory | asset-pipeline-lead |
| Exam running / UI-XR runtime + evidence | xr-systems-architect |
| Encounter authoring / admin / review | implementation-planning-lead |
| Model Vetting tester app | asset-pipeline-lead + productivity-skeptic |
| Harness / autonomy / orchestration | chief-coordinator |
| Adversarial review | openclaw-drift-police, productivity-skeptic, implementation-plan-gap-attacker |

Required per-slice record fields: Product path advanced, Blueprint/factory tie, Touched files, Evidence, Token introspection, Next queued slice.

## Validation Rules

- Every slice advances Q1, Q4, or Q5 per `agents/rules/GUARD_BLUEPRINT.md`
- Skeptic-visible delta in Model Vetting **or** UI-XR sample per `agents/rules/MANDATE_VISIBILITY.md`
- Post-slice: `pnpm openclaw:post-slice`; coordination edits: `pnpm agent:alignment && pnpm docs:drift-check`
- Rehydration: `agents/rules/EXEC_REHYDRATE.md`; `openclaw-runbook-2026-05-27.md`; UI-XR runtime evidence consumer; `openclaw:lease`
- Per-slice checkpoints: append to `PROJECT_STATUS.md` only (not this file's snapshot header)

## Per-Slice Checkpoints

(Historical worker-backlog checkpoints were archived under the local gitignored `.openclinxr/slice-archive/` tree (pre-optimization snapshot, 2026-06-07). New checkpoints go to `PROJECT_STATUS.md`. Archive via `pnpm openclaw:checkpoint:archive`.)