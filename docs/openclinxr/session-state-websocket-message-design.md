# Session-State WebSocket Message Design

Date: 2026-05-05  
Status: Design-only, not runtime implementation

## Scope

This note defines vocabulary for future WebSocket session-state messages that may use `@openclinxr/session-state`. It does not implement realtime synchronization, persistence, Colyseus, `@colyseus/schema`, bitECS, WebTransport, QUIC, or Redis/Redka integration.

The first production-shaped type-level contracts now live in `@openclinxr/session-state` as `websocket_design_contract` messages. They are serializable domain contracts only; no `apps/api` route, WebSocket server, Redis/Redka adapter, MongoDB repository, or realtime synchronization loop is included.

The current implemented state contract is:

- `packages/openclinxr/session-state`

## Design Principles

- The server remains authoritative for actor routing, clinical state, trace tags, and evidence boundaries.
- WebSocket messages should carry small deltas, not full scenario records, unless a resync is requested.
- High-frequency spatial state should be separated from durable clinical events.
- Voice transcript metadata may reference stream and segment ids, but raw audio should not be stored in session-state messages.
- Redis/Redka may later accelerate presence, pub/sub, recent context, and spatial fan-out, but durable clinical and audit state must be database-backed.

## Candidate Message Families

| Family | Direction | Purpose | Durability |
| --- | --- | --- | --- |
| `session.snapshot.request` | client to server | Ask for current authoritative session state | Not durable |
| `session.snapshot` | server to client | Send current actor, clinical, and spatial summary | Cacheable; rehydratable |
| `actor.interaction.route` | client to server | Submit learner text or final transcript for actor routing | Durable interaction event candidate |
| `actor.interaction.routed` | server to client | Report selected actor, routing reason, and trace tags | Durable interaction event candidate |
| `clinical.action.record` | client to server | Record order/finding-style clinical progress | Durable clinical event candidate |
| `clinical.state.delta` | server to client | Broadcast completed trace tags, orders, and findings | Durable clinical event projection |
| `spatial.actor.transform` | client to server or server to client | Low-latency actor transform update | Ephemeral; selectively checkpointed |
| `session.resync.required` | server to client | Tell client to request a fresh snapshot | Not durable |

## Promoted Type Contracts

`@openclinxr/session-state` now exposes design-only helpers for the reviewed message families:

- `createSessionStateSnapshotMessage`
- `createActorInteractionRouteMessage`
- `createActorInteractionRoutedMessage`
- `createSessionStateClinicalEventMessage`
- `createSpatialActorTransformMessage`
- `evaluateSessionStateWebSocketMessageDesign`

The snapshot helper exposes actor visible memory only. The clinical-event helper uses `projectDurableClinicalEventForReview`, so hidden/private payload keys are redacted before a review-facing WebSocket message is built. Voice transcript sources preserve `rawAudioStored: false`.

Every promoted message includes:

- `schemaVersion: 1`
- `transport: "websocket_design_contract"`
- `direction`
- `messageId`
- `stationRunId`
- `sequence`
- `atSecond`
- `sentAt`

## Example Messages

```json
{
  "type": "actor.interaction.route",
  "stationRunId": "run_ed_chest_pain_priority_v1_learner_001",
  "atSecond": 142,
  "learnerUtterance": "Anna, can you tell me exactly when his pain started?",
  "traceContextTags": ["history_onset", "family_collateral"],
  "source": {
    "kind": "voice_transcript",
    "streamId": "voice_stream_station_001",
    "transcriptSegmentId": "segment_0007_final",
    "finalTranscriptText": "Anna, can you tell me exactly when his pain started?",
    "provider": "local_fastapi_transport_echo",
    "provenanceRefs": ["trace:voice_stream_station_001:segment_0007_final"],
    "rawAudioStored": false
  }
}
```

```json
{
  "type": "actor.interaction.routed",
  "stationRunId": "run_ed_chest_pain_priority_v1_learner_001",
  "routedActorId": "spouse_anna_hayes_v1",
  "routingReason": "addressed_actor_name",
  "traceContextTags": ["history_onset", "family_collateral"],
  "conversationTurn": 1
}
```

```json
{
  "type": "spatial.actor.transform",
  "stationRunId": "run_ed_chest_pain_priority_v1_learner_001",
  "actorId": "nurse_maria_alvarez_v1",
  "position": { "x": 1.2, "y": 0, "z": -0.6 },
  "rotationYRadians": -0.4,
  "interactionState": "holding_equipment",
  "lastUpdatedAtSecond": 190
}
```

## Validation Gates Before Runtime Implementation

- Keep the current type-level contracts in `@openclinxr/session-state` free of runtime imports.
- Keep WebSocket as the implemented transport lane until Quest and server evidence supports another transport.
- Keep `@openclinxr/session-state` free of WebSocket, Redis, Redka, MongoDB, Colyseus, and bitECS runtime dependencies.
- Add persistence contracts only through a follow-up proposal or an already-approved Phase 2 persistence implementation slice.
- Add `apps/api` runtime wiring only through a later verified slice; these contracts alone are not route implementation evidence.

## Open Design Risks

- Later WebSocket delta synchronization may require versioned state paths or patch operations rather than simple message families.
- Spatial updates can become noisy; checkpointing policy should be defined before durable storage is attached.
- Actor routing may need explicit addressee hints from XR gaze, hand targeting, or UI selection rather than text-only routing.
- Real voice integration will need confidence, partial/final transcript handling, and safety events before production use.
