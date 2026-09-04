export const AUTHORING_PREVIEW_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "exam_equivalence",
  "scoring",
  "quest_readiness",
] as const;

export const STALE_REVIEW_IDENTITY_REFUSAL =
  "Promotion refused: review identity is stale for the draft revision.";
export const STALE_VALIDATION_REFUSAL =
  "Promotion refused: draft revision failed production encounter-contract validation.";

export type AuthoringPreviewChange = {
  surface: "actor" | "dialogue" | "emotion" | "asset";
  change: "added" | "removed" | "changed";
  path: string;
  before: string | null;
  after: string | null;
};

export type PromotionDecision =
  | { allowed: true }
  | { allowed: false; reasons: readonly string[] };

export type AuthoringPreviewResult = {
  validationOk: boolean;
  validationErrors: readonly string[];
  draftIdentity: string | null;
  changes: readonly AuthoringPreviewChange[];
  promotion: PromotionDecision;
  notEvidenceFor: typeof AUTHORING_PREVIEW_NOT_EVIDENCE_FOR;
};
