# Leadership Packet: iteration-0003

## Score Summary

```text
iterations/iteration-0003/02-core-scorecard.json
  plan_type: core-plan
  weighted_score: 4.332
  composite_score: 4.325
  confidence: 0.86
  critical_risks: 2
  evidence_debt: 2
  decision_debt: 1
```

```text
iterations/iteration-0003/04-adversarial-scorecard.json
  plan_type: adversarial-counterplan
  weighted_score: 4.441
  composite_score: 4.439
  confidence: 0.88
  critical_risks: 2
  evidence_debt: 1
  decision_debt: 1
```

```text
iterations/iteration-0003/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.506
  composite_score: 4.507
  confidence: 0.89
  critical_risks: 2
  evidence_debt: 2
  decision_debt: 2
```


---

# Iteration 0003 Brief

Date: 2026-05-03
Loop focus: technology approach, XR asset pipeline, provider routing, communication-style fidelity, admin UX/testing, and production-ready case-bank expansion.

## User Additions

The user asked the agent teams to:

- Reinspect the original assets and add a technological approach brief for development guidance.
- Incorporate human generation, skin, clothing, rigging, animation, and interaction-model references.
- Keep runtime feasible on Azure App Service Plan B1 Basic and Quest 3, with local M4 Max mode for development and asset generation.
- Favor TypeScript, React, Bun, Hono, CellixJS-compatible patterns, MongoDB, WebXR, Ant Design 6, Ant Design Pro patterns, Penpot/OpenPencil, Storybook, Serenity/JS, and automated testing.
- Consider Grok APIs for production voice/reasoning once reviewed.
- Ground the plan in open-source or commercially supportable options while avoiding AGPL/GPL/copyleft runtime contamination.
- Use the provided Laverde et al. PDF and Bodonhelyi et al. PDF for virtual-patient agent, communication-style, and QA inspiration.

## Inputs Reviewed

- Original `xr-solution.zip` architecture bundle and MADRs.
- `grok.docx` and `chatgpt.docx` business/technical plans.
- Laverde et al. virtual-patient agent paper.
- Bodonhelyi et al. challenging patient communication preprint.
- Public source checks for Anny, MakeHuman, MakeClothes, StableGen, Mesh2Motion, NVIDIA ACE/Audio2Face, xAI voice/Grok docs, MDN WebXR/WebTransport, Penpot, OpenPencil, Storybook, Serenity/JS, Azure App Service, and npm dependency metadata.

## Iteration Goal

Produce a development-team handoff that is detailed enough to start a TypeScript implementation plan later, but does not build code yet.

The core team's work should now be judged on whether it gives developers:

- A realistic first product scope.
- Concrete technology choices and license posture.
- Quest 3/Azure B1 performance constraints.
- Asset-generation pipeline.
- Model/voice provider routing.
- Admin UX and testing stack.
- Virtual-patient memory, response grounding, and communication-style QA.
- A first case bank with environment, actors, assets, trace, and dialogue requirements.



---

# Core Team Plan

## Lead Position

OpenClinXR should start as a single-user, fully functional XR clinical-skills exam skeleton. The first milestone should be deterministic and auditable, with LLM/voice adapters enabled behind gates. Heavy asset and model generation happens offline or through external providers; Quest 3 and Azure B1 serve optimized experiences and orchestration.

## Development Handoff Additions

The core team produced or updated:

- `docs/openclinxr/technology-approach-brief.md`
- `docs/openclinxr/asset-generation-pipeline.md`
- `docs/openclinxr/webxr-azure-quest-performance-brief.md`
- `docs/openclinxr/virtual-patient-agent-model.md`
- `docs/openclinxr/communication-style-and-emotion-qa.md`
- `docs/openclinxr/sample-case-bank-v1.md`
- `docs/openclinxr/admin-ux-and-testing-brief.md`
- `docs/openclinxr/model-provider-and-voice-routing.md`
- MADRs 0016 through 0020

## Architecture Shape

The TypeScript implementation should use a monorepo with domain packages for exam blueprint, scenario bank, actor runtime, trace ledger, review workflow, model gateway, asset registry, and shared schemas. Bun/Hono is preferred for the first API/runtime path, with MongoDB-compatible persistence and static/CDN asset delivery.

The XR runtime uses WebSocket first, not WebTransport first. WebTransport remains a spike behind an interface after Quest 3 and Azure/proxy compatibility are measured.

## Virtual Patient And Actor Runtime

Every actor is a bounded generative agent:

- Case memory.
- Short-term conversation memory.
- Reflection/planning memory.
- Station-state/action policy.
- Communication-style and emotion policy.

The Laverde paper inspired memory stream, retrieval, reflection, and explicit/implicit/fictional response QA. The Bodonhelyi paper inspired first-message mood setting, author-note refresh, structured communication profiles, bounded stubbornness, and emotion/sentiment QA.

## Asset Pipeline

The asset path is offline and manifest-driven:

- Scenario case spec.
- Asset manifest.
- Human generation.
- Clothes/skin authoring.
- Rigging and retargeting.
- Animation clips.
- Environment/equipment kit.
- Optimization bake.
- Quest 3 visual/performance/license QA.
- Asset registry.

Anny is the preferred permissive human-generation candidate. MakeHuman/MPFB is authoring-only until counsel approves source/output boundaries. StableGen is optional isolated authoring because current repo licensing is GPL-3.0. Mesh2Motion is a promising permissive rigging/animation path. NVIDIA ACE/Audio2Face is a commercial adapter, not the open-source baseline.

## Admin UX And Testing

Non-examinee workflows use Ant Design 6, Ant Design Pro conventions, Storybook, Serenity/JS, Playwright, Vitest, Penpot, and OpenPencil. Examinee UX remains mostly in WebXR with canvas/texture-backed data surfaces for EHR, vitals, notes, and doorway instructions.

## Case Bank

The first seed bank has 12 station specifications across ED, pediatrics, ward, telehealth, OB, psychiatry, stroke, sepsis, urgent care, oncology, surgery, and primary care. Each case includes environment needs, actor roster, hidden truth, event schedule, dialogue fixtures, 3D asset requirements, trace tags, and communication-style intent.

## Core Recommendation

Proceed to a later implementation plan only after reviewing this handoff and completing the first technical spikes:

- Quest 3 runtime smoke.
- WebSocket latency.
- ASR/TTS medical vocabulary and turn-taking.
- Model-provider grounding/style adherence.
- Asset bundle size and frame stability.
- License review for asset tools and `@react-three/xr`.



---

# Adversarial Counterplan

## Red Team Position

The core plan is materially better, but it still has five ways to fail:

1. It can overfit to impressive papers without proving embodied XR behavior.
2. It can accidentally let GPL/AGPL tooling leak into runtime or distributed assets.
3. It can understate how hard low-latency speech, turn-taking, and animation sync are on Quest 3.
4. It can generate a large case bank faster than reviewers can validate it.
5. It can overclaim assessment value before psychometric evidence exists.

## Required Hardening

### Performance

The first runtime must be boring by design:

- Static optimized station bundle.
- One hero patient and two supporting actors maximum.
- Deterministic dialogue fixtures before live provider calls.
- Text-first fallback if voice latency fails.
- WebSocket only until WebTransport is proven end to end.

### Licensing

Add a hard asset ingestion gate:

- No asset without source tool, source asset, output license, reviewer, and hash.
- GPL/AGPL tools are tagged as forbidden runtime dependencies.
- StableGen is not allowed in default pipeline.
- MakeHuman source code is not bundled.
- Generated textures and meshes require counsel review when source terms are ambiguous.

### Clinical And Psychometric

The 12-case bank is useful as a seed, not a ready exam. Each case needs:

- Specialty reviewer sign-off.
- Psychometric blueprint linkage.
- Bias/cultural review.
- Expected emotion/communication QA.
- Score-use label.
- Pilot debrief data before any learner consequence.

### Provider Routing

Grok/local/frontier providers must all pass the same harness:

- Grounding.
- Style adherence.
- Adversarial prompt safety.
- Medical vocabulary ASR.
- Voice turn-taking.
- Latency.
- Cost.
- Data retention.

No provider should become a product dependency until it passes the harness.

## Counterplan Output

The adversarial team accepts the architecture if leadership adds:

- A no-live-generation runtime rule for phase 1.
- A license blocklist enforced in asset registry.
- A Quest 3 device gate before simulation QA.
- A provider benchmark gate before cloud voice pilot.
- A score-use blocker until evidence exists.



---

# Core Revision

## Accepted Red Team Changes

The core team accepts the adversarial constraints.

Phase 1 runtime rule:

- No live body, texture, clothing, or full-motion generation.
- No live Blender, StableGen, Audio2Face, or local LLM inference on Azure B1.
- No live body gesture generation on Quest 3.
- Use deterministic fixtures and optimized placeholder assets first.

License rule:

- Runtime asset ingestion requires provenance and license metadata.
- GPL/AGPL tools are forbidden runtime dependencies.
- Tool outputs require counsel review when terms are ambiguous.

Device rule:

- A station cannot be simulation-QA approved without Quest 3 smoke testing.

Provider rule:

- Model/voice providers must pass a benchmark harness before production use.

Score-use rule:

- All learner reports remain formative/local until psychometric evidence supports broader claims.

## Revised First Implementation Scope

Build a one-station deterministic ED chest pain skeleton that exercises:

- Scenario bank CRUD.
- Actor cards with communication profiles.
- Environment/equipment manifest.
- Station statechart.
- Encounter timer and patient note timer.
- Mock patient, spouse, and nurse responses.
- Trace events.
- Review packet.
- Asset registry records.
- Admin screens with Ant Design.
- Storybook/Serenity/Vitest/Playwright test scaffold.

The voice and LLM adapters can exist as contracts and mocks first.

## Deferred Until Spikes Pass

- Live cloud voice in the exam runtime.
- WebTransport default transport.
- Mesh2Motion/Audio2Face production pipeline.
- Multi-user concurrent exam delivery.
- Automated scoring beyond human-reviewed formative scoring.



---

# Senior Leadership Review

## Decision

Senior leadership conditionally approves the iteration as a development-handoff package. The plan is now mature enough to start a later implementation plan for a deterministic first station, but not mature enough to skip spikes or make assessment claims.

## CEO Strategy Chair

Approved the narrow beachhead: UME/OSCE/EPA-style formative clinical-skills training, not high-stakes replacement. The 12-case bank is valuable as a product narrative and validation roadmap.

## CTO

Approved TypeScript/Bun/Hono/React/MongoDB direction with provider adapters and offline assets. Required WebSocket-first transport and a Quest 3 performance gate before runtime expansion.

## Chief Medical Officer

Approved multi-actor case structure with physician specialty review. Required explicit score-use label and specialty sign-off for each case.

## Chief Psychometrician

Approved trace and review architecture as promising. Blocked high-stakes score interpretation until rater training, difficulty metadata, generalizability evidence, and pilot studies exist.

## General Counsel And IP Counsel

Approved the license posture. Required asset registry enforcement, provider terms review, privacy/retention review, and no ECFMG/USMLE equivalence claims.

## Product Growth Executive

Approved Ant Design/Penpot/Storybook/Serenity approach for enterprise admin confidence. Recommended demoing faculty review and trace replay before advanced avatar claims.

## Leadership Required Revisions

- Keep deterministic ED chest pain as first code milestone.
- Treat the 12-case bank as seed content pending review.
- Add communication-style QA to actor-card schema early.
- Do not use GPL/AGPL tooling in runtime or distributed product.
- Benchmark Grok/voice/local model adapters before choosing production defaults.
- Run Quest 3 device tests before claiming XR readiness.



---

# Final Synthesis

Iteration 0003 turns the prior exam architecture into a practical development handoff.

The design is now grounded in:

- Step 2 CS-inspired sequential station structure.
- Multi-actor, multi-environment XR simulation.
- MongoDB-compatible scenario, trace, memory, review, and asset structures.
- TypeScript-first implementation direction.
- Offline 3D asset generation and Quest 3 optimization.
- Provider-agnostic LLM/voice routing with Grok/local model candidates.
- Communication-style actor profiles with emotion QA.
- Ant Design/Penpot/Storybook/Serenity admin workflow guidance.
- A 12-case seed bank with environment, actor, dialogue, asset, and trace requirements.

The first build should not attempt the whole vision. It should build one deterministic ED chest pain station with mock providers and optimized placeholder assets, then use the architecture to mature toward voice, richer XR, and a reviewed scenario bank.

## Current Development Readiness

Ready:

- Domain boundaries.
- First station scope.
- Technology approach.
- Review gates.
- Case-bank seed.
- Testing strategy.

Not ready without spikes:

- Production provider selection.
- Live voice in XR.
- WebTransport default.
- High-stakes scoring.
- Large-scale concurrent delivery.
- Final asset pipeline tooling lock.

## Confidence

The plan is strong enough to begin a code implementation plan. It is not strong enough to claim clinical validity, psychometric validity, Quest readiness, provider readiness, or ECFMG/USMLE equivalence.



---

# Memory Update Log

Date: 2026-05-03

## Agent Memory Updates Completed

- `source-librarian`: add technology source ledger and preprint/PDF lessons.
- `clinical-simulation-lead`: add 12-case bank and communication-style QA lesson.
- `xr-systems-architect`: add Quest 3 pre-baked asset/performance budget.
- `platform-devops-lead`: add Azure B1 orchestration-only and WebSocket-first decision.
- `solution-architect`: add provider adapter and actor communication-profile architecture.
- `ux-product-lead`: add Ant Design/Penpot/Storybook/Serenity admin UX direction.
- `ip-open-source-counsel`: add copyleft asset-pipeline risk.
- `rubric-steward`: add iteration-0003 score improvement and evidence debt.

## Durable Lessons

- Communication style is a first-class actor design layer.
- Emotion/sentiment QA is a useful signal but not proof of embodied realism.
- Asset generation belongs offline for the first product.
- Azure B1 is orchestration, not generation or inference.
- WebSocket is the first real-time transport; WebTransport remains a spike.
- Provider adapters are mandatory for Grok/local/frontier model flexibility.
- The first implementation should remain deterministic and human-reviewed.

