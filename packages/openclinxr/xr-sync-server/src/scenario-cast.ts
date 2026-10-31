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

import { ActorState, type ActorStateInstance } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One station's scenario cast: identity, exact roster, starting emotion. */
export interface ScenarioCast {
  scenarioId: string;
  scenarioTitle: string;
  actorIds: string[];
  baselineEmotion: string;
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
  for (const entry of actors) {
    if (!isRecord(entry) || typeof entry["actorId"] !== "string" || (entry["actorId"] as string).length === 0) {
      throw new Error(`bad-scenarios: scenarios[${index}] actors[].actorId must be a non-empty string`);
    }
    const id = entry["actorId"] as string;
    if (!actorIds.includes(id)) {
      actorIds.push(id);
    }
  }
  const policy = value["emotionPolicy"];
  const baseline =
    isRecord(policy) && typeof policy["baseline"] === "string" && (policy["baseline"] as string).length > 0
      ? (policy["baseline"] as string)
      : "neutral";
  return { scenarioId, scenarioTitle: title, actorIds, baselineEmotion: baseline };
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
    actors.set(id, actor);
  }
}
