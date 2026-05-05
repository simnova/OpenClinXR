# Proposal: Multi-Actor Runtime Promotion

**Status:** Proposed  
**Requested by:** Codex  
**Date:** 2026-05-05  
**Scope:** Promote the approved multi-actor state spike from isolated evidence package into production-shaped server runtime contracts

## Decision Needed

Approve or defer promotion of the custom multi-actor state baseline from `packages/openclinxr/multi-actor-state-spike` into a production-shaped OpenClinXR package.

The recommended target is a dedicated project package:

- `packages/openclinxr/session-state`

This keeps the contract reusable by `scenario-runtime`, `apps/api`, future WebSocket session-state messages, GraphQL, and persistence without overloading the existing runtime package too early.

## Recommendation

Approve a constrained promotion slice.

Use the custom domain-state baseline as the first production-shaped contract. Do not adopt Colyseus, `@colyseus/schema`, or bitECS yet. The spike evidence says the first real problem is defining clinical actor state cleanly, not choosing a synchronization framework.

## Proposed Scope

If approved, Codex may:

- Create `packages/openclinxr/session-state`.
- Move or copy the stable public API from `packages/openclinxr/multi-actor-state-spike` into the new package.
- Add ArchUnitTS rules so production code imports the promoted package rather than the spike package.
- Add focused tests for actor routing, per-actor memory boundaries, clinical orders/findings, spatial transforms, and evidence boundaries.
- Add a small adapter in `packages/openclinxr/scenario-runtime` only if it is needed to prove integration.
- Keep WebSocket session-state messages design-only unless a separate implementation slice is approved or clearly in scope.

## Out Of Scope

- Full realtime synchronization implementation.
- Colyseus, `@colyseus/schema`, bitECS, WebTransport, QUIC, or Web3 package installs.
- Final clinical validity claims.
- Quest performance claims.
- Voice model inference integration beyond typed metadata placeholders.
- Production persistence in MongoDB/Mongoose.

## Rationale

The first spike produced implementation-backed evidence that a custom baseline can represent:

- Patient, family, nurse, physician, and other actor roles.
- Per-actor visible and private memory.
- Routing based on addressed actor name or role keyword.
- Clinical trace progress, orders, and findings.
- Spatial actor transform state.
- Evidence boundaries that prevent accidental production or Quest-readiness claims.

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
- `packages/openclinxr/multi-actor-state-spike` remains as evidence or is clearly marked as superseded.
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

