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
