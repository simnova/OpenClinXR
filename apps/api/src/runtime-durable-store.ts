import type { ScenarioRuntimeDurableStore } from "@openclinxr/scenario-runtime";
import type { ApiPersistenceSink } from "./app.js";

/**
 * Adapts API persistence sink methods into ScenarioRuntime's optional durableStore.
 * When wired at bootstrap, actor turns (generateActorResponse) and review packets
 * (reviewPacket / reviewPacketAndPersist) flow into the same sink used by REST paths.
 */
export function createScenarioRuntimeDurableStoreFromApiPersistence(
  sink: ApiPersistenceSink,
): ScenarioRuntimeDurableStore {
  return {
    saveReviewPacket(stationRunId, packet) {
      return sink.saveReviewPacket?.(stationRunId, packet);
    },
    saveActorTurn(stationRunId, turn) {
      return sink.saveActorTurn?.(stationRunId, turn);
    },
  };
}
