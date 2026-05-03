# Development Handoff

Date: 2026-05-03
Status: Next-code-phase handoff draft

## Build Goal

Build the first OpenClinXR planning-to-runtime skeleton for a Step 2 CS-inspired, multi-station XR clinical skills exam system. The first code milestone should support authoring an exam blueprint, drafting a station, reviewing it, assembling an exam form, starting an exam session, recording trace events, and generating a faculty review packet.

## Non-Goals

- No high-stakes scoring.
- No ECFMG/USMLE equivalence claims.
- No confidential exam content.
- No real patient data.
- No public marketplace.
- No EHR integration.
- No production-grade avatar pipeline.

## Recommended First Implementation Phases

### Phase 0: Repo And Domain Skeleton

Create a TypeScript monorepo influenced by CellixJS DDD patterns:

- `apps/api`
- `apps/web`
- `packages/domain`
- `packages/data-mongodb`
- `packages/scenario-runtime`
- `packages/llm-gateway`
- `packages/trace-ledger`
- `packages/review-workflow`
- `packages/shared-schemas`

### Phase 1: Blueprint And Scenario Bank

Implement:

- Exam blueprint CRUD.
- Scenario bank CRUD.
- Actor card CRUD.
- Environment catalog CRUD.
- Review status workflow.
- Source and claim ledger.

Acceptance:

- Admin can create a blueprint and one ED chest pain station.
- Station cannot be published without clinical, psychometric, and legal review states.

### Phase 2: Exam Form Assembly

Implement:

- Exam form assembler from approved scenarios.
- Coverage matrix against AMA day-one skills and EPAs.
- Station ordering.
- Version lock.

Acceptance:

- Admin can assemble an ordered exam form.
- The system flags missing skill coverage.

### Phase 3: Station Runtime Skeleton

Implement:

- Exam session start.
- Doorway instructions.
- Encounter timer.
- Note timer.
- Station transition.
- Trace event append.
- Mock actor responses.

Acceptance:

- Learner can complete one station with trace events and a patient note.

### Phase 4: LLM Actor Gateway

Implement:

- Actor dialogue request contract.
- Prompt policy.
- Memory retrieval pack.
- Safety guardrail.
- LLM audit event.
- Mock provider and one real provider adapter.

Acceptance:

- Actor responses are generated with auditable prompt/model/memory provenance.
- Guardrail can block a response and produce fallback.

### Phase 5: Faculty Review Packet

Implement:

- Review queue.
- Trace timeline.
- Highlighted required events.
- Rubric scoring.
- Faculty comments.
- Score audit event.

Acceptance:

- Faculty can review a station and submit human-governed scores.

## Critical Engineering Spikes

1. Quest browser/WebXR capability and latency.
2. ASR latency and medical vocabulary reliability.
3. TTS naturalness and emotional controllability.
4. LLM actor consistency under adversarial learner inputs.
5. MongoDB schema and index performance for trace replay.
6. CellixJS fit for DDD/monorepo/runtime patterns.

## First Acceptance Test Scenario

ED Chest Pain:

- Learner receives doorway instructions.
- Patient, nurse, and family member are present.
- Learner asks pain/history questions.
- Nurse interruption introduces new vital sign.
- Learner requests ECG or escalates.
- Learner submits patient note.
- Faculty opens review packet and scores history, urgent recognition, teamwork, documentation, and organizing work.

## Readiness Gates Before Code

The next implementation plan should not start until these docs are reviewed:

- `docs/openclinxr/research-brief-step2cs-llm-vsp.md`
- `docs/openclinxr/exam-scenario-architecture.md`
- `docs/openclinxr/mongodb-data-model.md`
- `docs/openclinxr/statecharts-and-sequences.md`
- `docs/openclinxr/ux-flows.md`
- `docs/openclinxr/knowledge-graph-and-indexing.md`
- `docs/openclinxr/development-handoff.md`
- MADRs 0011 through 0015

