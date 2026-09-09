import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";

/**
 * What a CASE authors about where an actor stands, sits or lies.
 *
 * The scene manifest keyed its placements by ED literal actor ids with hardcoded postures, so a
 * non-ED case found no entry, fell back to the ED defaults, and resolved every actor as standing.
 * Measured 2026-09-09 on the loaded humanoid: the clinic patient — who authors
 * `supportSurface: "chair"` — sampled at posture=standing on the ED stretcher's x −0.9.
 *
 * That mattered because the composition landed for the runtime card applies only to seated and
 * supine. A patient wrongly resolved as standing passes straight through it, so the authored
 * offset could not reach the figure however correct the composition was.
 */

/** The three postures the runtime composes for. `standing` is the pass-through. */
export type AuthoredPosture = "standing" | "seated" | "supine";

/**
 * Map an authored support surface onto a posture.
 *
 * `chair` seats; `stretcher` and `bed` lay supine; `none`, an unknown surface and an absent one
 * all stand. Unknown is deliberately NOT an error here: the case schema takes free text, and a
 * surface nobody has taught the runtime about should degrade to the pass-through rather than
 * refuse a scenario. The refusal that matters — a nonzero NORMAL offset on a supported posture —
 * belongs to composeSupportedActorWorldPosition and is not duplicated.
 */
export function postureForSupportSurface(supportSurface: string | undefined): AuthoredPosture {
  if (supportSurface === "chair") return "seated";
  if (supportSurface === "stretcher" || supportSurface === "bed") return "supine";
  return "standing";
}

export type AuthoredCasePlacement = {
  supportSurface?: string | undefined;
  plantOffsetMeters?: { x: number; y: number; z: number } | undefined;
};

/** Every authored placement in `scenarioId`, keyed by actor id. Empty when the case authors none. */
export function authoredCasePlacements(scenarioId: string): Record<string, AuthoredCasePlacement> {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  const out: Record<string, AuthoredCasePlacement> = {};
  for (const actor of scenario?.actors ?? []) {
    if (actor.placement) out[actor.actorId] = actor.placement;
  }
  return out;
}
