/**
 * Single source of truth for the physics-touch capture output directory.
 *
 * The path is declared ONCE here and imported by:
 *   - the producer:  ./physics-touch-capture.mjs
 *   - the contract:  packages/openclinxr/arena/physics-touch-contract/src/__tests__/physics-ui-xr-bind.test.ts
 *   - a consumer:    apps/arena/physics-clinical-touch/src/main.ts
 *
 * Previously the producer wrote `2026-08-02-prod-refine` while the test read
 * `2026-08-02-uixr-bind` — two literals that drifted apart and kept four tests
 * red in every checkout. The path is relative to the repository root.
 *
 * `.openclinxr/` is gitignored, so the directory only exists on machines where
 * the capture has been run. The contract tests skip with a recorded reason when
 * it is absent; they execute in full once a capture produced it.
 */
export const PHYSICS_TOUCH_CAPTURE_OUTPUT_DIR =
  ".openclinxr/evidence/physics-clinical-touch/2026-08-02-prod-refine";
