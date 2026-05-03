# MADR 0014: Use CellixJS-Inspired DDD Contexts And Actor Cells, Pending Fit Spike

Status: Accepted for planning
Date: 2026-05-03

## Context

Prior OpenClinXR artifacts referenced CellixJS-style actors/cells. Public CellixJS documentation emphasizes DDD layers, contexts, aggregates, repositories, unit of work, monorepo organization, and Turborepo-based affected-package workflows. Public docs do not prove that a specific actor-cell runtime exists for OpenClinXR needs.

## Decision

Use CellixJS as an architectural influence, not a hard runtime dependency. Model OpenClinXR with DDD contexts and actor-like cells for exam sessions, stations, environments, actors, evaluators, and safety guardrails. Run a fit spike before adopting CellixJS packages or conventions directly.

## Consequences

Positive:

- Preserves compatibility with the team's stated technology comfort.
- Avoids premature dependency lock-in.
- Gives developers clear context boundaries.

Negative:

- Requires a spike before implementation can choose exact packages.
- May require custom actor-cell runtime if CellixJS does not fit.

## Reversal Trigger

Revisit after a technical spike evaluates CellixJS package reality, documentation, runtime fit, and developer ergonomics.

