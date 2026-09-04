import { readFileSync } from "node:fs";
import { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import type { EncounterRuntimeAsset } from "@openclinxr/asset-registry/runtime-bundles";
import {
  mountStationEnvironmentForRuntime,
  resolveCompiledRoomFromRuntimeEnvironment,
} from "./compiled-room-runtime-mount.js";
import { resolveStationEnvironment } from "./station-environment.js";

/**
 * Compiled room GLB from encounter materialization is the learner-visible shell.
 * Parametric `buildStationEnvironment` is the fallback when the URL is absent.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness
 */

const ED_BAY = "ed_exam_bay_v1";
const TELEHEALTH = "telehealth_home_visit_v1";

function mockLoadGltf(url: string): Promise<Group> {
  const root = new Group();
  root.userData.mockSourceUrl = url;
  return Promise.resolve(root);
}

function hasParametricFloor(root: Group): boolean {
  let found = false;
  root.traverse((obj) => {
    if (obj.name === "openclinxr.station-environment.floor") found = true;
  });
  return found;
}

describe("the compiled room GLB replaces the parametric shell", () => {
  it("two environmentIds produce two compileNodeId tags and do not spawn the parametric box", async () => {
    const ed = await resolveStationEnvironment({
      environmentId: ED_BAY,
      compiledRoomAssetUrl: "/compiled/rooms/ed_exam_bay_v1.glb",
      compileNodeId: "room:ed_exam_bay_v1",
      loadGltf: mockLoadGltf,
    });
    const home = await resolveStationEnvironment({
      environmentId: TELEHEALTH,
      compiledRoomAssetUrl: "/compiled/rooms/telehealth_home_visit_v1.glb",
      compileNodeId: "room:telehealth_home_visit_v1",
      loadGltf: mockLoadGltf,
    });

    expect(ed.userData.openClinXrCompiledRoom).toBe(true);
    expect(home.userData.openClinXrCompiledRoom).toBe(true);
    expect(ed.userData.environmentId).toBe(ED_BAY);
    expect(home.userData.environmentId).toBe(TELEHEALTH);
    expect(ed.userData.compileNodeId).toBe("room:ed_exam_bay_v1");
    expect(home.userData.compileNodeId).toBe("room:telehealth_home_visit_v1");
    expect(ed.userData.compileNodeId).not.toBe(home.userData.compileNodeId);
    expect(ed.userData.compiledRoomAssetUrl).toBe("/compiled/rooms/ed_exam_bay_v1.glb");
    expect(home.userData.compiledRoomAssetUrl).toBe(
      "/compiled/rooms/telehealth_home_visit_v1.glb",
    );

    expect(ed.name).toBe("openclinxr.compiled-room-shell");
    expect(home.name).toBe("openclinxr.compiled-room-shell");
    expect(hasParametricFloor(ed)).toBe(false);
    expect(hasParametricFloor(home)).toBe(false);
    expect(ed.children.some((c) => c instanceof Mesh)).toBe(false);
  });

  it("missing URL keeps the parametric path", async () => {
    const shell = await resolveStationEnvironment({ environmentId: ED_BAY });
    expect(shell.userData.openClinXrCompiledRoom).not.toBe(true);
    expect(shell.userData.compileNodeId).toBeUndefined();
    expect(shell.name).toBe("openclinxr.station-environment-shell");
    expect(shell.userData.environmentId).toBe(ED_BAY);
    expect(hasParametricFloor(shell)).toBe(true);
  });
});

function compiledEnvironment(input: {
  environmentId: string;
  url: string;
  storeKind?: EncounterRuntimeAsset["blob"]["storeKind"];
  provenanceRefs?: string[];
  scenarioAssetId?: string;
  reviewStatus?: EncounterRuntimeAsset["reviewStatus"];
}): EncounterRuntimeAsset {
  return {
    assetId: `compiled_${input.environmentId}_room`,
    version: "v1",
    kind: "environment_model",
    displayName: "compiled room",
    scenarioAssetId: input.scenarioAssetId ?? input.environmentId,
    blob: {
      storeKind: input.storeKind ?? "azurite_blob",
      containerName: "openclinxr-assets",
      blobName: `compiled/${input.environmentId}.glb`,
      url: input.url,
    },
    reviewStatus: input.reviewStatus ?? "approved_for_local_runtime",
    provenanceRefs: input.provenanceRefs ?? [`room:${input.environmentId}`],
    notEvidenceFor: ["quest_readiness", "clinical_validity"],
  };
}

describe("the learner runtime path consumes compiled room identity", () => {
  it("mounts two compileNodeId tags from runtime environment assets and skips parametric walls", async () => {
    const ed = await mountStationEnvironmentForRuntime({
      environmentId: ED_BAY,
      environment: compiledEnvironment({
        environmentId: ED_BAY,
        url: "/compiled/rooms/ed_exam_bay_v1.glb",
      }),
      loadGltf: mockLoadGltf,
    });
    const home = await mountStationEnvironmentForRuntime({
      environmentId: TELEHEALTH,
      environment: compiledEnvironment({
        environmentId: TELEHEALTH,
        url: "/compiled/rooms/telehealth_home_visit_v1.glb",
      }),
      loadGltf: mockLoadGltf,
    });
    expect(ed.userData.compileNodeId).toBe("room:ed_exam_bay_v1");
    expect(home.userData.compileNodeId).toBe("room:telehealth_home_visit_v1");
    expect(ed.userData.openClinXrCompiledRoom).toBe(true);
    expect(hasParametricFloor(ed)).toBe(false);
    expect(hasParametricFloor(home)).toBe(false);
  });

  it("keeps fixture local bundles on the parametric fallback", async () => {
    const fixture = createEdChestPainLocalLearnerRuntimeAssetBundle();
    expect(resolveCompiledRoomFromRuntimeEnvironment({
      environmentId: ED_BAY,
      environment: fixture.environment,
    })).toBeNull();
    const shell = await mountStationEnvironmentForRuntime({
      environmentId: ED_BAY,
      environment: fixture.environment,
      loadGltf: mockLoadGltf,
    });
    expect(shell.userData.openClinXrCompiledRoom).not.toBe(true);
    expect(hasParametricFloor(shell)).toBe(true);
  });

  it("refuses a compiled URL whose identity is a different environmentId", async () => {
    const mismatched = compiledEnvironment({
      environmentId: TELEHEALTH,
      url: "/compiled/rooms/telehealth_home_visit_v1.glb",
      provenanceRefs: ["room:telehealth_home_visit_v1"],
      scenarioAssetId: TELEHEALTH,
    });
    expect(resolveCompiledRoomFromRuntimeEnvironment({
      environmentId: ED_BAY,
      environment: mismatched,
    })).toBeNull();
    const shell = await mountStationEnvironmentForRuntime({
      environmentId: ED_BAY,
      environment: mismatched,
      loadGltf: mockLoadGltf,
    });
    expect(shell.userData.compileNodeId).toBeUndefined();
    expect(hasParametricFloor(shell)).toBe(true);
  });

  it("fails if main.ts station mount ignores the compiled runtime adapter", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(mainSource).toContain("mountStationEnvironmentForRuntime");
    expect(mainSource).toContain("await mountStationEnvironmentForRuntime({ environmentId: activeEnvironmentId, environment: encounterRuntimeAssetBundle.environment })");
    expect(mainSource).not.toMatch(
      /const stationEnvironment = buildStationEnvironment\(\{\s*environmentId: activeEnvironmentId\s*\}\)/,
    );
  });
});
