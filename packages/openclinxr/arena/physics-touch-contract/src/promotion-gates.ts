/**
 * Physics Touch Promotion Gates
 *
 * Single source of truth for the pre-production fence.
 * All gates default to `false` — no automation may flip them.
 *
 * Split-gate model (MADR 0031 supplement to 0030):
 *   - `runtimePromotionAllowed`: human/BOD gate for promotion to production runtime paths.
 *     Remains `false` — live Rapier WASM stays arena-only.
 *   - `liveEngineProductionAllowed`: live Rapier WASM in production apps.
 *     Remains `false` — baked transforms are the opt-in consumer path.
 *   - `bakedTransformsCaptureAllowed`: offline baked JSON transforms may be captured
 *     by the arena and consumed by production apps (ui-xr opt-in).
 *     Already `true` — this is the baked-consumer path governed by MADR 0031.
 *
 * Governing MADRs: 0030, 0031
 * Pre-production checklist: docs/openclinxr/physics-realbind-pre-production-readiness-checklist-2026-08-02.md
 */

export const runtimePromotionAllowed = false as const;
export const liveEngineProductionAllowed = false as const;
export const bakedTransformsCaptureAllowed = true as const;

export const PHYSICS_TOUCH_PROMOTION = {
  /** Human-only flip gate — successor MADR/BOD required */
  runtimePromotionAllowed: false,

  /** Live Rapier WASM is forbidden in production apps */
  liveEngineProductionAllowed: false,

  /** Baked offline JSON transforms may be captured and consumed by production apps */
  bakedTransformsCaptureAllowed: true,

  /** Determinism scope accepted at OD-3 */
  determinismScope: "local",

  /** Claims this package does NOT support */
  notEvidenceFor: [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ] as const,

  /** Governing decisions */
  governingMadrs: ["0030", "0031"] as const,
} as const;
