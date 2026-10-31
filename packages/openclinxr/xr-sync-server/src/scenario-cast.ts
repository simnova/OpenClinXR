/**
 * C16 scenario-cast for the xr-sync encounter server.
 *
 * Kept in its own module so room.ts/server.ts stay under the file-size gate.
 * Each exam station is CAST from its scenario: the station's actor roster,
 * starting emotion, and scenario identity come from the @openclinxr/shared-schemas
 * Scenario filling that blueprint slot, not from the fixed physician/patient
 * roster or client roomOptions.actors. scenarios[i] fills the blueprint's
 * sorted slot i (the same mapping @openclinxr/exam-assembly assembleExamForm
 * uses: slots sorted by (order, slotId); slot i <- scenarios[i]; the
 * approved-only rule is mirrored here, never imported from exam-assembly).
 *
 * Boot refuses (every message names "scenarios" so the refusal is greppable):
 * scenarios without examBlueprint; scenarios.length !== slot count; any
 * scenario whose status is not "approved"; any scenario without a non-empty
 * actors[].actorId roster.
 */

import type { CaseEmotionPolicy } from "@openclinxr/conversation-policy";
import { ActorState, type ActorStateInstance } from "./schema.js";
import type { ScheduledScenarioEntry } from "./scheduled-event.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One cast actor's voice: identity + scenario opening line for its first reply. */
export interface CastVoiceActor {
  actorId: string;
  displayName: string;
  /** Scenario openingUtterance ("" when the scenario names none; caption keeps the "<name>: " shape). */
  openingUtterance: string;
}

/** Stable named cue for a cast actor's opening reply (one cue for every opening). */
export const CAST_OPENING_CUE_ID = "cue-opening-01";

/** Learner-visible caption mirroring the scenario-fixtures "<displayName>: <caption>" format (not imported). */
export function openingCaption(displayName: string, openingUtterance: string): string {
  return `${displayName}: ${openingUtterance}`;
}

/** One station's scenario cast: identity, exact roster, starting emotion, voice, policy. */
export interface ScenarioCast {
  scenarioId: string;
  scenarioTitle: string;
  actorIds: string[];
  baselineEmotion: string;
  /** Per-actor voice lines (same order as the scenario roster, deduped by actorId). */
  castActors: CastVoiceActor[];
  /** The scenario's emotionPolicy (null when the scenario names none). */
  emotionPolicy: CaseEmotionPolicy | null;
  /** The scenario's eventSchedule: server-clock interjections for this station (empty when none). */
  schedule: ScheduledScenarioEntry[];
}

/** Extract one station's cast from a scenario value (throws naming "scenarios" on invalid). */
function castForScenario(value: unknown, index: number): ScenarioCast {
  if (!isRecord(value)) {
    throw new Error(`bad-scenarios: scenarios[${index}] must be an object`);
  }
  const scenarioId = value["scenarioId"];
  const title = value["title"];
  const status = value["status"];
  if (typeof scenarioId !== "string" || scenarioId.length === 0) {
    throw new Error(`bad-scenarios: scenarios[${index}].scenarioId must be a non-empty string`);
  }
  if (typeof title !== "string" || title.length === 0) {
    throw new Error(`bad-scenarios: scenarios[${index}].title must be a non-empty string`);
  }
  if (status !== "approved") {
    throw new Error(
      `bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) status must be "approved" (assembleExamForm rule)`,
    );
  }
  const actors = value["actors"];
  if (!Array.isArray(actors) || actors.length === 0) {
    throw new Error(`bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) must name at least one actor`);
  }
  const actorIds: string[] = [];
  const castActors: CastVoiceActor[] = [];
  for (const entry of actors) {
    if (!isRecord(entry) || typeof entry["actorId"] !== "string" || (entry["actorId"] as string).length === 0) {
      throw new Error(`bad-scenarios: scenarios[${index}] actors[].actorId must be a non-empty string`);
    }
    const id = entry["actorId"] as string;
    if (!actorIds.includes(id)) {
      actorIds.push(id);
      const displayName = typeof entry["displayName"] === "string" && (entry["displayName"] as string).length > 0
        ? (entry["displayName"] as string)
        : id;
      const opening = typeof entry["openingUtterance"] === "string" ? (entry["openingUtterance"] as string) : "";
      castActors.push({ actorId: id, displayName, openingUtterance: opening });
    }
  }
  const policy = value["emotionPolicy"];
  const baseline =
    isRecord(policy) && typeof policy["baseline"] === "string" && (policy["baseline"] as string).length > 0
      ? (policy["baseline"] as string)
      : "neutral";
  return { scenarioId, scenarioTitle: title, actorIds, baselineEmotion: baseline, castActors, emotionPolicy: readEmotionPolicy(policy), schedule: readScenarioSchedule(value["eventSchedule"], actorIds, index, scenarioId) };
}

/** Read a scenario eventSchedule value (every refusal names "scenarios"). */
function readScenarioSchedule(value: unknown, actorIds: string[], index: number, scenarioId: string): ScheduledScenarioEntry[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) eventSchedule must be an array`);
  }
  const seen = new Set<string>();
  const schedule: ScheduledScenarioEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw["eventId"] !== "string" || (raw["eventId"] as string).length === 0) {
      throw new Error(`bad-scenarios: scenarios[${index}] eventSchedule[].eventId must be a non-empty string`);
    }
    const eventId = raw["eventId"] as string;
    if (seen.has(eventId)) {
      throw new Error(`bad-scenarios: scenarios[${index}] eventSchedule eventId "${eventId.slice(0, 64)}" is not unique`);
    }
    seen.add(eventId);
    if (!Number.isInteger(raw["atSecond"]) || (raw["atSecond"] as number) < 0) {
      throw new Error(`bad-scenarios: scenarios[${index}] eventSchedule "${eventId.slice(0, 64)}" atSecond must be an integer >= 0`);
    }
    if (typeof raw["actorId"] !== "string" || !actorIds.includes(raw["actorId"] as string)) {
      throw new Error(`bad-scenarios: scenarios[${index}] eventSchedule "${eventId.slice(0, 64)}" actorId must be in the cast`);
    }
    if (typeof raw["tag"] !== "string" || (raw["tag"] as string).length === 0) {
      throw new Error(`bad-scenarios: scenarios[${index}] eventSchedule "${eventId.slice(0, 64)}" tag must be a non-empty string`);
    }
    schedule.push({ eventId, atSecond: raw["atSecond"] as number, actorId: raw["actorId"] as string, tag: raw["tag"] as string });
  }
  return schedule;
}

/** Read a scenario emotionPolicy value (null unless it carries baseline + bounds + a transition list). */
function readEmotionPolicy(value: unknown): CaseEmotionPolicy | null {
  if (!isRecord(value)) {
    return null;
  }
  const baseline = value["baseline"];
  const upperBound = value["upperBound"];
  const lowerBound = value["lowerBound"];
  const transitions = value["transitions"];
  if (typeof baseline !== "string" || typeof upperBound !== "string" || typeof lowerBound !== "string") {
    return null;
  }
  if (!Array.isArray(transitions)) {
    return null;
  }
  return { baseline, upperBound, lowerBound, transitions } as CaseEmotionPolicy;
}

/**
 * C17 emotion policy for one station: the cast scenario's own policy, or an
 * empty-transitions policy at the cast baseline when the scenario names none
 * (no transition ever matches, so the emotion never moves).
 */
export function stationEmotionPolicy(cast: ScenarioCast): CaseEmotionPolicy {
  if (cast.emotionPolicy !== null) {
    return cast.emotionPolicy;
  }
  return { baseline: cast.baselineEmotion as CaseEmotionPolicy["baseline"], upperBound: "anxious", lowerBound: "reassured", transitions: [] };
}

/**
 * Validate scenarios against the derived slot list and return the per-slot
 * casts. scenarios[i] fills stations[i]. Throws a named error (every message
 * names "scenarios") on a non-array, a length mismatch, or an invalid entry.
 */
export function parseScenarioCasts(scenarios: unknown, stations: string[]): ScenarioCast[] {
  if (!Array.isArray(scenarios)) {
    throw new Error("bad-scenarios: scenarios must be an array of @openclinxr/shared-schemas Scenario");
  }
  if (scenarios.length !== stations.length) {
    throw new Error(
      `bad-scenarios: scenarios length ${scenarios.length} !== station slot count ${stations.length} (scenarios[i] fills slot i)`,
    );
  }
  return scenarios.map((entry, index) => castForScenario(entry, index));
}

/** The cast for one station index, or null when the session runs without scenarios. */
export function castForStation(casts: ScenarioCast[] | null | undefined, stationIndex: number): ScenarioCast | null {
  if (casts === null || casts === undefined || stationIndex < 0 || stationIndex >= casts.length) {
    return null;
  }
  return casts[stationIndex] as ScenarioCast;
}

/**
 * Populate a room's actor map from one station's scenario cast. The cast
 * REPLACES the roster: the default physician/patient roster and client
 * roomOptions.actors are ignored on a cast station. Each actor's emotion
 * starts at the scenario emotionPolicy.baseline, else "neutral".
 */
export function populateCastRoster(actors: Map<string, ActorStateInstance>, cast: ScenarioCast): void {
  for (const id of cast.actorIds) {
    const actor = new ActorState();
    actor.id = id;
    actor.speaking = false;
    actor.emotion = cast.baselineEmotion;
    actor.replyId = "";
    actor.cueId = "";
    actor.caption = "";
    actors.set(id, actor);
  }
}
