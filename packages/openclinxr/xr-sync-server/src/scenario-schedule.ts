/**
 * C19 scenario event schedule for the xr-sync encounter room.
 *
 * Kept in its own module so room.ts/station-replay.ts/conversation-trace.ts
 * stay under the file-size gate. One driver per cast station room: timers on
 * the room clock start at encounter start and are cleared at phase close and
 * room dispose. Each entry fires once atSecond after the encounter starts
 * (entries with atSecond >= the encounter length never fire; only the
 * station's own schedule runs because each room only holds its own cast).
 *
 * An entry due while an actor turn is open waits: the interjection starts
 * when that turn ends (still inside the encounter), so no two actors ever
 * speak at once. Firing reuses the actor-turn bookkeeping (speaking, empty
 * caption/cue, turnOwner, turnLog, turn-completed timer, trace) so live, the
 * shared reducer, and replay agree. No emotion transition fires (nothing was
 * acknowledged or interrupted) and no text enters the trace.
 */
import { pickC3Reply } from "./conversation-trace.js";
import type { ConversationTracer } from "./conversation-tracer.js";
import { SCHEDULED_EVENT_KIND, scheduledReplyId, type ScheduledScenarioEntry } from "./scheduled-event.js";
import type { TurnRecord } from "./room-types.js";

/** Minimal actor surface the scheduled interjection mutates. */
export interface ScheduleActorState {
  speaking: boolean;
  replyId: string;
  cueId: string;
  caption: string;
}

/** Room clock surface the schedule timers use. */
export interface ScheduleClock {
  setTimeout(handler: (...args: unknown[]) => void, ms: number): { clear(): void };
  setInterval(handler: (...args: unknown[]) => void, ms: number): { clear(): void };
}

/** Narrow room surface the schedule driver mutates. */
export interface ScenarioScheduleBindings {
  clock: ScheduleClock;
  state: { phase: string; lastScheduledEventId: string; turnId: number; turnOwner: string };
  actors: { get(id: string): ScheduleActorState | undefined; values(): Iterable<ScheduleActorState> };
  tracer: ConversationTracer;
  turnLog: TurnRecord[];
  turnOpenedAtMs: Map<number, number>;
  getOpenTurn(): { turnId: number; actorId: string; timer: { clear(): void } } | null;
  setOpenTurn(turn: { turnId: number; actorId: string; timer: { clear(): void } } | null): void;
}

/** Delay between blocked-entry retries on the room clock (well under one phase tick). */
const SCHEDULE_RETRY_MS = 100;

/** Open-turn accessors (the room owns the field; the driver only reads/writes it). */
export interface ScheduleOpenTurn {
  get(): { turnId: number; actorId: string; timer: { clear(): void } } | null;
  set(turn: { turnId: number; actorId: string; timer: { clear(): void } } | null): void;
}

/**
 * Build one station's schedule driver (null off a cast station). Rooms are
 * per-station, so one driver per room covers that station's own schedule.
 */
export function createScheduleDriver(
  clock: ScheduleClock,
  state: { phase: string; lastScheduledEventId: string; turnId: number; turnOwner: string },
  actors: { get(id: string): ScheduleActorState | undefined; values(): Iterable<ScheduleActorState> },
  tracer: ConversationTracer,
  turnLog: TurnRecord[],
  turnOpenedAtMs: Map<number, number>,
  openTurn: ScheduleOpenTurn,
  schedule: readonly ScheduledScenarioEntry[] | null,
  encounterSeconds: number,
): ScenarioScheduleDriver | null {
  if (schedule === null) {
    return null;
  }
  const bindings: ScenarioScheduleBindings = {
    clock,
    state,
    actors,
    tracer,
    turnLog,
    turnOpenedAtMs,
    getOpenTurn: () => openTurn.get(),
    setOpenTurn: (turn) => {
      openTurn.set(turn);
    },
  };
  return new ScenarioScheduleDriver(bindings, [...schedule], encounterSeconds);
}

/** One station's scenario schedule driver (per room; rooms are per station). */
export class ScenarioScheduleDriver {
  private timers: { clear(): void }[] = [];
  private pending: ScheduledScenarioEntry[] = [];
  private poll: { clear(): void } | null = null;
  private readonly fired = new Set<string>();

  constructor(
    private readonly bindings: ScenarioScheduleBindings,
    private readonly entries: ScheduledScenarioEntry[],
    private readonly encounterSeconds: number,
  ) {}

  /** Start one room-clock timer per due entry (atSecond < encounter length). */
  startEncounter(): void {
    this.clear();
    for (const entry of this.entries) {
      if (entry.atSecond < 0 || entry.atSecond >= this.encounterSeconds || this.fired.has(entry.eventId)) {
        continue;
      }
      const timer = this.bindings.clock.setTimeout(() => {
        this.onDue(entry);
      }, entry.atSecond * 1000);
      this.timers.push(timer);
    }
  }

  /** Clear every timer and drop queued entries (phase close / room dispose). */
  clear(): void {
    for (const timer of this.timers) {
      timer.clear();
    }
    this.timers = [];
    this.poll?.clear();
    this.poll = null;
    this.pending = [];
  }

  private onDue(entry: ScheduledScenarioEntry): void {
    if (this.fired.has(entry.eventId) || this.bindings.state.phase !== "encounter") {
      return;
    }
    if (!this.canFire()) {
      if (!this.pending.includes(entry)) {
        this.pending.push(entry);
      }
      this.armPoll();
      return;
    }
    this.fire(entry);
  }

  /** An interjection starts only with no open turn and no actor speaking. */
  private canFire(): boolean {
    if (this.bindings.getOpenTurn() !== null) {
      return false;
    }
    for (const actor of this.bindings.actors.values()) {
      if (actor.speaking) {
        return false;
      }
    }
    return true;
  }

  private armPoll(): void {
    if (this.poll !== null) {
      return;
    }
    this.poll = this.bindings.clock.setInterval(() => {
      if (this.bindings.state.phase !== "encounter") {
        this.clear();
        return;
      }
      for (const entry of [...this.pending]) {
        if (this.canFire()) {
          this.fire(entry);
        }
      }
      if (this.pending.length === 0) {
        this.poll?.clear();
        this.poll = null;
      }
    }, SCHEDULE_RETRY_MS);
  }

  private fire(entry: ScheduledScenarioEntry): void {
    const bindings = this.bindings;
    if (bindings.state.phase !== "encounter") {
      return;
    }
    const actor = bindings.actors.get(entry.actorId);
    if (!actor || !this.canFire()) {
      if (actor && !this.pending.includes(entry)) {
        this.pending.push(entry);
        this.armPoll();
      }
      return;
    }
    this.fired.add(entry.eventId);
    this.pending = this.pending.filter((queued) => queued !== entry);
    bindings.state.turnId += 1;
    const turnId = bindings.state.turnId;
    const replyId = scheduledReplyId(entry.eventId);
    actor.speaking = true;
    actor.replyId = replyId;
    actor.cueId = "";
    actor.caption = "";
    bindings.state.turnOwner = "actor";
    bindings.tracer.push({ seq: null, kind: SCHEDULED_EVENT_KIND, actorId: entry.actorId, turnId, eventId: entry.eventId, tag: entry.tag });
    const record: TurnRecord = { turnId, actorId: entry.actorId, replyId, startSeq: 0, end: "open", endSeq: null };
    bindings.turnLog.push(record);
    bindings.turnOpenedAtMs.set(turnId, Date.now());
    bindings.state.lastScheduledEventId = entry.eventId;
    const timer = bindings.clock.setTimeout(() => {
      if (bindings.getOpenTurn()?.turnId !== turnId) {
        return;
      }
      bindings.setOpenTurn(null);
      actor.speaking = false;
      actor.caption = "";
      bindings.state.turnOwner = "none";
      record.end = "completed";
      bindings.tracer.push({ seq: null, kind: "turn-completed", actorId: entry.actorId, turnId });
    }, pickC3Reply(1).durationMs);
    bindings.setOpenTurn({ turnId, actorId: entry.actorId, timer });
  }
}
