# MADR 0015: Require Human-Governed Exam Bank Review Before Scenario Publication

Status: Accepted for planning
Date: 2026-05-03

## Context

The user wants LLMs to generate scenario banks, but the system is assessment-adjacent and must preserve clinical, psychometric, legal, and educational defensibility.

## Decision

Generated scenarios cannot be administered as exam stations until they pass clinical, psychometric, legal/compliance/IP, and simulation QA review. Review state is versioned and stored with the scenario. Psychometricians can tweak scenario and rubric details before exam form publication.

## Consequences

Positive:

- Reduces clinical safety risk.
- Supports defensible scenario-bank governance.
- Creates a clear human accountability layer.

Negative:

- Slows scenario-bank generation.
- Requires reviewer UX and workflow management.

## Reversal Trigger

Do not reverse for high-stakes or assessment-adjacent use. Revisit only for sandboxed low-stakes learner practice with explicit labeling.

