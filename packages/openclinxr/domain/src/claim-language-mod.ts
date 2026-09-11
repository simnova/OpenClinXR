import type { ScenarioGovernance } from "@openclinxr/shared-schemas";

export type ScoreUseLabel = ScenarioGovernance["scoreUseLabel"];
export type ValidationStage = ScenarioGovernance["validationStage"];

export type UnsafeClaimLanguageFinding = {
  ruleId: string;
  match: string;
  guidance: string;
};

export type ScenarioGovernanceCopy = {
  scoreUseNotice: string;
  validationNotice: string;
  syntheticCaseNotice: string;
  humanReviewNotice: string;
};

type UnsafeClaimLanguageRule = {
  ruleId: string;
  pattern: RegExp;
  guidance: string;
};

const unsafeClaimLanguageRules: UnsafeClaimLanguageRule[] = [
  {
    ruleId: "exam-equivalence",
    pattern: /\b(?:ecfmg|usmle|nbme|step\s*2\s*cs)\b/i,
    guidance: "Avoid exam-brand and replacement language in user-facing copy; describe OpenClinXR as local formative simulation.",
  },
  {
    ruleId: "licensure-or-credentialing",
    pattern: /\b(?:licensure|license-ready|board[- ]?equivalent|credential(?:s|ing)?|certif(?:y|ies|ication))\b/i,
    guidance: "Do not imply licensure, board, certification, or credentialing readiness.",
  },
  {
    ruleId: "diagnostic-performance",
    pattern: /\b(?:diagnos(?:es|is)|diagnostic)\s+(?:accuracy|performance|decision|readiness|support|capability)\b/i,
    guidance: "Do not present simulation outputs as diagnostic performance or clinical decision support.",
  },
  {
    ruleId: "high-stakes-score-use",
    pattern: /\b(?:high[- ]stakes|pass\/fail|summative)\s+(?:score|scoring|assessment|exam|decision|use)\b/i,
    guidance: "Keep user-facing assessment language formative unless an approved score-use argument exists.",
  },
  {
    ruleId: "validated-outcome-overclaim",
    pattern: /\b(?:clinically validated|validated\s+(?:outcome|performance|assessment|score)|proven\s+(?:clinical|learner|assessment))\b/i,
    guidance: "Do not claim validation evidence that has not been captured in governance records.",
  },
];

export const safeUserFacingClaimLanguage = {
  formativeAssessment: "Formative local practice with faculty review.",
  syntheticScenario: "Synthetic training scenario for local review.",
  humanReview: "Faculty review is required before score interpretation.",
  modelAssistance: "Model-generated actor responses are simulation aids with trace and audit review.",
  deviceEvidence: "Device readiness must be rechecked on the target headset before use.",
} as const;

export const scoreUseCopy: Record<ScoreUseLabel, string> = {
  formative_local_only: "Formative local practice.",
  pilot_research_only: "Pilot research review.",
  validated_summative: "Restricted Stage 3 score use.",
};

export const validationStageCopy: Record<ValidationStage, string> = {
  stage_0_synthetic_draft: "Synthetic draft pending expert review.",
  stage_1_expert_reviewed: "Expert reviewed for prototype use.",
  stage_2_pilot_ready: "Pilot ready after required reviewer approval.",
  stage_3_validated: "Stage 3 evidence approved.",
};

export function findUnsafeClaimLanguage(copy: string): UnsafeClaimLanguageFinding[] {
  return unsafeClaimLanguageRules.flatMap((rule) => {
    const match = copy.match(rule.pattern);
    if (!match) {
      return [];
    }
    return [{ ruleId: rule.ruleId, match: match[0], guidance: rule.guidance }];
  });
}

export function assertSafeClaimLanguage(copy: string): string {
  const findings = findUnsafeClaimLanguage(copy);
  if (findings.length > 0) {
    throw new Error(`Unsafe claim language: ${findings.map((finding) => finding.ruleId).join(", ")}`);
  }
  return copy;
}

export function buildScenarioGovernanceCopy(governance: ScenarioGovernance): ScenarioGovernanceCopy {
  return {
    scoreUseNotice: assertSafeClaimLanguage(scoreUseCopy[governance.scoreUseLabel]),
    validationNotice: assertSafeClaimLanguage(validationStageCopy[governance.validationStage]),
    syntheticCaseNotice: safeUserFacingClaimLanguage.syntheticScenario,
    humanReviewNotice: safeUserFacingClaimLanguage.humanReview,
  };
}
