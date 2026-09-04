/**
 * Conservative engineering joint limits, with a claim envelope that refuses a clinical reading.
 *
 * Card tsk_3433c4b85ee4f9f8. M3 (`evidence/motion-evidence.ts` joint_limit gate) already refuses an
 * over-limit elbow against a CALLER-supplied table and invents no threshold. This module owns the
 * engineering DEFAULTS (the same conservative clamps `ik/solve-chain.ts` already applies at solve
 * time) and the claim envelope those numbers MUST travel with: a bare radian is not clinical
 * evidence, and nothing here may be promoted as a clinical normal range.
 *
 * claimScope: engineering_anatomical_plausibility — a pose stays inside conservative engineering
 * clamps so a compiled clip does not hyperextend a joint the solver already refuses to drive past.
 *
 * notEvidenceFor: clinical_normal_range, clinical_validity, biomechanical_validity,
 * scoring_validity, exam_equivalence, learner_readiness. The numbers are not a human ROM table.
 *
 * A joint absent from the limit table is UNCHECKED (same blindness M3 documents). Combinations and
 * order are invisible: shoulder, elbow and wrist each inside range while the arm passes through the
 * torso still accept.
 */
export const JOINT_LIMIT_CLAIM_SCOPE = "engineering_anatomical_plausibility" as const;

export const JOINT_LIMIT_NOT_EVIDENCE_FOR = [
  "clinical_normal_range",
  "clinical_validity",
  "biomechanical_validity",
  "scoring_validity",
  "exam_equivalence",
  "learner_readiness",
] as const;

/**
 * Conservative engineering defaults, radians about rest. Provenance: `ik/solve-chain.ts`
 * SHOULDER_BEND_LIMIT_RAD = 2.0, ELBOW_BEND_LIMIT_RAD = 2.7 (module constants, not anatomical).
 * `elbow_flexion_l` is the M3 fixture spelling so a caller that reuses that table does not silently
 * uncheck the elbow.
 */
export const CONSERVATIVE_ENGINEERING_LIMITS_RAD: Readonly<Record<string, number>> = {
  shoulder_bend: 2.0,
  elbow_flexion: 2.7,
  elbow_flexion_l: 2.7,
};

export type JointAngleSample = {
  id: string;
  measuredRad: number;
};

export type JointLimitJointResult = {
  id: string;
  measuredRad: number;
  limitRad: number;
  withinLimit: boolean;
};

export type JointLimitEvidence = {
  claimScope: typeof JOINT_LIMIT_CLAIM_SCOPE;
  notEvidenceFor: readonly string[];
  verdict: "accept" | "refuse";
  unit: "rad";
  cannotSee: string;
  joints: readonly JointLimitJointResult[];
};

export type JointLimitValidation = { ok: true; evidence: JointLimitEvidence } | { ok: false; errors: string[] };

const REQUIRED_NOT_EVIDENCE_FOR = ["clinical_normal_range", "clinical_validity"] as const;

/**
 * Promotional clinical wording. `clinical_normal_range` as a notEvidenceFor TOKEN is required;
 * the same phrase in any other string presents the numbers as a clinical ROM table.
 */
const CLINICAL_PROMOTION =
  /clinical[\s_-]*normal[\s_-]*range|\bclinically normal\b|\bnormal range of motion\b|\bclinical ROM\b/i;

const CANNOT_SEE =
  "combinations or order: each listed joint independently inside its engineering clamp while the chain is geometrically impossible; a joint absent from the limit table; a limit table that is itself wrong";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Classify samples against an engineering limit table. Defaults are the conservative clamps above.
 * Every returned record carries claimScope + notEvidenceFor — a measured radian never leaves this
 * function as a bare number.
 */
export function evaluateJointLimits(
  samples: readonly JointAngleSample[],
  limitsRad: Readonly<Record<string, number>> = CONSERVATIVE_ENGINEERING_LIMITS_RAD,
): JointLimitEvidence {
  const joints: JointLimitJointResult[] = [];
  let anyOver = false;
  for (const sample of samples) {
    if (!isNonEmptyString(sample.id) || !isFiniteNumber(sample.measuredRad)) {
      throw new Error("evaluateJointLimits: each sample needs a non-empty id and a finite measuredRad");
    }
    const limit = limitsRad[sample.id];
    if (limit === undefined) continue;
    if (!isFiniteNumber(limit) || limit <= 0) {
      throw new Error(`evaluateJointLimits: limit for "${sample.id}" must be a positive finite radian`);
    }
    const measured = Math.abs(sample.measuredRad);
    const withinLimit = measured <= limit;
    if (!withinLimit) anyOver = true;
    joints.push({ id: sample.id, measuredRad: measured, limitRad: limit, withinLimit });
  }
  return {
    claimScope: JOINT_LIMIT_CLAIM_SCOPE,
    notEvidenceFor: [...JOINT_LIMIT_NOT_EVIDENCE_FOR],
    verdict: anyOver ? "refuse" : "accept",
    unit: "rad",
    cannotSee: CANNOT_SEE,
    joints,
  };
}

function collectPromotionalWording(value: unknown, path: string, into: string[]): void {
  if (typeof value === "string") {
    if (CLINICAL_PROMOTION.test(value)) into.push(`${path}: promotional clinical wording`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectPromotionalWording(entry, `${path}[${index}]`, into));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "notEvidenceFor") continue;
      collectPromotionalWording(child, path === "" ? key : `${path}.${key}`, into);
    }
  }
}

/**
 * Closed-envelope check. Missing claimScope, missing clinical-normal-range/validity refusals,
 * promotional clinical wording, or an accept that hides a limit violation are all errors. A
 * record that is only measured/limit numbers (no envelope) is the cheapest clinical promotion
 * and is refused by the missing-scope clause.
 */
export function validateJointLimitEvidence(value: unknown): JointLimitValidation {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["joint-limit evidence must be an object"] };
  }
  const record = value as Record<string, unknown>;

  if (record["claimScope"] !== JOINT_LIMIT_CLAIM_SCOPE) {
    errors.push(`claimScope must be "${JOINT_LIMIT_CLAIM_SCOPE}" (missing scope is not engineering evidence)`);
  }

  const notEvidenceFor = record["notEvidenceFor"];
  if (!Array.isArray(notEvidenceFor) || !notEvidenceFor.every(isNonEmptyString)) {
    errors.push("notEvidenceFor must be a non-empty array of non-empty strings");
  } else {
    for (const required of REQUIRED_NOT_EVIDENCE_FOR) {
      if (!notEvidenceFor.includes(required)) {
        errors.push(`notEvidenceFor must include "${required}"`);
      }
    }
  }

  const verdict = record["verdict"];
  if (verdict !== "accept" && verdict !== "refuse") {
    errors.push('verdict must be "accept" or "refuse"');
  }
  if (record["unit"] !== "rad") {
    errors.push('unit must be "rad"');
  }
  if (!isNonEmptyString(record["cannotSee"])) {
    errors.push("cannotSee must be a non-empty string");
  }

  const joints = record["joints"];
  if (!Array.isArray(joints)) {
    errors.push("joints must be an array");
  } else {
    let anyOver = false;
    for (const [index, joint] of joints.entries()) {
      if (typeof joint !== "object" || joint === null) {
        errors.push(`joints[${index}] must be an object`);
        continue;
      }
      const row = joint as Record<string, unknown>;
      if (!isNonEmptyString(row["id"])) errors.push(`joints[${index}].id must be a non-empty string`);
      if (!isFiniteNumber(row["measuredRad"])) errors.push(`joints[${index}].measuredRad must be finite`);
      if (!isFiniteNumber(row["limitRad"]) || (row["limitRad"] as number) <= 0) {
        errors.push(`joints[${index}].limitRad must be a positive finite radian`);
      }
      if (typeof row["withinLimit"] !== "boolean") errors.push(`joints[${index}].withinLimit must be boolean`);
      if (
        isFiniteNumber(row["measuredRad"]) &&
        isFiniteNumber(row["limitRad"]) &&
        row["limitRad"] > 0 &&
        Math.abs(row["measuredRad"]) > row["limitRad"]
      ) {
        anyOver = true;
        if (row["withinLimit"] !== false) {
          errors.push(`joints[${index}] exceeds its engineering limit but withinLimit is not false`);
        }
      }
    }
    if (anyOver && verdict === "accept") {
      errors.push("verdict must be refuse when any listed joint exceeds its engineering limit");
    }
  }

  collectPromotionalWording(record, "", errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, evidence: record as unknown as JointLimitEvidence };
}
