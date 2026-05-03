# Leadership Packet: iteration-0002

## Score Summary

```text
iterations/iteration-0002/02-core-scorecard.json
  plan_type: core-plan
  weighted_score: 4.056
  composite_score: 4.032
  confidence: 0.84
  critical_risks: 3
  evidence_debt: 3
  decision_debt: 3
```

```text
iterations/iteration-0002/04-adversarial-scorecard.json
  plan_type: adversarial-counterplan
  weighted_score: 4.295
  composite_score: 4.286
  confidence: 0.88
  critical_risks: 2
  evidence_debt: 2
  decision_debt: 1
```

```text
iterations/iteration-0002/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.250
  composite_score: 4.243
  confidence: 0.86
  critical_risks: 2
  evidence_debt: 1
  decision_debt: 1
```


---

# Iteration 0002 Brief

Date: 2026-05-03
Theme: Step 2 CS-inspired sequential XR exam architecture

## User Directive

Expand OpenClinXR from a single-scenario concept into a source-backed architecture for a timed sequence of realistic clinical skills stations. The design must mirror public structure from the former Step 2 CS process where appropriate, then extend the station model into XR environments with additional actors, speech, emotion, environmental pressure, and team workflows.

The team must produce development-ready design artifacts without writing application code.

## Source-Grounded Requirements

- Support a configurable 12-station exam form with 15-minute encounters, 10-minute patient notes, station transitions, and breaks after station groups.
- Preserve the public Step 2 CS-inspired phase structure: doorway instructions, encounter, patient note, transition, and cumulative exam session.
- Expand each encounter beyond one standardized patient to include nurses, physicians, family members, interpreters, respiratory therapists, bystanders, and environmental events.
- Map station coverage to clinical encounter, communication, documentation, team participation, urgent recognition, and time/prioritization targets.
- Use LLMs for scenario generation, actor dialogue, review assistance, speech-driven interaction, and memory/reflection, but keep exam-bank approval and scoring human-governed.
- Include psychometric review before scenario publication.
- Include legal review for prohibited claims, consent, source/IP, privacy, retention, and non-equivalence to USMLE, ECFMG, NBME, or licensure exams.
- Use MongoDB-friendly structures for blueprints, scenario bank, forms, actor cards, memories, trace events, review packets, and knowledge graph nodes/edges.
- Use CellixJS-style DDD and monorepo forethought, but do not make CellixJS a hard runtime dependency until a spike proves fit.

## Primary Output

Iteration 0002 creates a set of OpenClinXR design docs under `docs/openclinxr/`, MADRs 0011-0015, new source records, updated agent memories, and this iteration packet.

## Success Definition

The next engineer should be able to start a TypeScript/Node/MongoDB implementation plan from these artifacts without needing to rediscover the exam flow, station lifecycle, actor model, review loop, or data model.



---

# Iteration 0002 Core Plan

## Core Design Position

OpenClinXR should be designed as a multi-station clinical skills exam platform, not a one-off XR simulation. The first complete architecture should support a full Step 2 CS-inspired exam form while allowing smaller pilots. The system must be explicit that it is a formative and programmatic assessment platform unless future validation supports a stronger score-use claim.

## Exam Runtime

The runtime is built around four nested entities:

- `ExamBlueprint`: assessment intent, station count, timing, break cadence, coverage targets, environment mix, specialty mix, actor requirements, review rules, and psychometric targets.
- `ExamForm`: a version-locked ordered list of approved station versions with timing, break slots, prompt/model policy versions, scoring rubric versions, and publication status.
- `Station`: doorway instructions, environment, actors, hidden truth, event schedule, expected learner actions, safety-critical actions, scoring rubric, note task, and termination rules.
- `ActorCard`: role, knowledge boundaries, disclosure rules, emotional/pain model, voice/avatar profile, memory policy, permitted actions, and guardrails.

The session state machine must support:

- Orientation and consent.
- Station doorway.
- Encounter timer.
- Note timer.
- Note auto-submit.
- Inter-station transitions and scheduled breaks.
- Completion and faculty review queue.

## Expanded Station Model

Each station can include one or more virtual actors and environmental cells:

- Patient actor: symptoms, history, pain, emotion, disclosure.
- Family/caregiver actor: pressure, consent conflict, missing collateral history, emotional escalation.
- Nurse actor: interruptions, vital signs, task requests, escalation cues.
- Physician/consultant actor: oral summary pressure, handoff, supervision, competing priorities.
- Interpreter/social worker/respiratory therapist actor: communication and interprofessional teamwork.
- Environment cell: monitors, alarms, ambient sound, privacy boundaries, object affordances, patient deterioration.

The first scenario slice should be ED chest pain with patient, nurse, and family member because it exercises history, urgent recognition, teamwork, communication, note-writing, prioritization, and environmental pressure.

## LLM Boundaries

LLMs are separated into four modes:

- Scenario Generator: drafts station packages from blueprints and coverage gaps.
- Actor Dialogue Engine: generates bounded actor responses during an encounter.
- Reflection/Consistency Engine: summarizes memories and flags contradictions outside the hot path.
- Review Assistant: helps reviewers inspect coverage, contradictions, and risky content.

LLMs do not approve scenarios, certify competence, or silently change scoring rubrics. Every prompt, model version, retrieved memory, response, tool call, guardrail result, and override is written to the trace/audit ledger.

## Human Review And Psychometrics

Scenario-bank publication requires:

- Clinical specialty review.
- Psychometric review.
- Legal/compliance/IP review.
- Simulation QA.
- Version lock.

Psychometric work starts with blueprint coverage, case-specific rubrics, trace completeness, rater calibration, score-use statements, and pilot data exports. Automated scoring remains advisory until evidence supports stronger use.

## MongoDB Design

MongoDB is the primary planning and runtime persistence layer:

- `exam_blueprints`
- `scenario_bank`
- `actor_cards`
- `exam_forms`
- `exam_sessions`
- `station_runs`
- `trace_events`
- `actor_memories`
- `llm_audit_events`
- `review_packets`
- `knowledge_nodes`
- `knowledge_edges`

Runtime reads should use version-locked station packs. Replay, review, audit, and psychometric export read append-only traces.

## Knowledge Graph And Indexing

Knowledge graph nodes capture scenarios, actor facts, hidden clinical truth, learning targets, rubric criteria, source claims, review findings, and implementation decisions. Edges capture coverage, evidence, contradiction, dependency, and supersession.

Retrieval packs for actors combine role memory, current station state, hidden truth boundaries, recent learner actions, relevant clinical facts, and safety policy. Agent Factory memory uses the same pattern: indexed notes with source IDs, confidence, iteration number, and status.

## CellixJS Forethought

The implementation should follow DDD boundaries that are compatible with CellixJS public documentation:

- Domain contexts for exam, scenario, actor, trace, review, and analytics.
- Aggregate roots for blueprint, scenario, form, session, station run, and review packet.
- Repositories and unit-of-work style persistence boundaries.
- A TypeScript monorepo with affected-package analysis.

CellixJS remains a candidate influence until a technology spike validates its package reality, runtime behavior, documentation depth, and fit with the actor-cell runtime.

## Development Handoff

The next code phase should build only the planning-to-runtime skeleton:

- Blueprint editor.
- Scenario bank and actor card model.
- Exam form assembler.
- Station runtime skeleton.
- Trace ledger.
- Human review workflow.
- Mock actor engine, followed by one real LLM provider adapter.

It should not build high-stakes scoring, confidential exam content, EHR integrations, real-patient ingestion, or public marketplace features.



---

# Iteration 0002 Adversarial Counterplan

## Red-Team Position

The core plan is much stronger than Iteration 0001, but it still risks overbuilding a dazzling simulation before proving that the exam evidence chain is reliable. The adversarial team accepts the multi-station design goal, then forces the implementation path to prove each fragile assumption in order.

## Holes Found

1. A full 12-station XR exam is architecturally useful but too broad for the first code milestone.
2. LLM-generated stations can look clinically plausible while containing hidden psychometric defects, unfair cues, inconsistent difficulty, or biased actor behavior.
3. Multi-actor speech interactions create turn-taking, interruption, latency, and attribution problems that can corrupt trace evidence.
4. Realistic environments can distract from assessment constructs if environmental events are not mapped to rubric-relevant learner actions.
5. Automated scoring can become a liability magnet if any UI implies pass/fail certainty before validation.
6. CellixJS enthusiasm can turn into dependency lock-in before proving runtime and maintenance fit.
7. Public Step 2 CS details can inspire flow, but product messaging must avoid historical-exam equivalence.

## Counterplan

Build a proof ladder instead of a product-shaped demo.

### Proof 1: Evidence-First Station Pack

Implement one complete ED chest pain station in data before any XR polish:

- Blueprint coverage.
- Doorway instructions.
- Actor cards.
- Hidden clinical truth.
- Rubric.
- Expected trace events.
- Review packet.
- Synthetic trace replay.

Pass condition: faculty and psychometric reviewers can inspect the station and identify exactly what is being assessed.

### Proof 2: Deterministic Multi-Actor Runtime

Run the station with scripted or fixture-backed actors first:

- Patient answers from actor card.
- Nurse interruption triggered by event schedule.
- Family pressure triggered by learner delay or missed empathy.
- Timer and note auto-submit work.
- Trace events are complete.

Pass condition: the system captures the intended evidence without LLM variability.

### Proof 3: Bounded LLM Actor Adapter

Turn on LLM dialogue only after deterministic trace quality passes:

- Actor response schema is strict.
- Hidden truth is only disclosed through rules.
- All retrieved memory and prompts are auditable.
- Guardrail blocks out-of-role, unsafe, diagnosis-leaking, or station-invalid responses.
- Fallback response exists.

Pass condition: adversarial learner utterances do not break actor role, leak hidden truth, or erase required evidence.

### Proof 4: XR And Speech Slice

Only then test speech and XR:

- ASR transcript confidence thresholds.
- TTS latency and emotional tone.
- Multi-speaker turn attribution.
- Environment events visible/audible.
- Mobile/desktop fallback.

Pass condition: speech and XR improve realism without degrading station timing, trace completeness, or learner accessibility.

## Leadership Revision Demands

- Rename all "exam equivalent" language to "Step 2 CS-inspired historical flow" or "clinical skills station sequence."
- Put a visible "formative/local assessment only" score-use statement in faculty review outputs.
- Create a claims registry before outreach.
- Require a psychometrician sign-off state before an exam form can be activated.
- Treat automated scoring as "rubric suggestion" until validation gates are met.
- Add a trace-quality dashboard before any learner-facing score summary.
- Treat CellixJS as an architecture spike, not a commitment.

## Adversarial Output

The best path is not less ambitious. It is stricter. Build the full 12-station architecture into the schema and state machine now, but implement the first milestone as one high-fidelity station that proves review, trace, timing, actor boundaries, and human scoring.



---

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



---

# Iteration 0002 Leadership Review

## Status

Conditional approval for implementation planning. Revision required before external pilots, commercial claims, or any summative score-use statement.

## Leadership Findings

### Chief Medical Officer

The architecture now respects the difference between realistic clinical pressure and validated assessment. The station model is clinically plausible because it includes additional actors, deterioration, team communication, documentation, and safety-critical actions. The first ED chest pain slice is an appropriate stress case.

Required revision: specialty physician reviewers must approve every scenario family before bank publication.

### Chief Psychometrician

The plan has moved from "simulation experience" to "evidence chain." Blueprint coverage, trace requirements, review gates, rater calibration, and human scoring are the right first primitives.

Required revision: write the score-use statement, rater training outline, station difficulty metadata, and trace-quality metric before learner-score reporting.

### Chief Technology Officer

The actor-cell architecture, MongoDB model, and TypeScript/Node handoff are ready for an implementation plan. The CellixJS decision is correctly held as a spike.

Required revision: define pass/fail criteria for ASR/TTS/LLM latency before building immersive XR polish.

### General Counsel

The non-equivalence position is clear. The claims-not-supported fields in source records are helpful and should be surfaced in any future outreach materials.

Required revision: create a claims registry, consent matrix, retention schedule, and data-flow appendix before any institution-facing demo beyond private design review.

### Chief Compliance Officer

The plan excludes real patient data and makes auditability central. That is the correct default.

Required revision: add a threat model, access-control model, and tenant-isolation test plan before production deployment.

### Product Growth Executive

The new architecture is more credible for design partners because it has a realistic exam flow and faculty review loop. The buyer story should be "scenario-bank and evidence workflow" before "frontier XR."

Required revision: do not lead with a high-stakes exam replacement narrative.

### Investor Board Skeptic

The ambition is high but now sequenced. The risk is still scope sprawl. The proof ladder is the only acceptable implementation path.

Required revision: lock the first milestone to one ED station plus review and trace.

## Leadership Verdict

Proceed to a code implementation plan for the deterministic ED chest pain station and reusable exam architecture skeleton. Do not proceed to external pilot, public launch, or high-stakes scoring claims.



---

# Iteration 0002 Final Synthesis

## What Improved Since Iteration 0001

- The product target is now a timed, sequential, multi-station clinical skills exam system rather than a generic XR simulation.
- The historical exam-flow inspiration is grounded in public USMLE and ECFMG sources.
- The competency targets are grounded in AMA day-one skills.
- LLM virtual patient use is grounded in current LLM-agent and virtual standardized patient literature.
- MongoDB collections, indexes, statecharts, sequence diagrams, UX flows, knowledge graph structures, and MADRs are now documented.
- The first implementation path is sharper: full-fidelity architecture, one deterministic ED chest pain station as the proof slice.
- Leadership and adversarial review now agree on the proof ladder.
- Core weighted score improved from 3.261 in Iteration 0001 to 4.056 in Iteration 0002.
- The strongest dimension gains were evidence discipline, specialty clinical generalizability, architecture coherence, legal/regulatory resilience, and technical feasibility.

## Build-Ready Packet

Primary docs:

- `docs/openclinxr/research-brief-step2cs-llm-vsp.md`
- `docs/openclinxr/exam-scenario-architecture.md`
- `docs/openclinxr/mongodb-data-model.md`
- `docs/openclinxr/statecharts-and-sequences.md`
- `docs/openclinxr/ux-flows.md`
- `docs/openclinxr/knowledge-graph-and-indexing.md`
- `docs/openclinxr/development-handoff.md`

Architecture decisions:

- `madr/0011-step2cs-inspired-sequential-exam.md`
- `madr/0012-llm-bounded-actor-dialogue.md`
- `madr/0013-mongodb-knowledge-graph-and-indexing.md`
- `madr/0014-cellixjs-inspired-domain-contexts.md`
- `madr/0015-human-governed-exam-bank-review.md`

## Remaining Blockers Before External Use

- Resolve the supplied IEEE paper citation or mark it permanently out of scope.
- Write the claims registry, consent matrix, retention schedule, and data-flow appendix.
- Write the psychometric score-use statement, rater training outline, trace-quality metric, and pilot validation plan.
- Complete technology spikes for ASR, TTS, LLM consistency, XR runtime, and CellixJS fit.

## Recommended Next Action

Create the code implementation plan for Phase 0 through Phase 5, scoped to the deterministic ED chest pain station plus reusable exam architecture skeleton.



---

# Iteration 0002 Memory Update Log

Date: 2026-05-03

## Agent Memories Updated

- `chief-coordinator`: sequential exam design is now the coordination baseline.
- `solution-architect`: exam blueprint/form/station/actor architecture is the implementation boundary.
- `clinical-simulation-lead`: stations must support multi-actor, multi-environment clinical pressure.
- `psychometrics-lead`: score use remains formative/local until validation work is complete.
- `data-trace-architect`: MongoDB collections and trace ledger boundaries are the current persistence model.
- `xr-systems-architect`: actor-cell runtime and environmental cells are the current XR runtime abstraction.
- `legal-regulatory-counsel`: non-equivalence to USMLE/ECFMG/NBME/licensure is a permanent claims boundary.
- `source-librarian`: public-source ledger now includes Step 2 CS timing, ECFMG operational notices, AMA skills, LLM VSP papers, patient-note corpus, and CellixJS docs.

## Memory Themes Added

- `step2cs-inspired-sequential-exam`
- `expanded-multi-actor-stations`
- `human-governed-scenario-bank`
- `mongodb-knowledge-graph-trace-ledger`
- `cellixjs-inspired-ddd-spike`
- `formative-local-score-use`
- `claims-non-equivalence`

