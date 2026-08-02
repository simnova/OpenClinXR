# Physics Touch Artifacts

Production-safe baked bone-transform schema types and consumer gates.

**Zero Rapier dependency** — production apps (`apps/ui-xr`, `apps/ui-admin`, `apps/api`) MAY import from this package.

**Governing decisions:** [MADR 0030](../../../docs/madr/0030-arena-physics-clinical-touch-realbind-proven.md), [MADR 0031](../../../docs/madr/0031-physics-baked-vs-live-consumer-split.md).

**Consumer model (split-gate, MADR 0031):**

| Gate | Value |
|---|---|
| `bakedTransformsConsumerAllowed` | `true` |
| `liveEngineInProductionForbidden` | `true` |

Baked JSON transforms are captured offline by the arena physics pipeline
(`packages/openclinxr/arena/physics-touch-contract/src/cli/generate-physics-bone-transforms.ts`)
and consumed by production apps. Live Rapier WASM is **forbidden** in all production
runtime paths.

Useful checks:

```bash
pnpm --filter @openclinxr/physics-touch-artifacts test
pnpm --filter @openclinxr/physics-touch-artifacts typecheck
```
