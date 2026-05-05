import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildUikitmlSpatialTextEvidence,
  uikitmlSpatialTextCompiledConfigPath,
  uikitmlSpatialTextDocumentName,
  uikitmlSpatialTextSourcePath,
} from "./uikitml-spatial-text.js";

const appRoot = join(import.meta.dirname, "..");

describe("UIKitML spatial text sidecar posture", () => {
  it("keeps the UIKitML spike sidecar-only with exact approved package versions", () => {
    const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    const rootPackageJson = JSON.parse(readFileSync(join(appRoot, "..", "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.devDependencies).toMatchObject({
      "@iwsdk/vite-plugin-uikitml": "0.3.1",
      "@pmndrs/uikitml": "0.1.12",
      "@pmndrs/uikit": "1.0.66",
      vite: "8.0.10",
    });
    expect({ ...rootPackageJson.dependencies, ...rootPackageJson.devDependencies }).not.toHaveProperty(
      "@iwsdk/vite-plugin-uikitml",
    );
    expect({ ...rootPackageJson.dependencies, ...rootPackageJson.devDependencies }).not.toHaveProperty("@pmndrs/uikit");
  });

  it("documents the Vite 8 peer mismatch and avoids Quest readiness claims", () => {
    const evidence = buildUikitmlSpatialTextEvidence({
      status: "rendered_in_sidecar",
      renderMode: "uikitml_json_to_uikit_document",
      elementType: "custom",
      classCount: 5,
    });

    expect(evidence).toMatchObject({
      sourcePath: uikitmlSpatialTextSourcePath,
      compiledConfigPath: uikitmlSpatialTextCompiledConfigPath,
      documentName: uikitmlSpatialTextDocumentName,
      comparisonScope: "text_readability_comparison_only",
      readyForQuestTextClaim: false,
      readyForProductionSpatialUi: false,
      vitePeerCompatibility: {
        pluginPeerRange: "^7.0.0",
        observedViteVersion: "8.0.10",
        status: "peer_mismatch_runtime_verified_by_sidecar_build",
      },
    });
    expect(evidence.notEvidenceFor).toContain("quest_text_readiness");
    expect(evidence.notEvidenceFor).toContain("production_spatial_ui_adoption");
  });

  it("wires the Vite plugin to compile reviewed .uikitml source into public generated JSON", () => {
    const viteConfig = readFileSync(join(appRoot, "vite.config.ts"), "utf8");
    const source = readFileSync(join(appRoot, uikitmlSpatialTextSourcePath), "utf8");

    expect(viteConfig).toContain("compileUIKit");
    expect(viteConfig).toContain("openClinXrIwsdkSpikeUIKitmlSourceDir");
    expect(viteConfig).toContain("openClinXrIwsdkSpikeUIKitmlOutputDir");
    expect(source).toContain('id="openclinxr-uikitml-readability-panel"');
    expect(source).toContain("Evidence scope: sidecar text readability only");
  });
});
