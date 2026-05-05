# Server-Side Multi-Actor State Persistence Phase 2

**Date:** 2026-05-05  
**Proposal:** `proposals/approved/proposal-server-side-multi-actor-state-context-persistence-phase2.md`  
**Status:** Contract promoted into `@openclinxr/session-state`; production persistence remains future work

## Scope

This note records the Phase 2 persistence-boundary slice for multi-actor clinical session state. It promotes the approved durable-versus-realtime contract into the production-shaped `packages/openclinxr/session-state` package without adding MongoDB, Redis, Redka, Colyseus, `@colyseus/schema`, bitECS, WebTransport, QUIC, Web3, or cloud dependencies.

The implementation is still an architecture spike boundary. It is not a production persistence layer, not Redis/Redka runtime evidence, not clinical record-retention policy, and not a realtime synchronization implementation.

## Implemented Contract

`@openclinxr/session-state` now exposes:

- `DurableConversationTurnRecord`
- `DurableEmotionalStateTimelineRecord`
- `DurableMultiActorSessionStore`
- `RealtimeSessionCacheSnapshot`
- `RealtimeSessionCache`
- `PersistenceSpikeStores`
- `persistLatestInteractionTurn`
- `writeRealtimeCacheSnapshot`
- `rehydrateRealtimeCacheFromDurableState`
- `evaluateMultiActorPersistencePhase2Strategy`

The in-memory stores are proof adapters for deterministic tests only. They prove the boundary and cloning behavior without making cache state authoritative.

## Responsibility Boundary

Durable database source of truth:

- Conversation history.
- Emotional-state timeline.
- Clinical trace events.
- Orders and findings.
- Audit-relevant interaction records.
- Review and recovery checkpoints.

Redis/Redka-shaped realtime cache:

- Actor and object transforms.
- Presence.
- Recent context windows.
- Pub/sub notifications.
- Short-lived session leases.

The cache is disposable and must be rehydratable from durable state. Raw voice audio is not persisted in actor state; final transcript provenance is stored with `rawAudioStored: false`.

## Recovery Shape

The promoted test flow records a final voice-transcript interaction, persists the durable turn and actor emotional-state timeline, writes a short-lived realtime cache snapshot, clears the cache, and rehydrates a new snapshot from the durable turn records plus current session spatial state.

This proves the intended separation:

- Durable records remain after cache loss.
- Cache snapshots can be recreated.
- Recent turn refs point back to durable turn ids.
- Spatial transforms stay in the realtime snapshot, not in the durable conversation record.

## Follow-Up Direction

The next implementation slice should add database-backed durable actor turns before any Redis/Redka runtime adoption:

1. Add MongoDB memory-server tests for conversation turns and emotional-state timelines.
2. Add thin repositories in `packages/openclinxr/data-mongodb`.
3. Extend the injected API persistence sink with durable multi-actor methods.
4. Keep Redis/Redka as a later adapter after durable replay exists.

Do not add Redis/Redka dependencies before there is a durable replay path to protect clinical/audit state from cache loss.

## Verification

Focused verification for this slice:

```bash
pnpm --filter @openclinxr/session-state test
pnpm --filter @openclinxr/session-state typecheck
pnpm --filter @openclinxr/multi-actor-state-spike test
pnpm --filter @openclinxr/multi-actor-state-spike typecheck
pnpm --filter @openclinxr/architecture-rules test
pnpm --filter @openclinxr/architecture-rules typecheck
pnpm agent:sources
```
