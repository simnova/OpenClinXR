# MADR 0030: Realbind Physics Clinical-Touch — PROVEN Under Local Determinism

Date: 2026-08-02
Status: **PROVEN** under local determinism — **not automatically promoted** to production XR

## Context

MADR 0029 kept physics clinical-touch **arena-only** and required a successor MADR with
dual evidence (arena cagematch + UI-XR bind) before any promotion path could open. Epic
`arena-physics-clinical-touch-realbind-v1` (R1–R6) explicitly addressed the five deferred
items from the prior epic (D1–D5) and the binary-decision successor MADR (R6).

Operator decisions (OD-1 through OD-5) were frozen at epic open:
- OD-1: Rapier (`@dimforge/rapier3d`) as the required real engine
- OD-2: Extend canonical phenotype type at its real definition site
- OD-3: `determinismScope: "local"` — accepted closure; no second architecture
- OD-4: Immersive/headset physics deferred to R7, operator-gated
- OD-5: 90 min per-slice toil timebox

All five deferred items (D1–D5) are now delivered with committed evidence.

## Evidence (R1–R5 closed)

### D1 — Real Rapier WASM, C6 through real binding
- `packages/openclinxr/arena/physics-touch-contract/src/adapters/rapier-real.ts`:
  `RapierRealAdapter` loads `@dimforge/rapier3d-compat` WASM; `engineId: "rapier"`
  (not `/-candidate$/`). AD-1 guard satisfied.
- `real-engine-loaded.test.ts` green: asserts `engineId === "rapier"` and C6
  replay-equivalence checksums from real `takeSnapshot()` / restore.

### D2 — Factory-generated physics config
- `tools/openclinxr/factory/generated-physics-config-artifacts.ts` (570 lines):
  `SCHEMA_VERSION` / `KIND` / `OUTPUT_DIR` / provenance embedding, mirroring
  `generated-human-rigging-artifacts.ts`.
- Input: canonical phenotype type extended with `bodyMechanics` (habitus tables,
  per-region tissueCompliance, jointRangeProfile, guardingTriggers).
- 33 factory tests + 29 package-level `physics-config-v1.test.ts` = 62 config tests.
  AD-2 guard: grep-confirmed zero hand-authored physics constants in adapter/scenario code.

### D3 — UI-XR bind: physics-driven bones on real patient GLB
- Physics bone transforms compose with skinned GLB + `deformsWithBreathing` +
  `garmentGeometry.sleeveDeform` on real comparator `ed_anny_real_garment_patient`.
- Evidence: `.openclinxr/evidence/physics-clinical-touch/2026-08-02-uixr-bind/`
  - `inspection.json`: `physicsTouch.engineId: "rapier"`, bones affected: spine,
    chest, upper_arm.L/R, clavicle.L/R, `openclinxr_real_garment_from_phenotype`
    userData with `spineDz: -0.029mm`, `guardingAngle: 0.031 rad`
  - `physics-touch-ed-patient-front.png` (192,551 bytes)
  - `physics-touch-ed-patient-palpation.png` (192,718 bytes)
- AD-3 + visibility guard satisfied.

### D4 — Measured metrics (not types)
- `report.json` with populated mm/°/ms from real run:
  - `stepCostMs`: p50 0.012ms, p95 0.022ms, max 4.522ms (361 samples)
  - `frameBudgetHeadroom`: 16.645ms
  - `contactStability`: 88.6mm
  - `poseReturnError`: 0°
  - `jointExplosionRate`: 0
  - `replayEquivalence`: true, `snapshotSupport`: true, `licenceClean`: true
  - `garmentCoherence`: grade B
- `metrics-populated.test.ts` (26 tests): rejects default/zero/null population.
- `registry.json` with `model-vetting-report.v1` shapes (`promotionStatus: false`,
  `realismGrade: "B"`).
- AD-4 guard satisfied.

### D5 — Runnable arena app
- `apps/arena/physics-clinical-touch/src/**` exists and runs headless.
- `public/cagematch/physics-clinical-touch/2026-08-02/` populated:
  - `report.json`, `registry.json`, `physics-touch-ed-patient-front.png`,
    `physics-touch-ed-patient-palpation.png`
- AD-5 guard satisfied.

### Package test posture
- `@openclinxr/physics-touch-contract`: 221 tests green (incl. real-engine-loaded,
  metrics-populated, physics-ui-xr-bind, physics-config-v1, determinism, C1–C7).
- Factory: 62 config tests green.
- `notEvidenceFor: [clinical_validity, exam_equivalence, scoring, learner_readiness]`
  on all artifacts.

## Decision

**PROVEN** under local determinism, dual evidence present:
1. Arena cagematch (`apps/arena/physics-clinical-touch`): measured metrics +
   committed PNGs + registry.json.
2. UI-XR bind (`apps/ui-xr`): physics-driven bone transforms on a real patient
   GLB, captured and committed.

### Named promotion gate (human-only flip)

This MADR names **one** gate a human may flip in a later decision or successor MADR:

> **`runtimePromotionAllowed`** — physics-touch config consumer promotion from
> `@openclinxr/physics-touch-contract` / `tools/openclinxr/factory` into production
> packages (e.g., `apps/ui-xr` production runtime path).

**This MADR does NOT flip any gate.** All production, Quest, clinical, and scoring
gates remain `false`. The evidence produced qualifies the gate for human review;
it does not constitute automatic promotion.

### Scope and posture

| Property | Value |
|---|---|
| `determinismScope` | `local` (OD-3) |
| Platforms | Apple M1 Max desktop/preview only |
| Headset evidence | None (R7 deferred, OD-4) |
| C5 multi-architecture | Not required (OD-3 accepted closure) |
| `notEvidenceFor` | clinical_validity, exam_equivalence, scoring, learner_readiness |

## Consequences

Positive:
- Real Rapier WASM determinism contract (C1–C7) is proven on a real engine, not a
  candidate stand-in.
- Factory generator path exists and is wired to the canonical phenotype type.
- Physics-driven bone transforms compose with the existing skinned-GLB, breathing,
  and garment pipeline inside UI-XR.
- Measured metrics and dual evidence (arena cagematch + UI-XR bind) satisfy the
  promotion-path prerequisite MADR 0029 required.
- A single, explicit promotion gate (`runtimePromotionAllowed`) is named for human
  review — no implicit, ambiguous, or automatic promotion.

Negative:
- No headset/Quest evidence (R7 deferred, operator-gated).
- `contactStability` at 88.6mm exceeds the aspirational <2mm threshold from
  the spec; acceptable for `local` determinism evaluation but must be addressed
  before any production physics runtime path.
- `determinismScope: "local"` — no cross-platform C5 evidence.
- All production gates remain `false` until a human explicitly flips
  `runtimePromotionAllowed` in a successor decision.

## Related

- MADR 0029: arena-only non-promotion decision; this MADR is the successor it required.
- Epic brief: `docs/openclinxr/arena-physics-clinical-touch-realbind-2026-08-02.md`
- Epic: `.openclinxr/epics/ACTIVE` → `arena-physics-clinical-touch-realbind-v1`
- Evidence root: `.openclinxr/evidence/physics-clinical-touch/2026-08-02-uixr-bind/`
- Arena cagematch: `apps/arena/physics-clinical-touch/public/cagematch/physics-clinical-touch/2026-08-02/`
- R7 successor: `arena-physics-realbind-r7-quest-optional` (operator-gated immersive/headset physics)
- MADR 0021 (local-first spikes), 0027 (Quest gate), 0028 (IWSDK sidecar)
