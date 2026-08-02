# Physics Realbind Pre-Production Readiness Checklist

Date: 2026-08-02
Status: **PRE-PRODUCTION FENCE — NOT A PRODUCTION READINESS CERTIFICATE**

This checklist documents what is proven and what blocks promotion of
`@openclinxr/physics-touch-contract` / `apps/arena/physics-clinical-touch`
into production runtime paths (`apps/ui-xr`, `apps/ui-admin`, `apps/api`).

**Governing MADR:** [0030-arena-physics-clinical-touch-realbind-proven.md](../madr/0030-arena-physics-clinical-touch-realbind-proven.md)
**Supplement MADR:** [0031-physics-baked-vs-live-consumer-split.md](../madr/0031-physics-baked-vs-live-consumer-split.md) (split-gate model)

---

## DONE — Proven Under Local Determinism

| Item | Evidence |
|---|---|
| Real Rapier WASM (C1–C7) | `RapierRealAdapter`, `engineId: "rapier"`, C6 replay-equivalence |
| Factory physics config | `generatePhysicsConfigFromPhenotype`, 62 config tests |
| UI-XR bind | Physics bone transforms on real patient GLB + `deformsWithBreathing` + `garmentGeometry.sleeveDeform` |
| Measured metrics | `stepCostMs` p50 0.012ms / p95 0.022ms / max 4.522ms; `frameBudgetHeadroom` 16.645ms; `replayEquivalence` true |
| Dual evidence | Arena cagematch (PNGs + registry.json) + UI-XR bind (inspection.json + PNGs) |
| Package test posture | `@openclinxr/physics-touch-contract`: 221 tests green |

---

## BLOCKERS — Must Resolve Before Production Promotion

| Blocker | Current Value | Required | Source |
|---|---|---|---|
| `contactStability` | ~1.05 mm (redefined settle metric) | **CLEARED** — residual definition accepted under MADR 0031 settle-metric redefinition; gate split means live engine still gated regardless | MADR 0031 |
| No headset evidence | None | Required (R7 deferred, OD-4) | MADR 0030 §Scope |
| `determinismScope` | `local` only | Cross-platform C5 (future) | MADR 0030 §Scope |
| `runtimePromotionAllowed` | `false` | Human-only flip | `src/promotion-gates.ts` |
| `liveEngineProductionAllowed` | `false` | Human-only flip | `src/promotion-gates.ts` (split gate, MADR 0031) |
| `promotionStatus` | `false` (registry.json) | Human-only flip | registry.json |
| `realismGrade` | `"B"` | Gate-dependent | registry.json |

---

## HUMAN-ONLY — Gate Flip Required

The following gates are **explicitly named for human review** and must be flipped
in a successor MADR or BOD decision:

> **`runtimePromotionAllowed`** — controls whether physics-touch config consumers
> may be promoted from `@openclinxr/physics-touch-contract` /
> `tools/openclinxr/factory` into production packages (e.g., `apps/ui-xr`
> production runtime path).

> **`liveEngineProductionAllowed`** — controls whether live Rapier WASM may run
> in production app runtime paths. Split gate from `runtimePromotionAllowed`
> per MADR 0031 split-gate model.

> **`bakedTransformsCaptureAllowed`** — already `true` (MADR 0031).
> Baked offline JSON bone transforms may be captured in arena and consumed
> by production apps via `@openclinxr/physics-touch-artifacts`.

**Current values:** all human-review gates `false` except `bakedTransformsCaptureAllowed = true`
(see `packages/openclinxr/arena/physics-touch-contract/src/promotion-gates.ts`)

No agent, automated pipeline, or subagent may flip `runtimePromotionAllowed` or
`liveEngineProductionAllowed`.

---

## Required Architecture-Rule Green

The following architecture-rule tests must pass before any production promotion claim:

- [ ] Production apps (`apps/ui-xr`, `apps/ui-admin`, `apps/api`) free of `@openclinxr/physics-touch-contract` dependency
- [x] Production apps (`apps/ui-xr`, `apps/ui-admin`, `apps/api`) MAY depend on `@openclinxr/physics-touch-artifacts` (baked path)
- [ ] Production apps free of `@dimforge/rapier3d` / `@dimforge/rapier3d-compat` dependency
- [ ] Production apps free of relative-path imports from `apps/arena/physics-clinical-touch/`
- [ ] Production apps free of relative-path imports from `packages/openclinxr/arena/physics-touch-contract/`
- [x] `@openclinxr/physics-touch-artifacts` package.json contains zero `@dimforge/rapier*` entries
- [ ] Arena MADR link expectations include 0030 + 0031 for physics package + app READMEs

Enforced by `packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts`.

---

## Consumer Model: Baked vs Live (Split-Gate, MADR 0031)

| Consumer | Engine | Status |
|---|---|---|
| Arena cagematch | Live WASM (`@dimforge/rapier3d-compat`) | Arena-only, allowed |
| UI-XR capture evidence | Offline baked JSON transforms | Opt-in only, `bakedTransformsCaptureAllowed: true` |
| Production `apps/ui-xr` runtime | Live WASM | **FORBIDDEN** (`liveEngineProductionAllowed: false`) |
| Production `apps/ui-xr` runtime | Baked JSON transforms (via `@openclinxr/physics-touch-artifacts`) | **Allowed** (MADR 0031) |
| Production `apps/api` | Any physics import | **FORBIDDEN** |
| Production `apps/ui-admin` | Any physics import | **FORBIDDEN** |

Live Rapier WASM stays in arena (`apps/arena/physics-clinical-touch`).
Production consumers may only use offline-baked JSON transforms via
`@openclinxr/physics-touch-artifacts` (zero Rapier dependency), and
live-engine promotion requires a human to flip both `runtimePromotionAllowed`
and `liveEngineProductionAllowed`.

---

## notEvidenceFor

All physics artifacts carry:

```
notEvidenceFor: [
  clinical_validity,
  exam_equivalence,
  scoring,
  learner_readiness,
]
```

This list must remain on all artifacts. Removal requires a separate human decision.

---

## Explicit: This Is NOT a Production Readiness Certificate

This checklist documents the **pre-production fence**. It does not constitute,
imply, or authorize:

- Production promotion of any physics package or app
- Clinical validity, exam equivalence, scoring, or learner-readiness claims
- Quest/headset readiness
- Live WASM physics in production runtime paths

All gates remain `false` until a human explicitly flips `runtimePromotionAllowed`
in a successor MADR or BOD decision.
