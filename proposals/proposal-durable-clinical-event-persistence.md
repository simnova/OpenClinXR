# Proposal: Durable Clinical Event Persistence

**Status:** Proposed  
**Decision needed:** Approve, defer, or revise the constrained implementation slice  
**Requested by:** Codex  
**Date:** 2026-05-05  
**Scope:** Package-local durable clinical-event persistence only

## Decision Needed

Approve a follow-on implementation slice that adds MongoDB-backed durable persistence for clinical events that were explicitly excluded from the approved actor-turn persistence slice.

This proposal covers durable records for:

- Clinical actions and trace-tag progress.
- Orders and order status changes.
- Findings and observed results.
- Checklist updates.
- Rubric or case-progress events.

It does not reopen conversation-turn or emotional-state persistence, which already has a constrained MongoDB repository slice in `@openclinxr/data-mongodb`.

## Recommendation

Approve the slice after the actor-turn repository work remains verified and stable.

The safest next step is a database-only event-log contract in `@openclinxr/session-state`, followed by thin MongoDB repositories in `@openclinxr/data-mongodb`. Redis/Redka, WebSocket synchronization, and API runtime wiring should remain out of scope until durable replay is proven.

## Proposed Scope

Add a durable clinical-event model that can replay clinically significant state after a restart without relying on realtime cache state.

Candidate durable record shape:

- `clinicalEventId`: stable idempotency key.
- `stationRunId`: station/session replay partition.
- `actorId`: actor associated with the event when applicable.
- `atSecond`: station-relative ordering timestamp.
- `eventKind`: `clinical_action_recorded`, `order_status_changed`, `finding_recorded`, `checklist_item_updated`, `rubric_progress_updated`, or `case_status_changed`.
- `traceTag`: optional scenario trace tag.
- `label`: human-readable event label.
- `status`: event-specific status when applicable.
- `payload`: structured domain payload with hidden-fact-safe projection rules.
- `provenanceRefs`: trace, model, reviewer, or UI provenance references.
- `durableStore`: `database_source_of_truth`.

## Proposed Files

- `packages/openclinxr/session-state/src/index.ts`
- `packages/openclinxr/session-state/src/session-state.test.ts`
- `packages/openclinxr/data-mongodb/src/repositories.ts`
- `packages/openclinxr/data-mongodb/src/mongodb-repositories.test.ts`
- `packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts`
- `docs/openclinxr/server-side-multi-actor-state-persistence-phase2-2026-05-05.md`

## Acceptance Criteria

- Clinical-event records replay by `stationRunId` in deterministic order.
- Re-saving the same `clinicalEventId` is idempotent.
- Orders, findings, checklist updates, and rubric/case progress can be represented without overloading conversation-turn records.
- Hidden clinical truth and private actor memory are not exposed by public projection helpers.
- `@openclinxr/session-state` remains free of MongoDB, Redis, Redka, Colyseus, bitECS, WebTransport, QUIC, and Web3 dependencies.
- `@openclinxr/data-mongodb` remains database-only for this slice.

## Out Of Scope

- `apps/api`, REST, GraphQL, WebSocket, or runtime wiring.
- Redis/Redka cache adapters.
- Realtime synchronization.
- Colyseus, `@colyseus/schema`, bitECS, WebTransport, QUIC, or Web3 packages.
- Cloud databases, hosted services, credentials, paid APIs, or production deployment.
- Clinical record-retention policy claims.
- Clinical validity, scoring validity, readiness, licensure, or exam-equivalence claims.

## Verification

```bash
pnpm --filter @openclinxr/session-state test
pnpm --filter @openclinxr/session-state typecheck
pnpm --filter @openclinxr/data-mongodb test
pnpm --filter @openclinxr/data-mongodb typecheck
pnpm --filter @openclinxr/architecture-rules test
pnpm security:audit-policy
pnpm security:licenses
git diff --check
```

## Approval Boundaries

Approval would allow Codex to:

- Add durable clinical-event record types and package-local tests.
- Add MongoDB-backed repositories using existing `mongodb-memory-server` test patterns.
- Add architecture tests that preserve the database-only and no-runtime-wiring boundary.
- Update persistence documentation after verification passes.

Approval would not allow Codex to:

- Wire durable clinical events into `apps/api` runtime behavior.
- Add Redis/Redka or realtime synchronization packages.
- Use cloud, paid, hosted, or production infrastructure.
- Make production, retention-policy, or clinical-validity claims.

## Rollback

Revert the package-local record types, repositories, tests, and documentation updates. No database migrations, production state, credentials, cloud resources, or runtime routes are created by this proposed slice.
