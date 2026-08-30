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

/** The compliance region those correspond to, kept beside them so the pairing is readable. */
export const COMPLIANCE_REGION_RLQ = "abdomen_rlq";
export const COMPLIANCE_REGION_CHEST_L = "chest_L";
