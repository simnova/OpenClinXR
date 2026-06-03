# MADR 0011: Use Step 2 CS-Inspired Sequential Exam Sessions

Status: Accepted for planning
Date: 2026-05-03

## Context

The product direction now requires a series of timed clinical scenarios run in sequence, inspired by the public structure of the former Step 2 CS exam. Public USMLE materials describe 12 patient cases, timed encounters, and patient notes, but OpenClinXR must not reproduce confidential exam content or claim equivalence.

## Decision

OpenClinXR will model exams as ordered `ExamForm` objects composed of timed `Station` objects. Each station will include doorway instructions, encounter phase, post-encounter note phase, trace capture, and human-governed review.

## Consequences

Positive:

- Supports exam-bank assembly and coverage mapping.
- Aligns with familiar clinical-skills assessment patterns.
- Enables station-level psychometric analysis.

Negative:

- Increases complexity beyond single-scenario training.
- Requires robust timing, state, and transition handling.

## Reversal Trigger

Revisit if design partners reject station-sequenced assessment in favor of purely free-practice simulation.

