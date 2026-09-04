import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { ScenarioRuntimeDurableStore } from "@openclinxr/scenario-runtime";
import type { ApiPersistenceSink } from "./app.js";

/**
 * Exam-run assembled review packet hooks. Optional on the API persistence sink;
 * the route persists/retrieves one exam-run artifact rather than flattening
 * per-station packets in transport.
 */
export type AssembledExamReviewDurableStore = {
  saveAssembledExamReviewPacket(
    examRunId: string,
    packet: AssembledExamReviewPacket,
  ): void | Promise<void>;
  getAssembledExamReviewPacket(
    examRunId: string,
  ): Promise<AssembledExamReviewPacket | undefined> | AssembledExamReviewPacket | undefined;
};

export type ApiRuntimeDurableStore = ScenarioRuntimeDurableStore & AssembledExamReviewDurableStore;

/**
 * Adapts API persistence sink methods into ScenarioRuntime's optional durableStore
 * plus the assembled-exam review packet exam-run artifact hooks.
 * When wired at bootstrap, actor turns (generateActorResponse) and review packets
 * (reviewPacket / reviewPacketAndPersist) flow into the same sink used by REST paths.
 */
export function createScenarioRuntimeDurableStoreFromApiPersistence(
  sink: ApiPersistenceSink,
): ApiRuntimeDurableStore {
  return {
    saveReviewPacket(stationRunId, packet) {
      return sink.saveReviewPacket?.(stationRunId, packet);
    },
    saveActorTurn(stationRunId, turn) {
      return sink.saveActorTurn?.(stationRunId, turn);
    },
    saveAssembledExamReviewPacket(examRunId, packet) {
      return sink.saveAssembledExamReviewPacket?.(examRunId, packet);
    },
    getAssembledExamReviewPacket(examRunId) {
      return sink.getAssembledExamReviewPacket?.(examRunId);
    },
  };
}
