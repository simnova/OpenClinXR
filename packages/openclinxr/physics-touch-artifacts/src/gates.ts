/**
 * Physics Touch Artifacts — Production-Consumer Gates
 *
 * Split-gate model (MADR 0031 supplement to 0030):
 *   - Baked transforms: consumer-ready, opt-in capture path already used by ui-xr.
 *   - Live Rapier WASM: arena-only; forbidden in production apps.
 *
 * These gates are production-safe (no Rapier dependency).
 * The arena-side gate `runtimePromotionAllowed` lives in
 * `packages/openclinxr/arena/physics-touch-contract/src/promotion-gates.ts`
 * and remains `false` — human/BOD flip required for live-engine promotion.
 */

/** Baked offline transforms may be consumed by production apps (ui-xr opt-in capture). */
export const bakedTransformsConsumerAllowed = true as const;

/** Live Rapier WASM is forbidden in all production runtime paths. */
export const liveEngineInProductionForbidden = true as const;

export const PHYSICS_TOUCH_ARTIFACTS_GATES = {
  /** Baked JSON transforms are consumer-ready — already used by ui-xr opt-in capture */
  bakedTransformsConsumerAllowed: true,

  /** Live Rapier WASM must never ship in production apps */
  liveEngineInProductionForbidden: true,

  /** Claims this package does NOT support */
  notEvidenceFor: [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
    "production_physics_readiness",
  ] as const,

  /** Governing decisions */
  governingMadrs: ["0030", "0031"] as const,
} as const;
