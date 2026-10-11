# CCD stance lock on the four-joint leg solver: hypothesis refuted (2026-10-11)

Verdict: REJECT. Runtime code changed (default-off flag); physician control rows
bit-identical. Evidence: `.openclinxr/evidence/ccd-lock/report.json`.

## Why this slice exists

The stepping-turn slice measured the shipped two-bone stance-leg solver missing its
own heel target by 0.045-0.40 m on a no-op solve, while CCD over the four leg joints
hits 0.0000 m (`stepping-turn-2026-10-11.md` STEP 1). The walk phase alone slides
0.0997 m (physician) / 0.1364 m (nurse) on the SC-05 assay. Hypothesis: the stance
lock's corrections miss because of that solver. This slice puts the stance lock on
the hinge-constrained four-joint solver behind a default-off flag and measures
walk-phase slide off vs on.

## What changed (default off, control rows bit-identical)

- `stance-lock-leg-ik-mod.ts` (new, 85 lines): `applyStanceLegSolve` owns the stance-leg
  IK application. The shipped two-bone math moved there verbatim; flag on reuses
  `solveSteppingLegHinge` from `stepping-turn-leg-ik-mod.ts` (intra-package import, no
  duplicated solver) with the slot-yaw pole and intermediates at the clip pose, falling
  back to two-bone when the rig carries no four-joint chain. Read-only heel-miss tap.
- `stance-lock-mod.ts` (497 -> 480 lines): calls the helper; adds `ccdStanceLockEnabled`
  + `recordHeelMiss` inputs. No new public export.
- `case-owned-approach-runtime-mod.ts` (+3 lines, at the 500 budget, none raised):
  `ccdStanceLockEnabled` field + create input + init. `case-owned-approach-frame-mod.ts`
  (+1): passthrough. `runtime-approach-measurement.ts` (harness): passthrough.
- Assay: `tools/.../ccd-stance-lock/ccd-stance-lock-cagematch.ts` (new). No package
  export added, so no admission overlay was needed.
- Tests: `the-ccd-stance-lock-switches-solvers.test.ts` (3 tests pass, all routed through
  the public `case-owned-approach-runtime` subpath so the test-import ceiling holds):
  default crowns and solves, flag on drives the hinge (mids frozen, angles differ),
  no-chain fallback identical. Existing stance suites: 19/19 pass.
- Index: `arch-index.json` regenerated (`pnpm arch:index`); diff is the new test file only.

## Gates

- `pnpm docs:drift-check`: clean.
- `pnpm architecture`: back to the HEAD baseline — the only failures are the 4
  pre-existing `workspace-architecture.test.ts` ones (ui-xr/Mongo/circular), identical set
  with and without this slice (verified via stash). No ceiling raised: runtime-mod sits
  exactly at its 500-line zone budget; no freeze entry added or widened.
- Package typecheck: no new errors (4 pre-existing test-signature errors unchanged).

## Measurement (physician gates; stop rule fired)

Part A (SC-05 assay, flag off vs on):

| candidate | walk slide | whole | max step | arrival |
|---|---|---|---|---|
| A (off) | 0.0997 | 0.1200 | 0.0679 | 0.1588 |
| C (on) | 0.0997 | 0.1200 | 0.0679 | 0.1588 |

Walk-slide reduction 0.0000 m (bar >= 0.03). The A row reproduces the stepping-turn
control bit-identically. The C row is bit-identical to A: expected, not a harness
defect — the assay rigs carry marker toes, not leg bones, so both candidates take the
lock's no-chain XZ-only fallback and neither solver runs in-assay. The on/off assay
comparison is vacuous for the solver hypothesis by construction.

Part B (mirror probe, shipped GLB bytes, no-op heel target, 10 configs):

| solver | median miss | max miss |
|---|---|---|
| two-bone (off) | 0.1760 | 0.3987 |
| hinge (on) | 0.0000 | 0.0000 |

The solver gap is real and reproduces the FACTS range, but it has no walk-phase outlet
in this assay because there is no leg to solve.

## Bars (physician)

1/4 pass: heel-miss median 0.0000 < 0.01 (pass); walk reduction 0.0000 < 0.03 (FAIL);
max step identical (pass); arrival identical (pass). Per the slice stop rule the
physician FAIL refutes the hypothesis: the walk-phase slide does not come from the
stance-leg solver choice. Nurse/child assay rows were not run (stop rule).

## Limits

1. The hinge path is proven on fabricated chains (unit) and mirror bytes (probe) only;
   no browser/real-skeleton walk has run with the flag on.
2. The settled-posture correction (`settled-posture-correction.ts`) keeps its own
   two-bone call site; out of scope for this slice.
3. Flipping the flag for production needs orchestrator review.

## Recommended next

Leave the flag off (default). The walk-phase slide needs a different lead; do not
spend another solver slice on it without one.
