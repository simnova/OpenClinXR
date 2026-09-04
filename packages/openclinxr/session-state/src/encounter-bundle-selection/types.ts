export const durableExamStationEncounterBundlePinClaimScope =
  "durable_exam_station_bundle_pin_not_exam_equivalence" as const;

export const durableExamStationEncounterBundlePinNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "production_persistence",
] as const;

export type DurableExamStationEncounterBundlePinNotEvidenceFor =
  (typeof durableExamStationEncounterBundlePinNotEvidenceFor)[number];

export type EncounterBundlePinDurableStore = "database_source_of_truth" | "test_local_memory";

export type DurablePromotedEncounterBundleLookupEntry = {
  bundleId: string;
  scenarioId: string;
  stationId: string;
  contentIdentity: string;
  runtimeEligibility: "promoted" | "blocked" | "stale" | "retired";
  frozenForEncounter: boolean;
  identityScope: "learner_runtime_opaque_bundle";
};

export type DurableExamStationEncounterBundlePin = {
  examFormId: string;
  stationOrder: number;
  slotId: string;
  scenarioId: string;
  scenarioVersion: number;
  bundleId: string;
  contentIdentity: string;
  durableStore: EncounterBundlePinDurableStore;
};

export type DurableExamFormEncounterBundlePins = {
  examFormId: string;
  pins: readonly DurableExamStationEncounterBundlePin[];
  durableStore: EncounterBundlePinDurableStore;
  claimScope: typeof durableExamStationEncounterBundlePinClaimScope;
  notEvidenceFor: typeof durableExamStationEncounterBundlePinNotEvidenceFor;
};

export type PersistExamFormEncounterBundlePinsInput = {
  examFormId: string;
  pins: ReadonlyArray<Omit<DurableExamStationEncounterBundlePin, "examFormId" | "durableStore">>;
};

export type LaunchPinnedStationAssetsInput = {
  examFormId: string;
  slotId: string;
  catalog: readonly DurablePromotedEncounterBundleLookupEntry[];
};

export type LaunchPinnedStationAssetsSuccess = {
  launched: true;
  examFormId: string;
  slotId: string;
  scenarioId: string;
  bundleId: string;
  contentIdentity: string;
  claimScope: typeof durableExamStationEncounterBundlePinClaimScope;
  notEvidenceFor: typeof durableExamStationEncounterBundlePinNotEvidenceFor;
};

export type LaunchPinnedStationAssetsRefusal = {
  launched: false;
  examFormId: string;
  slotId: string;
  blockers: string[];
  claimScope: typeof durableExamStationEncounterBundlePinClaimScope;
  notEvidenceFor: typeof durableExamStationEncounterBundlePinNotEvidenceFor;
};

export type LaunchPinnedStationAssetsResult =
  | LaunchPinnedStationAssetsSuccess
  | LaunchPinnedStationAssetsRefusal;

export type ExamFormEncounterBundlePinPersistencePort = {
  readonly durableStore: EncounterBundlePinDurableStore;
  persist(input: PersistExamFormEncounterBundlePinsInput): Promise<DurableExamFormEncounterBundlePins>;
  load(examFormId: string): Promise<DurableExamFormEncounterBundlePins | null>;
};
