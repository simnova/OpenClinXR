# Proposal: Durable Actor Turn Persistence Promotion

**Status:** Proposed  
**Decision needed:** Approve or defer  
**Requested by:** Codex  
**Date:** 2026-05-05  
**Scope:** Promote the approved Phase 2 durable actor-turn persistence contract into MongoDB-backed repository code

## Decision Needed

Approve a constrained implementation slice that adds MongoDB-backed durable repositories for multi-actor conversation turns and actor emotional-state timeline records.

This would move beyond the current contract/test-double evidence in `@openclinxr/session-state` and into production-shaped persistence package code, so it needs explicit approval before implementation.

## Recommendation

Approve the constrained slice, but keep it database-only and leave Redis/Redka for a later adapter after durable replay exists.

The first durable persistence step should be:

- Add MongoDB memory-server tests for conversation turn replay, emotional-state timeline replay, idempotent upsert behavior, and `rawAudioStored: false`.
- Add thin repositories in `packages/openclinxr/data-mongodb`.
- Keep `apps/api` wiring and REST/WebSocket route changes out of the first slice unless separately approved.
- Do not add Redis, Redka, Colyseus, `@colyseus/schema`, bitECS, WebTransport, QUIC, or Web3 packages.

## Rationale

The approved Phase 2 persistence contract now states that durable clinical/audit state belongs in the database, while Redis/Redka-shaped cache state is disposable and rehydratable. The next evidence gap is proving durable actor-turn persistence using the local `mongodb-memory-server` pattern already accepted elsewhere in the repo.

## Proposed Files

- `packages/openclinxr/data-mongodb/src/repositories.ts`
- `packages/openclinxr/data-mongodb/src/mongodb-repositories.test.ts`
- `docs/openclinxr/server-side-multi-actor-state-persistence-phase2-2026-05-05.md`

## Out Of Scope

- API route wiring.
- WebSocket session-state sync.
- Redis/Redka runtime adapters.
- Production deployment.
- Cloud/hosted databases or credentials.
- Clinical record-retention policy claims.

## Verification

```bash
pnpm --filter @openclinxr/session-state test
pnpm --filter @openclinxr/session-state typecheck
pnpm --filter @openclinxr/data-mongodb test
pnpm --filter @openclinxr/data-mongodb typecheck
pnpm --filter @openclinxr/architecture-rules test
pnpm security:audit-policy
pnpm security:licenses
```

## Approval Boundaries

Approval would allow Codex to:

- Add Mongo-backed repository implementations for the already-approved durable actor-turn and emotional-state record types.
- Use existing local `mongodb-memory-server` test infrastructure.
- Commit repository code and evidence after verification passes.

Approval would not allow Codex to:

- Wire this into `apps/api` runtime behavior.
- Add Redis/Redka packages.
- Add realtime sync, WebTransport, QUIC, Web3, Colyseus, `@colyseus/schema`, or bitECS.
- Use cloud services, credentials, paid APIs, or hosted databases.
