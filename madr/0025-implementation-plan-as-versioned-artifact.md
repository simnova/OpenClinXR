# MADR 0025: Treat The Code Implementation Plan As A Versioned Artifact

Status: Accepted for planning
Date: 2026-05-03

## Context

The user asked for an exhaustive code implementation plan after multiple agent iterations. The plan must be specific enough for code workers while remaining separate from actual implementation.

## Decision

Maintain two implementation artifacts:

- `docs/openclinxr/code-implementation-plan.md` for architecture, phases, package ownership, and readiness gates.
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md` for task-by-task worker execution.

Every later iteration may refine these artifacts, but code implementation should not begin until leadership accepts the plan and a worker is assigned to execute it.

## Consequences

Positive:

- Separates planning maturity from code changes.
- Gives future workers exact files and tests.
- Preserves iteration history and score deltas.

Negative:

- Plan detail can drift from future dependency versions.
- The plan requires maintenance as local spikes produce new facts.

## Reversal Trigger

Revisit once the first implementation branch begins and code reality supersedes planning assumptions.

## Sources

- `src-internal-agent-factory-design-spec`
- `src-local-hardware-spike-2026-05-03`
