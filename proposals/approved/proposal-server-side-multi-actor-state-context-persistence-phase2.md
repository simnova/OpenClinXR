# Proposal: Server-Side Multi-Actor State, Context, And Persistence Management Phase 2

**Status:** Approved  
**Approved by:** Patrick Gidich on 2026-05-05 14:34:17 EDT  
**Decision:** Approved as a follow-on architecture spike after the initial server-side multi-actor state and context management spike  
**Requested by:** Codex  
**Date:** 2026-05-05  
**Scope:** Server-side architecture spike only  
**Timing:** After the initial Colyseus / bitECS / custom-state evaluation has a documented baseline.

## Decision

Approve a focused Phase 2 spike to mature the server-side multi-actor state architecture by adding a persistence strategy. This spike builds on the Phase 1 recommendation to start with a custom domain-state baseline while keeping Colyseus and schema/delta frameworks as follow-up candidates.

## Recommendation

Use Redis-compatible infrastructure only where it clearly helps real-time behavior. Do not let Redis, Redka, or SQLite-backed cache state replace durable clinical persistence.

The working posture for this spike is:

- Redka or Redis-compatible local tooling for real-time, ephemeral, low-latency, and high-frequency state.
- Real Redis in staging/production for pub/sub, presence, leases, short-lived session caches, and spatial/interactions fan-out.
- MongoDB-compatible durable persistence for clinically significant records, audit-relevant state, case progression, interaction history, emotional-state history, and review artifacts.

## Proposed Responsibility Split

| State Type | Local Spike Candidate | Production Candidate | Persistence Posture |
| --- | --- | --- | --- |
| Actor positions, hand/object transforms, presence, and transient focus | Redka or in-memory Redis-compatible adapter | Redis | Ephemeral with TTL and replay from durable checkpoints when needed |
| Recent conversational context window for low-latency prompt assembly | Redka/Redis-compatible adapter | Redis | Cache only; reconstructable from durable interaction history |
| Durable interaction history and actor conversation turns | MongoDB memory server or local MongoDB | MongoDB / DocumentDB-compatible store | Durable source of truth |
| Emotional-state snapshots and changes over time | MongoDB memory server or local MongoDB | MongoDB / DocumentDB-compatible store | Durable and audit-relevant |
| Clinical trace tags, orders, findings, rubric progress, and case status | MongoDB memory server or local MongoDB | MongoDB / DocumentDB-compatible store | Durable and audit-relevant |
| Pub/sub for live UI/XR updates | Redka/Redis-compatible adapter if feasible; otherwise adapter-only test double | Redis | Ephemeral notification lane |
| Recovery after restart | Rehydrate from MongoDB into short-lived cache | Rehydrate from database into Redis | Database is authoritative |

## Proposed Spike Activities

- Review Phase 1 findings and confirm the custom domain-state baseline remains the preferred first implementation.
- Define session-state snapshots, event records, conversation turns, emotional-state timeline entries, and spatial cache records.
- Design adapter interfaces that separate durable persistence from real-time cache/pub-sub behavior.
- Evaluate Redka or SQLite-backed local Redis-compatible tooling for local parity without making it the durable source of truth.
- Evaluate how `mongodb-memory-server` can support deterministic local durable-state tests.
- Prototype recovery posture: durable session event log to cache rehydration.
- Document how role-aware actor routing consumes recent context from cache while relying on durable history for audit and recovery.
- Compare custom adapters, Colyseus, `@colyseus/schema`, and ECS-style approaches against persistence and recovery needs.

## Out Of Scope

- Full LLM integration.
- Voice transport implementation beyond using existing voice-turn provenance as example input.
- Production deployment.
- Final architecture selection without a follow-up implementation proposal.
- Treating Redis, Redka, or SQLite cache state as the durable clinical record.

## Verification And Output

The spike should produce:

- A Phase 2 architecture note with the Redis/Redka-versus-database responsibility boundary.
- A proposed durable data model for conversation history, emotional state, clinical progress, and interaction audit.
- A proposed cache/pub-sub model for spatial and recent-context state.
- Tests or executable type-level examples showing recovery from durable state into a real-time session cache.
- A follow-up implementation proposal if the direction is ready to promote into production-shaped packages.

## Approval Boundaries

Codex may:

- Prototype state models that incorporate conversation history and emotional state.
- Evaluate persistence strategies using Redka locally and real Redis as a production target.
- Use existing approved local MongoDB memory tooling where it fits deterministic tests.
- Make minor scope modifications needed to keep the spike coherent with Phase 1 findings.

Codex may not:

- Modify production systems.
- Add production runtime dependencies without a follow-up proposal or existing approval.
- Use cloud Redis, paid APIs, production credentials, or hosted databases.
- Commit to a final architecture without a follow-up proposal.
