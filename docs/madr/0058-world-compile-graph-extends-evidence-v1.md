# 0058 — World Compile Graph is an additive projection on encounter-materialization-evidence.v1

- Status: **accepted** (operationalize 2026-08-27)
- Date: 2026-08-27
- Deciders: Patrick (operator); chief-coordinator embodiment
- Relates to: MADR 0020 (antd + xyflow), 0030 (physics JSON), 0044/0051/0052 (MPFB), 0053 (rooms), 0054/0055 (equipment)
- Implements: lockable compile nodes without a fourth factory ledger

## Context

Faculty cannot lock a generated nurse, gown, or cart across rebakes. Factory already emits input-manifest, operation-manifest, evidence.v1. A new `WorldCompileGraph.v1` stored schema would collide with those ledgers.

## Options

- A. New stored schema + new admin route + canvas-first.
- B. Extend `openclinxr.encounter-materialization-evidence.v1` with optional lock/stale/hash/edges; faculty Table on `EnvironmentGenerationQueuePanel`; `@xyflow/react` as a later view; split body vs wardrobe so lock can skip a baker.
- C. Full-encounter rebake forever.

## Decision

**B.** Product copy may say World Compile Graph. Stored `schemaVersion` stays `openclinxr.encounter-materialization-evidence.v1`. Bump `.v2` only if a field becomes required.

- `#167` and `FacultyReviewDecisionPanel` stay packet promote/hold.
- `CaseAuthoringWorkbench` stays case-only.
- Mongo `encounter_materialization_evidence` unique `{scenarioId, caseDefVersion, compileVersion}` is a projection; file-first dated JSON remains CI SSOT.
- ui-xr consumes `contentHash` / GLB paths only, never the graph editor.
- Phase 0 emits unsplit actor/equipment nodes only.
- `compile()` honors `planWardrobeBake`: locked wardrobe + unchanged body hash must not invoke Blender.

## Consequences

- Dated 2026-05-28 evidence JSON must still validate.
- Queue `contentHash` is sha256 of artifact bytes or omitted — never `local-deterministic-encounter-definition-contract`.
- Canvas is a view; Table is the write path.
- Does not thaw `#167`. Not Quest/scoring/clinical-validity evidence.
