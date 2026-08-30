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

/** The compliance regions those correspond to, kept beside them so the pairing is readable. */
export const COMPLIANCE_REGION_RLQ = "abdomen_rlq";
export const COMPLIANCE_REGION_CHEST_L = "chest_L";
