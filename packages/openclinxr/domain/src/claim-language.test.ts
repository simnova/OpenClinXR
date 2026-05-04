import { describe, expect, it } from "vitest";
import {
  assertSafeClaimLanguage,
  buildScenarioGovernanceCopy,
  findUnsafeClaimLanguage,
  safeUserFacingClaimLanguage,
  scoreUseCopy,
  validationStageCopy,
  type ScenarioGovernanceCopy,
} from "./index.js";

describe("safe claim language", () => {
  it("keeps approved user-facing copy free of exam, licensure, diagnosis, and score-use overclaims", () => {
    const approvedCopy = [
      ...Object.values(safeUserFacingClaimLanguage),
      ...Object.values(scoreUseCopy),
      ...Object.values(validationStageCopy),
    ];

    expect(approvedCopy.flatMap((copy) => findUnsafeClaimLanguage(copy))).toEqual([]);
  });

  it("flags common unsafe assessment and clinical claims before they reach UI surfaces", () => {
    const findings = findUnsafeClaimLanguage(
      "OpenClinXR replaces Step 2 CS, certifies licensure readiness, and provides diagnostic performance for high-stakes scoring.",
    );

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "exam-equivalence",
      "licensure-or-credentialing",
      "diagnostic-performance",
      "high-stakes-score-use",
    ]);
    expect(() => assertSafeClaimLanguage("USMLE-equivalent high-stakes assessment")).toThrow(
      "Unsafe claim language: exam-equivalence, high-stakes-score-use",
    );
  });

  it("builds scenario governance notices from the schema-owned score-use and validation labels", () => {
    const copy: ScenarioGovernanceCopy = buildScenarioGovernanceCopy({
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure: "Synthetic repository-contract fixture.",
      validationStage: "stage_1_expert_reviewed",
      validationLimitations: ["Prototype fixture review only."],
      requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
      sourceIds: ["src-test"],
      safetyCriticalTraceTags: ["ecg_request"],
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    });

    expect(copy).toEqual({
      scoreUseNotice: "Formative local practice.",
      validationNotice: "Expert reviewed for prototype use.",
      syntheticCaseNotice: "Synthetic training scenario for local review.",
      humanReviewNotice: "Faculty review is required before score interpretation.",
    });
  });
});
