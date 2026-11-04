/**
 * st-vitlearn D4: the learner's humanoid slot loads through the shared
 * skin-shade loader factory; the equipment slot keeps its bare loader.
 */
import { Color, Group, MeshStandardMaterial } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKIN_SHADE_EXTENSION_NAME } from "@openclinxr/xr-scene/skin-shade-loader";
import {
  loadGeneratedEquipmentIntoSceneSlot,
  loadGeneratedHumanoidIntoActorSlot,
} from "./generated-loaders.js";
import { tintGeneratedMaterial } from "./material-tint.js";
import type { AssetLoadingContext } from "./types.js";

const loaderState = vi.hoisted(() => ({
  instances: [] as Array<{ plugins: unknown[]; meshoptDecoder: unknown }>,
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    plugins: unknown[] = [];
    meshoptDecoder: unknown = undefined;
    constructor() {
      loaderState.instances.push(this);
    }
    setMeshoptDecoder(decoder: unknown): void {
      this.meshoptDecoder = decoder;
    }
    register(pluginCallback: unknown): void {
      this.plugins.push(pluginCallback);
    }
    load(): void {}
  },
}));

vi.mock("three/addons/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: { stVitlearnTestStandin: true },
}));

function stubContext(): AssetLoadingContext {
  return {
    runtimeActorRole: () => "patient",
    scenarioId: () => "ed_chest_pain_priority_v1",
    selectedHumanoidSourceComparator: () => null,
    runtimePatientActorId: () => "patient",
    resolveCastPath: (input: { fallbackPath: string }) => input.fallbackPath,
    sourceProvenanceForPath: () => undefined,
    shouldShowPrimitiveFallbacks: () => false,
    registerEquipmentSlot: () => {},
    addPediatricEquipmentCues: () => {},
  } as unknown as AssetLoadingContext;
}

describe("skin-shade loader wiring (st-vitlearn)", () => {
  beforeEach(() => {
    loaderState.instances.length = 0;
  });

  it("registers the OPENCLINXR_skin_shade plugin on the humanoid loader", () => {
    loadGeneratedHumanoidIntoActorSlot(stubContext(), new Group(), {
      assetPath: "/generated-humanoids/mpfb-ob-patient-aisha.glb",
      assetId: "mpfb_ob_patient_aisha",
      objectName: "ob_patient",
      actorId: "patient",
      roleTintColor: 0xffffff,
      verticalOffsetMeters: 0,
    });
    expect(loaderState.instances).toHaveLength(1);
    const humanoidLoader = loaderState.instances[0]!;
    // Factory preserves the bare loader's meshopt behaviour.
    expect(humanoidLoader.meshoptDecoder).toBeDefined();
    expect(humanoidLoader.plugins).toHaveLength(1);
    const plugin = (humanoidLoader.plugins[0] as (parser: unknown) => { name: string })({});
    expect(plugin.name).toBe(SKIN_SHADE_EXTENSION_NAME);
  });

  it("counterweight: the equipment loader carries no skin-shade plugin", () => {
    loadGeneratedEquipmentIntoSceneSlot(stubContext(), new Group(), {
      assetId: "bedside_monitor_equipment",
      assetPath: "/bedside-monitor-generated.glb",
      objectName: "bedside_monitor",
    });
    expect(loaderState.instances).toHaveLength(1);
    const equipmentLoader = loaderState.instances[0]!;
    expect(equipmentLoader.plugins).toHaveLength(0);
    // Bare loader never set meshopt — unchanged by this slice.
    expect(equipmentLoader.meshoptDecoder).toBeUndefined();
  });
});

describe("tint preserves loader-installed program hooks (st-vitlearn)", () => {
  it("carries onBeforeCompile/customProgramCacheKey across the tint clone", () => {
    // The factory installs the skin hook at parse; tintSceneMaterials clones
    // every material before first render, and clone() drops program hooks.
    const source = new MeshStandardMaterial({ color: 0xffffff });
    const hook = (): void => {};
    const key = (): string => "st-vitlearn-hook";
    source.onBeforeCompile = hook;
    source.customProgramCacheKey = key;
    const out = tintGeneratedMaterial(source, new Color(0xffffff));
    expect(out).toBeInstanceOf(MeshStandardMaterial);
    const cloned = out as MeshStandardMaterial;
    expect(cloned).not.toBe(source);
    expect(cloned.onBeforeCompile).toBe(hook);
    expect(cloned.customProgramCacheKey).toBe(key);
  });

  it("still tints an unhooked material", () => {
    const source = new MeshStandardMaterial({ color: 0xffffff });
    const out = tintGeneratedMaterial(source, new Color(0x000000)) as MeshStandardMaterial;
    expect(out).not.toBe(source);
    expect(out.color.getHex()).not.toBe(0xffffff);
  });
});
