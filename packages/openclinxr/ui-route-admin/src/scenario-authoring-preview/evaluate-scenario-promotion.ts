import type { PromotionDecision } from "./types.js";
import { STALE_REVIEW_IDENTITY_REFUSAL, STALE_VALIDATION_REFUSAL } from "./types.js";

export function evaluateScenarioPromotion(input: {
  validationOk: boolean;
  validationErrors?: readonly string[];
  draftIdentity: string;
  reviewIdentity: string | null;
}): PromotionDecision {
  const reasons: string[] = [];
  if (!input.validationOk) {
    reasons.push(STALE_VALIDATION_REFUSAL);
    for (const error of input.validationErrors ?? []) {
      reasons.push(error);
    }
  }
  if (input.reviewIdentity === null || input.reviewIdentity !== input.draftIdentity) {
    reasons.push(STALE_REVIEW_IDENTITY_REFUSAL);
  }
  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}
