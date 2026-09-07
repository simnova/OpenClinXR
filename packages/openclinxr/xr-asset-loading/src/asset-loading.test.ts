import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addActorSpecificIdentityVariantCue,
  addRoleSpecificHumanoidVisuals,
  addScenarioSpecificClinicalTeamCue,
  addScenarioSpecificFamilyCue,
  addScenarioSpecificPatientCue,
  configureSemanticRolePoseOverlay,
  readSelectedHumanoidSourceComparator,
  runtimeHumanoidVariantAssetPath,
  shouldShowProceduralHumanoidDetailCues,
  tintGeneratedMaterial,
  tintGeneratedSceneMaterials,
} from "./index.js";
import type { AssetLoadingContext } from "./types.js";

function stubContext(overrides: Partial<AssetLoadingContext> = {}): AssetLoadingContext {
  const recorded: Array<{ actorId: string; cueId: string; sceneObjectName: string }> = [];
  return {
    scenarioId: () => "ed_chest_pain_priority_v1",
    encounterBundle: () => ({}) as AssetLoadingContext["encounterBundle"] extends () => infer T ? T : never,
    scenarioTheme: () => ({
      backgroundColor: 0x151b22,
      floorColor: 0x59636b,
      panelBackground: "#f1f5f9",
      panelAccent: "#dc2626",
      reusedAssetAccentColor: 0xdc2626,
    }),
    sceneObjectPrefix: () => "openclinxr.ed_chest_pain_priority_v1",
    runtimeActorRole: (actorId: string) => (actorId === "patient" ? "patient" : "nurse"),
    runtimePatientActorId: () => "patient",
    runtimeClinicalTeamActorId: () => "nurse",
    runtimeFamilyActorId: () => "family",
    isPediatricAsthmaScenario: () => false,
    selectedCaptureMode: () => "",
    selectedHumanoidSourceComparator: () => null,
    shouldShowAffordanceMarkers: () => false,
    shouldUseCleanSourceComparatorCapture: () => false,
    isEdBayVisibleComparatorCapture: () => false,
    shouldShowComparatorDebugFaceCues: () => false,
    isMouthGazePoseReviewCaptureMode: () => false,
    isCaptureShadowPath: () => false,
    isRealGarmentSleeveDeformCapture: () => false,
    recordBootPhase: () => {},
    roleCueEvidence: () => ({ scenarioId: "ed_chest_pain_priority_v1", runtimeActorRole: () => undefined }),
    pediatricEvidence: () => ({ scenarioId: "ed_chest_pain_priority_v1" }),
    pediatricEquipment: () => ({ scenarioObjectPrefix: "openclinxr.ed", isPediatricScenario: () => false }),
    humanoidCues: () => ({ scenarioObjectPrefix: "openclinxr.ed", shouldShowAffordanceMarkers: () => false }),
    clinicalPanel: () => ({
      clinicalPanelObjectName: "panel",
      evidenceStore: new Map(),
      clinicalPanelLines: () => [],
      buildTextPanelEvidence: () => {
        throw new Error("not used in asset-loading tests");
      },
    }),
    createReadablePanel: () => ({ mesh: new Mesh() }) as never,
    recordRoleDistinctCue: (actorId, cueId, sceneObjectName) => {
      recorded.push({ actorId, cueId, sceneObjectName });
    },
    recordPediatricEquipmentCue: () => {},
    addPediatricEquipmentCues: () => {},
    sourceProvenanceForPath: () => undefined,
    resolveCastPath: (input) => input.fallbackPath,
    normalizeEquipmentMount: (equipment) => equipment,
    prepareEnvironmentShell: () => ({}),
    animationSlots: () => [],
    pushAnimationSlot: () => {},
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    registerTouchRegions: () => {},
    triggerDialogue: () => {},
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    schedulePedsPlaybackIfReady: () => {},
    touchResponseClipNames: () => [],
    roleClipNames: () => [],
    gazeProbeClipNames: () => [],
    morphTargetsNeutralized: () => {},
    realGarmentSurfaces: () => null,
    sleeveDeformCue: () => undefined,
    suppressOverlaysForComparator: () => {},
    faceReviewCues: () => {},
    frameCaptureOnNamedActor: () => {},
    comparatorSubjectActorId: () => "patient",
    recordEdBayCameraPose: () => {},
    resolveEffectiveVerticalOffset: () => 0,
    resolvePosture: () => "standing",
    activeEnvironmentId: () => "ed_exam_bay_v1",
    applyPosture: () => {},
    applySupine: () => {},
    applyClinicalIdle: () => {},
    applyRolePosture: () => {},
    applyRoleWardrobeCue: () => {},
    tintSceneMaterials: () => {},
    clinicalIdleClipPresent: () => false,
    seatedClipPlayable: () => false,
    translationBoneNames: () => [],
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: 0 }),
    seatedChairHeight: () => 0.45,
    findStretcherInScene: () => null,
    applyAndPlantSupineDeck: () => {},
    stretcherDeckTopWorldY: () => 0.8,
    humanoidDialogueDurationMs: () => 1000,
    createEmotionState: () => ({
      currentEmotion: "neutral",
      targetEmotion: "neutral",
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      transitionStartedAtMs: 0,
      transitionDurationMs: 0,
    }),
    affordanceMarker: () => new Group() as never,
    detailCues: () => new Group(),
    collisionCues: () => new Group(),
    mouthCue: () => new Group() as never,
    gazeCue: () => new Group() as never,
    eyeFocusCue: () => new Group(),
    expressionCue: () => new Group(),
    recordSceneAsset: () => {},
    affordanceCueIds: (_assetId, cueIds) => cueIds,
    shouldSuppressEquipmentModel: () => false,
    shouldShowPrimitiveFallbacks: () => false,
    refreshEquipmentMountEvidence: () => {},
    applyEquipmentTraceVisuals: () => {},
    environmentStatePresent: () => false,
    rolePostureContext: () => ({
      actorRole: () => undefined,
      isPatient: () => false,
      isClinicalTeam: () => false,
      isFamily: () => false,
      isPediatricAsthmaScenario: () => false,
      scenarioId: "ed_chest_pain_priority_v1",
    }),
    seedMouthGazeGarmentGeometry: () => {},
    markActorCastShadow: () => {},
    clinicalTouchScenario: () => undefined,
    selectedScenarioId: () => "ed_chest_pain_priority_v1",
    scenarioForId: () => undefined,
    actorMetadataRoleClipNames: () => [],
    registerEquipmentSlot: () => {},
    ...overrides,
  };
}

describe("xr-asset-loading", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } } as never);
    vi.stubGlobal("performance", { now: () => 100 } as never);
  });

  it("reads the comparator from the query string", () => {
    expect(readSelectedHumanoidSourceComparator("?humanoidSourceComparator=peds_anny_real_garment_patient")).toBe(
      "peds_anny_real_garment_patient",
    );
    expect(readSelectedHumanoidSourceComparator("?humanoidSourceComparator=nope")).toBeNull();
  });

  it("routes the default cast through the cast SSOT", () => {
    const ctx = stubContext();
    expect(runtimeHumanoidVariantAssetPath(ctx, "nurse", "/fallback.glb")).toBe("/fallback.glb");
  });

  it("hides procedural role cues for generated GLB normal runtime", () => {
    const ctx = stubContext();
    expect(shouldShowProceduralHumanoidDetailCues(ctx, "generated_glb")).toBe(false);
    expect(shouldShowProceduralHumanoidDetailCues(ctx, "primitive_fallback")).toBe(true);
  });

  it("attaches patient role visuals without affordance markers", () => {
    const ctx = stubContext({ shouldShowAffordanceMarkers: () => true });
    const humanoid = new Group();
    addRoleSpecificHumanoidVisuals(ctx, humanoid, "patient");
    expect(humanoid.children.length).toBeGreaterThan(3);
  });

  it("attaches identity variant metadata without readiness claims", () => {
    const ctx = stubContext();
    const humanoid = new Group();
    addActorSpecificIdentityVariantCue(ctx, humanoid, "patient");
    expect((humanoid.userData as Record<string, unknown>)["openClinXrActorSpecificIdentityVariantCue"]).toBeDefined();
  });

  it("adds scenario patient cues only for known scenarios", () => {
    const ctx = stubContext({ scenarioId: () => "ob_headache_preeclampsia_triage_v1" });
    const humanoid = new Group();
    addScenarioSpecificPatientCue(ctx, humanoid, "patient");
    expect(humanoid.children.length).toBe(1);
    addScenarioSpecificClinicalTeamCue(ctx, humanoid, "nurse");
    addScenarioSpecificFamilyCue(ctx, humanoid, "family");
    expect(humanoid.children.length).toBeGreaterThanOrEqual(1);
  });

  it("hides semantic role overlays unless affordance markers show", () => {
    const ctx = stubContext();
    const mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial({ color: 0xffffff }));
    configureSemanticRolePoseOverlay(ctx, mesh, "cue");
    expect(mesh.visible).toBe(false);
  });

  it("tints cloned materials without mutating the source", () => {
    const material = new MeshStandardMaterial({ color: 0xffffff });
    const tinted = tintGeneratedMaterial(material, new Color(0x000000));
    expect(tinted).not.toBe(material);
    const group = new Group();
    tintGeneratedSceneMaterials(group, 0xff0000);
    expect(group.children.length).toBe(0);
  });
});
