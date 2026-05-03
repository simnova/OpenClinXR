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

The most detailed build sequence now lives in:

- `docs/openclinxr/code-implementation-plan.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`

Use those documents as the implementation source of truth. The phase outline below is the shorter orientation version.

### Phase 0: Repo And Domain Skeleton

Create a TypeScript monorepo influenced by CellixJS DDD patterns:

- `apps/api`
- `apps/web`
- `apps/admin`
- `apps/xr`
- `packages/domain`
- `packages/data-mongodb`
- `packages/scenario-runtime`
- `packages/model-gateway`
- `packages/voice-gateway`
- `packages/trace-ledger`
- `packages/review-workflow`
- `packages/shared-schemas`
- `packages/test-harness`
- `packages/asset-registry`

### Phase 1: Blueprint And Scenario Bank

Implement:

- Exam blueprint CRUD.
- Scenario bank CRUD.
- Actor card CRUD.
- Communication-style profile CRUD.
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
- Communication-style and bounded-stubbornness policy.
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
5. Communication-style adherence without repetitive or exaggerated behavior.
6. MongoDB schema and index performance for trace replay.
7. CellixJS fit for DDD/monorepo/runtime patterns.

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
- `docs/openclinxr/station-pack-ed-chest-pain-v1.md`
- `docs/openclinxr/psychometric-and-review-governance.md`
- `docs/openclinxr/claims-consent-privacy-governance.md`
- `docs/openclinxr/technology-approach-brief.md`
- `docs/openclinxr/asset-generation-pipeline.md`
- `docs/openclinxr/webxr-azure-quest-performance-brief.md`
- `docs/openclinxr/virtual-patient-agent-model.md`
- `docs/openclinxr/communication-style-and-emotion-qa.md`
- `docs/openclinxr/sample-case-bank-v1.md`
- `docs/openclinxr/admin-ux-and-testing-brief.md`
- `docs/openclinxr/model-provider-and-voice-routing.md`
- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `docs/openclinxr/mongodb-memory-server-test-strategy.md`
- `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md`
- `docs/openclinxr/code-implementation-plan.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/openclinxr/development-handoff.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- MADRs 0011 through 0027

## Code-Phase Hard Stops

- Do not require cloud API keys, paid services, local model downloads, local voice runtimes, MongoDB, Bun, or Quest 3 hardware for the first deterministic station simulation.
- Do not start local LLM or voice runtime implementation until mock provider audit contracts exist and pass verification.
- Do not start generated-human asset work until asset manifest validation and license/provenance gates exist.
- Do not claim diagnostic performance, licensure readiness, ECFMG replacement, USMLE equivalence, or validated high-stakes scoring.
- Do not call the first XR shell ready until the desktop fallback renders a nonblank canvas and core text does not overlap.
- Do not claim Quest readiness until the Quest 3 USB-C smoke checklist records a pass or a precise blocker.
- Do not approve a scenario without clinical, psychometric, legal, and simulation QA review states.

## Local Hardware Updates

- Android Platform Tools were installed locally on 2026-05-03.
- The Quest 3 is visible to `adb`; USB debugging was authorized earlier, `adb reverse tcp:5173 tcp:5173` succeeded, and Quest Browser loaded a static local smoke page. A later check saw the same headset as `unauthorized`, so the next headset smoke requires accepting the USB debugging prompt again.
- `mongodb-memory-server` is accepted as the local MongoDB integration-test path, with binary download/cache behavior documented as an explicit setup gate.

## Implementation Progress

Milestone 1 deterministic station core has started:

- pnpm workspace added.
- Shared schemas package added.
- Pure station domain package added.
- ED chest pain fixture package added.
- In-memory trace ledger package added.
- Review workflow package added.
- Test harness package added.

The current deterministic harness runs the ED chest pain fixture through station start, encounter, nurse interruption, learner actions, patient note submission, trace replay, and faculty review packet generation using the offline model and voice gateways for provider health.

Milestone 2 API shell has also started:

- Hono API app exists at `apps/api`.
- API can serve the ED fixture, start a session, append learner trace events, submit a note, and return a review packet.
- API state is intentionally in-memory for this slice; MongoDB remains a later repository-contract milestone.
- API provider health is now sourced from the offline model and voice gateways rather than hard-coded local literals.

MongoDB repository-contract milestone has also started:

- `packages/data-mongodb` exists.
- `mongodb-memory-server` tests pass locally using MongoDB binary `7.0.24`.
- Scenario and trace repositories now have first contract tests for versioned scenario lookup, approved scenario queries, trace append, ordered replay, and sequence uniqueness.

XR station-shell milestone has also started:

- `apps/xr` exists.
- The ED chest pain station shell renders a Three.js emergency department bay with patient, nurse, spouse, bed, monitor, timer/status strip, simulated EHR, mock dialogue, and trace action controls.
- Runtime state tests, package typecheck, and production build pass locally.
- Desktop and mobile browser smoke checks show a nonblank canvas with no console errors and readable control surfaces.
- The current Quest 3 device smoke is blocked by ADB reporting `unauthorized`; the headset needs the USB debugging prompt accepted again before rerunning the shell in Quest Browser.

Offline model/voice gateway milestone has also started:

- `packages/model-gateway` exists.
- `packages/voice-gateway` exists.
- Mock model responses are deterministic and include provider/model IDs, policy IDs, prompt template ID, scenario version, actor ID, retrieved memory IDs, safety policy version, token usage, zero cost, and guardrail result.
- Mock voice streaming emits partial/final transcript events and audio chunk events with provenance and a viseme cue.
- Local model and voice adapters are intentionally surfaced as `not_configured` until local Qwen/Kimi/DeepSeek or VibeVoice-style runtime adapters are explicitly installed and benchmarked.

Asset registry milestone has also started:

- `packages/asset-registry` exists.
- ED chest pain placeholder manifests exist for patient, nurse, and ED bay assets.
- Registry readiness checks block copyleft/unknown/review-required licenses, missing QA, and over-budget Quest 3 geometry/texture/draw-call profiles.
- This is the gate to use before attempting Anny, MakeHuman, StableGen, SMPLitex, clothing, rigging, or generated-environment ingestion.

Scenario runtime milestone has also started:

- `packages/scenario-runtime` exists.
- It centralizes the ED chest pain station session flow, trace append, note submission, provider health, asset readiness, and review packet generation.
- It is the intended shared orchestration layer for future API and XR runtime integration, replacing duplicated station-flow logic as the next cleanup.
