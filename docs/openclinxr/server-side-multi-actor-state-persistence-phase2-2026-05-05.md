# Server-Side Multi-Actor State Persistence Phase 2

**Date:** 2026-05-05  
**Proposal:** `proposals/approved/proposal-server-side-multi-actor-state-context-persistence-phase2.md`  
**Status:** Contract promoted into `@openclinxr/session-state`; MongoDB actor-turn and clinical-event repositories added for constrained local durable replay; API/runtime wiring remains future work

## Scope

This note records the Phase 2 persistence-boundary slice for multi-actor clinical session state. It promotes the approved durable-versus-realtime contract into the production-shaped `packages/openclinxr/session-state` package without adding MongoDB, Redis, Redka, Colyseus, `@colyseus/schema`, bitECS, WebTransport, QUIC, Web3, or cloud dependencies.

The implementation is still an architecture spike boundary. It is not a production persistence layer, not Redis/Redka runtime evidence, not clinical record-retention policy, and not a realtime synchronization implementation.

The durable actor-turn promotion approved on 2026-05-05 narrows "actor turn" to conversational turns and emotional-state timeline records. Durable clinical events are now a separate event-log contract for clinical actions, orders, findings, checklist updates, rubric progress, and case status. This separation keeps clinical events from overloading actor-turn records.

## Implemented Contract

`@openclinxr/session-state` now exposes:

- `DurableConversationTurnRecord`
- `DurableEmotionalStateTimelineRecord`
- `DurableClinicalEventRecord`
- `DurableClinicalEventKind`
- `DurableClinicalEventReviewProjection`
- `DurableMultiActorSessionStore`
- `AsyncDurableMultiActorSessionStore`
- `RealtimeSessionCacheSnapshot`
- `RealtimeSessionCache`
- `PersistenceSpikeStores`
- `persistLatestInteractionTurn`
- `projectDurableClinicalEventForReview`
- `writeRealtimeCacheSnapshot`
- `rehydrateRealtimeCacheFromDurableState`
- `evaluateMultiActorPersistencePhase2Strategy`

`DurableMultiActorSessionStore` remains the synchronous in-memory proof adapter shape used by deterministic package tests. `AsyncDurableMultiActorSessionStore` is the production-shaped durable port for database-backed adapters, so MongoDB can conform to an explicit async contract without wiring into the API runtime.

`@openclinxr/data-mongodb` now adds constrained MongoDB-backed repositories for:

- Durable conversation turn replay by station run.
- Durable emotional-state timeline replay by station run and actor.
- Durable clinical-event replay by station run.
- Idempotent upsert behavior for all durable record types.
- `rawAudioStored: false` preservation and transcript provenance references for voice-transcript turns.
- Hidden-fact-safe clinical-event review projection via public payload only.
- Explicit conformance to `AsyncDurableMultiActorSessionStore`.

These repositories are package-local and use `mongodb-memory-server` tests. They are not wired into `apps/api`, REST, GraphQL, WebSocket routes, or runtime session synchronization.

## Responsibility Boundary

Durable database source of truth:

- Conversation history.
- Emotional-state timeline.
- Clinical trace events.
- Orders and findings.
- Checklist, rubric, and case-progress events.
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

The durable clinical-event replay flow stores package-local event-log records keyed by `clinicalEventId`, upserts repeated saves idempotently, and replays events by `stationRunId` in deterministic `atSecond` plus id order. The public review projection exposes `payload.public` and redacts `payload.private`, so hidden clinical truth, hidden-fact refs, and server-only actor notes do not leak into reviewer-facing projections.

## Follow-Up Direction

The database-backed durable actor-turn and clinical-event slices now live in `packages/openclinxr/data-mongodb`. Remaining follow-up work should stay sequenced after these durable replay paths:

1. Consider a later API persistence-sink extension for durable multi-actor methods only after repository evidence is stable.
2. Keep Redis/Redka as a later adapter after durable replay exists.
3. Keep WebSocket session-state sync separate from durable database repositories.
4. Add retention policy, archival, and clinical audit governance only through a later proposal.

Do not add Redis/Redka dependencies before there is a durable replay path to protect clinical/audit state from cache loss.

## Verification

Focused verification for the current durable boundary:

```bash
pnpm --filter @openclinxr/session-state test
pnpm --filter @openclinxr/session-state typecheck
pnpm --filter @openclinxr/data-mongodb test
pnpm --filter @openclinxr/data-mongodb typecheck
pnpm --filter @openclinxr/architecture-rules test
pnpm --filter @openclinxr/architecture-rules typecheck
pnpm security:audit-policy
pnpm security:licenses
```
