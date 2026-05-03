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
