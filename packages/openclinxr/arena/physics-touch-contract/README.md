# Physics Touch Contract

**Arena role:** engine-agnostic determinism contract (C1–C7) for clinical-touch physics cage match.

**Governing decisions:** [MADR 0021](../../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0027](../../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md), [MADR 0028](../../../../docs/madr/0028-iwsdk-sidecar-spike.md), [MADR 0029](../../../../docs/madr/0029-arena-physics-clinical-touch-determinism.md).

**Spec:** [arena-physics-clinical-touch-cagematch-2026-08-01](../../../../docs/openclinxr/arena-physics-clinical-touch-cagematch-2026-08-01.md).

**Production relationship:** arena-only. Do not import from production `apps/ui-xr` or non-arena packages. All gates remain false. Not clinical, scoring, exam-equivalence, Quest readiness, or learner-readiness evidence.

Useful checks:

```bash
pnpm --filter @openclinxr/physics-touch-contract test
pnpm --filter @openclinxr/physics-touch-contract typecheck
```
