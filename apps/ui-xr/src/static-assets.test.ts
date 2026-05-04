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

    expect(runtimeStateSource).toContain("Phase 1 VR");
    expect(mainSource).toContain("__openClinXrExperienceModeEvidence");
    expect(mainSource).toContain("Enter VR");
    expect(mainSource).toContain('requestSession("immersive-vr"');
    expect(mainSource).not.toContain('requestSession("immersive-ar"');
    expect(mainSource).toContain('"hand-tracking"');
    expect(mainSource).toContain("renderer.xr.enabled = true");
    expect(mainSource).toContain("renderer.setAnimationLoop");
  });

  it("renders clinical text and controller affordances inside the immersive scene", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("CanvasTexture");
    expect(mainSource).toContain("openclinxr.ed-chest-pain.in-vr-clinical-panel");
    expect(mainSource).toContain("renderer.xr.getController");
    expect(mainSource).toContain("openclinxr.ed-chest-pain.controller-ray");
  });

  it("adds primitive hand models and experimental locomotion affordances", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("XRHandModelFactory");
    expect(mainSource).toContain("renderer.xr.getHand");
    expect(mainSource).toContain("openclinxr.ed-chest-pain.hand-model");
    expect(mainSource).toContain("installHandModelsOnce");
    expect(mainSource).toContain("handModelStatus");
    expect(mainSource).toContain("__openClinXrBootEvidence");
    expect(mainSource).toContain("applyLocomotion");
    expect(mainSource).toContain("readXrGamepadLocomotion");
    expect(mainSource).toContain("fallbackAnimationLoop");
    expect(mainSource).toContain("__openClinXrInputEvidence");
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
});
