import type { EncounterRuntimeAsset, LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import type { AssetLoadingContext } from "@openclinxr/xr-asset-loading";
import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene } from "three";
import { Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as assetLoading from "@openclinxr/xr-asset-loading";
import {
  actorNameplateLabel,
  runtimeGeneratedSceneObjectName,
  stageStationActors,
  type StationActorSlotKind,
  type StationActorStagingContext,
} from "./actor-staging.js";

function asset(assetId: string): EncounterRuntimeAsset {
  return {
    assetId,
    version: "v1",
    kind: "humanoid_model",
    displayName: assetId,
    scenarioAssetId: assetId,
    blob: { storeKind: "app_public_fixture", containerName: "fixtures", blobName: `${assetId}.glb`, url: `/xr/${assetId}.glb` },
    reviewStatus: "approved_for_local_runtime",
    provenanceRefs: [],
    notEvidenceFor: [],
  };
}

const SLOT_ACTORS: Record<StationActorSlotKind, string> = {
  primary_patient: "patient_robert_hayes_v1",
  clinical_team: "nurse_maria_alvarez_v1",
  family_or_observer: "spouse_anna_hayes_v1",
  additional_cast: "observer_lee_v1",
};

function buildCtx(overrides: Partial<{
  actors: Record<StationActorSlotKind, string>;
  placements: Partial<Record<StationActorSlotKind, "standing" | "seated">>;
  cleanComparatorCapture: boolean;
  mismatch: boolean;
  scenarioId: string;
  subjectActorId: string;
  applyActorFraming: StationActorStagingContext["applyActorFraming"];
}> = {}): StationActorStagingContext {
  const actors = overrides.actors ?? SLOT_ACTORS;
  const placements = overrides.placements ?? {};
  const bundle = {
    scenarioId: overrides.scenarioId ?? "peds_asthma_parent_anxiety_v1",
    actors: (Object.values(actors) as string[])
      .filter((actorId) => actorId.length > 0)
      .map((actorId) => ({ actorId, embodiment: "humanoid" })),
  } as LearnerRuntimeAssetBundle;
  return {
    encounterBundle: () => bundle,
    slotAssignment: () => ({
      stagedActorIds: Object.values(actors),
      notStagedActorIds: [],
      patientActorId: actors.primary_patient,
      clinicalTeamActorId: actors.clinical_team,
      familyActorId: actors.family_or_observer,
      additionalActorId: actors.additional_cast,
    }),
    assetLoadingContext: () => ({
      scenarioId: () => "ed_chest_pain_priority_v1",
      selectedScenarioId: () => "ed_chest_pain_priority_v1",
      activeEnvironmentId: () => "ed_exam_bay_v1",
      runtimeActorRole: () => undefined,
      selectedHumanoidSourceComparator: () => null,
      runtimePatientActorId: () => actors.primary_patient,
      runtimeClinicalTeamActorId: () => actors.clinical_team,
      runtimeFamilyActorId: () => actors.family_or_observer,
      shouldUseCleanSourceComparatorCapture: () => false,
      isEdBayVisibleComparatorCapture: () => false,
      isMouthGazePoseReviewCaptureMode: () => false,
      isRealGarmentSleeveDeformCapture: () => false,
      isCaptureShadowPath: () => false,
      selectedCaptureMode: () => "",
      shouldShowComparatorDebugFaceCues: () => false,
      resolveCastPath: (input: { fallbackPath: string }) => input.fallbackPath,
      sourceProvenanceForPath: () => undefined,
      resolveEffectiveVerticalOffset: () => 0,
      resolvePosture: () => "standing",
      applyPosture: () => {},
      applySupine: () => {},
      applyClinicalIdle: () => {},
      applyRolePosture: () => {},
      applyRoleWardrobeCue: () => {},
      applyAndPlantSupineDeck: () => {},
      morphTargetsNeutralized: () => {},
      realGarmentSurfaces: () => null,
      sleeveDeformCue: () => undefined,
      suppressOverlaysForComparator: () => {},
      faceReviewCues: () => {},
      frameCaptureOnNamedActor: () => {},
      comparatorSubjectActorId: () => actors.primary_patient,
      recordEdBayCameraPose: () => {},
      clinicalIdleClipPresent: () => false,
      roleClipNames: () => [],
      gazeProbeClipNames: () => [],
      affordanceMarker: () => new Group(),
      detailCues: () => new Group(),
      collisionCues: () => new Group(),
      mouthCue: () => new Group(),
      gazeCue: () => new Group(),
      eyeFocusCue: () => new Group(),
      expressionCue: () => new Group(),
      tintSceneMaterials: () => {},
      recordSceneAsset: () => {},
      markActorCastShadow: () => {},
      seedMouthGazeGarmentGeometry: () => {},
      rolePostureContext: () => ({
        actorRole: () => undefined,
        isPatient: () => false,
        isClinicalTeam: () => false,
        isFamily: () => false,
        isPediatricAsthmaScenario: () => false,
        scenarioId: "ed_chest_pain_priority_v1",
      }),
    }) as unknown as AssetLoadingContext,
    actorPlacement: (_actorId, fallback) => ({
      ...fallback,
      posture: placements[fallback.slotKind] ?? "standing",
    }),
    actorIdForSlot: (slotKind) => actors[slotKind],
    humanoidAssetForSlot: (slotKind) => asset(`${slotKind}_asset`),
    resolveAssetUrl: (a) => `/xr/${a.assetId}.glb`,
    createActorNameplate: () => new Mesh(new PlaneGeometry(0.95, 0.24), new MeshBasicMaterial()),
    applyActorFraming: overrides.applyActorFraming ?? (() => {}),
    createVirtualDeviceActorAffordance: () => new Group(),
    scenarioRuntimeMismatch: () => overrides.mismatch ?? false,
    cleanComparatorCapture: () => overrides.cleanComparatorCapture ?? false,
    readActorSlotAssignment: () => null,
  };
}

function rootsByKind(scene: Scene): Map<string, Group> {
  const roots = new Map<string, Group>();
  for (const child of scene.children) {
    const kind = (child.userData as Record<string, unknown>)["openClinXrSlotKind"];
    if (typeof kind === "string") roots.set(kind, child as Group);
  }
  return roots;
}

describe("stageStationActors", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } } as never);
    vi.spyOn(assetLoading, "loadGeneratedHumanoidIntoActorSlot").mockImplementation(() => {});
  });

  it("exports stageStationActors", async () => {
    const mod = await import("./actor-staging.js");
    expect(typeof mod.stageStationActors).toBe("function");
  });

  it("stamps slot identity, visibility, and nameplates on all four slots", () => {
    const scene = new Scene();
    const { patient, nurse } = stageStationActors(buildCtx(), scene);
    const roots = rootsByKind(scene);
    expect(roots.get("primary_patient")).toBe(patient);
    expect(roots.get("clinical_team")).toBe(nurse);
    for (const [kind, actorId] of [
      ["primary_patient", SLOT_ACTORS.primary_patient],
      ["clinical_team", SLOT_ACTORS.clinical_team],
      ["family_or_observer", SLOT_ACTORS.family_or_observer],
      ["additional_cast", SLOT_ACTORS.additional_cast],
    ] as const) {
      const root = roots.get(kind);
      expect(root, kind).toBeDefined();
      expect(root!.userData["openClinXrSlotKind"]).toBe(kind);
      expect(root!.userData["openClinXrActorPosture"]).toBe("standing");
      expect(root!.userData["openClinXrActorId"]).toBe(actorId);
      expect(root!.userData["openClinXrSlotUnfilledReason"]).toBeUndefined();
      expect(root!.visible).toBe(true);
      expect(root!.children.length).toBeGreaterThan(2);
    }
  });

  it("hides unfilled slots with empty actorId and an unfilled reason", () => {
    const scene = new Scene();
    stageStationActors(buildCtx({ actors: { ...SLOT_ACTORS, additional_cast: "" } }), scene);
    const additional = rootsByKind(scene).get("additional_cast")!;
    expect(additional.userData["openClinXrActorId"]).toBe("");
    expect(additional.visible).toBe(false);
    expect(additional.userData["openClinXrSlotUnfilledReason"]).toBe("no_remaining_unique_humanoid_for_additional_slot");
    expect(additional.children.length).toBe(2);
  });

  it("family identity userData is stamped before applyActorFraming runs (#591 ordering)", () => {
    const seen: Array<Record<string, unknown>> = [];
    const ctx = buildCtx({
      applyActorFraming: (actor) => {
        seen.push({ name: actor.name, ...actor.userData });
      },
    });
    const scene = new Scene();
    stageStationActors(ctx, scene);
    const spouse = rootsByKind(scene).get("family_or_observer")!;
    const atCall = seen.find((entry) => entry["openClinXrActorId"] === SLOT_ACTORS.family_or_observer);
    expect(atCall).toBeDefined();
    expect(atCall!["openClinXrSlotKind"]).toBe("family_or_observer");
    expect(atCall!["openClinXrActorPosture"]).toBe("standing");
    void spouse;
  });

  it("additional_cast stays hidden under clean comparator capture even as named subject, while patient shows (#315)", () => {
    const subject = "shared_subject_actor_v1";
    const loadingForSubject = {
      selectedHumanoidSourceComparator: () => "peds_anny_real_garment_patient",
      runtimePatientActorId: () => subject,
      runtimeClinicalTeamActorId: () => SLOT_ACTORS.clinical_team,
      runtimeFamilyActorId: () => SLOT_ACTORS.family_or_observer,
    };
    const ctxForAdditionalSubject = buildCtx({ cleanComparatorCapture: true, actors: { ...SLOT_ACTORS, additional_cast: subject } });
    vi.spyOn(ctxForAdditionalSubject, "assetLoadingContext").mockReturnValue({
      ...(ctxForAdditionalSubject.assetLoadingContext() as unknown as Record<string, unknown>),
      ...loadingForSubject,
    } as unknown as AssetLoadingContext);
    const additionalScene = new Scene();
    stageStationActors(ctxForAdditionalSubject, additionalScene);
    const additional = rootsByKind(additionalScene).get("additional_cast")!;
    expect(additional.visible).toBe(false);
    expect(additional.userData["openClinXrComparatorVisibilityPolicy"]).toBe(
      "hidden_for_clean_humanoid_source_comparator_capture",
    );
    const ctxForPatientSubject = buildCtx({ cleanComparatorCapture: true, actors: { ...SLOT_ACTORS, primary_patient: subject } });
    vi.spyOn(ctxForPatientSubject, "assetLoadingContext").mockReturnValue({
      ...(ctxForPatientSubject.assetLoadingContext() as unknown as Record<string, unknown>),
      ...loadingForSubject,
    } as unknown as AssetLoadingContext);
    const patientScene = new Scene();
    stageStationActors(ctxForPatientSubject, patientScene);
    const patient = rootsByKind(patientScene).get("primary_patient")!;
    expect(patient.visible).toBe(true);
    expect(patient.userData["openClinXrComparatorVisibilityPolicy"]).toBe(
      "shown_as_named_subject_for_clean_humanoid_source_comparator_capture",
    );
  });

  it("seated family placement produces the reseat and standing does not (#591)", () => {
    const seatedScene = new Scene();
    stageStationActors(buildCtx({ placements: { family_or_observer: "seated" } }), seatedScene);
    const seatedSpouse = rootsByKind(seatedScene).get("family_or_observer")!;
    expect(seatedSpouse.userData["openClinXrDynamicScenePolicy"]).toBe(
      "parent_seated_on_authored_family_chair_anchor_for_visible_three_actor_review",
    );

    const standingScene = new Scene();
    stageStationActors(buildCtx({ placements: { family_or_observer: "standing" } }), standingScene);
    const standingSpouse = rootsByKind(standingScene).get("family_or_observer")!;
    expect(standingSpouse.userData["openClinXrDynamicScenePolicy"]).toBe(
      "parent_actor_reframed_from_case_defined_parent_chair_zone_for_visible_three_actor_review",
    );
    expect(standingSpouse.position.z).toBe(0.42);
  });

  it("moves the pure helpers with identical output", () => {
    expect(actorNameplateLabel("Patient", "patient_robert_hayes_v1")).toBe("Patient: patient robert hayes");
    expect(runtimeGeneratedSceneObjectName(asset("some Asset/Id"))).toBe("some-Asset-Id");
  });
});
