import type { Group } from "three";
import type { ElementJson } from "@pmndrs/uikitml";

export const uikitmlSpatialTextSourcePath = "ui/spatial-text-readability.uikitml" as const;
export const uikitmlSpatialTextCompiledConfigPath = "/uikitml/spatial-text-readability.json" as const;
export const uikitmlSpatialTextDocumentName = "openclinxr.ed-chest-pain.uikitml-spatial-text-panel" as const;

export type UikitmlSpatialTextStatus =
  | "source_registered"
  | "compiled_json_loaded"
  | "rendered_in_sidecar"
  | "blocked";

export type UikitmlSpatialTextEvidence = {
  source: "window.__openClinXrUikitmlSpatialTextEvidence";
  status: UikitmlSpatialTextStatus;
  sourcePath: typeof uikitmlSpatialTextSourcePath;
  compiledConfigPath: typeof uikitmlSpatialTextCompiledConfigPath;
  documentName: typeof uikitmlSpatialTextDocumentName;
  packageVersions: {
    vite: "8.0.10";
    vitePluginUikitml: "0.3.1";
    pmndrsUikitml: "0.1.12";
    pmndrsUikit: "1.0.66";
  };
  vitePeerCompatibility: {
    pluginPeerRange: "^7.0.0";
    observedViteVersion: "8.0.10";
    status: "peer_mismatch_runtime_verified_by_sidecar_build";
  };
  licensePosture: {
    vitePluginUikitml: "MIT";
    pmndrsUikitml: "MIT";
    pmndrsUikit: "SEE_LICENSE_FILE_MIT_STYLE_TERMS_REVIEWED";
  };
  comparisonScope: "text_readability_comparison_only";
  renderMode: "compile_only" | "uikitml_json_to_uikit_document" | "blocked";
  elementType: string | null;
  classCount: number | null;
  targetWorldMeters: { width: number; height: number };
  readyForQuestTextClaim: false;
  readyForProductionSpatialUi: false;
  error: string | null;
  notEvidenceFor: readonly [
    "quest_text_readiness",
    "production_spatial_ui_adoption",
    "clinical_workflow_readiness",
  ];
};

export type UikitmlSpatialTextRuntimePanel = {
  group: Group;
  update(deltaMs: number): void;
  evidence: UikitmlSpatialTextEvidence;
};

type ParsedUIKitmlConfig = {
  element: ElementJson | string | undefined;
  classes: Record<string, {
    origin?: string;
    content: Record<string, unknown>;
  }>;
};

const targetWorldMeters = { width: 2.4, height: 0.82 } as const;

export function buildUikitmlSpatialTextEvidence(input: {
  status: UikitmlSpatialTextStatus;
  renderMode: UikitmlSpatialTextEvidence["renderMode"];
  elementType?: string | null;
  classCount?: number | null;
  error?: unknown;
}): UikitmlSpatialTextEvidence {
  return {
    source: "window.__openClinXrUikitmlSpatialTextEvidence",
    status: input.status,
    sourcePath: uikitmlSpatialTextSourcePath,
    compiledConfigPath: uikitmlSpatialTextCompiledConfigPath,
    documentName: uikitmlSpatialTextDocumentName,
    packageVersions: {
      vite: "8.0.10",
      vitePluginUikitml: "0.3.1",
      pmndrsUikitml: "0.1.12",
      pmndrsUikit: "1.0.66",
    },
    vitePeerCompatibility: {
      pluginPeerRange: "^7.0.0",
      observedViteVersion: "8.0.10",
      status: "peer_mismatch_runtime_verified_by_sidecar_build",
    },
    licensePosture: {
      vitePluginUikitml: "MIT",
      pmndrsUikitml: "MIT",
      pmndrsUikit: "SEE_LICENSE_FILE_MIT_STYLE_TERMS_REVIEWED",
    },
    comparisonScope: "text_readability_comparison_only",
    renderMode: input.renderMode,
    elementType: input.elementType ?? null,
    classCount: input.classCount ?? null,
    targetWorldMeters: { ...targetWorldMeters },
    readyForQuestTextClaim: false,
    readyForProductionSpatialUi: false,
    error: input.error === undefined ? null : formatUnknownError(input.error),
    notEvidenceFor: [
      "quest_text_readiness",
      "production_spatial_ui_adoption",
      "clinical_workflow_readiness",
    ],
  };
}

export async function createUikitmlSpatialTextPanel(): Promise<UikitmlSpatialTextRuntimePanel> {
  const [{ interpret }, { UIKitDocument }] = await Promise.all([
    import("@pmndrs/uikitml"),
    import("@iwsdk/core"),
  ]);
  const response = await fetch(uikitmlSpatialTextCompiledConfigPath, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`UIKitML compiled config unavailable: ${response.status} ${response.statusText}`);
  }

  const config = await response.json() as ParsedUIKitmlConfig;
  const rootComponent = interpret(config);
  if (!rootComponent) {
    throw new Error("UIKitML interpret returned no root component");
  }

  const document = new UIKitDocument(rootComponent) as Group & {
    setTargetDimensions(width: number, height: number): void;
  };
  document.name = uikitmlSpatialTextDocumentName;
  document.position.set(0, 3.14, -1.76);
  document.rotation.x = -0.025;
  document.renderOrder = 75;
  document.setTargetDimensions(targetWorldMeters.width, targetWorldMeters.height);

  return {
    group: document,
    update(deltaMs: number): void {
      rootComponent.update(deltaMs);
    },
    evidence: buildUikitmlSpatialTextEvidence({
      status: "rendered_in_sidecar",
      renderMode: "uikitml_json_to_uikit_document",
      elementType: typeof config.element === "string" ? "string" : config.element?.type ?? null,
      classCount: Object.keys(config.classes ?? {}).length,
    }),
  };
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
