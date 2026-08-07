/**
 * #111 humanoid cast-path resolution inspector.
 *
 * Reports what the running app's fallthrough resolver returns for every shipped
 * station actor vs the casting SSOT. Uses `resolveHumanoidVariantOrCastPath` —
 * the same function `runtimeHumanoidVariantAssetPath` in apps/ui-xr/src/main.ts
 * calls after scenario-specific comparator branches (and after #111 removed the
 * blanket older|elder|geriatric|delirium string-match short-circuit).
 *
 * claimScope: path identity of slotted actors vs resolveScenarioActorCast.
 * notEvidenceFor: mesh quality, wardrobe, fourth-actor shell slots, clinical likeness.
 */

import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
  type ScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { resolveHumanoidVariantOrCastPath } from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";

export type ActorResolution = {
  scenarioId: string;
  actorId: string;
  role: string;
  /** What the running app's cast fallthrough resolver returns for this actor. */
  resolvedPath: string;
  /** What the casting SSOT says this actor should be. */
  castPath: string;
  /** True when the actor has a humanoid slot in the runtime shell (patient / clinical / family). */
  hasSlot: boolean;
};

export type HumanoidCastPathResolutionReport = {
  scenarios: string[];
  actors: ActorResolution[];
};

/**
 * Mirror of the three shell slots in apps/ui-xr/src/main.ts (~3649/3681/3719):
 * patient, clinical team (nurse-class), family/observer. A fourth bank actor is
 * not slotted (#112) — mark hasSlot false so contracts measure this defect only.
 */
function slottedActorIds(cast: readonly ScenarioActorCast[]): Set<string> {
  const humanoids = cast.filter(
    (a) => a.role.toLowerCase() !== "system" && !/_phone_|_tablet_|telehealth_system/iu.test(a.actorId),
  );
  const patient = humanoids.find((a) => a.role.toLowerCase() === "patient")?.actorId;
  const clinical = humanoids.find((a) =>
    ["nurse", "respiratory_therapist", "nurse_observer", "consultant"].includes(a.role.toLowerCase()),
  )?.actorId;
  const family = humanoids.find(
    (a) =>
      ["spouse", "parent", "family", "consultant"].includes(a.role.toLowerCase())
      && a.actorId !== clinical,
  )?.actorId;
  return new Set([patient, clinical, family].filter((id): id is string => Boolean(id)));
}

/**
 * Enumerate every castable shipped scenario and resolve each humanoid role path
 * with the same fallthrough function the UI-XR app uses (#111).
 */
export async function inspectHumanoidCastPathResolution(): Promise<HumanoidCastPathResolutionReport> {
  const scenarios = listShippedCastScenarioIds();
  const actors: ActorResolution[] = [];

  for (const scenarioId of scenarios) {
    const cast = resolveScenarioActorCast(scenarioId);
    const slots = slottedActorIds(cast);
    for (const entry of cast) {
      const castPath = entry.runtimeAssetPath;
      const resolvedPath = resolveHumanoidVariantOrCastPath({
        scenarioId,
        actorId: entry.actorId,
        role: entry.role,
        fallbackPath: castPath,
      });
      actors.push({
        scenarioId,
        actorId: entry.actorId,
        role: entry.role,
        resolvedPath,
        castPath,
        hasSlot: slots.has(entry.actorId),
      });
    }
  }

  return { scenarios, actors };
}
