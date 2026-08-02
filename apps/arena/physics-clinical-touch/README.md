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

Slice `arena-physics-s1-determinism-harness` — contract package scaffolded.
Slice `arena-physics-s2-havok-adapter` — pending (Havok adapter + IWSDK harness integration).
Slice `arena-physics-s3-rapier-adapter` — pending.
Slice `arena-physics-s4-jolt-adapter` — pending.

## Gates

All provider/runtime/learner/Quest/production/clinical/scoring gates remain **false**.
This is an arena sidecar only. Nothing promotes to production apps.
