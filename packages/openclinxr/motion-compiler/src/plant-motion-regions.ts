/**
 * MOTION REGION IDS USED BY THE PLANT FIXTURES. One declaration, imported by every plant.
 *
 * Added 2026-08-30 after an independent reviewer measured three spellings of the same concept across
 * the plant set:
 *
 *     keystone, M4                       "guard_abdomen_rlq"
 *     contacts, registry foundation      "motion_guard_abdomen_rlq"
 *     M2 internal targets                "abdomen_rlq"        (a raw ComplianceRegion)
 *
 * Nothing was wrong with any one file. The set disagreed, and a worker reading three plants sees
 * three conventions for the region M1's mapper is supposed to produce — which is the collision M1
 * clause (2) exists to prevent, arriving through fixtures instead of through code.
 *
 * These are FIXTURES, not the vocabulary. `MOTION_BODY_REGIONS` is M1's deliverable and does not
 * exist yet; when it does, these must be members of it and the plants that assert membership are
 * M1's, not this file's. What this file buys is that the plants stop disagreeing with each other
 * while nobody can check them.
 *
 * The `motion_` prefix is deliberate and is NOT a rename of the touch vocabulary: M1 clause (2)
 * refuses a 1:1 rename by requiring at least one motion region with no ComplianceRegion counterpart.
 * A prefix on a fixture id says only "this is the motion side of the boundary".
 */

/** The motion region a right-lower-quadrant guard drives. */
export const MOTION_REGION_GUARD_RLQ = "motion_guard_abdomen_rlq";

/** A second motion region, for clauses that must show two targets differ. */
export const MOTION_REGION_GUARD_CHEST_L = "motion_guard_chest_l";

export const MOTION_REGION_GUARD_LUQ = "motion_guard_abdomen_luq";
export const MOTION_REGION_GUARD_CHEST_R = "motion_guard_chest_r";

/**
 * The four the guard plant drives across three rigs. One list, so "four targets" cannot drift from
 * whatever a clause happens to enumerate.
 */
export const GUARD_MOTION_REGIONS = [
  MOTION_REGION_GUARD_RLQ,
  MOTION_REGION_GUARD_LUQ,
  MOTION_REGION_GUARD_CHEST_R,
  MOTION_REGION_GUARD_CHEST_L,
] as const;

/**
 * A FIFTH, deliberately outside the four above.
 *
 * The guard plant's clause (2) proves there is no per-target pose table by compiling a target the
 * module never declared. It used an invented id; a closed motion vocabulary and an arbitrary
 * undeclared region cannot both be canonical, so the undeclared case is now a DECLARED motion region
 * that simply has no entry in any pose table — which is the property the clause is actually about.
 */
export const MOTION_REGION_GUARD_FLANK_R = "motion_guard_flank_r";

/**
 * EVERY compliance/motion pair the plants rely on, so the mapper is bound on all four arrows rather
 * than the two that happened to be convenient.
 *
 * A partial binding is a real hole: with only `abdomen_rlq` and `chest_L` asserted,
 * `motion_guard_abdomen_luq` and `motion_guard_chest_r` could sit in the vocabulary while the mapper
 * emitted different strings for those touch sites — and since the guard plant never calls the mapper,
 * the split would surface in the planner instead, far from either contract that would have caught it.
 */
export const COMPLIANCE_TO_MOTION_REGION = [
  { compliance: "abdomen_rlq", motion: MOTION_REGION_GUARD_RLQ },
  { compliance: "abdomen_luq", motion: MOTION_REGION_GUARD_LUQ },
  { compliance: "chest_R", motion: MOTION_REGION_GUARD_CHEST_R },
  { compliance: "chest_L", motion: MOTION_REGION_GUARD_CHEST_L },
] as const;

/** Kept as named constants because several clauses read one pair rather than the list. */
export const COMPLIANCE_REGION_RLQ = "abdomen_rlq";
export const COMPLIANCE_REGION_CHEST_L = "chest_L";

/**
 * THE SPACE A REGION ANCHOR IS EXPRESSED IN, named here because the last unnamed space cost a round.
 *
 * `SkeletonProfile.regionAnchors` values are metres in the rig's BIND WORLD frame — the same space
 * as `SkeletonProfile.bindFrame`, and the space the FK oracle accumulates into. NOT node-local to any
 * bone, and not a chest-relative offset: either of those would compare as a miss against an oracle
 * that walks the chain to world, and nobody reading a failing distance would see why.
 *
 * The track contract earned `rotationAbsoluteNodeLocal` for exactly this reason. This is the same
 * discipline applied to positions.
 *
 * WHAT THIS IS NOT, and it is a real limitation rather than a caveat. Brief section 8 resolves
 * `bodySurface(left_precordium)` — a point on a MESH. A bind-pose skeleton anchor is a proxy for
 * that, and the contacts plant already deferred penetration and orientation on the grounds that a
 * point is not a surface. These anchors make that proxy load-bearing on the skeleton, and M1b
 * deriving bind transforms from a shipped GLB will NOT produce them: they need a mesh closest-point
 * or a landmark offset, and that work is unowned today. Recorded on the contact-surfaces card
 * (tsk_67cafb96802a06bc) rather than left in a comment.
 */
export const REGION_ANCHOR_SPACE = "bind_world_metres";

/**
 * The space TRAVELS WITH THE DATA, as `SkeletonProfile.regionAnchorSpace`.
 *
 * A constant declared nearby and referenced only in prose is a marker check: a worker can read the
 * numbers as chest-relative, leave this unused, and satisfy every shape. The discriminator has to be
 * on the profile so a primitive can REFUSE a space it does not implement, which is what
 * `rotationAbsoluteNodeLocal` does for rotations — the meaning is in the field name, not in a comment
 * beside it.
 */
export type RegionAnchorSpace = typeof REGION_ANCHOR_SPACE;
