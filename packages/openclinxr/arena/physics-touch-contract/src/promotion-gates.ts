/**
 * Physics Touch Promotion Gates
 *
 * Single source of truth for the pre-production fence.
 * All gates default to `false` — no automation may flip them.
 *
 * Governing MADR: 0030-arena-physics-clinical-touch-realbind-proven.md
 * Pre-production checklist: docs/openclinxr/physics-realbind-pre-production-readiness-checklist-2026-08-02.md
 */

export const runtimePromotionAllowed = false as const;

export const PHYSICS_TOUCH_PROMOTION = {
  /** Human-only flip gate — successor MADR/BOD required */
  runtimePromotionAllowed: false,

  /** Determinism scope accepted at OD-3 */
  determinismScope: "local",

  /** Claims this package does NOT support */
  notEvidenceFor: [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ] as const,

  /** Governing decision */
  governingMadr: "0030",
} as const;
