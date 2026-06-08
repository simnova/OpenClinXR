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
last_measured: 2026-06-07
parseable_sections: 4
---

## Current State Snapshot

**Stable product north star**: Blueprint-driven encounter factory for Step 2 CS-inspired XR clinical-skills exam platform. Case definitions drive generated runtime (actors, dialogue, emotion, locomotion, assets), review/persistence/replay.

**Functional areas** (sizable collaborative vertical slices): WebXR asset & scene factory, exam running (UI-XR + evidence), Model Vetting tester app, encounter authoring/admin/review.

**Rehydration contract**: Read this header + ownership matrix only (~40 lines). Transient WIP (file:line, subagent IDs, capture logs) lives in `PROJECT_STATUS.md` § Per-Slice Checkpoints or `docs/openclinxr/slice-archive/`. Strategic direction: `PROJECT_STATUS.md` § Strategy.

**Stable emphasis**: Sizable collaborative vertical slices; visibility/noticeability mandate; Q1/Q4/Q5; anti-toil; conversation tooling first-class; cheap-first tiering + self-escalation.

**Next priority**: On resume (`pnpm openclaw:run-next` → lease → slice-team), orchestration coordinator dequeues from `PROJECT_STATUS.md` **Next dequeue** and selects a slice provable in Model Vetting, UI-XR, or asset pipeline.

**Recent summary**: Real garment sleeves from `phenotype.garmentLayers` closed in tester + UI-XR (Q1/Q5). Encounter authoring + review packet loop batch closed (Q1/Q4). Harness optimization slice in flight (Q5).

## Ownership Matrix

| Worker | Area | Next slice | Template | Role lead |
|--------|------|------------|----------|-----------|
| 9/11 | UI-XR evidence | `peds-evidence-loop` | peds-evidence-loop | xr-systems-architect |
| 10/11 | Asset factory | `peds-parent-nurse-garment-asset` | real-garment-v1 | asset-pipeline-lead |
| 7/8/9 | Admin review/replay | `admin-packet-replay-surfaces-impl` | admin-packet-replay | implementation-planning-lead |
| 0 | Harness/autonomy | instruction-stack optimization | — | chief-coordinator |

Required per-slice record fields: Product path advanced, Blueprint/factory tie, Touched files, Evidence, Token introspection, Next queued slice.

## Validation Rules

- Every slice advances Q1, Q4, or Q5 per `agents/rules/GUARD_BLUEPRINT.md`
- Skeptic-visible delta in Model Vetting **or** UI-XR sample per `agents/rules/MANDATE_VISIBILITY.md`
- Post-slice: `pnpm openclaw:post-slice`; coordination edits: `pnpm agent:alignment && pnpm docs:drift-check`
- Rehydration: `agents/rules/EXEC_REHYDRATE.md`; `openclaw-runbook-2026-05-27.md`; UI-XR runtime evidence consumer; `openclaw:lease`
- Per-slice checkpoints: append to `PROJECT_STATUS.md` only (not this file's snapshot header)

## Per-Slice Checkpoints

(Historical worker-backlog checkpoints archived to `.openclinxr/slice-archive/worker-backlog-pre-optimization-2026-06-07.md`. New checkpoints go to `PROJECT_STATUS.md`. Archive via `pnpm openclaw:checkpoint:archive`.)