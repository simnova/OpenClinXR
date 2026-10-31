/**
 * C6 station phase clock for the xr-sync encounter room.
 *
 * Kept in its own module so room.ts stays under the file-size gate. The room
 * owns state/trace/turn side effects; this module owns only timing: which
 * phase is current, how many integer seconds remain, and when the next
 * boundary fires on the room clock (this.clock, never Date-based polling).
 *
 * Phases: "doorway" -> "encounter" -> "note" -> "closed". Durations come from
 * server config (createEncounterServer({ timing })); client roomOptions.timing
 * and roomOptions.phase are never read (the room ignores them by construction).
 * Validation is local integer checks (no shared-schemas dependency, so the
 * xr-sync-server consumer contract stays unchanged).
 */
import type { ConversationTraceEvent } from "./conversation-trace.js";

/** Station timing in whole seconds (C6 server config). All integers >= 0. */
export interface StationTiming {
  doorwaySeconds: number;
  encounterSeconds: number;
  noteSeconds: number;
}

/** Phase names in encounter order. "brief" is the no-timing mode (not a clock phase). */
export type StationPhase = "doorway" | "encounter" | "note" | "closed";

export const STATION_PHASES: readonly StationPhase[] = ["doorway", "encounter", "note", "closed"];

/** Reject reason when conversation intents arrive outside "encounter". Pose is exempt. */
export const OUTSIDE_ENCOUNTER_PHASE_REASON = "outside-encounter-phase";

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validate server timing config. Returns the timing when configured, null
 * when absent (no timing -> C1..C5 "brief" behaviour). Throws on invalid.
 */
export function parseStationTiming(value: unknown): StationTiming | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("bad-timing: timing must be { doorwaySeconds, encounterSeconds, noteSeconds }");
  }
  const record = value as { doorwaySeconds?: unknown; encounterSeconds?: unknown; noteSeconds?: unknown };
  const doorwaySeconds = record.doorwaySeconds;
  const encounterSeconds = record.encounterSeconds;
  const noteSeconds = record.noteSeconds;
  if (!isNonNegativeInteger(doorwaySeconds) || !isNonNegativeInteger(encounterSeconds) || !isNonNegativeInteger(noteSeconds)) {
    throw new Error("bad-timing: doorwaySeconds, encounterSeconds, noteSeconds must be integers >= 0");
  }
  return { doorwaySeconds, encounterSeconds, noteSeconds };
}

/** Minimal clock surface (Colyseus room clock). */
export interface PhaseClockLike {
  setTimeout(handler: (...args: unknown[]) => void, ms: number): { clear(): void };
  setInterval(handler: (...args: unknown[]) => void, ms: number): { clear(): void };
}

/**
 * Structural bindings the station clock drives. The room passes an object
 * literal in onCreate (where its privates are in scope); the clock never
 * touches Colyseus types, only these narrow members.
 */
export interface StationPhaseBindings {
  clock: PhaseClockLike;
  state: {
    phase: string;
    phaseRemainingS: number;
    turnOwner: string;
    learners: { values(): Iterable<{ speaking: boolean }> };
    actors: { get(id: string): { speaking: boolean; caption: string } | undefined };
  };
  tracer: { push(event: ConversationTraceEvent): void };
  turnLog: { turnId: number; end: string }[];
  getOpenTurn(): { turnId: number; actorId: string; timer: { clear(): void } } | null;
  clearPhaseTurn(): void;
  phaseChangedAtMs: Map<string, number>;
  /** C7 rotation driver: invoked once when the station enters "closed". */
  onClosed?: () => void;
}

/**
 * Attach the station clock for server-configured timing, or mark brief mode
 * when timing is absent (C1..C5 behaviour). Returns the running clock or null.
 * Client roomOptions.timing/phase never reach here: the room passes only its
 * server-bound stationTiming.
 */
export function attachStationPhaseClock(
  bindings: StationPhaseBindings,
  timing: StationTiming | null,
): StationPhaseClock | null {
  if (timing === null) {
    bindings.state.phase = "brief";
    bindings.state.phaseRemainingS = 0;
    return null;
  }
  const clock = new StationPhaseClock(bindings.clock, timing, {
    setPhase: (phase, remaining) => {
      bindings.state.phase = phase;
      bindings.state.phaseRemainingS = remaining;
    },
    tracePhase: (phase, atMs) => {
      bindings.phaseChangedAtMs.set(phase, atMs);
      bindings.tracer.push({ seq: null, kind: "phase-changed", actorId: "", turnId: null, phase });
    },
    // A transition to a non-encounter phase while a learner utterance is open
    // closes the utterance (learner speaking false) without opening an actor
    // turn; an open actor turn ends as "closed-by-phase" (speaking false, its
    // reply timer cleared so it never fires later). The shared trace reducer
    // derives the same closed-by-phase end from the phase-changed event alone.
    // No-op when nothing is open (including the initial "doorway" enter).
    onLeaveEncounter: () => {
      let wasOpen = false;
      for (const learner of bindings.state.learners.values()) {
        if (learner.speaking) {
          learner.speaking = false;
          wasOpen = true;
        }
      }
      const open = bindings.getOpenTurn();
      if (open) {
        open.timer.clear();
        bindings.clearPhaseTurn();
        const actor = bindings.state.actors.get(open.actorId);
        if (actor) {
          actor.speaking = false;
          // C17: a phase-closed reply ends with no caption (same as completion).
          actor.caption = "";
        }
        const record = bindings.turnLog.find((entry) => entry.turnId === open.turnId);
        if (record && record.end === "open") {
          record.end = "closed-by-phase";
        }
        wasOpen = true;
      }
      if (wasOpen) {
        bindings.state.turnOwner = "none";
      }
    },
    now: () => Date.now(),
    // C7 rotation fires on the station's "closed" phase-changed, on the room
    // clock. C8 rotates learners + observers together (see room.rotateStation).
    onClosed: () => {
      bindings.onClosed?.();
    },
  });
  clock.start();
  return clock;
}

/**
 * C6 phase gate: with the clock running, conversation intents are accepted
 * only during "encounter" (pose is accepted in every phase). Returns the
 * reject reason, or null when the intent may proceed.
 */
/** Minimal server snapshot surface the phase waits read. C11: note-submit is
 * owned by the patient-note applier (accepted only in "note"), so the
 * encounter gate never sees it. */
export function phaseGateReason(clockRunning: boolean, phase: string, kind: string): string | null {
  if (kind === "note-submit") {
    return null;
  }
  if (clockRunning && kind !== "pose" && phase !== "encounter") {
    return OUTSIDE_ENCOUNTER_PHASE_REASON;
  }
  return null;
}

/** Room side effects the clock drives at each boundary. */
export interface PhaseClockHooks {
  /** Apply (phase, remainingS) to authoritative schema state. */
  setPhase(phase: StationPhase, remainingS: number): void;
  /** Record one trace event plus the probe-only Date.now timestamp. */
  tracePhase(phase: StationPhase, atMs: number): void;
  /** Room closes learner utterances / the open actor turn for a non-encounter phase. */
  onLeaveEncounter(): void;
  /** C7 rotation driver: invoked once when the station enters "closed". */
  onClosed?: () => void;
  now(): number;
}

/**
 * Room-clock phase clock. Started once at room create when timing is
 * configured. Ticks on the room clock: remainingS decrements once per
 * second; boundaries also refresh remainingS so the state never goes stale.
 */
export class StationPhaseClock {
  private stopped = false;
  private countdown: { clear(): void } | null = null;
  private boundary: { clear(): void } | null = null;
  private generation = 0;

  constructor(
    private readonly clock: PhaseClockLike,
    private readonly timing: StationTiming,
    private readonly hooks: PhaseClockHooks,
  ) {}

  start(): void {
    this.enter("doorway");
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.countdown?.clear();
    this.boundary?.clear();
    this.countdown = null;
    this.boundary = null;
  }

  private durationFor(phase: StationPhase): number {
    switch (phase) {
      case "doorway":
        return this.timing.doorwaySeconds;
      case "encounter":
        return this.timing.encounterSeconds;
      case "note":
        return this.timing.noteSeconds;
      case "closed":
        return 0;
    }
  }

  private nextAfter(phase: StationPhase): StationPhase | null {
    switch (phase) {
      case "doorway":
        return "encounter";
      case "encounter":
        return "note";
      case "note":
        return "closed";
      case "closed":
        return null;
    }
  }

  private enter(phase: StationPhase): void {
    if (this.stopped) {
      return;
    }
    // One generation per entered phase: the countdown tick and the boundary
    // timeout race at the deadline; whichever fires first advances the
    // generation and the loser no-ops, so each phase-changed emits exactly once.
    this.generation += 1;
    const gen = this.generation;
    this.countdown?.clear();
    this.boundary?.clear();
    this.countdown = null;
    this.boundary = null;
    const duration = this.durationFor(phase);
    this.hooks.setPhase(phase, phase === "closed" ? 0 : duration);
    this.hooks.tracePhase(phase, this.hooks.now());
    if (phase !== "encounter") {
      // Closing side effects live on the room (learner speaking flags, the
      // open actor turn). The initial "doorway" enter is a no-op there (no
      // turn can be open yet); the shared reducer derives the same
      // "closed-by-phase" end from the phase-changed event alone.
      this.hooks.onLeaveEncounter();
    }
    const next = this.nextAfter(phase);
    if (next === null) {
      // Terminal phase: C8 rotation fires on the room clock at closed (learners
    // + observers rotate together; observer role preserved in the reservation).
      this.hooks.onClosed?.();
      return;
    }
    if (duration <= 0) {
      // Zero-length phase: advance on the room clock (never synchronously, so
      // onCreate finishes before the first transition).
      this.boundary = this.clock.setTimeout(() => {
        if (!this.stopped && this.generation === gen) {
          this.enter(next);
        }
      }, 0);
      return;
    }
    // Countdown: remainingS ticks once per second; the boundary refreshes it
    // to the next phase duration so patches stay exact at each transition.
    let remaining = duration;
    this.countdown = this.clock.setInterval(() => {
      if (this.stopped || this.generation !== gen) {
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        this.enter(next);
        return;
      }
      this.hooks.setPhase(phase, remaining);
    }, 1000);
    // Boundary guard: fires at the same deadline so a missed interval tick
    // cannot stretch the phase.
    this.boundary = this.clock.setTimeout(() => {
      if (this.stopped || this.generation !== gen) {
        return;
      }
      this.enter(next);
    }, duration * 1000);
  }
}
