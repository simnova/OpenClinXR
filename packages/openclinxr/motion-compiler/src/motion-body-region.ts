/**
 * MotionBodyRegion — the ANIMATION OUTPUT vocabulary. (M1 deliverable.)
 *
 * A motion body region answers "what does the actor's body do / toward what body
 * surface does an action aim". That is a DIFFERENT question from the one
 * `ComplianceRegion` (shared-schemas/src/schemas.ts) answers — "where did the
 * learner press". The two vocabularies must not become the same set by accident:
 * the day they merge, every new touch site silently becomes a motion primitive
 * target and every new motion target silently becomes palpable.
 *
 * This module is the boundary. It declares the closed motion vocabulary and the
 * explicit, exported compliance→motion mapping. The mapping is a PRODUCT
 * DECISION written down where a reader can find it, not implied by a shared
 * string.
 *
 * THE COUNTERWEIGHT THE PLANTS ENFORCE: a 1:1 rename ("abdomen_rlq" ->
 * "motion_abdomen_rlq") is the same vocabulary with new spelling. The declared
 * set therefore carries regions the touch schema CANNOT express — the motion-only
 * sites the factory brief (§6) names as needed for animation: sternum,
 * left_precordium, right_shoulder, left_thigh, forehead, mouth. Those are
 * animation targets (sternal rub, precordial auscultation posture, shoulder
 * positioning, thigh injection flinch, forehead temperature check, mouth/airway
 * response), not exam touch sites.
 */

/**
 * The ten clinical touch sites (ComplianceRegionSchema), each mapped to the
 * motion region a guard/withdrawal toward it drives. Closed: every value the
 * shipped schema declares is here, and nothing else maps.
 */
export const COMPLIANCE_TO_MOTION_REGION = [
  { compliance: "abdomen_ruq", motion: "motion_guard_abdomen_ruq" },
  { compliance: "abdomen_rlq", motion: "motion_guard_abdomen_rlq" },
  { compliance: "abdomen_luq", motion: "motion_guard_abdomen_luq" },
  { compliance: "abdomen_llq", motion: "motion_guard_abdomen_llq" },
  { compliance: "abdomen_epigastric", motion: "motion_guard_abdomen_epigastric" },
  { compliance: "abdomen_suprapubic", motion: "motion_guard_abdomen_suprapubic" },
  { compliance: "chest_R", motion: "motion_guard_chest_r" },
  { compliance: "chest_L", motion: "motion_guard_chest_l" },
  { compliance: "neck_anterior", motion: "motion_guard_neck_anterior" },
  { compliance: "neck_posterior", motion: "motion_guard_neck_posterior" },
] as const;

/**
 * A FIFTH guard region the plant fixtures drive that no touch site maps to
 * (plant-motion-regions.ts MOTION_REGION_GUARD_FLANK_R). Declared here so the
 * fixture set and the production vocabulary cannot disagree.
 */
export const MOTION_REGION_GUARD_FLANK_R = "motion_guard_flank_r";

/**
 * The closed MotionBodyRegion vocabulary: the image of the compliance mapping,
 * plus motion-only regions the touch schema has no counterpart for.
 *
 * Cardinality is deliberately not reduced: the six abdominal quadrants map 1:1
 * because a guard toward abdomen_rlq is a different arm pose from a guard toward
 * abdomen_llq, and collapsing them would throw away that distinction. Nothing
 * here has an opinion on the mapping's clinical sense — the plants check that a
 * mapping EXISTS and is not identity, never which region a quadrant should reach.
 */
export const MOTION_BODY_REGIONS = [
  ...COMPLIANCE_TO_MOTION_REGION.map((pair) => pair.motion),
  MOTION_REGION_GUARD_FLANK_R,
  "sternum",
  "left_precordium",
  "right_shoulder",
  "left_thigh",
  "forehead",
  "mouth",
] as const;

export type MotionBodyRegion = (typeof MOTION_BODY_REGIONS)[number];

const COMPLIANCE_TO_MOTION: Readonly<Record<string, string>> = Object.fromEntries(
  COMPLIANCE_TO_MOTION_REGION.map((pair) => [pair.compliance, pair.motion]),
);

/**
 * The explicit compliance→motion mapping. Every value the shipped
 * ComplianceRegionSchema declares maps to a DECLARED motion region, and the
 * mapping is never identity — the vocabularies are disjoint by construction.
 *
 * An unknown region is REFUSED (throws), never guessed: a planner that receives
 * a touch row for a site the mapper does not know must fail loudly rather than
 * emit a motion target no vocabulary declares.
 */
export function motionBodyRegionForComplianceRegion(region: string): string {
  const motion = COMPLIANCE_TO_MOTION[region];
  if (motion === undefined) {
    throw new Error(
      `motionBodyRegionForComplianceRegion: "${region}" is not a declared ComplianceRegion — ` +
        `the mapper is closed over the ten clinical touch sites`,
    );
  }
  return motion;
}

/** True when a target id is a member of the closed motion vocabulary. */
export function isMotionBodyRegion(id: string): boolean {
  return (MOTION_BODY_REGIONS as readonly string[]).includes(id);
}
