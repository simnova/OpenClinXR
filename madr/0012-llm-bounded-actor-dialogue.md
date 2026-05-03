# MADR 0012: Use Bounded LLM Actor Dialogue With Review Gates

Status: Accepted for planning
Date: 2026-05-03

## Context

The system needs realistic dialogue, speech, emotion, pain responses, and family/team interactions. LLM virtual patient literature supports generative agents with memory and retrieval for history-taking practice, while also implying the need for consistency and review.

## Decision

Use LLMs as bounded actor engines and scenario draft generators. Scenario drafts require clinical, psychometric, legal/compliance, and simulation QA review before they enter an exam bank. Runtime actor dialogue must be constrained by actor cards, hidden truth, disclosure rules, retrieved memory, and safety guardrails.

## Consequences

Positive:

- Enables realistic, flexible, multi-actor dialogue.
- Reduces manual scripting burden.
- Preserves provenance through prompt/model/memory audit logs.

Negative:

- Requires guardrails and response auditing.
- Adds model drift and latency risks.
- Cannot support autonomous high-stakes scoring without validation.

## Reversal Trigger

Revisit if LLM actor consistency, safety, latency, or review burden fails pilot thresholds.

