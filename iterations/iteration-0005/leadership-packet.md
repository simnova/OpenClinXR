# Leadership Packet: iteration-0005

## Score Summary

```text
iterations/iteration-0005/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.602
  composite_score: 4.603
  confidence: 0.91
  critical_risks: 1
  evidence_debt: 1
  decision_debt: 1
```


---

# Iteration 0005 Brief

Date: 2026-05-03
Loop focus: code architecture, package ownership, first vertical slice, and implementation sequencing.

## Goal

Turn architecture and local spike results into an executable code implementation plan.

## Scope Lock

First build:

- ED chest pain station.
- Mock actor dialogue.
- Trace ledger.
- Faculty review packet.
- Admin app.
- Learner XR shell with desktop fallback.
- Optional local model/voice adapters disabled by default.

Out of first build:

- High-stakes scoring.
- Cloud model calls.
- Live generated assets.
- Required local LLM/voice downloads.
- Multi-user scaling.



---

# Core Plan

## Architecture

The first implementation uses a pnpm TypeScript monorepo:

- `apps/api`
- `apps/admin`
- `apps/xr`
- `packages/shared-schemas`
- `packages/domain`
- `packages/scenario-fixtures`
- `packages/scenario-runtime`
- `packages/trace-ledger`
- `packages/review-workflow`
- `packages/data-mongodb`
- `packages/model-gateway`
- `packages/voice-gateway`
- `packages/asset-registry`
- `packages/test-harness`

## Sequencing

Build pure schemas and domain before UI. Use in-memory repositories before MongoDB. Use mock providers before local model and voice runtimes. Use desktop fallback before Quest 3 testing.

## Added Artifact

- `docs/openclinxr/code-implementation-plan.md`

This establishes the package map, phase gates, dependencies, and first milestone definition of done.



---

# Adversarial Counterplan

## Attack

The implementation architecture is credible but risks overbuilding packages before the first station proves value.

## Required Constraint

Each package must earn its place by supporting the ED chest pain vertical slice:

- Shared schemas validate the fixture and trace.
- Domain handles station phase transitions.
- Fixture package supplies ED chest pain data.
- Trace ledger replays a run.
- Review workflow builds faculty packet.
- API exposes local endpoints.
- Admin and XR apps consume the same contracts.
- Model/voice packages provide mock contracts only until spikes pass.

Any package without a first-slice test should be deferred.



---

# Core Revision

The core team accepts the package constraint.

The implementation plan now treats the first vertical slice as the filter for every package. Packages may exist as scaffold only when they are needed for a concrete test or contract.

Implementation workers must commit after small testable increments rather than building a large monorepo shell in one pass.



---

# Leadership Review

Leadership accepts iteration 0005.

The codebase plan now has clear ownership and a realistic build order. The strongest decision is to make the ED chest pain station the forcing function for every abstraction.

Required action:

- The detailed worker plan must include exact files, test commands, and commit boundaries.



---

# Final Synthesis

Iteration 0005 turns the implementation idea into a concrete monorepo architecture. The first slice is deliberately narrow: one ED chest pain station, mock providers, trace replay, review packet, admin shell, and XR shell.

This is now ready for a worker-level task plan.



---

# Memory Update Log

Date: 2026-05-03

## Durable Lessons

- Package boundaries must be justified by the ED chest pain vertical slice.
- In-memory repositories precede MongoDB.
- Mock providers precede local models and voice.
- Desktop fallback precedes Quest 3 validation.

