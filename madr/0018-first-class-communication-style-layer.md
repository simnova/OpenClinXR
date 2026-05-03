# MADR 0018: Make Communication Style A First-Class Actor Layer

Status: Accepted for planning
Date: 2026-05-03

## Context

The exam concept should test empathy, de-escalation, family dynamics, health literacy, difficult conversations, and interprofessional communication. A generic "patient tone" prompt is too weak for that. Recent virtual-patient papers show structured personas, author notes, first messages, and bounded resistance mechanisms can improve role consistency.

## Decision

Every actor card will include a communication profile with style, intensity, mood, topics to avoid, escalation/de-escalation triggers, first-message state, gesture cue palette, voice style, and expected emotion profile. Actor responses must include style adherence metadata and emotion QA hooks.

## Consequences

Positive:

- Enables deliberate testing of communication skills.
- Gives faculty and simulation QA a reviewable artifact.
- Reduces drift into overly agreeable or generic LLM behavior.
- Provides measurable style QA signals across iterations.

Negative:

- Increases authoring complexity.
- Requires reviewer training to avoid caricature or cultural stereotyping.
- Automated emotion analysis is only an aid and must not be treated as validation by itself.

## Reversal Trigger

Revisit only if pilot reviewers find structured profiles reduce realism or create unacceptable bias despite mitigation.

## Sources

- `src-local-bodonhelyi-medical-communication-pdf-2025`
- `src-local-laverde-llm-agents-pdf-2025`
- `src-jmir-llm-virtual-patients-2025`
