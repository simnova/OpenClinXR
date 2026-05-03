# Core Plan

## Implementation Milestone Structure

### Milestone 0: Planning Artifacts Frozen For Code

Deliverables:

- Code implementation plan.
- Worker backlog and validation matrix.
- Local hardware spike results.
- Local AI and voice model strategy.
- Updated development handoff.
- Leadership packets through iteration 0007.

Exit:

- Agent factory verification passes.
- Score trend shows no regression from iteration 0006.

### Milestone 1: Deterministic Station Core

Deliverables:

- pnpm TypeScript workspace.
- Shared schemas.
- Domain station state machine.
- ED chest pain scenario fixture.
- Trace ledger.
- Review workflow.
- Test harness simulation.

Exit:

- One command runs station lifecycle from fixture to review packet.
- No cloud key, local model, voice runtime, headset, or MongoDB is required.

### Milestone 2: API And Admin Review

Deliverables:

- Hono API using in-memory repositories.
- Admin scenario/review screens using Ant Design.
- Storybook for core admin components.
- API contract tests.
- Playwright admin smoke.

Exit:

- Admin can inspect review gates and trace replay for the ED station.
- Scenario approval cannot bypass required review roles.

### Milestone 3: Learner Runtime Shell

Deliverables:

- Vite XR/non-XR app.
- Desktop fallback.
- Placeholder room and actor slots.
- Doorway instructions, encounter timer, mock dialogue, EHR/note panel.
- WebGL nonblank screenshot test.

Exit:

- Desktop runtime can complete the station with mock interactions.
- XR entry remains feature-gated until Quest 3 manual smoke.

### Milestone 4: Local Runtime Readiness Spikes

Deliverables:

- Local model benchmark harness.
- Mock/local model provider health interface.
- Mock/local voice provider health interface.
- Optional Qwen/DeepSeek smoke notes on target hardware.
- Optional VibeVoice feasibility note with AI safety gates.

Exit:

- Local runtime choice remains data-driven.
- Production deployment can use Grok or other providers later without changing domain contracts.

### Milestone 5: Asset Pipeline Prototype

Deliverables:

- Asset manifest validation.
- Placeholder character/equipment/environment manifests.
- License/provenance gate.
- Manual or automated glTF optimization checklist.
- Quest 3 performance budget checklist.

Exit:

- ED station asset needs are defined enough for generated or hand-authored asset production.
- Missing license or performance smoke blocks simulation QA approval.

## First Commit Series

1. Workspace and verification scripts.
2. Shared schema package with tests.
3. Domain package with station transition tests.
4. ED chest pain fixture package with schema validation.
5. Trace ledger package with replay tests.
6. Review workflow package with review packet tests.
7. Test harness package with deterministic station simulation.
8. API shell with in-memory lifecycle endpoints.
9. Admin shell with review gate and trace replay.
10. XR fallback shell with nonblank canvas.
11. Mock model and voice gateways with audit records.
12. Asset registry manifest validation.
13. End-to-end local verification command.

## Coding Principles

- Prefer pure domain code and contract tests before UI.
- Keep every provider replaceable.
- Default to mock providers.
- Record every trace event needed for faculty review.
- Preserve multi-actor station structure from the first fixture.
- Use source records and MADRs when adding nontrivial dependencies.
- Do not introduce paid API calls, cloud resources, or model downloads as default setup.

