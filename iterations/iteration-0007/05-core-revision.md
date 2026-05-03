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

