import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isActorCloseRealismCaptureMode,
  isActorPoseReviewCaptureMode,
  isGeneratedSceneOverviewCaptureMode,
  isHumanoidFaceDetailCaptureMode,
  isHumanoidMouthGazePoseReviewCaptureMode,
  isPhysicsClinicalTouchCapture,
  isSceneOnlyVisualReviewCaptureMode,
  readSelectedCaptureMode,
  shouldShowInSceneEvidencePanels,
  shouldShowInSceneIdentityLabels,
  shouldShowPrimitiveAssetFallbacks,
  shouldShowRuntimeAffordanceMarkers,
} from "./capture-mode.js";
import { isRealGarmentSleeveDeformCapture } from "./real-garment-capture.js";
import { shouldRenderRoomPropInVisualReview } from "./visual-review-filter.js";
import { shouldShowActorRealismRequirementPanel } from "./evidence-panels.js";
import {
  buildCaseDefinedHumanoidPerformanceContractEvidence,
  formatCaseDefinedHumanoidPerformanceContractEvidence,
  isGeneratedPlaceholderAssetForDifferentScenario,
  isGeneratedPlaceholderSourceForDifferentScenario,
  shouldSuppressGeneratedEnvironmentShell,
  shouldSuppressGeneratedEquipmentModel,
} from "./scene-manifest-evidence.js";
import {
  formatSceneAssetEvidenceStatus,
  formatUnknownError,
  recordSceneAssetStatus,
  recordXrEntryEvidence,
  refreshDeclaredEquipmentMountEvidenceFromScene,
  roundPerformanceNow,
  runtimeAssetAffordanceCueIds,
} from "./scene-asset-evidence.js";
import {
  bundleUsesOnlyApprovedLocalFixtureAssets,
  publishRuntimeActorSlotAssignmentEvidence,
  recordLearnerRuntimeUseGateEvidence,
  resolveRuntimeSlotAssignment,
  runtimeBundleAssets,
  shouldUseLearnerRuntimeAssetBundle,
} from "./learner-runtime-evidence.js";

describe("capture-mode predicates", () => {
  it("reads the capture query params", () => {
    expect(readSelectedCaptureMode("?capture=actor-close")).toBe("actor-close");
    expect(readSelectedCaptureMode("?openclinxrCaptureMode=scene-only")).toBe("scene-only");
    expect(readSelectedCaptureMode("")).toBe("");
  });

  it("classifies capture families", () => {
    expect(isActorCloseRealismCaptureMode("actor-close")).toBe(true);
    expect(isActorCloseRealismCaptureMode("scene-only")).toBe(false);
    expect(isHumanoidFaceDetailCaptureMode("face-detail")).toBe(true);
    expect(isGeneratedSceneOverviewCaptureMode("scene-overview")).toBe(true);
    expect(isActorPoseReviewCaptureMode("pose-review")).toBe(true);
    expect(isHumanoidMouthGazePoseReviewCaptureMode("mouth-gaze-pose", false)).toBe(true);
    expect(isHumanoidMouthGazePoseReviewCaptureMode("scene-only", true)).toBe(true);
    expect(isHumanoidMouthGazePoseReviewCaptureMode("scene-only", false)).toBe(false);
  });

  it("gates physics touch capture on comparator and mode", () => {
    expect(isPhysicsClinicalTouchCapture("physics-touch", "ed_anny_real_garment_patient")).toBe(true);
    expect(isPhysicsClinicalTouchCapture("scene-only", "ed_anny_real_garment_patient")).toBe(false);
    expect(isPhysicsClinicalTouchCapture("physics-touch", "other")).toBe(false);
  });

  it("shows panels only on escape-hatch modes in generated scenes", () => {
    expect(shouldShowInSceneEvidencePanels("panel", true)).toBe(true);
    expect(shouldShowInSceneEvidencePanels("scene-only", true)).toBe(false);
    expect(shouldShowInSceneEvidencePanels("scene-only", false)).toBe(true);
    expect(shouldShowRuntimeAffordanceMarkers("affordance", true)).toBe(true);
    expect(shouldShowPrimitiveAssetFallbacks("fallback", true)).toBe(true);
    expect(shouldShowInSceneIdentityLabels("label", true)).toBe(true);
  });

  it("routes ed-bay-visible away from the scene-only filter", () => {
    expect(isSceneOnlyVisualReviewCaptureMode("ed-bay-visible", false)).toBe(false);
    expect(isSceneOnlyVisualReviewCaptureMode("scene-only", false)).toBe(true);
    expect(isSceneOnlyVisualReviewCaptureMode("scene-only", true)).toBe(true);
  });
});

describe("real-garment capture", () => {
  it("requires a real-garment comparator and a sleeve mode", () => {
    expect(isRealGarmentSleeveDeformCapture("peds_anny_real_garment_patient", "sleeve-deform")).toBe(true);
    expect(isRealGarmentSleeveDeformCapture("peds_anny_real_garment_parent", "garment-sleeve")).toBe(true);
    expect(isRealGarmentSleeveDeformCapture("other", "sleeve-deform")).toBe(false);
    expect(isRealGarmentSleeveDeformCapture("peds_anny_real_garment_patient", "scene-only")).toBe(false);
    expect(isRealGarmentSleeveDeformCapture(null, "sleeve-deform")).toBe(false);
  });
});

describe("visual-review filter", () => {
  it("passes everything outside scene-only review", () => {
    expect(shouldRenderRoomPropInVisualReview({ propId: "x", generatedBy: "other", semanticRole: null } as never, false)).toBe(true);
  });

  it("keeps scene-manifest non-detail props and the essential set", () => {
    expect(shouldRenderRoomPropInVisualReview({ propId: "other", generatedBy: "scene_manifest", semanticRole: "focal" } as never, true)).toBe(true);
    expect(shouldRenderRoomPropInVisualReview({ propId: "oxygen-panel", generatedBy: "other", semanticRole: "environmental_detail" } as never, true)).toBe(true);
    expect(shouldRenderRoomPropInVisualReview({ propId: "other", generatedBy: "other", semanticRole: "environmental_detail" } as never, true)).toBe(false);
  });
});

describe("evidence panels", () => {
  it("hides the realism panel for clean comparator captures", () => {
    expect(shouldShowActorRealismRequirementPanel("scene-only", {}, {
      cleanComparatorCapture: true,
      edBayVisibleCapture: false,
      evidencePanelsVisible: true,
      mouthGazePoseReview: false,
    })).toBe(false);
    expect(shouldShowActorRealismRequirementPanel("actor-realism", {}, {
      cleanComparatorCapture: false,
      edBayVisibleCapture: false,
      evidencePanelsVisible: false,
      mouthGazePoseReview: false,
    })).toBe(true);
  });
});

describe("placeholder suppression", () => {
  const neverFixture = () => false;

  it("detects scenario-mismatched sources", () => {
    expect(isGeneratedPlaceholderSourceForDifferentScenario("other_bundle thing", "my_scenario", true, neverFixture)).toBe(true);
    expect(isGeneratedPlaceholderSourceForDifferentScenario("my_scenario thing", "my_scenario", true, neverFixture)).toBe(false);
    expect(isGeneratedPlaceholderSourceForDifferentScenario("other_bundle thing", "my_scenario", false, neverFixture)).toBe(false);
    expect(isGeneratedPlaceholderSourceForDifferentScenario("other_bundle thing", "my_scenario", true, () => true)).toBe(false);
  });

  it("suppresses placeholder assets and equipment models", () => {
    const asset = { blob: { blobName: "other_bundle", url: "" } } as never;
    expect(isGeneratedPlaceholderAssetForDifferentScenario(asset, "my_scenario", true, neverFixture)).toBe(true);
    expect(shouldSuppressGeneratedEnvironmentShell(asset, () => true)).toBe(true);
    expect(shouldSuppressGeneratedEnvironmentShell(asset, () => false)).toBe(false);
    expect(shouldSuppressGeneratedEquipmentModel("x", () => true, () => true)).toBe(false);
    expect(shouldSuppressGeneratedEquipmentModel("x", () => false, () => true)).toBe(true);
    expect(shouldSuppressGeneratedEquipmentModel("x", () => false, () => false)).toBe(false);
  });
});

describe("scene-asset evidence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } } as never);
    vi.stubGlobal("performance", { now: () => 100 } as never);
  });

  it("formats errors and affordance cue ids", () => {
    expect(formatUnknownError(new Error("boom"))).toContain("boom");
    expect(formatUnknownError("plain")).toBe("plain");
    expect(runtimeAssetAffordanceCueIds("a", ["x"])).toEqual(["a:x"]);
    expect(roundPerformanceNow()).toEqual(expect.any(Number));
  });

  it("records scene assets and formats status", () => {
    const evidence = recordSceneAssetStatus({ assetId: "probe-b", status: "loaded" } as never);
    expect(evidence.expectedAssetCount).toBeGreaterThanOrEqual(1);
    expect(formatSceneAssetEvidenceStatus(evidence)).toContain("generated loaded");
    expect(formatSceneAssetEvidenceStatus(null)).toBe("generated assets pending");
  });

  it("records XR entry attempts", () => {
    recordXrEntryEvidence("requesting");
    recordXrEntryEvidence("started");
    expect(window.__openClinXrXrEntryEvidence?.lastStatus).toBe("started");
    expect(window.__openClinXrXrEntryEvidence?.attempts).toBeGreaterThanOrEqual(1);
  });

  it("refreshes declared equipment mounts from the debug scene", () => {
    const scene = { marker: true } as never;
    (window as unknown as { __openClinXrDebugScene?: unknown }).__openClinXrDebugScene = scene;
    window.__openClinXrDeclaredEquipmentMountEvidence = { source: "window.__openClinXrDeclaredEquipmentMountEvidence", scenarioId: "s", items: [], notEvidenceFor: [] };
    refreshDeclaredEquipmentMountEvidenceFromScene(() => [{ equipmentId: "e", source: "gltf", triangleCount: 1, meshCount: 1 }]);
    expect(window.__openClinXrDeclaredEquipmentMountEvidence?.items).toHaveLength(1);
    refreshDeclaredEquipmentMountEvidenceFromScene(() => []);
    expect(window.__openClinXrDeclaredEquipmentMountEvidence?.items).toHaveLength(1);
  });
});

describe("humanoid performance contract evidence", () => {
  it("builds and formats the case-defined contract", () => {
    const evidence = buildCaseDefinedHumanoidPerformanceContractEvidence("ed_chest_pain_priority_v1");
    expect(evidence.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(evidence.actorCount).toBeGreaterThan(0);
    expect(formatCaseDefinedHumanoidPerformanceContractEvidence(evidence)).toContain("case humanoid contract");
    expect(formatCaseDefinedHumanoidPerformanceContractEvidence(null)).toBe("case humanoid contract pending");
  });
});

describe("learner-runtime evidence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } } as never);
  });

  it("enumerates bundle assets and approves fixtures", () => {
    const fixture = { blob: { storeKind: "app_public_fixture" }, reviewStatus: "approved_for_local_runtime" };
    const bundle = {
      environment: fixture,
      actors: [{ model: fixture, animationClips: [], phonemeMap: null }],
      equipment: [{ model: fixture }],
      uiSurfaces: [],
    } as never;
    expect(runtimeBundleAssets(bundle)).toHaveLength(3);
    expect(bundleUsesOnlyApprovedLocalFixtureAssets(bundle)).toBe(true);
    expect(shouldUseLearnerRuntimeAssetBundle(bundle)).toBe(true);
  });

  it("records the use gate and slot assignment", () => {
    const fixture = { blob: { storeKind: "app_public_fixture" }, reviewStatus: "approved_for_local_runtime" };
    const bundle = {
      bundleId: "b",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "app_public",
      environment: fixture,
      actors: [{ actorId: "a1", role: "patient", embodiment: "humanoid", model: fixture, animationClips: [], phonemeMap: null }],
      equipment: [],
      uiSurfaces: [],
      sceneManifest: { manifestId: "m", schemaVersion: "v", roomProps: [], dialogueTurns: [], actorPlacements: {}, equipmentPlacements: {} },
    } as never;
    const evidence = recordLearnerRuntimeUseGateEvidence(bundle, "local_fixture_fallback", null);
    expect(evidence.bundleId).toBe("b");
    expect(window.__openClinXrLearnerRuntimeUseGateEvidence?.bundleId).toBe("b");
    const slots = resolveRuntimeSlotAssignment(bundle);
    publishRuntimeActorSlotAssignmentEvidence(bundle, slots);
    expect(window.__openClinXrActorSlotAssignment?.scenarioId).toBe("ed_chest_pain_priority_v1");
  });
});
