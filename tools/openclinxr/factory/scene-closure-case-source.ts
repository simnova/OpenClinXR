/**
 * SC-01 selected-case / asset source manifest for `scene_closure_supine_bedside_v1`.
 *
 * THIS IS AUTHORING INPUT. It is the versioned record of what a faculty author selected for the
 * scene-closure encounter, and it exists so the selection can be persisted and reviewed through
 * the supported authoring path. It is deliberately NOT a runtime fixture lookup: nothing under
 * `packages/` or `apps/` imports this module, and the runtime never reads it. The runtime reads
 * the PERSISTED scenario through `ScenarioCatalogPort` / `resolveScenarioById`, which is the whole
 * point of the card — a second in-repo bank keyed by scenario id would reproduce the defect this
 * slice removes.
 *
 * WHY THE DEFECT NEEDED A NEW CASE. Measured 2026-09-09 on the unchanged baseline, and stated
 * correctly here after a first version of this note blamed the wrong function.
 *
 * AT THE ROUTE, THE SELECTION WAS DISCARDED. `GET /runtime/asset-bundles/:bundleId` called
 * `createEdChestPainLocalLearnerRuntimeAssetBundle()` with NO ARGUMENTS and read no scenario
 * parameter at all, so a persisted case never reached the cast resolver and the served bundle was
 * the ED bundle, ED `scenarioId` included. That is what the baseline RED observed.
 *
 * INSIDE THE CONSTRUCTOR there is a second, independent defect, reached whenever a caller does pass
 * a scenario id: `castFromScenarioBank`
 * (`packages/openclinxr/asset-registry/src/actor-casting.ts:294`) resolves through a module-level
 * `scenarioBank.find()` and returns `[]` for an id the bank does not carry, and
 * `resolveBundleCastActorIds` then substitutes the ED literals. `apps/ui-xr/src/main.ts:650-652`
 * does pass an id, so it hit this one: a bundle whose only correct field was `scenarioId`, while
 * `describeRuntimeBundleScenarioMatch`
 * (`packages/openclinxr/xr-pose/src/actor-floor-composition.ts:191`) compared scenario ids only and
 * reported `matches: true`. Both defects are real, they live in different files, and only the first
 * is what the baseline RED measured.
 *
 * WHAT IS BORROWED AND WHAT IS NEW. The four actor identities and their clinical facts are the
 * Ward delirium case's (`packages/openclinxr/scenario-fixtures/src/ward-delirium.ts`), which is
 * left byte-identical: the card requires `patient_margaret_ellis_v1` and
 * `senior_resident_ward_v1` preserved, and reusing the reviewed people avoids inventing new
 * clinical content. The SCHEDULE, the authored placement (supine support with an offset, and a
 * physician start position away from the bedside), the equipment decisions and the trace tags are
 * NEW and synthetic to this encounter. Borrowed clinical facts and the reviewed synthetic setup
 * are separate, and the disclosure below says so.
 *
 * CLAIM SCOPE: local formative synthetic authoring input. NOT EVIDENCE FOR clinical validity,
 * scoring validity, learner launch readiness, or headset readiness.
 */

// Type-only, and erased at build: the authoring input is CHECKED against the real case schema
// (status union, actor roles, the supportSurface enum) without taking a runtime dependency on the
// package. A structural echo of the schema here would drift from it silently.
import type { Scenario } from "../../../packages/openclinxr/shared-schemas/src/index.js";

/** Bump when any pinned selection below changes; dependent SC-04 evidence pins this string. */
export const SCENE_CLOSURE_CASE_SOURCE_VERSION = "openclinxr.scene-closure-case-source.v1";

/** The persisted scenario id. Deliberately unlike every fixture id in the bank. */
export const SCENE_CLOSURE_CASE_ID = "scene_closure_supine_bedside_v1";

/** Reused room. Pinned, not synthesized: the card forbids generalized room synthesis. */
export const SCENE_CLOSURE_ENVIRONMENT_ID = "inpatient_ward_room_v1";

export const SCENE_CLOSURE_STATION_ID = "scene_closure_supine_bedside_station_v1";

/**
 * The two identities the card names, pinned so a producer can refuse a persisted document that
 * has drifted from the selection rather than staging whoever the cast resolver happens to return.
 */
export const SCENE_CLOSURE_PINNED_CAST = {
  patient: "patient_margaret_ellis_v1",
  physician: "senior_resident_ward_v1",
} as const;

/** The authored document is a real `Scenario`, checked by the compiler rather than by convention. */
export type SceneClosureCaseDocument = Scenario;

/**
 * Equipment decisions, kept as data so the producer and the regression test read the SAME record.
 *
 * The phrases are what the case authors in `equipment`; the aliases are the reviewed phrase ->
 * catalogue-id bindings consumed by `bindInitialSceneContents`
 * (`packages/openclinxr/asset-registry/src/initial-scene-contents.ts`). Precedence is that
 * module's, stated once there and not re-derived here.
 *
 * ECG AND IV ARE INTENTIONALLY ABSENT, and that is a decision rather than an omission. The ED bay
 * injects `ecg_cart_equipment` and `iv_stand_equipment` unconditionally
 * (`packages/openclinxr/xr-station/src/station-equipment.ts:371-372`, guarded by
 * `isEdChestPainBayScenario` at :200, and the same pair is hard-coded into the local bundle's
 * `equipment` array). A ward medication-reconciliation encounter has neither at the bedside, so
 * this case must not inherit them — that inheritance is the negative control.
 */
export const SCENE_CLOSURE_EQUIPMENT_DECISIONS = {
  /** Required at start. Each carries the activity or rule it came from; a phrase without one is refused. */
  requirementSources: {
    "hospital bed": "activity:supine_bedside_assessment#the patient is assessed lying on the bed",
    "side rails": "rule:ward_fall_risk_precautions#rails up on both sides for a confused patient",
    "call bell": "rule:ward_fall_risk_precautions#call bell within reach before the clinician leaves",
    "EHR laptop": "activity:medication_reconciliation#the home medication list is compared on the ward EHR",
    "12-lead ECG machine": "decision:not_at_this_bedside#no cardiac workup is authored for this encounter",
    "IV pole": "decision:not_at_this_bedside#no infusion is authored for this encounter",
  } as Record<string, string>,
  /** Reviewed phrase -> catalogue equipment id. No substring matching anywhere; a phrase binds or it does not. */
  reviewedAliases: {
    "hospital bed": ["hospital_bed_equipment"],
    "side rails": ["side_rails_equipment"],
    "call bell": ["call_bell_equipment"],
    "EHR laptop": ["ehr_screen_equipment"],
    "12-lead ECG machine": ["12_lead_ecg_machine_equipment"],
    "IV pole": ["iv_pole_equipment"],
  } as Record<string, string[]>,
  /** The encounter proceeds without these. */
  optional: ["EHR laptop"] as string[],
  /** Kept in the plan, bound to nothing, never realized. */
  intentionallyAbsent: ["12-lead ECG machine", "IV pole"] as string[],
  /** Both rails are separate objects; two copies must keep distinct realized ids. */
  copies: { side_rails_equipment: 2 } as Record<string, number>,
} as const;

/**
 * The subset of the decisions above that the PERSISTED document carries, and therefore the only
 * part a runtime can act on.
 *
 * The phrases, aliases and sources above are authoring policy: they record how a reviewer bound
 * this case's English to catalogue ids, and they stay here because a runtime that read them would
 * be a second catalogue. What the DOCUMENT carries is the decision itself —
 * `equipmentDecisions.intentionallyAbsentEquipmentIds`
 * (`packages/openclinxr/shared-schemas/src/schemas.ts` `SceneEquipmentDecisionsSchema`) — because a
 * refusal only affects the served scene if it survives persistence.
 *
 * `side_rails_equipment` is deliberately NOT carried as `copies` here, even though the case authors
 * two rails: the local encounter bundle realizes only the ECG cart and the IV pole, so a copy count
 * for a parametric ward item would be a decision the scene cannot act on — and the route refuses
 * exactly that rather than accepting it silently. The two rails stay an authoring-side decision
 * until a later slice realizes parametric equipment into the bundle.
 */
export const SCENE_CLOSURE_PERSISTED_EQUIPMENT_DECISIONS = {
  intentionallyAbsentEquipmentIds: ["12_lead_ecg_machine_equipment", "iv_pole_equipment"],
} as const;

/**
 * Actors, borrowed identities with NEW authored placement.
 *
 * `supportSurface` takes `stretcher | chair | none` only
 * (`packages/openclinxr/shared-schemas/src/schemas.ts:227-241`), and `stretcher` is the value that
 * maps to the supine posture in `postureForSupportSurface`
 * (`packages/openclinxr/asset-registry/src/case-actor-placements.ts:29-33`). "Bed" is the ward
 * word for the same support; the schema's enum is what the runtime composes against, so the
 * authored value is `stretcher` and the room is a ward bed.
 *
 * The physician's authored plant offset is his START position, on the far side of the room. The
 * bedside destination is COMPUTED from the patient's own position by `bedsideClinicianPlacement`
 * and is deliberately not authored here; the two must not coincide, or "walks to the bedside" has
 * nothing to walk.
 */
const SCENE_CLOSURE_ACTORS: Scenario["actors"] = [
  {
    actorId: SCENE_CLOSURE_PINNED_CAST.patient,
    role: "patient",
    displayName: "Margaret Ellis",
    demeanor: "lying on the ward bed, hard of hearing, drowsy but rousable",
    hiddenFacts: [
      "Recently started diphenhydramine for sleep",
      "Burning urination and frequency are present but not volunteered",
    ],
    openingUtterance: "I am sorry, I cannot sit up very well. Where is my daughter?",
    placement: {
      supportSurface: "stretcher",
      plantOffsetMeters: { x: 0.12, y: 0, z: -0.08 },
    },
  },
  {
    actorId: "ward_nurse_patel_v1",
    role: "nurse",
    displayName: "Nurse Patel",
    demeanor: "at the bedside with the overnight fall-risk notes",
    hiddenFacts: ["Patient tried to get out of bed overnight and has poor sleep"],
    placement: { supportSurface: "none", plantOffsetMeters: { x: 0.85, y: 0, z: 0.35 } },
  },
  {
    actorId: "daughter_lena_ellis_v1",
    role: "family",
    displayName: "Lena Ellis",
    demeanor: "seated beside the bed with the home medication list on her phone",
    hiddenFacts: ["Can provide baseline cognition and home medication list if invited"],
    placement: { supportSurface: "chair", plantOffsetMeters: { x: -0.62, y: 0, z: 0.44 } },
  },
  {
    actorId: SCENE_CLOSURE_PINNED_CAST.physician,
    role: "physician",
    displayName: "Senior Resident",
    demeanor: "starts at the ward doorway and comes to the bedside for the summary",
    hiddenFacts: ["Wants delirium, medication, infection, and fall-risk priorities"],
    // START position, not the bedside destination. See the note above.
    placement: { supportSurface: "none", plantOffsetMeters: { x: -1.95, y: 0, z: 1.72 } },
    phenotype: {
      age: 34,
      body_profile: "adult_clinical_physician",
      pose: "standing_clinical_ready",
      gender_presentation: "adult_male_physician",
      height_cm: 172,
      build: "average_clinical_team",
      clothing_style: "white_lab_coat_over_scrubs",
      wardrobeRole: "physician_clinical",
      role_visual_cue: "senior_resident_physician",
    },
  },
];

/** The authored document, exactly as the supported producer persists it through `POST /scenarios`. */
export function sceneClosureCaseDocument(): SceneClosureCaseDocument {
  return {
    scenarioId: SCENE_CLOSURE_CASE_ID,
    version: 1,
    title: "Scene Closure — Supine Bedside Ward Assessment",
    status: "draft",
    review: { clinical: "draft", psychometric: "draft", legal: "draft", simulationQa: "draft" },
    clinicalObjectives: [
      "Assess a supine ward patient without asking her to stand",
      "Reconcile the home medication list with the ward record",
      "State fall-risk precautions to the team at the bedside",
    ],
    actors: SCENE_CLOSURE_ACTORS.map((actor) => ({ ...actor })),
    requiredTraceTags: [
      "supine_bedside_assessment",
      "medication_reconciliation",
      "fall_risk_action",
      "bedside_summary",
    ],
    // NEW synthetic schedule — deliberately not the Ward case's 240/360/600 sequence.
    eventSchedule: [
      { eventId: "nurse_hands_over_overnight_notes", atSecond: 120, actorId: "ward_nurse_patel_v1", tag: "fall_risk_action" },
      { eventId: "daughter_offers_home_med_list", atSecond: 300, actorId: "daughter_lena_ellis_v1", tag: "medication_reconciliation" },
      { eventId: "resident_arrives_at_bedside", atSecond: 480, actorId: SCENE_CLOSURE_PINNED_CAST.physician, tag: "bedside_summary" },
    ],
    reviewRubric: [
      { rubricId: "supine_assessment", label: "Supine bedside assessment", requiredTraceTags: ["supine_bedside_assessment"] },
      { rubricId: "medication_reconciliation", label: "Medication reconciliation", requiredTraceTags: ["medication_reconciliation"] },
      { rubricId: "bedside_safety_handoff", label: "Bedside safety handoff", requiredTraceTags: ["fall_risk_action", "bedside_summary"] },
    ],
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure:
        "Synthetic scene-closure authoring input. Actor identities and clinical facts are borrowed from the "
        + "synthetic ward delirium draft; the schedule, placement and equipment decisions are new and reviewed "
        + "separately. Not validated for summative assessment and not evidence of clinical validity.",
      validationStage: "stage_0_synthetic_draft",
      validationLimitations: [
        "Requires specialty clinician, psychometric, legal, and simulation QA review before learner use.",
      ],
      requiredReviewerRoles: ["internist", "geriatrician", "psychometrician", "legal", "simulation_qa"],
      sourceIds: ["src-openclinxr-scene-closure-case-source-v1"],
      safetyCriticalTraceTags: ["fall_risk_action", "bedside_summary"],
      hiddenFactPolicy: { learnerView: "redact_hidden_facts", disclosureRequiresTrigger: true },
    },
    environment: {
      environmentId: SCENE_CLOSURE_ENVIRONMENT_ID,
      name: "Inpatient Medical Ward Room",
      description: "Ward room with a bed, side rails, call bell, medication cart and EHR laptop. No ECG cart, no IV pole.",
    },
    equipment: [
      "hospital bed",
      "side rails",
      "call bell",
      "EHR laptop",
      "12-lead ECG machine",
      "IV pole",
    ],
    assetNeeds: [
      { assetId: "patient_margaret_ellis_character", assetType: "character", description: "Older adult supine on a ward bed, hard of hearing, rousable", licenseStatus: "placeholder-approved" },
      { assetId: "senior_resident_ward_character", assetType: "character", description: "Male senior resident who starts at the doorway and walks to the bedside", licenseStatus: "placeholder-approved" },
      { assetId: "ward_room_environment", assetType: "environment", description: "Reused inpatient ward room; no new room is synthesized for this case", licenseStatus: "placeholder-approved" },
      // Equipment asset needs name CATALOGUE ids outright — precedence 1 in bindInitialSceneContents.
      // The ECG and IV ids are absent on purpose and their absence is the negative control.
      { assetId: "hospital_bed_equipment", assetType: "equipment", description: "Ward bed the patient lies on", licenseStatus: "placeholder-approved" },
      { assetId: "side_rails_equipment", assetType: "equipment", description: "Both side rails, two realized copies", licenseStatus: "placeholder-approved" },
      { assetId: "call_bell_equipment", assetType: "equipment", description: "Call bell within reach", licenseStatus: "placeholder-approved" },
      { assetId: "ehr_screen_equipment", assetType: "equipment", description: "Ward EHR laptop for the medication list", licenseStatus: "placeholder-approved" },
    ],
    equipmentDecisions: {
      intentionallyAbsentEquipmentIds: [...SCENE_CLOSURE_PERSISTED_EQUIPMENT_DECISIONS.intentionallyAbsentEquipmentIds],
    },
  };
}

/** A named refusal from the producer's pin check. Empty list = the document matches the selection. */
export type SceneClosureCastRefusal = { pinnedRole: string; expectedActorId: string; foundActorId: string; reason: string };

/**
 * Refuse a persisted document whose cast has drifted from the pinned selection, NAMING who was
 * found instead.
 *
 * This is the producer's half of "a misidentified physician is named and refused rather than
 * silently substituted". The runtime half is that the bundle stages the persisted document's own
 * actor and never substitutes the pinned id back in — a silent substitution would make the
 * document and the scene disagree while both looked correct. Neither half guesses: this one
 * reports, the runtime one carries whoever the case actually names.
 */
export function refuseIfCastDriftsFromSelection(document: SceneClosureCaseDocument): SceneClosureCastRefusal[] {
  const refusals: SceneClosureCastRefusal[] = [];
  for (const [pinnedRole, expectedActorId] of Object.entries(SCENE_CLOSURE_PINNED_CAST)) {
    const found = document.actors.find((actor) => actor.role === pinnedRole);
    const foundActorId = found?.actorId ?? "";
    if (foundActorId === expectedActorId) continue;
    refusals.push({
      pinnedRole,
      expectedActorId,
      foundActorId,
      reason: foundActorId === ""
        ? `the persisted case declares no ${pinnedRole}; the selection pins ${expectedActorId}`
        : `the persisted case declares ${pinnedRole} ${foundActorId}; the selection pins ${expectedActorId}`,
    });
  }
  return refusals;
}
