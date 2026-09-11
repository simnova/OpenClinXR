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

/**
 * A case document supplied by a CALLER instead of found in the in-repo bank.
 *
 * The bank lookup is a module-level `scenarioBank.find()`, so a persisted authored case — one the
 * repo has never seen — resolved to nothing and every consumer silently fell back to the ED
 * literals. The injection point is this type: the API resolves the authored scenario through the
 * existing `ScenarioCatalogPort` and passes the document down. Nothing here reads persistence and
 * nothing here holds a second catalogue; the caller that already owns the lookup owns it still.
 *
 * Structural, not `Scenario`: this package must accept a persisted document from a host that
 * validated it, without importing the whole schema surface to read four fields.
 */
export type CaseScenarioSource = {
  scenarioId: string;
  actors?: readonly {
    actorId: string;
    role: string;
    placement?: AuthoredCasePlacement | undefined;
  }[] | undefined;
  environment?: { environmentId?: string | undefined } | undefined;
  environmentId?: string | undefined;
  assetNeeds?: readonly { assetId: string }[] | undefined;
  /** What the case DECIDED about equipment, as opposed to described. Absent = today's defaults. */
  equipmentDecisions?: {
    intentionallyAbsentEquipmentIds?: readonly string[] | undefined;
    copies?: Readonly<Record<string, number>> | undefined;
  } | undefined;
};

/**
 * The case document for `scenarioId`: the injected one when the caller supplies it, otherwise the
 * bank's. An injected document whose id disagrees with `scenarioId` is IGNORED rather than
 * trusted — a caller resolving one case and asking about another is a bug, and silently answering
 * from the wrong document is exactly the class of silence this seam exists to remove.
 */
export function caseScenarioDocument(
  scenarioId: string,
  scenario?: CaseScenarioSource | undefined,
): CaseScenarioSource | undefined {
  if (scenario && scenario.scenarioId === scenarioId) return scenario;
  return scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
}

/** Every authored placement in `scenarioId`, keyed by actor id. Empty when the case authors none. */
export function authoredCasePlacements(
  scenarioId: string,
  scenario?: CaseScenarioSource | undefined,
): Record<string, AuthoredCasePlacement> {
  const resolved = caseScenarioDocument(scenarioId, scenario);
  const out: Record<string, AuthoredCasePlacement> = {};
  for (const actor of resolved?.actors ?? []) {
    if (actor.placement) out[actor.actorId] = actor.placement;
  }
  return out;
}
