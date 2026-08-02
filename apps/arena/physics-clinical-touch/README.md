# Physics Clinical Touch

App shell for the arena physics clinical touch cage match (epic `arena-physics-clinical-touch-v1`).

**Governing decisions:** [MADR 0021](../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md), [MADR 0028](../../../docs/madr/0028-iwsdk-sidecar-spike.md), [MADR 0029](../../../docs/madr/0029-arena-physics-clinical-touch-determinism.md).

## Package

Contract: [`@openclinxr/physics-touch-contract`](../../../packages/openclinxr/arena/physics-touch-contract/)
One interface, three engine adapters (Havok, Rapier, Jolt).

## Future adapter layout

```
src/
  adapters/{havok,rapier,jolt}.ts   — engine-specific PhysicsAdapter impls
  harness/{fixed-step,input-log,snapshot-hash,replay}.ts  — thin re-exports from contract
  scenarios/{palpation,passive-rom,guarding,positioning}.ts
public/cagematch/physics-clinical-touch/<yyyy-mm-dd>/     — evidence artifacts
test/*.test.ts
```

## Current status

Slice `arena-physics-s1-determinism-harness` — contract package scaffolded ✅ (25/25 tests).
Slice `arena-physics-s2-havok-adapter` — ✅ `HavokCandidateAdapter` + palpation scenario + C6 proofs + cagematch report. Real WASM gated on `@babylonjs/havok` dep install; candidate path exercises full step/snapshot/reset/C6 determinism. `engineId: "havok-candidate"`.
Slice `arena-physics-s3-rapier-jolt-cagematch` — ✅ `RapierCandidateAdapter` (engineId `rapier-candidate`, SplitMix32 PRNG, Verlet integration, SOR impulses), `JoltCandidateAdapter` (engineId `jolt-candidate`, Xoshiro128** PRNG, sub-stepped velocity integration, speculative contacts, broad-phase grid), `runThreeWayCagematch(log)` producing per-engine C6 reports + winner/eliminated verdict. All three engines have distinct checksums. Real WASM gated on `@dimforge/rapier3d` / Jolt napi-rs; candidate paths exercise full step/snapshot/reset/C6 determinism.
Slice `arena-physics-s4-winner-scenarios` — ✅ passive-rom, guarding, positioning InputLog builders + C6 HavokCandidateAdapter tests + scenarioInspectionReport. GuardingThresholdEvent emission hooks (case-def shaped, not clinical scoring). Inspection-shaped JSON for evidence. Garment coherence: metadata-only claim that existing ED real-garment GLB path is out of band — does NOT rewrite apps/ui-xr; notEvidenceFor garment visual recorded in arena report.
Slice `arena-physics-s5-factory-physics-config` — ✅ `PhysicsConfigV1` type + `generatePhysicsConfigFromPhenotype(input)` factory in `packages/openclinxr/arena/physics-touch-contract/src/factory/`. Committed habitable-tables.ts with `AVERAGE|OBESE|FRAIL_MASS|COMPLIANCE|JOINT_LIMITS|GUARDING_TRIGGERS` + selectors. Deterministic: same phenotype → same config hash; different habitus → different masses/compliance/limits/triggers. `HavokCandidateAdapter.fromPhysicsConfig(config)` static factory for minimal seed/fixedDt wiring. Plain TS types only — no schemas/ package dependency.

## Gates

All provider/runtime/learner/Quest/production/clinical/scoring gates remain **false**.
This is an arena sidecar only. Nothing promotes to production apps.
