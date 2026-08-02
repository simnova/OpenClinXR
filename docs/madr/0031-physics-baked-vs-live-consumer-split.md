# MADR 0031: Physics Baked-vs-Live Consumer Split

**Status:** Accepted
**Date:** 2026-08-02
**Supersedes/Augments:** [0030-arena-physics-clinical-touch-realbind-proven.md](0030-arena-physics-clinical-touch-realbind-proven.md)
**Context:** Pre-production fence refinement — split-gate model after realbind evidence

---

## Decision

The physics-touch promotion gate is split into three independent flags
in `packages/openclinxr/arena/physics-touch-contract/src/promotion-gates.ts`:

| Gate | Value | Meaning |
|---|---|---|
| `runtimePromotionAllowed` | `false` | Human/BOD flip required for any physics promotion to production runtime paths |
| `liveEngineProductionAllowed` | `false` | Live Rapier WASM forbidden in production apps (`apps/ui-xr`, `apps/ui-admin`, `apps/api`) |
| `bakedTransformsCaptureAllowed` | `true` | Offline baked JSON bone transforms may be captured in arena and consumed by production apps |

A new production-safe package `@openclinxr/physics-touch-artifacts` hosts baked
artifact schema types and consumer gates. This package has **zero Rapier dependency**
and is allowed as a dependency of production apps.

Consumer model:

| Consumer | Engine | Status |
|---|---|---|
| Arena cagematch | Live Rapier WASM | Arena-only, allowed |
| UI-XR capture evidence | Offline baked JSON transforms | Opt-in only, allowed |
| Production `apps/ui-xr` runtime | Live Rapier WASM | **FORBIDDEN** (`liveEngineProductionAllowed: false`) |
| Production `apps/ui-xr` runtime | Baked JSON transforms | **Allowed** (via `@openclinxr/physics-touch-artifacts`) |
| Production `apps/api` | Any physics import | **FORBIDDEN** |
| Production `apps/ui-admin` | Any physics import | **FORBIDDEN** |

## Rationale

- Live WASM stays arena-only until `runtimePromotionAllowed` is flipped by human/BOD.
- Baked transforms are already the opt-in consumer path (MADR 0030 §Consequences).
- Separating `bakedTransformsCaptureAllowed` from `runtimePromotionAllowed` decouples
  the bake-capture pipeline from the live-engine promotion question.
- A dedicated artifacts package gives production apps a safe import target with no
  physics engine transitive dependencies.

## Consequences

- Architecture rules updated: production apps may depend on `@openclinxr/physics-touch-artifacts`;
  must not depend on `@openclinxr/physics-touch-contract`, `@dimforge/rapier3d`, or
  `@dimforge/rapier3d-compat`.
- `physics-touch-artifacts/package.json` must contain no `@dimforge/rapier*` entry.
- MADR README index references updated to include 0031 for physics packages.
- `governingMadrs` in `PHYSICS_TOUCH_PROMOTION` now carries `["0030", "0031"]`.
- Pre-production checklist updated: contact-stability residual ~1.05 mm (redefined settle metric),
  split-gate model recorded, live engine still not prod.
