/**
 * Committed habitus lookup tables for physics_config.v1 generation.
 *
 * These tables provide case-def-shaped body-mechanics parameters
 * for three canonical habitus types: average, obese, frail.
 *
 * All values are dimensionless multipliers or scalar factors applied
 * by the physics-config factory; they are NOT clinical claims.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical habitus categories for case-def body mechanics. */
export type Habitus = "average" | "obese" | "frail";

/**
 * Body region identifiers used in mass and compliance lookups.
 * Mirrors clinical touch regions from the contact-region schema.
 */
export type HabitusBodyRegion =
  | "head"
  | "torso"
  | "abdomen"
  | "pelvis"
  | "upper_arm_L"
  | "upper_arm_R"
  | "forearm_L"
  | "forearm_R"
  | "hand_L"
  | "hand_R"
  | "thigh_L"
  | "thigh_R"
  | "calf_L"
  | "calf_R"
  | "foot_L"
  | "foot_R";

/**
 * Tissue compliance region identifiers.
 * Maps to the same regions palpation scenarios target.
 */
export type ComplianceRegion =
  | "abdomen_ruq"
  | "abdomen_rlq"
  | "abdomen_luq"
  | "abdomen_llq"
  | "abdomen_epigastric"
  | "abdomen_suprapubic"
  | "chest_R"
  | "chest_L"
  | "neck_anterior"
  | "neck_posterior";

/**
 * Joint identifiers for ROM limits.
 */
export type HabitusJoint =
  | "shoulder_R"
  | "shoulder_L"
  | "elbow_R"
  | "elbow_L"
  | "wrist_R"
  | "wrist_L"
  | "hip_R"
  | "hip_L"
  | "knee_R"
  | "knee_L"
  | "ankle_R"
  | "ankle_L"
  | "spine_lumbar"
  | "spine_cervical";

/**
 * Per-body-region mass lookup (kg, dimensionless scaling factor).
 * Base = average adult reference mass ~70 kg.
 */
export type MassTable = Record<HabitusBodyRegion, number>;

/**
 * Per-region tissue compliance lookup (0-1, 0 = rigid / bony, 1 = very soft).
 */
export type ComplianceTable = Record<ComplianceRegion, number>;

/**
 * Per-joint ROM limit lookup (radians).
 */
export type JointLimit = { min: number; max: number };
export type JointLimitTable = Record<HabitusJoint, JointLimit>;

/**
 * Per-contact-region guarding trigger lookup.
 * Optional interaction fields align with shared-schemas TouchResponse so
 * habitus tables can later drive clip/dialogue/trace without clinical claims.
 */
export type GuardingTriggerEntry = {
  /** Contact region triggering guarding. */
  region: ComplianceRegion;
  /** Pinch-strength threshold (0-1) at which guarding activates. */
  forceThreshold: number;
  /** Response strength multiplier (0-1, higher = stiffer guarding). */
  responseStrength: number;
  /** Optional emotion-event id for expression/runtime transition. */
  emotionEventId?: string;
  /** Optional animation clip id played on trigger. */
  responseClip?: string;
  /** Optional actor dialogue line spoken on trigger. */
  dialogueLine?: string;
  /** Optional trace tag recorded for review/replay (not clinical validity). */
  traceTag?: string;
};

// ---------------------------------------------------------------------------
// Committed tables
// ---------------------------------------------------------------------------

/**
 * Body-region masses for average habitus (~70 kg reference).
 * Scaled so sum ≈ 1.0 (relative mass distribution).
 */
export const AVERAGE_MASS: MassTable = {
  head: 0.07,
  torso: 0.28,
  abdomen: 0.15,
  pelvis: 0.10,
  upper_arm_L: 0.028,
  upper_arm_R: 0.028,
  forearm_L: 0.016,
  forearm_R: 0.016,
  hand_L: 0.007,
  hand_R: 0.007,
  thigh_L: 0.10,
  thigh_R: 0.10,
  calf_L: 0.045,
  calf_R: 0.045,
  foot_L: 0.015,
  foot_R: 0.015,
};

/**
 * Body-region masses for obese habitus.
 * Increased abdominal / torso / thigh mass; reduced distal limb proportion.
 */
export const OBESE_MASS: MassTable = {
  head: 0.05,
  torso: 0.26,
  abdomen: 0.24,
  pelvis: 0.12,
  upper_arm_L: 0.030,
  upper_arm_R: 0.030,
  forearm_L: 0.014,
  forearm_R: 0.014,
  hand_L: 0.005,
  hand_R: 0.005,
  thigh_L: 0.12,
  thigh_R: 0.12,
  calf_L: 0.040,
  calf_R: 0.040,
  foot_L: 0.012,
  foot_R: 0.012,
};

/**
 * Body-region masses for frail habitus.
 * Reduced overall mass; more fragile limb proportions.
 */
export const FRAIL_MASS: MassTable = {
  head: 0.09,
  torso: 0.30,
  abdomen: 0.11,
  pelvis: 0.08,
  upper_arm_L: 0.022,
  upper_arm_R: 0.022,
  forearm_L: 0.012,
  forearm_R: 0.012,
  hand_L: 0.006,
  hand_R: 0.006,
  thigh_L: 0.08,
  thigh_R: 0.08,
  calf_L: 0.038,
  calf_R: 0.038,
  foot_L: 0.013,
  foot_R: 0.013,
};

/**
 * Tissue compliance by contact region for average habitus.
 * 0 = rigid/bony, 1 = very soft/compressible.
 */
export const AVERAGE_COMPLIANCE: ComplianceTable = {
  abdomen_ruq: 0.45,
  abdomen_rlq: 0.45,
  abdomen_luq: 0.45,
  abdomen_llq: 0.45,
  abdomen_epigastric: 0.50,
  abdomen_suprapubic: 0.55,
  chest_R: 0.25,
  chest_L: 0.25,
  neck_anterior: 0.35,
  neck_posterior: 0.20,
};

/**
 * Tissue compliance for obese habitus.
 * Higher compliance (softer, more adipose tissue) in abdominal regions.
 */
export const OBESE_COMPLIANCE: ComplianceTable = {
  abdomen_ruq: 0.65,
  abdomen_rlq: 0.65,
  abdomen_luq: 0.65,
  abdomen_llq: 0.65,
  abdomen_epigastric: 0.70,
  abdomen_suprapubic: 0.75,
  chest_R: 0.35,
  chest_L: 0.35,
  neck_anterior: 0.45,
  neck_posterior: 0.25,
};

/**
 * Tissue compliance for frail habitus.
 * Lower compliance (less soft tissue, more bony prominence).
 */
export const FRAIL_COMPLIANCE: ComplianceTable = {
  abdomen_ruq: 0.30,
  abdomen_rlq: 0.30,
  abdomen_luq: 0.30,
  abdomen_llq: 0.30,
  abdomen_epigastric: 0.35,
  abdomen_suprapubic: 0.40,
  chest_R: 0.15,
  chest_L: 0.15,
  neck_anterior: 0.25,
  neck_posterior: 0.12,
};

/**
 * Joint ROM limits for average habitus (radians).
 * Standardized on a cooperative, unguarded patient.
 */
export const AVERAGE_JOINT_LIMITS: JointLimitTable = {
  shoulder_R: { min: -0.8, max: 3.0 },
  shoulder_L: { min: -0.8, max: 3.0 },
  elbow_R: { min: 0.0, max: 2.5 },
  elbow_L: { min: 0.0, max: 2.5 },
  wrist_R: { min: -1.2, max: 1.2 },
  wrist_L: { min: -1.2, max: 1.2 },
  hip_R: { min: -0.3, max: 2.0 },
  hip_L: { min: -0.3, max: 2.0 },
  knee_R: { min: 0.0, max: 2.2 },
  knee_L: { min: 0.0, max: 2.2 },
  ankle_R: { min: -0.5, max: 0.8 },
  ankle_L: { min: -0.5, max: 0.8 },
  spine_lumbar: { min: -0.4, max: 0.4 },
  spine_cervical: { min: -0.6, max: 0.6 },
};

/**
 * Joint ROM limits for obese habitus.
 * Reduced ROM due to soft-tissue impedance.
 */
export const OBESE_JOINT_LIMITS: JointLimitTable = {
  shoulder_R: { min: -0.6, max: 2.5 },
  shoulder_L: { min: -0.6, max: 2.5 },
  elbow_R: { min: 0.0, max: 2.2 },
  elbow_L: { min: 0.0, max: 2.2 },
  wrist_R: { min: -1.0, max: 1.0 },
  wrist_L: { min: -1.0, max: 1.0 },
  hip_R: { min: -0.2, max: 1.6 },
  hip_L: { min: -0.2, max: 1.6 },
  knee_R: { min: 0.0, max: 1.8 },
  knee_L: { min: 0.0, max: 1.8 },
  ankle_R: { min: -0.4, max: 0.6 },
  ankle_L: { min: -0.4, max: 0.6 },
  spine_lumbar: { min: -0.3, max: 0.3 },
  spine_cervical: { min: -0.5, max: 0.5 },
};

/**
 * Joint ROM limits for frail habitus.
 * Slightly reduced ROM with lower force tolerance.
 */
export const FRAIL_JOINT_LIMITS: JointLimitTable = {
  shoulder_R: { min: -0.6, max: 2.8 },
  shoulder_L: { min: -0.6, max: 2.8 },
  elbow_R: { min: 0.0, max: 2.3 },
  elbow_L: { min: 0.0, max: 2.3 },
  wrist_R: { min: -1.0, max: 1.0 },
  wrist_L: { min: -1.0, max: 1.0 },
  hip_R: { min: -0.2, max: 1.8 },
  hip_L: { min: -0.2, max: 1.8 },
  knee_R: { min: 0.0, max: 2.0 },
  knee_L: { min: 0.0, max: 2.0 },
  ankle_R: { min: -0.4, max: 0.6 },
  ankle_L: { min: -0.4, max: 0.6 },
  spine_lumbar: { min: -0.3, max: 0.3 },
  spine_cervical: { min: -0.5, max: 0.5 },
};

/**
 * Default guarding triggers for average habitus.
 * Abdominal regions guard at moderate force; chest guards at higher force.
 * Optional interaction fields align with shared-schemas TouchResponse (not clinical claims).
 * RLQ is most sensitive (maximal guarding); other abdomen/chest milder by default.
 */
export const AVERAGE_GUARDING_TRIGGERS: GuardingTriggerEntry[] = [
  {
    region: "abdomen_ruq",
    forceThreshold: 0.55,
    responseStrength: 0.45,
    emotionEventId: "guard_ruq_v1",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueLine: "A little tender up there, not as bad as lower right.",
    traceTag: "clinical_touch_guard_ruq",
  },
  {
    region: "abdomen_rlq",
    forceThreshold: 0.32,
    // responseStrength kept below frail (0.75) so habitus ordering tests hold; maximal = lower forceThreshold.
    responseStrength: 0.65,
    emotionEventId: "guard_rlq_v1",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueLine: "Ow— that hurts a lot, please don't push there.",
    traceTag: "clinical_touch_guard_rlq",
  },
  {
    region: "abdomen_luq",
    forceThreshold: 0.55,
    responseStrength: 0.45,
    emotionEventId: "guard_luq_v1",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueLine: "Mild discomfort on that side— nothing sharp.",
    traceTag: "clinical_touch_guard_luq",
  },
  {
    region: "abdomen_llq",
    forceThreshold: 0.5,
    responseStrength: 0.55,
    emotionEventId: "guard_llq_v1",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueLine: "Sensitive, but the worst is still the lower right.",
    traceTag: "clinical_touch_guard_llq",
  },
  { region: "abdomen_epigastric", forceThreshold: 0.35, responseStrength: 0.7 },
  { region: "abdomen_suprapubic", forceThreshold: 0.5, responseStrength: 0.4 },
  {
    region: "chest_R",
    forceThreshold: 0.42,
    responseStrength: 0.55,
    emotionEventId: "guard_chest_r_v1",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueLine: "That's where the pressure is— careful on that side.",
    traceTag: "clinical_touch_guard_chest_r",
  },
  {
    region: "chest_L",
    forceThreshold: 0.5,
    responseStrength: 0.4,
    emotionEventId: "guard_chest_l_v1",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueLine: "Some tightness there, not quite as sharp as the right.",
    traceTag: "clinical_touch_guard_chest_l",
  },
  { region: "neck_anterior", forceThreshold: 0.3, responseStrength: 0.6 },
  { region: "neck_posterior", forceThreshold: 0.4, responseStrength: 0.4 },
];

/**
 * Guarding triggers for obese habitus.
 * Higher thresholds (more tissue cushioning) but similar response.
 */
export const OBESE_GUARDING_TRIGGERS: GuardingTriggerEntry[] = [
  { region: "abdomen_ruq", forceThreshold: 0.55, responseStrength: 0.45 },
  { region: "abdomen_rlq", forceThreshold: 0.50, responseStrength: 0.55 },
  { region: "abdomen_luq", forceThreshold: 0.55, responseStrength: 0.45 },
  { region: "abdomen_llq", forceThreshold: 0.50, responseStrength: 0.55 },
  { region: "abdomen_epigastric", forceThreshold: 0.45, responseStrength: 0.65 },
  { region: "abdomen_suprapubic", forceThreshold: 0.60, responseStrength: 0.35 },
  { region: "chest_R", forceThreshold: 0.65, responseStrength: 0.25 },
  { region: "chest_L", forceThreshold: 0.65, responseStrength: 0.25 },
  { region: "neck_anterior", forceThreshold: 0.35, responseStrength: 0.55 },
  { region: "neck_posterior", forceThreshold: 0.45, responseStrength: 0.35 },
];

/**
 * Guarding triggers for frail habitus.
 * Lower thresholds (more sensitive, less tissue protection).
 */
export const FRAIL_GUARDING_TRIGGERS: GuardingTriggerEntry[] = [
  { region: "abdomen_ruq", forceThreshold: 0.30, responseStrength: 0.70 },
  { region: "abdomen_rlq", forceThreshold: 0.25, responseStrength: 0.75 },
  { region: "abdomen_luq", forceThreshold: 0.30, responseStrength: 0.70 },
  { region: "abdomen_llq", forceThreshold: 0.25, responseStrength: 0.75 },
  { region: "abdomen_epigastric", forceThreshold: 0.20, responseStrength: 0.80 },
  { region: "abdomen_suprapubic", forceThreshold: 0.35, responseStrength: 0.60 },
  { region: "chest_R", forceThreshold: 0.40, responseStrength: 0.50 },
  { region: "chest_L", forceThreshold: 0.40, responseStrength: 0.50 },
  { region: "neck_anterior", forceThreshold: 0.20, responseStrength: 0.75 },
  { region: "neck_posterior", forceThreshold: 0.25, responseStrength: 0.60 },
];

// ---------------------------------------------------------------------------
// Table selectors
// ---------------------------------------------------------------------------

/**
 * Select the mass table for a given habitus.
 */
export function selectMassTable(habitus: Habitus): MassTable {
  switch (habitus) {
    case "obese":
      return OBESE_MASS;
    case "frail":
      return FRAIL_MASS;
    default:
      return AVERAGE_MASS;
  }
}

/**
 * Select the compliance table for a given habitus.
 */
export function selectComplianceTable(habitus: Habitus): ComplianceTable {
  switch (habitus) {
    case "obese":
      return OBESE_COMPLIANCE;
    case "frail":
      return FRAIL_COMPLIANCE;
    default:
      return AVERAGE_COMPLIANCE;
  }
}

/**
 * Select the joint limit table for a given habitus.
 */
export function selectJointLimitTable(habitus: Habitus): JointLimitTable {
  switch (habitus) {
    case "obese":
      return OBESE_JOINT_LIMITS;
    case "frail":
      return FRAIL_JOINT_LIMITS;
    default:
      return AVERAGE_JOINT_LIMITS;
  }
}

/**
 * Select the guarding triggers for a given habitus.
 */
export function selectGuardingTriggers(
  habitus: Habitus,
): GuardingTriggerEntry[] {
  switch (habitus) {
    case "obese":
      return OBESE_GUARDING_TRIGGERS;
    case "frail":
      return FRAIL_GUARDING_TRIGGERS;
    default:
      return AVERAGE_GUARDING_TRIGGERS;
  }
}
