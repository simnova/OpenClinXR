# Iteration 0002 Core Revision

## Accepted Red-Team Changes

The core team accepts the adversarial proof ladder and revises the development handoff:

1. Keep the full 12-station data model, state machine, and exam-form design.
2. Implement the first code milestone as one complete ED chest pain station.
3. Prove faculty/psychometric review before learner-facing scoring.
4. Prove deterministic actor traces before live LLM dialogue.
5. Add LLM dialogue only behind strict actor schemas, guardrails, and audit logs.
6. Add XR and speech only after station timing and trace completeness work reliably.
7. Treat CellixJS as an evaluated influence rather than a committed dependency.

## Revised First Build Milestone

The next implementation plan should produce:

- TypeScript monorepo skeleton.
- Shared domain schemas for blueprint, scenario, actor card, exam form, session, station run, trace event, review packet, and knowledge graph node/edge.
- MongoDB repository interfaces and indexes.
- ED chest pain station seed data.
- Scenario publication workflow with clinical, psychometric, legal, and simulation QA states.
- Deterministic station runtime with timer, note auto-submit, nurse interruption, family pressure, and trace ledger.
- Faculty review packet and human rubric scoring.
- Mock LLM gateway contract with audit event shape.

## Revised Non-Negotiables

- No Step 2 CS equivalence claims.
- No confidential exam content.
- No high-stakes score-use claims.
- No real patient data.
- No learner pass/fail output from automated scoring.
- No unlogged LLM output.
- No scenario activation without human review states.

## Updated Confidence

The plan is ready for implementation planning after the remaining source-ledger and technology-spike debt is tracked. It is not ready for external pilot claims or validation claims.
