/**
 * Public interface of @openclinxr/multi-actor-state-spike.
 *
 * Named lists, not `export *`. A star republishes a module wholesale, so a symbol added inside
 * becomes public with nobody deciding it should be.
 */
export {
  buildActorModelContext,
  createMultiActorClinicalSession,
  createPersistenceSpikeStores,
  evaluateMultiActorPersistencePhase2Strategy,
  evaluateMultiActorStateOptions,
  persistLatestInteractionTurn,
  recordClinicalAction,
  rehydrateRealtimeCacheFromDurableState,
  routeActorInteraction,
  updateActorSpatialState,
  writeRealtimeCacheSnapshot,
} from "./functions.js";
