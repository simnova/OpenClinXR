import { describe, expect, it } from "vitest";

import { runMotionEvidenceGates } from "./evidence/motion-evidence.js";
import {
  CONSERVATIVE_ENGINEERING_LIMITS_RAD,
  evaluateJointLimits,
  JOINT_LIMIT_CLAIM_SCOPE,
  JOINT_LIMIT_NOT_EVIDENCE_FOR,
  validateJointLimitEvidence,
  type JointLimitEvidence,
} from "./skeleton/joint-limits.js";

/**
 * LIVE CONTRACT — BothyBoard tsk_3433c4b85ee4f9f8.
 *
 * OBJECTIVE: conservative joint-limit evidence carries
 * claimScope=engineering_anatomical_plausibility and explicit notEvidenceFor
 * clinical-normal-range / clinical-validity claims. Bare numbers must not be
 * promoted as clinical evidence.
 *
 * IMMUTABLE DIAGNOSIS HEADER — do not rewrite the tables. Append a ## FIXED
 * block below; do not delete this header.
 *
 * KNOWN-GOOD (M3, the-motion-evidence-gates-refuse-a-bad-clip.test.ts header):
 *   | fixture | measure       | value  | spec tolerance | margin   |
 *   |---------|---------------|--------|----------------|----------|
 *   | GOOD    | elbow flexion | 1.20 r | 2.60 r         | 2.2x in  |
 *   | BAD     | elbow flexion | 3.40 r | 2.60 r         | 1.3x out |
 * M3's joint_limit gate already refuses the BAD elbow. This card adds the
 * claim envelope those numbers were missing.
 *
 * CONSERVATIVE DEFAULTS (ik/solve-chain.ts):
 *   SHOULDER_BEND_LIMIT_RAD = 2.0, ELBOW_BEND_LIMIT_RAD = 2.7.
 *
 * COUNTERWEIGHTS (the cheapest passes this contract refuses):
 *   - missing claimScope on an otherwise-numeric record
 *   - promotional "clinical normal range" wording on the evidence
 *   - an accept verdict for an over-limit elbow
 *
 * claimScope: that joint-limit evidence is engineering anatomical plausibility
 *   only, and that an over-limit elbow is refused.
 * notEvidenceFor: clinical_normal_range, clinical_validity, biomechanical
 *   validity, scoring, exam equivalence, learner readiness, animation quality.
 */

/**
 * ## FIXED (tsk_3433c4b85ee4f9f8)
 *
 * `src/skeleton/joint-limits.ts` exports evaluateJointLimits (always stamps
 * claimScope + notEvidenceFor) and validateJointLimitEvidence (refuses missing
 * scope, clinical-normal-range wording, and a limit violation dressed as accept).
 */

const M3_ELBOW_LIMIT_RAD = 2.6;
const M3_GOOD_ELBOW_RAD = 1.2;
const M3_BAD_ELBOW_RAD = 3.4;

const M3_SPEC = {
  effectorTargetErrorToleranceM: 0.02,
  contactErrorToleranceM: 0.01,
  jointLimitsRad: { elbow_flexion_l: M3_ELBOW_LIMIT_RAD, knee_flexion_l: 2.4, shoulder_abduction_l: 3.0 },
  supportDriftToleranceM: 0.05,
  minProxySeparationM: 0.0,
  expectedRuntimeClipName: "openclinxr_motion_compiled_v1",
} as const;

const M3_GOOD_CLIP = {
  id: "fixture_good_v1",
  fps: 24,
  frameCount: 24,
  rootTranslationPerFrame: [
    [0, 0.94, 0],
    [0.004, 0.94, 0.001],
  ] as const,
  jointFlexionRad: { elbow_flexion_l: M3_GOOD_ELBOW_RAD, knee_flexion_l: 0.9, shoulder_abduction_l: 0.7 },
  effectorKeys: [
    { frame: 12, effector: "hand_l", targetWorld: [0.31, 1.02, 0.18] as const, achievedWorld: [0.314, 1.02, 0.18] as const },
  ],
  contacts: [
    {
      frame: 12,
      effector: "hand_l",
      surfaceId: "exam_table_top",
      effectorPointWorld: [0.31, 0.86, 0.18] as const,
      surfacePointWorld: [0.31, 0.86, 0.18] as const,
    },
  ],
  proxyMinSeparationM: 0.03,
  trackFrameCounts: [24, 24, 24],
  hasNaN: false,
  runtimeLoadedClipName: M3_SPEC.expectedRuntimeClipName,
};

const M3_BAD_CLIP = {
  ...M3_GOOD_CLIP,
  id: "fixture_bad_v1",
  jointFlexionRad: { ...M3_GOOD_CLIP.jointFlexionRad, elbow_flexion_l: M3_BAD_ELBOW_RAD },
  effectorKeys: [
    { frame: 12, effector: "hand_l", targetWorld: [0.31, 1.02, 0.18] as const, achievedWorld: [0.73, 1.02, 0.18] as const },
  ],
};

function m3JointLimit(clip: typeof M3_GOOD_CLIP | typeof M3_BAD_CLIP) {
  return runMotionEvidenceGates(clip, M3_SPEC).gates.find((gate) => gate.id === "joint_limit");
}

describe("the joint limits refuse a clinical claim", () => {
  it("(known-good) M3 still refuses an over-limit elbow and accepts the in-limit control", () => {
    const good = m3JointLimit(M3_GOOD_CLIP);
    const bad = m3JointLimit(M3_BAD_CLIP);
    expect(good?.verdict, "M3 good elbow 1.2 r vs 2.6 r must pass").toBe("pass");
    expect(bad?.verdict, "M3 bad elbow 3.4 r vs 2.6 r must fail").toBe("fail");
    expect(bad?.measured, "M3 reports the over-limit flexion").toBe(M3_BAD_ELBOW_RAD);
  });

  it("(1) an in-limit elbow accepts only as engineering_anatomical_plausibility evidence", () => {
    const evidence = evaluateJointLimits(
      [{ id: "elbow_flexion_l", measuredRad: M3_GOOD_ELBOW_RAD }],
      { elbow_flexion_l: M3_ELBOW_LIMIT_RAD },
    );
    expect(evidence.verdict).toBe("accept");
    expect(evidence.claimScope).toBe(JOINT_LIMIT_CLAIM_SCOPE);
    expect(evidence.claimScope).toBe("engineering_anatomical_plausibility");
    expect(evidence.notEvidenceFor).toEqual(expect.arrayContaining(["clinical_normal_range", "clinical_validity"]));
    expect([...JOINT_LIMIT_NOT_EVIDENCE_FOR]).toEqual(expect.arrayContaining(["clinical_normal_range", "clinical_validity"]));
    const checked = validateJointLimitEvidence(evidence);
    expect(checked.ok, checked.ok ? "" : checked.errors.join("; ")).toBe(true);
  });

  it("(2) an over-limit elbow is refused, with the same envelope", () => {
    const evidence = evaluateJointLimits(
      [{ id: "elbow_flexion_l", measuredRad: M3_BAD_ELBOW_RAD }],
      { elbow_flexion_l: M3_ELBOW_LIMIT_RAD },
    );
    expect(evidence.verdict).toBe("refuse");
    expect(evidence.joints).toEqual([
      {
        id: "elbow_flexion_l",
        measuredRad: M3_BAD_ELBOW_RAD,
        limitRad: M3_ELBOW_LIMIT_RAD,
        withinLimit: false,
      },
    ]);
    expect(evidence.claimScope).toBe("engineering_anatomical_plausibility");
    expect(evidence.notEvidenceFor).toEqual(expect.arrayContaining(["clinical_normal_range", "clinical_validity"]));
    const checked = validateJointLimitEvidence(evidence);
    expect(checked.ok, checked.ok ? "" : checked.errors.join("; ")).toBe(true);
  });

  it("(3) COUNTERWEIGHT: missing claimScope is not engineering evidence", () => {
    const bareNumbers = {
      verdict: "accept",
      unit: "rad",
      cannotSee: "n/a",
      joints: [{ id: "elbow_flexion_l", measuredRad: M3_GOOD_ELBOW_RAD, limitRad: M3_ELBOW_LIMIT_RAD, withinLimit: true }],
      notEvidenceFor: ["clinical_normal_range", "clinical_validity"],
    };
    const checked = validateJointLimitEvidence(bareNumbers);
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error("expected missing-scope refusal");
    expect(checked.errors.join(" ")).toMatch(/claimScope/);
    expect(checked.errors.join(" ")).toMatch(/engineering_anatomical_plausibility/);
  });

  it("(4) COUNTERWEIGHT: clinical-normal-range wording is promotional and refused", () => {
    const honest = evaluateJointLimits(
      [{ id: "elbow_flexion_l", measuredRad: M3_GOOD_ELBOW_RAD }],
      { elbow_flexion_l: M3_ELBOW_LIMIT_RAD },
    );
    const promoted: JointLimitEvidence = {
      ...honest,
      cannotSee: "elbow 1.2 rad is within clinical normal range",
    };
    const checked = validateJointLimitEvidence(promoted);
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error("expected promotional-wording refusal");
    expect(checked.errors.join(" ")).toMatch(/promotional clinical wording/);
  });

  it("(5) COUNTERWEIGHT: an over-limit elbow cannot accept", () => {
    const honest = evaluateJointLimits(
      [{ id: "elbow_flexion_l", measuredRad: M3_BAD_ELBOW_RAD }],
      { elbow_flexion_l: M3_ELBOW_LIMIT_RAD },
    );
    const laundered: JointLimitEvidence = { ...honest, verdict: "accept" };
    const checked = validateJointLimitEvidence(laundered);
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error("expected limit-violation refusal");
    expect(checked.errors.join(" ")).toMatch(/refuse when any listed joint exceeds/);
  });

  it("(6) conservative defaults match the in-tree solver clamps, not a clinical table", () => {
    expect(CONSERVATIVE_ENGINEERING_LIMITS_RAD["elbow_flexion"]).toBe(2.7);
    expect(CONSERVATIVE_ENGINEERING_LIMITS_RAD["shoulder_bend"]).toBe(2.0);
    const overDefault = evaluateJointLimits([{ id: "elbow_flexion", measuredRad: 3.1 }]);
    expect(overDefault.verdict).toBe("refuse");
    expect(overDefault.claimScope).toBe("engineering_anatomical_plausibility");
    const underDefault = evaluateJointLimits([{ id: "elbow_flexion", measuredRad: 1.0 }]);
    expect(underDefault.verdict).toBe("accept");
    expect(validateJointLimitEvidence(underDefault).ok).toBe(true);
  });
});
