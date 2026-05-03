# Leadership Packet: iteration-0007

## Score Summary

```text
iterations/iteration-0007/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.748
  composite_score: 4.747
  confidence: 0.93
  critical_risks: 2
  evidence_debt: 2
  decision_debt: 1
```


---

# Iteration 0007 Brief

Date: 2026-05-03
Loop focus: final code-phase readiness lock

## Objective

Run one more Core-Adversarial-Leadership loop to lock the implementation plan into a handoff that a development team can execute. The goal is not to build code yet. The goal is to remove ambiguity, identify remaining gates, and define what "ready to start implementation" means.

## Inputs

- Iteration 0006 leadership review and scorecard.
- Worker-ready implementation plan.
- Local hardware spike findings.
- Local model and voice strategy.
- Existing OpenClinXR architecture, UX, MongoDB, statechart, asset, governance, and case-bank documents.

## Required Decisions

- What is the code-phase milestone structure?
- What must be in the first commit series?
- Which local-only spikes should happen during implementation versus before implementation?
- What quality bars prevent premature "complete" claims?
- What should leadership expect after the first implementation sprint?

## Output Standard

The final output must be detailed enough for a TypeScript/React-oriented team to start the next phase without needing to rediscover architecture, roles, source assumptions, or test expectations.




---

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




---

# Adversarial Counterplan

## Final Attack

The plan is now strong, but the adversarial team still finds these failure modes:

1. A team could implement schemas that are too shallow, forcing later breaking changes.
2. Mock actor dialogue could become disconnected from the clinical objectives.
3. The admin shell could be visually plausible without proving review governance.
4. The XR shell could prove canvas rendering but not interaction ergonomics.
5. Optional local model research could consume time before the deterministic station is valuable.
6. Local voice research could create safety and consent work before text dialogue works.
7. The asset pipeline could become a research project before placeholder geometry is enough.
8. MongoDB indexing assumptions could remain untested until late.
9. "Maturity over time" could be lost unless scorecards become part of development cadence.

## Required Hard Stops

- Do not start local LLM or voice implementation until the mock provider audit contract exists.
- Do not start generated-human asset work until asset manifest validation exists.
- Do not start MongoDB optimization until repository contract tests exist.
- Do not call the XR shell ready until desktop screenshot, canvas nonblank, and responsive text checks pass.
- Do not claim psychometric validity until real scoring studies exist.
- Do not claim clinical safety or diagnostic performance.

## Adversarial Additions To Backlog

- Add claim-language linting for docs and UI copy.
- Add fixture clinical-objective assertions so mock dialogue maps back to station objectives.
- Add a `requiredTraceTags` review-packet test for each case.
- Add a scenario coverage matrix before a second station enters the bank.
- Add skipped-optional-runtime reporting to CI output.
- Add license metadata to every asset manifest entry.

## Final Red-Team Conclusion

The plan is ready only if leadership treats "first build complete" as an evidence statement backed by automated verification, not a visual demo milestone.




---

# Core Revision

## Accepted Final Changes

The Core team accepts all final red-team hard stops and adds them to the code-phase handoff.

## Added Quality Bars

- Every scenario fixture must include required clinical objectives, required trace tags, actor constraints, environment needs, and review rubric IDs.
- Mock dialogue fixtures must point to station objectives and actor cards.
- Review packet tests must distinguish observed, missing, late, and unsafe behaviors.
- UI copy must avoid exam-equivalence, diagnostic, and automated high-stakes scoring language.
- Optional runtime health output must be machine-readable.
- Asset records must include provenance, license, optimization target, and QA status.

## Final Implementation Readiness Statement

The plan is ready for code implementation, but not for production deployment. The next phase should build a local, deterministic, single-user first station that proves the architecture can support the larger XR simulation vision.

## Final Development Team Guidance

- Start with Milestone 1.
- Preserve test-first sequencing.
- Keep UI and XR shells thin until trace and review are proven.
- Treat local model/voice/asset spikes as secondary work unless the deterministic station blocks on them.
- Keep architecture docs and MADRs updated when code reveals different constraints.




---

# Leadership Review

## Final Decision

Senior Leadership approves the implementation plan for a code-phase start, subject to the hard stops and evidence gates documented in this iteration.

## Leadership Directives

CTO:

- Build the domain, trace, and review core before increasing runtime complexity.
- Keep all model and voice integrations behind adapters.

VP Engineering Delivery:

- Use the first commit series as the development queue.
- Commit in small slices with tests passing at each step.

Chief Medical Education Officer:

- Maintain the ED chest pain station's interprofessional and family-pressure elements.
- The station should teach and assess communication and prioritization, not just differential diagnosis.

Chief Psychometrician:

- Use trace-supported review as the first evidence substrate.
- Do not allow validity language to exceed available evidence.

Chief AI Safety Officer:

- Synthetic voice and local reasoning models require separate safety review before learner exposure.
- Provider audit records are mandatory.

General Counsel:

- The plan's non-goals and license gates are adequate for code start.
- Continue to avoid AGPL/copyleft default dependencies.

Simulation Center Director:

- The first demo must show faculty review and debrief value, not only learner immersion.

Chief Nursing Interprofessional Officer:

- Nurse actor behavior and escalation handling must be tested as first-class scenario requirements.

## Approved Next Step

Begin implementation only after committing the planning artifacts and verification output. The first implementation branch should target Milestone 1 and stop if the deterministic station simulation cannot be made reliable.




---

# Final Synthesis

The agent loop has reached a credible code-phase handoff. The system design is not complete in the sense of production readiness; it is complete enough to begin building the first deterministic OpenClinXR vertical slice without guessing at architecture, package ownership, test strategy, local-runtime posture, or claims boundaries.

## Final Plan Shape

- Build local-first.
- Start with one ED chest pain station.
- Use deterministic fixtures and mock providers.
- Prove trace and review before expanding immersion.
- Keep LLM, voice, MongoDB, Bun, and asset-generation tools behind gates.
- Use scorecards and leadership packets to keep maturity visible across iterations.

## What The Development Team Can Start With

- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- `docs/openclinxr/code-implementation-plan.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `docs/openclinxr/development-handoff.md`

## Remaining Before Production

- Real Quest 3 comfort and performance evidence.
- Real local model and local voice benchmarks on target hardware.
- Clinical expert review of every production case.
- Psychometric evidence for any scored use.
- Security, privacy, and legal review of data handling.
- Asset provenance and license audit.




---

# Memory Update Log

## New Durable Lessons

- Chief Coordinator: final loop approval requires milestones, hard stops, and evidence gates, not only higher scores.
- Rubric Steward: iteration scoring should remain part of the development cadence after code begins.
- Implementation Planning Lead: commit order is now part of the implementation contract.
- Test Automation Lead: deterministic station simulation is the first completion gate.
- Clinical Simulation Lead: faculty review and debrief value must be visible in the first demo.
- Psychometrics Lead: trace-supported review is the only defensible first scoring substrate.
- Voice And Speech Engineer: local voice must remain separate from mock dialogue until safety review passes.
- Local AI Inference Engineer: Kimi-class models are research/server candidates, while small Qwen/DeepSeek candidates are better local smoke targets.
- VP Engineering Delivery: planning artifacts should be committed before implementation begins.

## Open Risks

- Optional local AI or asset work could distract from first station proof.
- Quest 3 performance remains a manual evidence gate.
- Validity, reliability, fairness, and clinical safety require studies beyond the prototype.


