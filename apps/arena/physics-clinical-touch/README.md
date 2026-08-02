# Physics Clinical Touch

App shell for the arena physics clinical touch cage match (epic `arena-physics-clinical-touch-v1`).

**Governing decisions:** [MADR 0021](../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md), [MADR 0028](../../../docs/madr/0028-iwsdk-sidecar-spike.md). Dedicated physics MADR lands in epic slice s6.

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
Slice `arena-physics-s4-winner-scenarios` — pending.

## Gates

All provider/runtime/learner/Quest/production/clinical/scoring gates remain **false**.
This is an arena sidecar only. Nothing promotes to production apps.
