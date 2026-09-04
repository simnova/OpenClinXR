export const examStationEncounterBundlePinClaimScope =
  "assembled_exam_station_bundle_pin_not_exam_equivalence" as const;

export const examStationEncounterBundlePinNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
] as const;

export type ExamStationEncounterBundlePinNotEvidenceFor =
  (typeof examStationEncounterBundlePinNotEvidenceFor)[number];

export type PromotedEncounterBundleRuntimeEligibility =
  | "promoted"
  | "blocked"
  | "stale"
  | "retired";

/**
 * Catalog row for one promoted immutable encounter bundle.
 * Exam assembly pins by opaque `bundleId` — it does not infer fixtures from scenario ids.
 */
export type PromotedEncounterBundleCatalogEntry = {
  bundleId: string;
  scenarioId: string;
  stationId: string;
  contentIdentity: string;
  runtimeEligibility: PromotedEncounterBundleRuntimeEligibility;
  frozenForEncounter: boolean;
  identityScope: "learner_runtime_opaque_bundle";
  scenarioRevisionId?: string;
  authoredContentIdentity?: string;
};

export type ExamStationBundlePinTarget = {
  stationOrder: number;
  slotId: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioRevisionId?: string;
  authoredContentIdentity?: string;
};

export type ExamStationEncounterBundlePin = {
  stationOrder: number;
  slotId: string;
  scenarioId: string;
  scenarioVersion: number;
  bundleId: string;
  contentIdentity: string;
};

export type PinExamStationEncounterBundlesInput = {
  examFormId: string;
  stations: readonly ExamStationBundlePinTarget[];
  catalog: readonly PromotedEncounterBundleCatalogEntry[];
};

export type PinExamStationEncounterBundlesSuccess = {
  pinned: true;
  examFormId: string;
  pins: ExamStationEncounterBundlePin[];
  claimScope: typeof examStationEncounterBundlePinClaimScope;
  notEvidenceFor: typeof examStationEncounterBundlePinNotEvidenceFor;
};

export type PinExamStationEncounterBundlesRefusal = {
  pinned: false;
  examFormId: string;
  pins: [];
  blockers: string[];
  claimScope: typeof examStationEncounterBundlePinClaimScope;
  notEvidenceFor: typeof examStationEncounterBundlePinNotEvidenceFor;
};

export type PinExamStationEncounterBundlesResult =
  | PinExamStationEncounterBundlesSuccess
  | PinExamStationEncounterBundlesRefusal;
