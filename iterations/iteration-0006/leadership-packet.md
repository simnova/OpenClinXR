# Leadership Packet: iteration-0006

## Score Summary

```text
iterations/iteration-0006/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.676
  composite_score: 4.676
  confidence: 0.92
  critical_risks: 2
  evidence_debt: 2
  decision_debt: 1
```


---

# Iteration 0006 Brief

Date: 2026-05-03
Loop focus: adversarial implementation gap closure and automated verification

## Objective

Convert the implementation plan from an architectural backlog into a worker-ready build sequence that can survive skeptical review. This iteration asks the Core team to prove the first vertical slice is small enough to build, the Adversarial team to attack every implied dependency and missing test, and Senior Leadership to decide whether the next code phase has sufficient guardrails.

## Activated Agents

Core:

- Implementation Planning Lead
- Test Automation Lead
- Local AI Inference Engineer
- Voice And Speech Engineer
- Solution Architect
- Data And Trace Architect
- XR Systems Architect
- Security And Privacy Lead
- Psychometrics Lead
- Clinical Simulation Lead

Adversarial:

- Implementation Plan Gap Attacker
- Supply Chain Dependency Attacker
- Local Model Performance Skeptic
- Voice Safety Misuse Attacker
- Security Privacy Attacker
- Psychometric Overclaim Critic
- UX Friction Critic

Leadership:

- VP Engineering Delivery
- CTO
- Chief AI Safety Officer
- Chief Medical Education Officer
- Chief Psychometrician
- Chief Nursing Interprofessional Officer
- General Counsel
- Simulation Center Director

## Inputs

- `docs/openclinxr/code-implementation-plan.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `docs/openclinxr/station-pack-ed-chest-pain-v1.md`
- `madr/0021-local-first-no-cloud-implementation-spikes.md`
- `madr/0022-local-llm-runtime-and-model-tiering.md`
- `madr/0023-vibevoice-as-local-voice-candidate.md`
- `madr/0024-pnpm-node-first-bun-deployment-gate.md`
- `madr/0025-implementation-plan-as-versioned-artifact.md`

## Required Output

- A gap-attacked implementation sequence.
- A verification matrix for every early package and app.
- Explicit no-cloud local-runtime gates.
- Dependency and license controls before optional AI/voice/XR tools enter the build.
- Updated memory notes for agents whose responsibilities changed.




---

# Core Plan

## Core Position

The implementation can begin, but only as a deterministic first vertical slice. The team must treat local LLMs, local voice, MongoDB, WebXR headset validation, generated 3D humans, and Bun as gated capabilities rather than build blockers.

The first code branch should prove one thin thread:

1. Load the approved ED chest pain scenario fixture.
2. Start a station run.
3. Move through doorway, encounter, note, and review states.
4. Append deterministic trace events.
5. Produce a review packet.
6. Render a minimal admin review UI.
7. Render a non-XR learner runtime shell.
8. Expose mock model and voice providers with auditable contracts.

## Worker-Ready Decomposition

### Worker A: Workspace And Schemas

Owns:

- `pnpm-workspace.yaml`
- root `package.json`
- `tsconfig.base.json`
- `packages/shared-schemas`

Acceptance:

- `pnpm install` completes without optional AI or graphics dependencies.
- Schemas validate scenario, actor, trace, station state, patient note, review packet, model audit, voice audit, and asset manifest.
- Publishing a scenario without clinical, psychometric, legal, and simulation QA review states fails validation.

### Worker B: Domain And Scenario Fixture

Owns:

- `packages/domain`
- `packages/scenario-fixtures`

Acceptance:

- Station transitions are pure and deterministic.
- The ED chest pain fixture includes patient, spouse, and nurse actor cards.
- Required trace tags include ECG request, escalation, empathy, family communication, teamwork, and patient note.
- Domain tests prove incorrect ordering is rejected.

### Worker C: Trace Ledger And Review Workflow

Owns:

- `packages/trace-ledger`
- `packages/review-workflow`

Acceptance:

- In-memory trace append enforces station run ID and sequence ordering.
- Replay reconstructs the station timeline.
- Review packet identifies observed, missing, and late required behaviors.
- Faculty score draft is human-authored and never described as automated high-stakes scoring.

### Worker D: API Shell

Owns:

- `apps/api`
- API-facing repository interfaces

Acceptance:

- Hono server exposes health, scenario fixture, session start, event append, note submit, mock actor response, and review packet endpoints.
- API contract tests use in-memory repositories by default.
- MongoDB tests are skipped unless `OPENCLINXR_MONGO_URI` is set.

### Worker E: Admin UX

Owns:

- `apps/admin`
- reusable admin components if created later

Acceptance:

- Admin loads the ED chest pain station.
- Review status cannot jump to approved unless the required reviewer roles are present.
- Trace replay is visible in a dense Ant Design table/timeline layout.
- Storybook stories exist for scenario summary, review gate panel, trace timeline, and review packet.

### Worker F: XR Runtime Shell

Owns:

- `apps/xr`
- XR runtime fixtures

Acceptance:

- Desktop fallback renders without headset.
- Canvas is nonblank and stable under Playwright screenshot checks.
- XR entry is feature-detected and disabled when unavailable.
- Doorway instructions, timer, mock dialogue, and simulated EHR/note panel are visible without relying on generated avatars.

### Worker G: Model And Voice Gateways

Owns:

- `packages/model-gateway`
- `packages/voice-gateway`
- local benchmark contracts

Acceptance:

- Mock providers are deterministic.
- Local provider adapters return explicit `not_configured` health states when MLX, llama.cpp, Ollama, or VibeVoice are absent.
- No model download occurs during install, test, or dev server startup.
- Benchmark CLI can measure mock latency and record host metadata.

### Worker H: Test Harness And Verification

Owns:

- `packages/test-harness`
- root verification scripts

Acceptance:

- One deterministic station simulation can run headlessly.
- It emits a trace, submits a note, and generates a review packet.
- CI-equivalent local command runs typecheck, unit tests, contract tests, and mock simulation.
- Optional gates print skipped status with reasons.

## Dependency Rules

- Pin dependency versions during implementation; do not use `latest` in new application package manifests.
- Add optional dependencies only after a license and install-risk note is recorded.
- Keep AGPL/copyleft packages out of default runtime.
- Keep vendor model/voice APIs behind adapter interfaces with no keys required.
- Do not run paid cloud APIs during spikes.

## Local Runtime Rules

- MLX LM and llama.cpp are evaluation candidates, not required packages.
- Qwen3 4B GGUF is the first small local smoke candidate.
- DeepSeek-R1-Distill-Qwen 7B is a reasoning candidate after small-model smoke passes.
- Kimi-K2-Thinking is a server/offload research candidate, not the MacBook default.
- VibeVoice is a local voice research candidate behind consent, watermarking/disclosure, and misuse gates.

## Verification Matrix

| Area | First test | Blocker threshold |
| --- | --- | --- |
| Schemas | AJV/TypeBox unit tests | invalid approved scenario passes |
| Domain | station state Vitest tests | illegal transition accepted |
| Trace | append/replay tests | sequence gap not detected |
| Review | packet tests | missing required trace tag not flagged |
| API | supertest/undici contract tests | cloud key required |
| Admin | Storybook and Playwright | review gate can be bypassed |
| XR | screenshot and WebGL nonblank | blank canvas or overlapping core UI |
| Model | mock provider tests | live provider required |
| Voice | mock provider tests | audio runtime required |
| Assets | manifest validation | missing license accepted |




---

# Adversarial Counterplan

## Highest-Risk Holes Found

1. The implementation plan is broad enough that workers could scaffold many packages without producing a working station.
2. The proposed package manifests use broad dependency ranges in examples; this weakens reproducibility.
3. Local hardware findings were gathered on an M1 Max with 64 GB RAM, not the user's stated M4Pro/M4Max target, so local-model optimism must be bounded.
4. VibeVoice is not a default-safe production component because the upstream project itself highlights misuse and reliability concerns.
5. WebXR headset performance remains unvalidated; desktop screenshot checks do not prove Quest 3 comfort.
6. MongoDB repository tests could become theater if no local MongoDB instance or Testcontainers path is available.
7. Asset generation is still a separate pipeline; first code should not depend on MakeHuman, ANNY, StableGen, SMPLitex, Blender, or glTF Transform.
8. A mock actor can hide prompt and guardrail failures unless provider audit contracts are defined early.
9. Admin UI complexity can expand before the core station lifecycle works.
10. Review packet wording can accidentally imply summative scoring or exam equivalence.

## Required Countermeasures

- Reduce the first sprint to one executable thin thread and reject unrelated scaffolding.
- Add a worker backlog matrix that binds each package to tests, commands, and expected artifacts.
- Treat every optional runtime as a health-checked adapter with `not_configured` as a passing local state.
- Add explicit legal and AI safety notes to the voice gateway before evaluating VibeVoice.
- Add dependency-license intake before adding XR, 3D, model, voice, and test automation packages beyond the TypeScript core.
- Add text assertions that prohibit high-stakes, diagnostic, licensure, or ECFMG-equivalence claims.
- Add trace replay contract tests before faculty review UI work.
- Add nonblank canvas and responsive text checks before any detailed XR scene work.

## Adversarial Alternative

If the team wants even tighter scope, start with a CLI-only proof:

1. Load fixture.
2. Simulate learner events.
3. Generate trace.
4. Generate review packet.
5. Validate claims language.

Only after that passes should API, admin, and XR shells be added. This reduces user-visible momentum but gives the fastest proof that the core design is buildable.

## Decision The Red Team Forces

The core team must choose between:

- **Thin-thread UI first:** API, admin, and XR shells appear quickly, with mocks.
- **CLI-first proof:** domain, trace, and review are proven before UI.

Adversarial recommendation: use thin-thread UI only if the test harness is built in parallel and blocks completion claims.




---

# Core Revision

## Adopted Changes

The Core team accepts the red-team narrowing. The implementation plan will now use a dual-track first sprint:

- Track 1: CLI/test-harness proof of the station lifecycle.
- Track 2: minimal API/admin/XR shell that consumes the same fixture and trace contracts.

No optional local LLM, voice, MongoDB, asset-generation, Bun, or Quest-specific dependency may block Track 1.

## Revised First Sprint Definition

The first sprint is complete only when:

1. A deterministic ED chest pain station simulation runs in tests.
2. The generated trace replays in order.
3. Review packet flags observed and missing behaviors.
4. API exposes the same lifecycle through in-memory repositories.
5. Admin displays the review packet.
6. XR fallback displays doorway, timer, mock dialogue, and note panel.
7. Mock model and voice providers emit audit records.
8. A verification command proves all of the above without cloud keys or model downloads.

## Package Freeze For First Sprint

Allowed default packages:

- TypeScript
- Vitest
- AJV
- TypeBox
- Hono
- React
- Vite
- Ant Design
- Three.js or equivalent only after license intake
- Playwright after the first app exists

Deferred:

- MongoDB runtime dependency
- Bun install
- MLX LM
- llama.cpp
- Ollama
- VibeVoice
- MakeHuman/ANNY/StableGen/SMPLitex asset generation
- Serenity/JS
- Storybook beyond a first admin component story

## Claim-Language Guard

Every user-visible and documentation-facing feature should use these terms:

- "training simulation"
- "faculty review"
- "scenario review"
- "practice station"
- "trace-supported review"

Avoid:

- "diagnosis engine"
- "automated licensure scoring"
- "ECFMG replacement"
- "USMLE equivalent"
- "validated high-stakes exam"

## Updated Test Priority

1. Schema contract tests.
2. Domain transition tests.
3. Trace append/replay tests.
4. Review packet tests.
5. Test harness station simulation.
6. API contract tests.
7. Admin review gate test.
8. XR nonblank rendering test.
9. Provider health-state tests.
10. Dependency-license gate test.




---

# Leadership Review

## Decision

Senior Leadership approves the narrowed implementation plan for code-phase handoff, with one condition: the first build must prove a complete deterministic station lifecycle before optional local AI, voice, MongoDB, or avatar generation work is treated as progress.

## Executive Notes

VP Engineering Delivery:

- The plan is now implementable because the first sprint has a measurable thin thread.
- The worker backlog must be maintained as a living artifact until code begins.

CTO:

- The adapter-first posture is correct.
- Do not couple API startup to local model runtimes or voice runtimes.

Chief AI Safety Officer:

- Voice synthesis must remain behind disclosure, consent, provenance, and misuse review gates.
- Mock voice is enough for first build.

Chief Medical Education Officer:

- The ED chest pain station remains an appropriate first scenario because it tests urgency, communication, teamwork, and documentation.
- The experience should be described as simulation and training, not licensure assessment.

Chief Psychometrician:

- Trace-supported review is acceptable.
- Reliability and validity claims remain future evidence work.

Chief Nursing Interprofessional Officer:

- Nurse interruption and handoff behaviors must remain first-class trace tags.
- The first station should not collapse into physician-patient dialogue only.

General Counsel:

- The no-cloud default and explicit non-goals reduce privacy and regulatory risk.
- Licensing review is mandatory before adding asset-generation and voice dependencies.

Simulation Center Director:

- Faculty review workflow is necessary for credibility.
- Keep the admin UI dense and practical.

## Required Revisions Before Code

- Add a worker backlog and validation matrix.
- Update development handoff to include MADRs 0021-0025.
- Update memory for the new implementation, local AI, voice, test, legal, adversarial, and leadership agents.
- Regenerate leadership packets after scorecards are present.




---

# Final Synthesis

Iteration 0006 improves the plan by making the first build falsifiable. The team now has a thin thread, worker ownership, dependency controls, local-runtime gates, and a verification matrix.

## What Changed

- Optional local AI and voice moved from "implementation assumption" to "adapter health check."
- The first sprint now requires a deterministic station simulation.
- The admin and XR apps are scoped as shells that consume the same station contracts.
- The red-team concern about over-scaffolding is addressed by the test harness gate.
- Legal and AI safety review are embedded before synthetic voice evaluation.

## Current Best Implementation Posture

Build the deterministic core first, expose it through API/admin/XR, and then add local model/voice adapters only after the baseline is verifiably useful.

## Ready For Next Iteration

Iteration 0007 should lock the code-phase handoff:

- Worker backlog and validation matrix.
- Leadership-ready readiness statement.
- Memory updates.
- Final source and score verification.




---

# Memory Update Log

## New Durable Lessons

- Implementation Planning Lead: first sprint must be blocked by a deterministic station simulation, not package count.
- Test Automation Lead: optional runtime skips are acceptable only when they emit explicit reasons.
- Local AI Inference Engineer: local LLM work remains gated behind small-model smoke benchmarks on target Apple Silicon.
- Voice And Speech Engineer: VibeVoice is a research candidate, not a default runtime.
- AI Governance Counsel: synthetic voice needs disclosure, consent, provenance, and misuse review before production use.
- Implementation Plan Gap Attacker: over-scaffolding is the central code-phase failure mode.
- Supply Chain Dependency Attacker: dependency license and install-risk intake must precede optional XR, voice, and asset tools.
- VP Engineering Delivery: worker backlog must bind every task to tests and completion commands.

## Superseded Assumptions

- Supersedes any implied assumption that MongoDB, local LLMs, VibeVoice, Bun, or Quest 3 headset validation are required for the first code milestone.

## Open Questions

- Should first workers implement CLI/test harness before UI shells if capacity is limited?
- Which small local model should be benchmarked first on the actual target M4Pro/M4Max hardware?
- What minimum manual Quest 3 smoke protocol is acceptable before the first live demo?


