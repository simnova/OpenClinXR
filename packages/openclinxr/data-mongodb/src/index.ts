/** Re-export for tools composition roots (pnpm: bare `mongodb` is not resolvable from tools/). */
export { MongoClient } from "mongodb";
export {
  createMongoDurableMultiActorSessionStore,
  MongoDurableClinicalEventRepository,
  MongoDurableConversationTurnRepository,
  MongoDurableEmotionalStateTimelineRepository,
} from "./conversation-repositories.js";
export * from "./encounter-materialization-evidence-repositories.js";
export {
  createMongoExamPersistence,
  MongoExamFormRepository,
  MongoRuntimeAssetBundleRepository,
  MongoStationRunQueueRepository,
  saveLearnerRuntimeAssetBundleFromGeneratedReport,
} from "./exam-repositories.js";
export {
  CanonicalPhaseEventAdmission,
  createExamRunLedger,
  examRunLedgerClaimBoundary,
  examRunLedgerNotEvidenceFor,
  MemoryExamRunLedger,
  OpenExamRunInput,
} from "./exam-run-ledger.js";
export { MongoFacultyScoreDraftRepository } from "./faculty-repositories.js";
export { createMongoApiPersistenceSink } from "./persistence-sink.js";
export {
  durableActorTurnPersistenceScope,
  durableClinicalEventPersistenceScope,
  type EncounterMaterializationEvidenceRecord,
  type ScenarioReviewDecisionRecord,
} from "./records.js";
export * from "./scenario-repositories.js";
