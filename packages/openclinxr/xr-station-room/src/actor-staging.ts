/**
 * Station actor-slot staging — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). Four inlined actor-slot mounts in construction
 * order; keep four separate call sites, do not collapse into a loop.
 *
 * The four blocks look like duplication and are not. Three intentional
 * divergences a unified loop would silently revert:
 * 1. ORDERING (#591): the family slot stamps openClinXrSlotKind /
 *    openClinXrActorPosture / openClinXrActorId BEFORE applyActorFraming runs,
 *    because the framing's seated guard reads them. Patient and clinical stamp
 *    after framing and call no reseat.
 * 2. COMPARATOR VISIBILITY (#315): additional_cast is UNCONDITIONALLY hidden on
 *    cleanHumanoidSourceComparatorCapture; the other three show when they are
 *    the comparator's named subject.
 * 3. PEDIATRIC RESEAT (#591): the seated-parent reframe exists only on the
 *    family slot and reads family placement posture === "seated".
 */

import type {
  EncounterRuntimeActorPlacement,
  EncounterRuntimeAsset,
  LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import type {
  AssetLoadingContext,
} from "@openclinxr/xr-asset-loading";
import {
  comparatorCaptureSubjectActorId,
  loadGeneratedHumanoidIntoActorSlot,
} from "@openclinxr/xr-asset-loading";
import { publishRuntimeActorSlotAssignmentEvidence } from "@openclinxr/xr-capture-evidence";
import {
  additionalCastPlacementFallback,
  iwsdkStationSceneObjects,
} from "@openclinxr/xr-runtime-state";
import type { RuntimeSlotAssignment } from "@openclinxr/xr-runtime-state";
import { createPrimitiveActorMesh } from "@openclinxr/xr-scene";
import type { Group, Mesh, Scene } from "three";

export type StationActorSlotKind = EncounterRuntimeActorPlacement["slotKind"];

/** Slot-assignment evidence shape mirrored from main.ts window evidence. */
export type StationActorSlotAssignmentEvidence = {
  source: "window.__openClinXrActorSlotAssignment";
  scenarioId: string;
  declaredHumanoidActorIds: string[];
  stagedActorIds: string[];
  notStagedActorIds: { actorId: string; reason: string }[];
  maxVisibleSlots: number;
};

export type StationActorSlotAssignment = StationActorSlotAssignmentEvidence | null | undefined;

export type StationActorStagingContext = {
  encounterBundle: () => LearnerRuntimeAssetBundle;
  slotAssignment: () => RuntimeSlotAssignment;
  assetLoadingContext: () => AssetLoadingContext;
  actorPlacement: (actorId: string, fallback: EncounterRuntimeActorPlacement) => EncounterRuntimeActorPlacement;
  actorIdForSlot: (slotKind: StationActorSlotKind) => string;
  humanoidAssetForSlot: (slotKind: StationActorSlotKind) => EncounterRuntimeAsset;
  resolveAssetUrl: (asset: EncounterRuntimeAsset) => string;
  createActorNameplate: (label: string, accent: number) => Mesh;
  applyActorFraming: (actor: Group, actorId: string) => void;
  createVirtualDeviceActorAffordance: (actorId: string) => Group;
  scenarioRuntimeMismatch: () => boolean;
  cleanComparatorCapture: () => boolean;
  readActorSlotAssignment: () => StationActorSlotAssignment;
};

export type StationActorStagingResult = {
  patient: Group;
  nurse: Group;
};

/** Pure label helper moved from main.ts; main.ts imports it back. */
export function actorNameplateLabel(prefix: string, actorId: string): string {
  return `${prefix}: ${actorId.replace(/_v\d+$/u, "").replaceAll("_", " ")}`;
}

/** Pure scene-object-name helper moved from main.ts; main.ts imports it back. */
export function runtimeGeneratedSceneObjectName(asset: EncounterRuntimeAsset): string {
  return asset.assetId.replace(/[^a-z0-9:_-]+/giu, "-");
}

/**
 * Stage the four station actor slots in construction order. Returns the two
 * roots the render loop reads afterwards; family and additional_cast stay
 * reachable through the scene graph.
 */
export function stageStationActors(ctx: StationActorStagingContext, scene: Scene): StationActorStagingResult {
  // #122 — unique slot fill; unfilled slots stay in the graph but are hidden with empty actorId.
  publishRuntimeActorSlotAssignmentEvidence(ctx.encounterBundle(), ctx.slotAssignment());
  const patientActorId = ctx.actorIdForSlot("primary_patient");
  const patientRuntimeHumanoidAsset = ctx.humanoidAssetForSlot("primary_patient");
  const patientPlacement = ctx.actorPlacement(patientActorId || "unfilled_primary_patient", {
    slotKind: "primary_patient",
    position: { x: -0.72, y: 1.06, z: -0.12 },
    scale: { x: 1.1, y: 1.1, z: 1.1 },
    verticalOffsetMeters: -0.98,
    labelPrefix: "Patient",
  });
  const patient = createPrimitiveActorMesh(0x8fb9aa);
  patient.name = iwsdkStationSceneObjects.patientRobertHayes;
  patient.position.set(patientPlacement.position.x, patientPlacement.position.y, patientPlacement.position.z);
  patient.visible = Boolean(patientActorId) && !ctx.scenarioRuntimeMismatch();
  if (ctx.cleanComparatorCapture()) {
    // #315 follow-up: only the comparator's named subject renders; the patient is the
    // subject for the _patient comparators but NOT for _parent/_nurse (those name family/clinical).
    patient.visible = comparatorCaptureSubjectActorId(ctx.assetLoadingContext()) === patientActorId;
    patient.userData.openClinXrComparatorVisibilityPolicy = patient.visible
      ? "shown_as_named_subject_for_clean_humanoid_source_comparator_capture"
      : "hidden_for_clean_humanoid_source_comparator_capture_non_named_actor";
  }
  patient.scale.set(patientPlacement.scale.x, patientPlacement.scale.y, patientPlacement.scale.z);
  // POSTURE IS STAMPED BEFORE FRAMING, and the order is the whole fix.
  //
  // applyActorFraming's seated/supine guard (encounter-actor-framing.ts:140) reads
  // `actor.userData.openClinXrActorPosture` and returns early, keeping the composed XZ. The stamp
  // used to happen seven lines LATER, so the guard read "" every time, fell through, and
  // encounter-actor-framing.ts:178 overwrote the patient with the floor-standing frame
  // `(-0.9, 0, 0.08)`. That guard's own comment records the ordering as a known hazard; this is
  // the ordering being corrected rather than worked around.
  //
  // Measured 2026-09-09 on the loaded humanoid: runtimeActorPlacement composed x=0 with the
  // authored 0.4 m offset and x=-0.4 without it — a correct 0.4 m difference — and BOTH passes
  // sampled the patient at x=-0.9. The composition was right and its result was discarded here.
  patient.userData.openClinXrActorPosture = patientPlacement.posture ?? "standing";
  if (patientActorId) ctx.applyActorFraming(patient, patientActorId);
  if (patientActorId) {
    patient.add(ctx.createActorNameplate(actorNameplateLabel(patientPlacement.labelPrefix, patientActorId), 0x286b54));
  }
  scene.add(patient);
  // #83/#136: canonical slot kind on the root BEFORE load (never placement.slotKind — stale family tags collide).
  patient.userData.openClinXrSlotKind = "primary_patient";
  // The placement AS RESOLVED, stamped beside the posture it came with, so an instrument can read
  // what the runtime computed instead of inferring it from a transform. Measured 2026-09-09: the
  // patient slot sat at the manifest's raw x=-0.9 while its posture read `seated`, and a transform
  // alone cannot say whether the seated composition was never called or was called and overwritten.
  patient.userData.openClinXrResolvedPlacement = {
    position: { ...patientPlacement.position },
    posture: patientPlacement.posture ?? "standing",
    slotKind: patientPlacement.slotKind,
  };
  patient.userData.openClinXrActorId = patientActorId;
  patient.userData.openClinXrBaseHeadingRadians = patient.rotation.y;
  if (patientActorId) {
    loadGeneratedHumanoidIntoActorSlot(ctx.assetLoadingContext(), patient, {
      assetPath: ctx.resolveAssetUrl(patientRuntimeHumanoidAsset),
      assetId: patientRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(patientRuntimeHumanoidAsset),
      actorId: patientActorId,
      roleTintColor: 0x8fb9aa,
      verticalOffsetMeters: patientPlacement.verticalOffsetMeters,
      posture: patientPlacement.posture ?? "standing",
    });
  } else {
    patient.userData.openClinXrSlotUnfilledReason = "no_unique_patient_humanoid_for_station";
  }

  const clinicalActorId = ctx.actorIdForSlot("clinical_team");
  const nurseRuntimeHumanoidAsset = ctx.humanoidAssetForSlot("clinical_team");
  const nursePlacement = ctx.actorPlacement(clinicalActorId || "unfilled_clinical_team", {
    slotKind: "clinical_team",
    position: { x: 1.45, y: 0.95, z: 0.55 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Team",
  });
  const nurse = createPrimitiveActorMesh(0x5a9bd5);
  nurse.name = iwsdkStationSceneObjects.nurseMariaAlvarez;
  nurse.position.set(nursePlacement.position.x, nursePlacement.position.y, nursePlacement.position.z);
  nurse.visible = Boolean(clinicalActorId) && !ctx.scenarioRuntimeMismatch();
  if (ctx.cleanComparatorCapture()) {
    // #315 follow-up: the nurse comparator's named subject is the clinical actor — show it.
    nurse.visible = comparatorCaptureSubjectActorId(ctx.assetLoadingContext()) === clinicalActorId;
    nurse.userData.openClinXrComparatorVisibilityPolicy = nurse.visible
      ? "shown_as_named_subject_for_clean_humanoid_source_comparator_capture"
      : "hidden_for_clean_humanoid_source_comparator_capture_non_named_actor";
  } else if (!clinicalActorId) {
    nurse.visible = false;
  }
  nurse.scale.set(nursePlacement.scale.x, nursePlacement.scale.y, nursePlacement.scale.z);
  if (clinicalActorId) ctx.applyActorFraming(nurse, clinicalActorId);
  if (clinicalActorId) {
    nurse.add(ctx.createActorNameplate(actorNameplateLabel(nursePlacement.labelPrefix, clinicalActorId), 0x2f65a7));
  }
  scene.add(nurse);
  nurse.userData.openClinXrSlotKind = "clinical_team";
  nurse.userData.openClinXrActorPosture = nursePlacement.posture ?? "standing";
  nurse.userData.openClinXrActorId = clinicalActorId;
  nurse.userData.openClinXrBaseHeadingRadians = nurse.rotation.y;
  if (clinicalActorId) {
    loadGeneratedHumanoidIntoActorSlot(ctx.assetLoadingContext(), nurse, {
      assetPath: ctx.resolveAssetUrl(nurseRuntimeHumanoidAsset),
      assetId: nurseRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(nurseRuntimeHumanoidAsset),
      actorId: clinicalActorId,
      roleTintColor: 0x5a9bd5,
      verticalOffsetMeters: nursePlacement.verticalOffsetMeters,
      posture: nursePlacement.posture ?? "standing",
    });
  } else {
    nurse.userData.openClinXrSlotUnfilledReason = "no_unique_clinical_humanoid_for_station";
  }

  const familyActorId = ctx.actorIdForSlot("family_or_observer");
  const spouseRuntimeHumanoidAsset = ctx.humanoidAssetForSlot("family_or_observer");
  const spousePlacement = ctx.actorPlacement(familyActorId || "unfilled_family_or_observer", {
    slotKind: "family_or_observer",
    position: { x: -2.0, y: 0.95, z: 0.7 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Family",
  });
  const spouse = createPrimitiveActorMesh(0xd5a75a);
  spouse.name = iwsdkStationSceneObjects.spouseAnnaHayes;
  spouse.position.set(spousePlacement.position.x, spousePlacement.position.y, spousePlacement.position.z);
  spouse.visible = Boolean(familyActorId) && !ctx.scenarioRuntimeMismatch();
  if (ctx.cleanComparatorCapture()) {
    // #315 follow-up: the parent comparator's named subject is the family actor — show it.
    spouse.visible = comparatorCaptureSubjectActorId(ctx.assetLoadingContext()) === familyActorId;
    spouse.userData.openClinXrComparatorVisibilityPolicy = spouse.visible
      ? "shown_as_named_subject_for_clean_humanoid_source_comparator_capture"
      : "hidden_for_clean_humanoid_source_comparator_capture_non_named_actor";
  } else if (!familyActorId) {
    spouse.visible = false;
  }
  if (ctx.encounterBundle().scenarioId === "peds_asthma_parent_anxiety_v1" && familyActorId) {
    // #591: a SEATED parent stays on her authored family_chair anchor (#574) — moving her
    // XZ off the chair unseats her (pre-fix live: slot (1.42, 0.04) vs chair (−0.55, −0.75),
    // feet 0.256 m above the floor). Standing parents keep the three-actor review reframe.
    if (spousePlacement.posture === "seated") {
      spouse.rotation.y = -0.26;
      spouse.userData.openClinXrDynamicScenePolicy =
        "parent_seated_on_authored_family_chair_anchor_for_visible_three_actor_review";
    } else {
      spouse.position.x = Math.max(spouse.position.x, -1.42);
      spouse.position.z = 0.42;
      spouse.rotation.y = -0.26;
      spouse.userData.openClinXrDynamicScenePolicy = "parent_actor_reframed_from_case_defined_parent_chair_zone_for_visible_three_actor_review";
    }
  }
  // #591: stamp slot identity BEFORE framing — the framing's seated guard reads these, and
  // they were previously written only after applyCleanEncounterVisualReviewActorFraming ran.
  spouse.userData.openClinXrSlotKind = "family_or_observer";
  spouse.userData.openClinXrActorPosture = spousePlacement.posture ?? "standing";
  spouse.userData.openClinXrActorId = familyActorId;
  spouse.scale.set(spousePlacement.scale.x, spousePlacement.scale.y, spousePlacement.scale.z);
  if (familyActorId) ctx.applyActorFraming(spouse, familyActorId);
  if (familyActorId) {
    spouse.add(ctx.createActorNameplate(actorNameplateLabel(spousePlacement.labelPrefix, familyActorId), 0x9b642d));
  }
  scene.add(spouse);
  if (familyActorId) {
    loadGeneratedHumanoidIntoActorSlot(ctx.assetLoadingContext(), spouse, {
      assetPath: ctx.resolveAssetUrl(spouseRuntimeHumanoidAsset),
      assetId: spouseRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(spouseRuntimeHumanoidAsset),
      actorId: familyActorId,
      roleTintColor: 0xd5a75a,
      verticalOffsetMeters: spousePlacement.verticalOffsetMeters,
      posture: spousePlacement.posture ?? "standing",
    });
  } else {
    spouse.userData.openClinXrSlotUnfilledReason = "no_unique_family_humanoid_for_station";
  }

  // #122/#123 fourth slot — placement SSOT (team-adjacent secondary), not doorway hardcode.
  const additionalActorId = ctx.actorIdForSlot("additional_cast");
  const additionalRuntimeHumanoidAsset = ctx.humanoidAssetForSlot("additional_cast");
  const additionalPlacement = ctx.actorPlacement(
    additionalActorId || "unfilled_additional_cast",
    additionalCastPlacementFallback(),
  );
  const additional = createPrimitiveActorMesh(0x7c6bb5);
  additional.name = "runtime_additional_cast_slot";
  additional.position.set(additionalPlacement.position.x, additionalPlacement.position.y, additionalPlacement.position.z);
  additional.visible = Boolean(additionalActorId) && !ctx.scenarioRuntimeMismatch();
  if (ctx.cleanComparatorCapture() || !additionalActorId) {
    additional.visible = false;
    if (ctx.cleanComparatorCapture()) {
      additional.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
    }
  }
  additional.scale.set(additionalPlacement.scale.x, additionalPlacement.scale.y, additionalPlacement.scale.z);
  additional.userData.openClinXrSlotKind = "additional_cast";
  additional.userData.openClinXrActorPosture = additionalPlacement.posture ?? "standing";
  additional.userData.openClinXrActorId = additionalActorId;
  if (additionalActorId) ctx.applyActorFraming(additional, additionalActorId);
  // THE AUTHORED HEADING IS CONSUMED HERE, and it is applied AFTER framing on purpose.
  //
  // headingRadians has existed on the placement type since the heading card and NOTHING read it —
  // authored, then computed from the patient's position, and inert. Brief §7 step 3 asks for it
  // "consumed", which a field nobody applies is not.
  //
  // After framing because framing writes its own yaw for several branches (-0.26 at
  // encounter-actor-framing.ts:137 and :172-179 for three actor kinds). An authored heading is a
  // decision about where this actor looks; a framing default is what happens when nobody decided.
  // The decision wins, and an actor with no authored heading keeps the framing default untouched.
  if (additionalActorId && typeof additionalPlacement.headingRadians === "number") {
    additional.rotation.y = additionalPlacement.headingRadians;
    additional.userData.openClinXrConsumedHeadingRadians = additionalPlacement.headingRadians;
  }
  // The PERSISTENT heading, stamped after everything that writes rotation.y at staging time. The
  // frame loop composes its idle sway onto this instead of assigning over it; without a recorded
  // base there is nothing to compose onto and the first frame discards the placement.
  additional.userData.openClinXrBaseHeadingRadians = additional.rotation.y;
  if (additionalActorId) {
    additional.add(ctx.createActorNameplate(actorNameplateLabel(additionalPlacement.labelPrefix, additionalActorId), 0x5b4a9a));
  }
  scene.add(additional);
  if (additionalActorId) {
    loadGeneratedHumanoidIntoActorSlot(ctx.assetLoadingContext(), additional, {
      assetPath: ctx.resolveAssetUrl(additionalRuntimeHumanoidAsset),
      assetId: additionalRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(additionalRuntimeHumanoidAsset),
      actorId: additionalActorId,
      roleTintColor: 0x7c6bb5,
      verticalOffsetMeters: additionalPlacement.verticalOffsetMeters,
      posture: additionalPlacement.posture ?? "standing",
    });
  } else {
    additional.userData.openClinXrSlotUnfilledReason = "no_remaining_unique_humanoid_for_additional_slot";
  }
  const slotEvidence = ctx.readActorSlotAssignment();
  if (slotEvidence) {
    scene.userData.openClinXrNotStagedActorIds = slotEvidence.notStagedActorIds;
    scene.userData.openClinXrActorSlotAssignment = slotEvidence;
  }

  return { patient, nurse };
}
