/** Station-ready latch and timeout ownership for one authoritative room. */
import {
  attachStationPhaseClock,
  DEFAULT_READY_TIMEOUT_SECONDS,
  type StationPhaseBindings,
  type StationTiming,
} from "./phase-clock.js";

type ReadyState = StationPhaseBindings["state"] & {
  stationStarted: boolean;
  learners: StationPhaseBindings["state"]["learners"] & { has(sessionId: string): boolean };
};

export interface StationReadyController {
  dispose(): void;
}

interface StationReadyBindings extends Omit<StationPhaseBindings, "state"> {
  state: ReadyState;
  timing: StationTiming | null;
  breakSeconds: number;
  onReady(handler: (client: { sessionId: string }) => void): void;
}

/** Attach the dormant phase clock, arm its timeout, and register the one room-level ready handler. */
export function createStationReadyController(bindings: StationReadyBindings): StationReadyController | null {
  const { timing, breakSeconds, onReady, ...phaseBindings } = bindings;
  const phaseClock = attachStationPhaseClock(phaseBindings, timing, breakSeconds);
  if (phaseClock === null) return null;

  let readyTimeout: { clear(): void } | null = null;
  const start = (source: "station-ready" | "ready-timeout"): void => {
    if (bindings.state.stationStarted) return;
    bindings.state.stationStarted = true;
    readyTimeout?.clear();
    readyTimeout = null;
    bindings.tracer.push({ seq: null, kind: source, actorId: "", turnId: null });
    phaseClock.start();
  };
  readyTimeout = bindings.clock.setTimeout(
    () => start("ready-timeout"),
    (timing?.readyTimeoutSeconds ?? DEFAULT_READY_TIMEOUT_SECONDS) * 1000,
  );
  onReady((client) => {
    if (!bindings.state.learners.has(client.sessionId) || bindings.state.stationStarted) {
      bindings.tracer.push({ seq: null, kind: "ready-ignored", actorId: "", turnId: null });
      return;
    }
    start("station-ready");
  });
  return {
    dispose: () => {
      readyTimeout?.clear();
      readyTimeout = null;
      phaseClock.stop();
    },
  };
}
