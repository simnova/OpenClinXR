import { describe, expect, it } from "vitest";
import { type AuthoredOffsetRow, classify } from "./authored-offset-on-the-posed-humanoid.js";

/**
 * The counterweight this file guards was added AFTER the instrument reported `satisfied` about the
 * wrong humanoid, and the row below is the one that fooled it — copied from run 1's artifact
 * (.openclinxr/evidence/authored-offset-on-the-posed-humanoid/, measuredAt 2026-09-09T11:08:48Z),
 * not invented here.
 *
 * Navigating to clinic_knee_pain_return_to_play_v1 staged patient_robert_hayes_v1, the ED patient,
 * because apps/ui-xr/src/main.ts:641 binds the ED bundle and only records a scenario_mismatch
 * rather than materializing the selected case. The classifier looked up an authored offset for
 * that actor, found none, took the unauthored-control branch, and returned green.
 */
const RUN_ONE_CLINIC_ROW: Omit<AuthoredOffsetRow, "outcome" | "evidence"> = {
  scenarioId: "clinic_knee_pain_return_to_play_v1",
  patientActorId: "patient_robert_hayes_v1",
  authoredOffsetMeters: null,
  authoredSupportSurface: null,
  postureObserved: "supine",
  atSettle: {
    slotWorld: { x: -0.9, y: 0, z: 0.08 },
    skinnedCentreWorld: { x: -0.37049289633236226, y: 0.8595533837366605, z: -0.291190259434343 },
    framesObserved: 32,
    skinnedMeshCount: 17,
  },
  afterFurtherFrames: {
    slotWorld: { x: -0.9, y: 0, z: 0.08 },
    skinnedCentreWorld: { x: -0.3769453803479733, y: 0.864274396036141, z: -0.29023466494202865 },
    framesObserved: 63,
    skinnedMeshCount: 17,
  },
  skinnedDriftMeters: { x: -0.0064524840156110486, y: 0.00472101229948052, z: 0.00095559449231436 },
};

describe("the identity counterweight", () => {
  it("(1) REFUSES the row that reported satisfied about the wrong humanoid", () => {
    const verdict = classify(RUN_ONE_CLINIC_ROW);
    expect(verdict.outcome).toBe("unsatisfied");
    // Both ids must be named: a verdict that says only "mismatch" leaves the reader to go find
    // which two things disagreed, and the whole point is that the runtime staged someone else.
    expect(verdict.evidence).toContain("patient_jordan_cole_v1");
    expect(verdict.evidence).toContain("patient_robert_hayes_v1");
  });

  it("(2) CONTROL: the ED row, whose staged actor IS the one its case declares, still classifies as the unauthored control", () => {
    const verdict = classify({
      ...RUN_ONE_CLINIC_ROW,
      scenarioId: "ed_chest_pain_priority_v2",
    });
    expect(verdict.outcome).toBe("satisfied");
    expect(verdict.evidence).toContain("unauthored control");
  });

  it("(3) COUNTERWEIGHT: an absent patient slot is `unknown`, never `satisfied` — no observation is not a pass", () => {
    const verdict = classify({
      ...RUN_ONE_CLINIC_ROW,
      patientActorId: "",
      atSettle: { ...RUN_ONE_CLINIC_ROW.atSettle, skinnedMeshCount: 0 },
      afterFurtherFrames: { ...RUN_ONE_CLINIC_ROW.afterFurtherFrames, skinnedMeshCount: 0 },
    });
    expect(["unknown", "pending"]).toContain(verdict.outcome);
    expect(verdict.outcome).not.toBe("satisfied");
  });
});
