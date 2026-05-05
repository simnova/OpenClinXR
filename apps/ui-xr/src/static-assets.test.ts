import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static browser assets", () => {
  it("declares a local favicon to keep headset browser smoke logs clean", () => {
    const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(indexHtml).toContain('rel="icon"');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(existsSync(new URL("../public/favicon.svg", import.meta.url))).toBe(true);
  });

  it("keeps Three.js imports explicit so the headset bundle remains tree-shakeable", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).not.toContain('import * as THREE from "three"');
    expect(mainSource).toContain('} from "three"');
  });

  it("exposes an explicit immersive VR entry path for Quest Browser", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(runtimeStateSource).toContain("Phase 1 Full VR");
    expect(mainSource).toContain("__openClinXrExperienceModeEvidence");
    expect(mainSource).toContain("Enter Full VR");
    expect(mainSource).toContain('requestSession("immersive-vr"');
    expect(mainSource).not.toContain('requestSession("immersive-ar"');
    expect(mainSource).toContain('"hand-tracking"');
    expect(mainSource).toContain("renderer.xr.enabled = true");
    expect(mainSource).toContain("renderer.setAnimationLoop");
    expect(mainSource).toContain("isImmersiveFrameEvidenceActive");
    expect(mainSource).toContain("requestAnimationFrame(() => updateManualEvidencePanel())");
    expect(mainSource).toContain("__openClinXrXrEntryEvidence");
    expect(mainSource).toContain("recordXrEntryEvidence");
    expect(mainSource).toContain("lastError");
  });

  it("does not resize the renderer while an immersive headset session is presenting", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("renderer.xr.isPresenting");
    expect(mainSource.indexOf("renderer.xr.isPresenting")).toBeLessThan(mainSource.indexOf("renderer.setSize(width, height, false)"));
  });

  it("renders clinical text and controller affordances inside the immersive scene", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("CanvasTexture");
    expect(mainSource).toContain("createReadableVrTextPanel");
    expect(mainSource).toContain("iwsdkStationSceneObjects.clinicalPanel");
    expect(mainSource).toContain("iwsdkStationSceneObjects.dialoguePanel");
    expect(mainSource).toContain("iwsdkStationSceneObjects.inputPanel");
    expect(mainSource).toContain("renderer.xr.getController");
    expect(mainSource).toContain("XRControllerModelFactory");
    expect(mainSource).toContain("renderer.xr.getControllerGrip");
    expect(mainSource).toContain("openclinxr.ed-chest-pain.controller-ray");
    expect(mainSource).toContain('"select"');
    expect(mainSource).toContain("xr_controller_select");
    expect(mainSource).toContain("completeNextTraceActionFromXrSelect");
    expect(mainSource).toContain("iwsdkStationSceneObjects.controllerGripLeft");
    expect(mainSource).toContain("iwsdkStationSceneObjects.controllerGripRight");
  });

  it("raises and offsets in-scene text panels for clearer desktop visual QA", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("clockMesh.position.set(0.9, 3.35, -1.2)");
    expect(mainSource).toContain("panel.mesh.position.set(-1.55, 2.62, -1.42)");
    expect(mainSource).toContain("dialoguePanel.mesh.position.set(0.85, 2.58, -1.42)");
    expect(mainSource).toContain("inputPanel.mesh.position.set(0.45, 1.72, -1.08)");
    expect(mainSource).toContain("inputPanel.mesh.rotation.y = 0");
  });

  it("adds primitive hand models and experimental locomotion affordances", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("XRHandModelFactory");
    expect(mainSource).toContain("renderer.xr.getHand");
    expect(mainSource).toContain("primitiveHandModelProfile");
    expect(mainSource).toContain('createHandModel(hand, primitiveHandModelProfile)');
    expect(mainSource).not.toContain('createHandModel(hand, "boxes")');
    expect(mainSource).toContain("openclinxr.ed-chest-pain.hand-model");
    expect(mainSource).toContain("installHandModelsOnce");
    expect(mainSource).toContain("handModelStatus");
    expect(mainSource).toContain("__openClinXrBootEvidence");
    expect(mainSource).toContain("applyLocomotion");
    expect(mainSource).toContain("readXrGamepadLocomotion");
    expect(mainSource).toContain("readXrHandGestureLocomotion");
    expect(mainSource).toContain("handGestureDwellMs");
    expect(mainSource).toContain("other_locomotion_source_active");
    expect(mainSource).toContain("Gesture: armed");
    expect(mainSource).toContain("Trace hand select");
    expect(mainSource).toContain("xr_hand_select");
    expect(mainSource).toContain("createXrHandSelectState");
    expect(mainSource).toContain("maybeCompleteTraceActionFromHandSelect");
    expect(mainSource).toContain("xr_hand_gesture");
    expect(mainSource).toContain("xrHandGestureState");
    expect(mainSource).toContain("fallbackAnimationLoop");
    expect(mainSource).toContain("immersiveFramesObserved");
    expect(mainSource).toContain("previewFramesObserved");
    expect(mainSource).toContain("__openClinXrInputEvidence");
  });

  it("exposes a local manual-performance evidence export panel", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(runtimeStateSource).toContain("buildManualPerformanceCaptureSummary");
    expect(mainSource).toContain("__openClinXrManualPerformanceCaptureSummary");
    expect(mainSource).toContain("manual-evidence-json");
    expect(mainSource).toContain("copy-evidence-button");
    expect(mainSource).toContain("evidence-trace");
    expect(mainSource).toContain("evidence-validation");
    expect(mainSource).toContain("updateManualEvidencePanel");
    expect(mainSource).toContain("hand rep");
    expect(mainSource).toContain("attempt");
    expect(mainSource).toContain("frameStatsFresh");
    expect(mainSource).toContain("window.setInterval(updateManualEvidencePanel, 1000)");
    expect(mainSource).toContain("manualPerformanceDraft");
    expect(mainSource).toContain("__OPENCLINXR_UI_XR_APP_METADATA__");
    expect(mainSource).toContain("buildRuntimeReproducibilityEvidence");
    expect(runtimeStateSource).toContain("buildManualPerformanceReproducibility");
    expect(runtimeStateSource).toContain("browser_reported_metadata_not_device_firmware_proof");
    expect(runtimeStateSource).toContain("manualValidationReady");
    expect(runtimeStateSource).toContain("frame_stats_stale_or_unsampled");
    expect(mainSource).toContain("navigator.clipboard.writeText");
  });

  it("surfaces runtime provider and mode evidence without adding remote dependencies", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(runtimeStateSource).toContain("buildRuntimeEvidencePosture");
    expect(mainSource).toContain("__openClinXrRuntimeEvidencePosture");
    expect(mainSource).toContain("runtime-posture-grid");
    expect(mainSource).toContain("posture-model");
    expect(mainSource).toContain("posture-voice");
    expect(mainSource).toContain("posture-quest");
    expect(mainSource).toContain("posture-mr");
    expect(mainSource).toContain("Mock model/voice active");
  });

  it("names station scene objects for future IWSDK scene hierarchy checks", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("scene.name = iwsdkStationSceneObjects.stationRoot");
    expect(mainSource).toContain("patient.name = iwsdkStationSceneObjects.patientRobertHayes");
    expect(mainSource).toContain("nurse.name = iwsdkStationSceneObjects.nurseMariaAlvarez");
    expect(mainSource).toContain("spouse.name = iwsdkStationSceneObjects.spouseAnnaHayes");
    expect(mainSource).toContain("monitor.name = iwsdkStationSceneObjects.monitor");
  });

  it("loads only the active scenario fixture subpath in the headset app", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");
    const headsetSources = `${mainSource}\n${runtimeStateSource}`;

    expect(headsetSources).not.toContain('from "@openclinxr/scenario-fixtures"');
    expect(headsetSources).toContain('from "@openclinxr/scenario-fixtures/ed-chest-pain"');
  });

  it("keeps the Portless dev script aligned to the injected app port", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["dev:portless"]).toBe("vite --host 127.0.0.1 --port ${PORT:-5173} --strictPort");
  });

  it("bounds the desktop XR stage to the viewport while letting the runtime panel scroll", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.station-shell\s*{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.stage\s*{[^}]*height:\s*100vh;[^}]*min-height:\s*0;/s);
    expect(styles).toMatch(/#station-canvas\s*{[^}]*height:\s*100vh;[^}]*min-height:\s*0;/s);
    expect(styles).toMatch(/\.runtime-panel\s*{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.station-shell\s*{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.stage\s*{[^}]*height:\s*56vh;[^}]*min-height:\s*56vh;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.runtime-panel\s*{[^}]*height:\s*auto;[^}]*overflow-y:\s*visible;/s);
  });
});
