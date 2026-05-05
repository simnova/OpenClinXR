# Proposal: Multi-Actor Runtime Promotion

**Status:** Approved  
**Approved by:** Patrick Gidich on 2026-05-05  
**Decision:** Approved with clarifications: promote the multi-actor state work into a production-shaped package while keeping framework and persistence decisions evidence-gated  
**Requested by:** Codex  
**Date:** 2026-05-05  
**Scope:** Promote the approved multi-actor state spike from isolated evidence package into production-shaped server runtime contracts

## Decision

Approve promotion of the custom multi-actor state baseline from `packages/openclinxr/multi-actor-state-spike` into a production-shaped OpenClinXR package.

The approved target name is:

- `packages/openclinxr/session-state`

Naming conventions may evolve as clinical use cases and WebSocket session requirements solidify. A future cleanup may rename this package, for example to `clinical-state` or `actor-state`, without requiring another full proposal if the scope is only naming cleanup.

## Recommendation

Use the custom domain-state baseline as the first production-shaped contract. Do not adopt Colyseus, `@colyseus/schema`, or bitECS yet. The spike evidence says the first real problem is defining clinical actor state cleanly, not choosing a synchronization framework.

## Key Clarifications

1. Package naming: `packages/openclinxr/session-state` is acceptable for now.
2. Persistence strategy: Redis/Redka is only for real-time and ephemeral needs. Durable clinical state and long-term records must be persisted to a database. Persistence architecture remains future work.
3. Evidence handling: `packages/openclinxr/multi-actor-state-spike` must be clearly marked as superseded once the new package is established.
4. Future refactoring risk: later WebSocket delta synchronization work may require adjustments to the state shape. This is an accepted risk.

## Approved Scope

Codex may:

- Create `packages/openclinxr/session-state`.
- Promote the stable public API from the spike package.
- Add ArchUnitTS rules so production code imports the promoted package rather than the spike package.
- Add focused tests for actor routing, per-actor memory boundaries, clinical actions, spatial transforms, and evidence boundaries.
- Keep WebSocket session-state messages design-only for now.

## Not Approved

- Adoption of Colyseus, `@colyseus/schema`, or bitECS at this time.
- Full realtime synchronization implementation.
- Production persistence layer.
- Quest performance claims.
- Clinical validity claims.

## Rationale

The spike produced implementation-backed evidence that a custom baseline can represent:

- Patient, family, nurse, physician, and other actor roles.
- Per-actor visible and private memory.
- Routing based on addressed actor name or role keyword.
- Clinical trace progress, orders, and findings.
- Spatial actor transform state.
- Typed voice-transcript provenance without storing raw audio.
- Evidence boundaries that prevent accidental production, Quest-readiness, persistence, or clinical-validity claims.

This now deserves a production-shaped home, but the adoption boundary should stay explicit because it will influence API contracts, trace ledgers, review packets, and future voice/session synchronization.

## Pros

- Turns the spike into a reusable domain contract without bringing in heavy realtime dependencies.
- Gives `apps/api` and GraphQL a stable package boundary for future session-state APIs.
- Makes ArchUnitTS enforcement possible.
- Keeps Colyseus and schema-sync decisions evidence-gated.
- Aligns with the team preference for TypeScript-first, Bun/Hono-compatible architecture.

## Cons

- Adds another package boundary.
- May need one follow-up refactor if later WebSocket delta sync changes the shape.
- Does not yet solve high-frequency replication, persistence, or multi-user concurrency.
- Still needs later validation with voice turns and Quest runtime evidence.

## Acceptance Criteria

- `packages/openclinxr/session-state` exists with exact pinned workspace dependencies only.
- The package test suite covers actor routing, private memory boundaries, clinical actions, spatial transforms, and evidence limitations.
- `packages/openclinxr/multi-actor-state-spike` remains as evidence and is clearly marked as superseded.
- Architecture rules prevent production packages from importing `multi-actor-state-spike`.
- No new external runtime dependencies are added.
- Verification passes:

```bash
pnpm --filter @openclinxr/session-state test
pnpm --filter @openclinxr/session-state typecheck
pnpm --filter @openclinxr/architecture-rules test
pnpm security:audit-policy
pnpm security:licenses
```

## Rollback

Remove the new package and any imports from production packages. The isolated spike package and report remain as prior evidence.

## Related Evidence

- `docs/openclinxr/server-side-multi-actor-state-spike-2026-05-05.md`
- `packages/openclinxr/multi-actor-state-spike`
- `proposals/approved/proposal-server-side-multi-actor-state-context.md`
- `proposals/approved/proposal-server-side-multi-actor-state-context-persistence-phase2.md`
