import type { CaseScenarioSource } from "./case-actor-placements.js";
import { realizedEquipmentPlacementId } from "./realized-equipment-placements.js";
import type { EncounterRuntimeEquipmentPlacement } from "./runtime-bundles.js";

/**
 * Which real-GLB equipment fixtures a CASE puts in the local encounter bundle, and how many copies.
 *
 * THE DEFAULT IS THE DEFAULT. The local bundle has always realized `ecg_cart_equipment` and
 * `iv_stand_equipment`, and `planStationEquipmentMounts` pushes the same pair again for the ED bay
 * (`packages/openclinxr/xr-station/src/station-equipment.ts:371-372`). That default stays
 * authoritative for every case. A first version of this module inverted it — an injected case
 * realized only what its own `assetNeeds` named — and that was a REGRESSION, measured through the
 * constructor the route calls: `ward_delirium_med_rec_v1` and `clinic_knee_pain_return_to_play_v1`
 * came back with `equipment: []` where they had previously carried both fixtures. Neither case
 * asked for that; they were merely silent, and silence had been read as refusal.
 *
 * SO A REFUSAL IS AUTHORED, NEVER INFERRED. A default is dropped only when the persisted case
 * names it in `equipmentDecisions.intentionallyAbsentEquipmentIds`
 * (`packages/openclinxr/shared-schemas/src/schemas.ts` `SceneEquipmentDecisionsSchema`). A case
 * with no `equipmentDecisions` member — every shipped fixture — is byte-identical to before.
 *
 * THE ALIAS IS REVIEWED AND EXPLICIT. Cases author the CATALOGUE id
 * (`12_lead_ecg_machine_equipment`, `iv_pole_equipment`); the local bundle's fixture rows are keyed
 * by the older asset ids (`ecg_cart_equipment`, `iv_stand_equipment`). Either spelling refuses the
 * same fixture. There is no substring matching anywhere in this module.
 *
 * WHAT IS OUT OF SCOPE. Only these two ids have a real GLB fixture in the local bundle. Parametric
 * ward items (bed, rails, call bell, EHR screen) reach the scene through the station's parametric
 * builders, and inventing bundle rows and room positions for them here would be the generalized
 * room synthesis this slice is forbidden to write. A case may therefore refuse and duplicate only
 * within this pair today, and `unrealizableEquipmentDecisions` reports any decision that names
 * something outside it rather than accepting a decision that can have no effect.
 */
const REAL_GLB_EQUIPMENT_BY_AUTHORED_CATALOGUE_ID: Readonly<Record<string, string>> = {
  "12_lead_ecg_machine_equipment": "ecg_cart_equipment",
  iv_pole_equipment: "iv_stand_equipment",
};

/** The pair the local bundle has always carried, in its historical order. */
const ED_BAY_REAL_GLB_EQUIPMENT_IDS: readonly string[] = ["ecg_cart_equipment", "iv_stand_equipment"];

/** Historical positions for the two fixtures. Copy 2+ is offset so it is not mounted inside copy 1. */
const ED_BAY_EQUIPMENT_PLACEMENTS: Readonly<Record<string, EncounterRuntimeEquipmentPlacement>> = {
  ecg_cart_equipment: { position: { x: -2.15, y: 0, z: 0.55 }, label: "12-lead ECG", interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"] },
  iv_stand_equipment: { position: { x: -1.85, y: 0, z: 0.95 }, label: "IV pump", interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"] },
};

/** Metres between realized copies of one id, so a second copy is a second object on the floor. */
const REALIZED_COPY_OFFSET_METERS = 0.42;

/** The fixture id an authored id refuses or duplicates: the catalogue spelling or the fixture's own. */
function fixtureIdForAuthoredId(authoredId: string): string | undefined {
  const aliased = REAL_GLB_EQUIPMENT_BY_AUTHORED_CATALOGUE_ID[authoredId];
  if (aliased) return aliased;
  return ED_BAY_REAL_GLB_EQUIPMENT_IDS.includes(authoredId) ? authoredId : undefined;
}

/**
 * Equipment decisions this bundle cannot act on, with the reason.
 *
 * A decision naming an id outside the realizable pair is REPORTED rather than silently ignored: a
 * case that believes it has refused an ECG cart, and has actually refused nothing, is the same
 * silence the whole slice removes. The route turns a non-empty list into a refusal.
 */
export function unrealizableEquipmentDecisions(
  scenario?: CaseScenarioSource | undefined,
): Array<{ authoredEquipmentId: string; decision: "intentionally_absent" | "copies"; reason: string }> {
  const decisions = scenario?.equipmentDecisions;
  if (!decisions) return [];
  const out: Array<{ authoredEquipmentId: string; decision: "intentionally_absent" | "copies"; reason: string }> = [];
  const realizable = `the local encounter bundle realizes ${ED_BAY_REAL_GLB_EQUIPMENT_IDS.join(" and ")} only`;
  for (const authoredEquipmentId of decisions.intentionallyAbsentEquipmentIds ?? []) {
    if (fixtureIdForAuthoredId(authoredEquipmentId)) continue;
    out.push({ authoredEquipmentId, decision: "intentionally_absent", reason: `${realizable}, so refusing ${authoredEquipmentId} would have no effect` });
  }
  for (const authoredEquipmentId of Object.keys(decisions.copies ?? {})) {
    if (fixtureIdForAuthoredId(authoredEquipmentId)) continue;
    out.push({ authoredEquipmentId, decision: "copies", reason: `${realizable}, so copies of ${authoredEquipmentId} would have no effect` });
  }
  return out;
}

/** The bundle row a realized fixture becomes: its asset identity and the blob it loads. */
type RealGlbEquipmentFixture = {
  equipmentId: string;
  assetId: string;
  scenarioAssetId: string;
  displayName: string;
  blobName: string;
};

const REAL_GLB_EQUIPMENT_FIXTURES: Readonly<Record<string, RealGlbEquipmentFixture>> = {
  ecg_cart_equipment: {
    equipmentId: "ecg_cart_equipment",
    assetId: "ecg_cart_12_lead_glb",
    scenarioAssetId: "ecg_cart_equipment",
    displayName: "12-lead ECG cart GLB fixture",
    blobName: "xr-assets/medical-equipment/ecg-cart-12-lead.glb",
  },
  iv_stand_equipment: {
    equipmentId: "iv_stand_equipment",
    assetId: "iv_pole_with_pump_glb",
    scenarioAssetId: "iv_stand_equipment",
    displayName: "IV pole with pump GLB fixture",
    blobName: "xr-assets/medical-equipment/iv-pole-with-pump.glb",
  },
};

/**
 * The real-GLB equipment ids this case realizes, in historical order, one entry per COPY.
 *
 * No injected case, or an injected case with no `equipmentDecisions`, returns the historical pair
 * once each — exactly today's behaviour.
 */
function caseRealGlbEquipmentIds(scenario?: CaseScenarioSource | undefined): readonly string[] {
  const decisions = scenario?.equipmentDecisions;
  const refused = new Set(
    (decisions?.intentionallyAbsentEquipmentIds ?? [])
      .map(fixtureIdForAuthoredId)
      .filter((fixtureId): fixtureId is string => fixtureId !== undefined),
  );
  const out: string[] = [];
  for (const equipmentId of ED_BAY_REAL_GLB_EQUIPMENT_IDS) {
    if (refused.has(equipmentId)) continue;
    out.push(...Array.from({ length: authoredCopyCount(equipmentId, decisions) }, () => equipmentId));
  }
  return out;
}

/** Copies the case authored for one fixture, by either spelling. One when it authored none. */
function authoredCopyCount(
  fixtureId: string,
  decisions: CaseScenarioSource["equipmentDecisions"],
): number {
  for (const [authoredEquipmentId, count] of Object.entries(decisions?.copies ?? {})) {
    if (fixtureIdForAuthoredId(authoredEquipmentId) === fixtureId) return Math.max(1, count);
  }
  return 1;
}

/** Fixture descriptors for exactly the equipment this case realizes, one per copy. */
export function caseRealGlbEquipmentFixtures(
  scenario?: CaseScenarioSource | undefined,
): readonly RealGlbEquipmentFixture[] {
  return caseRealGlbEquipmentIds(scenario)
    .map((equipmentId) => REAL_GLB_EQUIPMENT_FIXTURES[equipmentId])
    .filter((fixture): fixture is RealGlbEquipmentFixture => fixture !== undefined);
}

/**
 * Scene-manifest placements keyed by REALIZED placement id, so two copies of one fixture mount
 * separately instead of the second overwriting the first.
 */
export function caseRealGlbEquipmentPlacements(
  scenario?: CaseScenarioSource | undefined,
): Record<string, EncounterRuntimeEquipmentPlacement> {
  const out: Record<string, EncounterRuntimeEquipmentPlacement> = {};
  const copyIndexByEquipmentId = new Map<string, number>();
  for (const equipmentId of caseRealGlbEquipmentIds(scenario)) {
    const placement = ED_BAY_EQUIPMENT_PLACEMENTS[equipmentId];
    if (!placement) continue;
    const copyIndex = (copyIndexByEquipmentId.get(equipmentId) ?? 0) + 1;
    copyIndexByEquipmentId.set(equipmentId, copyIndex);
    out[realizedEquipmentPlacementId(equipmentId, copyIndex)] = copyIndex === 1
      ? placement
      : {
          ...placement,
          position: { ...placement.position, x: placement.position.x + REALIZED_COPY_OFFSET_METERS * (copyIndex - 1) },
          label: `${placement.label ?? equipmentId} (${copyIndex})`,
        };
  }
  return out;
}
