import { readFileSync } from "node:fs";
import type { EncounterRuntimeAsset, LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import type { AssetLoadingContext } from "@openclinxr/xr-asset-loading";
import * as assetLoading from "@openclinxr/xr-asset-loading";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actorNameplateLabel,
  runtimeGeneratedSceneObjectName,
  type StationActorSlotKind,
  type StationActorStagingContext,
  stageStationActors,
} from "./actor-staging.js";
import {
  applyStagedPatientRootTransform,
  defaultPatientActorPlacement,
  resolveRuntimeActorPlacement,
} from "./index.js";

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
      setActorSlotByActor: () => {},
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

const ORIGIN_MAIN_PATIENT_STAGING_GOLDEN_TREE = "2997b8ba698f091ed7aaea22681930b4f0b2568b";
const ORIGIN_MAIN_PATIENT_STAGING_GOLDEN = {
  ed_chest_pain_priority_v1: {
    position: [-0.72, 1.06, -0.12],
    quaternion: [0, -0.24740395925452294, 0, 0.9689124217106447],
    scale: [1.1, 1.1, 1.1],
    userData: {
      openClinXrSlotKind: "primary_patient",
      openClinXrActorPosture: "supine",
      openClinXrPreserveResolvedPlacement: true,
      openClinXrConsumedHeadingRadians: undefined,
      openClinXrBaseHeadingRadians: -0.5,
    },
  },
  ob_headache_preeclampsia_triage_v1: {
    position: [-0.72, 1.06, -0.12],
    quaternion: [0, -0.24740395925452294, 0, 0.9689124217106447],
    scale: [1.1, 1.1, 1.1],
    userData: {
      openClinXrSlotKind: "primary_patient",
      openClinXrActorPosture: "standing",
      openClinXrPreserveResolvedPlacement: false,
      openClinXrConsumedHeadingRadians: undefined,
      openClinXrBaseHeadingRadians: -0.5,
    },
  },
  peds_asthma_parent_anxiety_v1: {
    position: [-0.12, 0.9, -1.05],
    quaternion: [0, -0.24740395925452294, 0, 0.9689124217106447],
    scale: [0.82, 0.82, 0.82],
    userData: {
      openClinXrSlotKind: "primary_patient",
      openClinXrActorPosture: "standing",
      openClinXrPreserveResolvedPlacement: false,
      openClinXrConsumedHeadingRadians: undefined,
      openClinXrBaseHeadingRadians: -0.5,
    },
  },
} as const;

function stageShippedPatient(scenarioId: keyof typeof ORIGIN_MAIN_PATIENT_STAGING_GOLDEN): {
  state: {
    position: number[];
    quaternion: number[];
    scale: number[];
    userData: Record<string, unknown>;
  };
  slotKindSeenByFraming: unknown;
} {
  const bundle = JSON.parse(readFileSync(
    new URL(`../../../../apps/ui-xr/public/xr-assets/generated/${scenarioId}/learner-runtime-bundle.v1.json`, import.meta.url),
    "utf8",
  )) as LearnerRuntimeAssetBundle;
  const patientPlacement = Object.entries(bundle.sceneManifest.actorPlacements)
    .find(([, placement]) => placement.slotKind === "primary_patient");
  if (!patientPlacement) throw new Error(`${scenarioId} has no primary patient placement`);
  const [patientActorId] = patientPlacement;
  const ctx = buildCtx({
    scenarioId,
    actors: {
      primary_patient: patientActorId,
      clinical_team: "",
      family_or_observer: "",
      additional_cast: "",
    },
  });
  vi.spyOn(ctx, "encounterBundle").mockReturnValue(bundle);
  vi.spyOn(ctx, "actorPlacement").mockImplementation((actorId, fallback) => ({
    ...fallback,
    ...bundle.sceneManifest.actorPlacements[actorId],
    posture: bundle.sceneManifest.actorPlacements[actorId]?.posture ?? fallback.posture ?? "standing",
  }));
  let slotKindSeenByFraming: unknown;
  vi.spyOn(ctx, "applyActorFraming").mockImplementation((actor) => {
    slotKindSeenByFraming = actor.userData["openClinXrSlotKind"];
    actor.rotation.y = -0.5;
  });
  const { patient } = stageStationActors(ctx, new Scene());
  const userData = Object.fromEntries([
    "openClinXrSlotKind",
    "openClinXrActorPosture",
    "openClinXrPreserveResolvedPlacement",
    "openClinXrConsumedHeadingRadians",
    "openClinXrBaseHeadingRadians",
  ].map((key) => [key, patient.userData[key]]));
  return {
    state: {
      position: patient.position.toArray(),
      quaternion: patient.quaternion.toArray(),
      scale: patient.scale.toArray(),
      userData,
    },
    slotKindSeenByFraming,
  };
}

describe("stageStationActors", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } } as never);
    vi.spyOn(assetLoading, "loadGeneratedHumanoidIntoActorSlot").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports stageStationActors", async () => {
    const mod = await import("./actor-staging.js");
    expect(typeof mod.stageStationActors).toBe("function");
  });

  it("keeps shipped ED, OB, and peds patient staging equivalent to the origin/main inline path", () => {
    // Recorded first by running these three shipped bundles through origin/main's byte-exact
    // stageStationActors at tree 2997b8ba698f091ed7aaea22681930b4f0b2568b, before the shared
    // transform replaced that inline path. This checked-in golden is not a test reimplementation.
    expect(ORIGIN_MAIN_PATIENT_STAGING_GOLDEN_TREE).toHaveLength(40);
    for (const scenarioId of Object.keys(ORIGIN_MAIN_PATIENT_STAGING_GOLDEN) as Array<keyof typeof ORIGIN_MAIN_PATIENT_STAGING_GOLDEN>) {
      const actual = stageShippedPatient(scenarioId);
      expect(actual.state).toEqual(ORIGIN_MAIN_PATIENT_STAGING_GOLDEN[scenarioId]);
      expect(actual.slotKindSeenByFraming).toBeUndefined();
    }
  });

  it("keeps the app staging path ordered framing before authored patient heading", () => {
    const ctx = buildCtx();
    vi.spyOn(ctx, "actorPlacement").mockImplementation((_actorId, fallback) => ({
      ...fallback,
      posture: "standing",
      headingRadians: 0.25,
    }));
    let slotKindSeenByFraming: unknown;
    vi.spyOn(ctx, "applyActorFraming").mockImplementation((actor, actorId) => {
      if (actorId !== SLOT_ACTORS.primary_patient) return;
      slotKindSeenByFraming = actor.userData["openClinXrSlotKind"];
      actor.rotation.y = -0.5;
    });
    const { patient } = stageStationActors(ctx, new Scene());
    expect(slotKindSeenByFraming).toBeUndefined();
    expect(patient.userData["openClinXrConsumedHeadingRadians"]).toBe(0.25);
    expect(patient.userData["openClinXrBaseHeadingRadians"]).toBe(0.25);
    expect(patient.rotation.y).toBeCloseTo(0.25);
  });

  it("resolves runtime placement through the named placement export", () => {
    const bundle = {
      sceneManifest: {
        actorPlacements: {
          patient_v1: {
            slotKind: "primary_patient",
            position: { x: -0.4, y: 0.8, z: 0.2 },
            scale: { x: 0.9, y: 0.9, z: 0.9 },
            verticalOffsetMeters: -0.7,
            labelPrefix: "Patient",
            posture: "standing",
          },
        },
      },
    } as unknown as Pick<LearnerRuntimeAssetBundle, "sceneManifest">;
    const placement = resolveRuntimeActorPlacement({
      bundle,
      actorId: "patient_v1",
      fallback: {
        slotKind: "primary_patient",
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        verticalOffsetMeters: -1,
        labelPrefix: "Patient",
      },
      scenarioId: "test_scenario_v1",
      environmentId: "test_room_v1",
      patientChairSeatHeightMeters: 0.48,
    });
    expect(placement.position).toEqual({ x: -0.4, y: 0.8, z: 0.2 });
    expect(placement.scale).toEqual({ x: 0.9, y: 0.9, z: 0.9 });
    expect(placement.posture).toBe("standing");
  });

  it("resolves the patient root through the same placement and framing order as station staging", () => {
    const bundle = {
      sceneManifest: {
        actorPlacements: {
          patient_v1: {
            slotKind: "primary_patient",
            position: { x: -0.72, y: 1.06, z: -0.12 },
            scale: { x: 1.1, y: 1.1, z: 1.1 },
            verticalOffsetMeters: -0.98,
            labelPrefix: "Patient",
            posture: "standing",
            headingRadians: 0.25,
          },
        },
      },
    } as unknown as Pick<LearnerRuntimeAssetBundle, "sceneManifest">;
    const placement = resolveRuntimeActorPlacement({
      bundle,
      actorId: "patient_v1",
      fallback: defaultPatientActorPlacement,
      scenarioId: "test_scenario_v1",
      environmentId: "test_room_v1",
      patientChairSeatHeightMeters: 0.48,
    });
    const patient = new Group();
    applyStagedPatientRootTransform({
      patient,
      placement,
      patientActorId: "patient_v1",
      applyActorFraming: (actor, actorId, framedPlacement) => {
        expect(actorId).toBe("patient_v1");
        expect(actor.userData["openClinXrActorPosture"]).toBe("standing");
        expect(framedPlacement.headingRadians).toBe(0.25);
        actor.rotation.y = -0.5;
      },
    });
    expect(patient.position.toArray()).toEqual([-0.72, 1.06, -0.12]);
    expect(patient.scale.toArray()).toEqual([1.1, 1.1, 1.1]);
    expect(patient.quaternion.y).toBeCloseTo(Math.sin(0.125));
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

  it("gives clinical framing the authored standing placement before it can choose a fallback", () => {
    const seen: Record<string, unknown> = {};
    stageStationActors(buildCtx({
      applyActorFraming: (actor, actorId) => {
        if (actorId === SLOT_ACTORS.clinical_team) {
          seen["posture"] = actor.userData["openClinXrActorPosture"];
          seen["intent"] = actor.userData["openClinXrPreserveResolvedPlacement"];
          seen["slot"] = actor.userData["openClinXrSlotKind"];
        }
      },
    }), new Scene());
    expect(seen).toEqual({ posture: "standing", intent: false, slot: "clinical_team" });
  });

  it("publishes every staged actor slot before an asynchronous humanoid load can finish", () => {
    const scene = new Scene();
    const ctx = buildCtx({
      applyActorFraming: (actor) => {
        actor.position.x += 0.123;
      },
    });
    const snapshots = new Map<string, { inScene: boolean; position: [number, number, number]; supportReadiness: unknown }>();
    const setActorSlotByActor = vi.fn();
    setActorSlotByActor.mockImplementation((actorId: string, root: Group) => {
      snapshots.set(actorId, {
        inScene: scene.children.includes(root),
        position: root.position.toArray(),
        supportReadiness: root.userData["openClinXrSupportReadiness"],
      });
    });
    const loading = ctx.assetLoadingContext();
    vi.spyOn(ctx, "assetLoadingContext").mockReturnValue({
      ...(loading as unknown as Record<string, unknown>),
      setActorSlotByActor,
    } as unknown as AssetLoadingContext);
    vi.mocked(assetLoading.loadGeneratedHumanoidIntoActorSlot).mockImplementation((_loading, root, input) => {
      expect(setActorSlotByActor, `${input.actorId} must be published before its loader starts`).toHaveBeenCalledWith(
        input.actorId,
        root,
      );
    });

    // beforeEach deliberately replaces the GLB loader with a no-op. The slot map therefore has to
    // be complete from synchronous scene staging; waiting for a successful asset callback makes
    // frozen-plan admission race network/decode order and fall back to the world origin.
    stageStationActors(ctx, scene);

    const roots = rootsByKind(scene);
    expect(assetLoading.loadGeneratedHumanoidIntoActorSlot).toHaveBeenCalledTimes(4);
    expect(setActorSlotByActor).toHaveBeenCalledTimes(4);
    for (const [kind, actorId] of Object.entries(SLOT_ACTORS) as Array<[StationActorSlotKind, string]>) {
      const root = roots.get(kind);
      expect(root, kind).toBeInstanceOf(Group);
      expect(scene.children).toContain(root);
      expect(root!.position.length(), `${kind} must be framed away from the origin`).toBeGreaterThan(0);
      expect(setActorSlotByActor).toHaveBeenCalledWith(actorId, root);
      expect(snapshots.get(actorId)).toEqual({
        inScene: true,
        position: root!.position.toArray(),
        supportReadiness: "unobserved",
      });
    }
  });

  it("does not publish an empty actor id for an unfilled staged slot", () => {
    const scene = new Scene();
    const actors = { ...SLOT_ACTORS, additional_cast: "" };
    const ctx = buildCtx({ actors });
    const setActorSlotByActor = vi.fn();
    const loading = ctx.assetLoadingContext();
    vi.spyOn(ctx, "assetLoadingContext").mockReturnValue({
      ...(loading as unknown as Record<string, unknown>),
      setActorSlotByActor,
    } as unknown as AssetLoadingContext);

    stageStationActors(ctx, scene);

    const roots = rootsByKind(scene);
    expect(assetLoading.loadGeneratedHumanoidIntoActorSlot).toHaveBeenCalledTimes(3);
    expect(setActorSlotByActor).toHaveBeenCalledTimes(3);
    for (const kind of ["primary_patient", "clinical_team", "family_or_observer"] as const) {
      expect(setActorSlotByActor).toHaveBeenCalledWith(actors[kind], roots.get(kind));
    }
    expect(setActorSlotByActor).not.toHaveBeenCalledWith("", expect.anything());
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
