/**
 * lighting_design rig -> ui-xr runtime wiring.
 * Valid rig overlays lights + exposure; missing/malformed rig falls back
 * to constants (fail closed); capture-shadow key light unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { DirectionalLight, PointLight, Scene, type WebGLRenderer } from "three";
import {
  applyLightingRigOverlay,
  applyStationInteriorLightingForEnvironment,
  colorForTemperatureK,
  loadLightingRig,
  parseLightingRig,
  resolveLightingRigPublicPath,
  rigEnergyToThreeIntensity,
  type FetchLike,
  type LightingRig,
} from "./lighting-rig-runtime.js";

const VALID_RIG: LightingRig = {
  schemaVersion: "openclinxr.lighting-rig.v1",
  room: { environmentId: "ed_exam_bay_v1" },
  bbox: { minX: -1.5, minY: -3, minZ: 0, maxX: 1.5, maxY: 3, maxZ: 2.5 },
  exposure: 1.0,
  lights: [
    { name: "key", type: "area", position: [0, 0, 2.2], energy: 234.6667, size: 1.35, colorTemperatureK: 5000 },
    { name: "fill", type: "point", position: [0, 0, 1.2], energy: 256, size: 0, colorTemperatureK: 5000 },
    { name: "spill", type: "directional", position: [-1.5, -3, 2.5], target: [0, 0, 1.2], energy: 53.3333, size: 0, colorTemperatureK: 5000 },
  ],
};

const okFetch = (payload: unknown): FetchLike => async () => ({
  ok: true,
  json: async () => payload,
});
const missingFetch: FetchLike = async () => ({ ok: false, json: async () => ({}) });

describe("lighting-rig-runtime (lighting_design -> ui-xr)", () => {
  it("resolves the promoted runtime path per environmentId", () => {
    expect(resolveLightingRigPublicPath("ed_exam_bay_v1")).toBe(
      "/xr-assets/lighting/ed_exam_bay_v1.rig.json",
    );
  });

  it("valid rig parses (shipped ed_exam_bay_v1 rig JSON)", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const raw = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "xr-assets", "lighting", "ed_exam_bay_v1.rig.json"), "utf8"),
    ) as unknown;
    const rig = parseLightingRig(raw);
    expect(rig).not.toBeNull();
    expect(rig?.lights.length).toBe(7);
    expect(rig?.exposure).toBe(1.0);
  });

  it("valid rig applies: area->directional, point->point, exposure on renderer", () => {
    const scene = new Scene();
    const renderer = { toneMappingExposure: 0.9 } as unknown as WebGLRenderer;
    const lights = applyLightingRigOverlay({ scene, renderer, rig: VALID_RIG });
    expect(lights.length).toBe(3);
    expect(lights.filter((l) => l instanceof DirectionalLight).length).toBe(2);
    expect(lights.filter((l) => l instanceof PointLight).length).toBe(1);
    expect(renderer.toneMappingExposure).toBe(1.0);
    expect(lights.every((l) => l.userData.openClinXrLightingRig === true)).toBe(true);
    expect(lights.every((l) => l.castShadow === false)).toBe(true);
    const target = (lights[0] as DirectionalLight).target.position;
    expect([target.x, target.y, target.z]).toEqual([0, 0, 1.25]);
  });

  it("missing rig (404) falls back to the requested variant, rigApplied=false", async () => {
    const scene = new Scene();
    const renderer = {} as unknown as WebGLRenderer;
    const result = await applyStationInteriorLightingForEnvironment({
      scene, renderer, environmentId: "no_such_room_v9", variantId: "control",
      ambientLightName: "ambient", keyLightName: "key", keyCastShadow: false,
      fetchImpl: missingFetch,
    });
    expect(result.rigApplied).toBe(false);
    expect(result.variantId).toBe("control");
    expect(scene.children.filter((c) => (c as { isLight?: boolean }).isLight === true).length)
      .toBeGreaterThanOrEqual(2);
  });

  it("malformed rig refuses: wrong schema, empty lights, out-of-range energy", () => {
    expect(parseLightingRig({ schemaVersion: "bogus", lights: [] })).toBeNull();
    expect(parseLightingRig({ schemaVersion: "openclinxr.lighting-rig.v1", lights: [], bbox: VALID_RIG.bbox, exposure: 1 })).toBeNull();
    expect(parseLightingRig({
      schemaVersion: "openclinxr.lighting-rig.v1", bbox: VALID_RIG.bbox, exposure: 1,
      lights: [{ ...VALID_RIG.lights[0], energy: 9999 }],
    })).toBeNull();
    expect(parseLightingRig({
      schemaVersion: "openclinxr.lighting-rig.v1", bbox: VALID_RIG.bbox, exposure: 1,
      lights: [{ ...VALID_RIG.lights[0], type: "laser" }],
    })).toBeNull();
    expect(parseLightingRig(null)).toBeNull();
  });

  it("malformed rig over fetch falls back (existing behavior preserved)", async () => {
    const scene = new Scene();
    const renderer = {} as unknown as WebGLRenderer;
    const result = await applyStationInteriorLightingForEnvironment({
      scene, renderer, environmentId: "ed_exam_bay_v1", variantId: "control",
      ambientLightName: "ambient", keyLightName: "key", keyCastShadow: true,
      fetchImpl: okFetch({ schemaVersion: "bogus" }),
    });
    expect(result.rigApplied).toBe(false);
    const key = scene.children.find((c) => c.name === "key");
    expect(key).toBeDefined();
    expect((key as DirectionalLight).castShadow).toBe(true);
  });

  it("capture key light keeps its contact-shadow frustum when a rig applies", async () => {
    const scene = new Scene();
    const renderer = {} as unknown as WebGLRenderer;
    const result = await applyStationInteriorLightingForEnvironment({
      scene, renderer, environmentId: "ed_exam_bay_v1", variantId: "control",
      ambientLightName: "ambient", keyLightName: "key", keyCastShadow: true,
      fetchImpl: okFetch(VALID_RIG),
    });
    expect(result.rigApplied).toBe(true);
    const key = scene.children.find((c) => c.name === "key") as DirectionalLight | undefined;
    expect(key).toBeDefined();
    expect(key?.castShadow).toBe(true);
    expect(key?.shadow.camera.left).toBe(-6);
    expect(key?.shadow.mapSize.x).toBe(2048);
  });

  it("rig fetch error (throw) falls back without throwing", async () => {
    const throwing: FetchLike = async () => { throw new Error("offline"); };
    expect(await loadLightingRig("ed_exam_bay_v1", throwing)).toBeNull();
  });

  it("indoor ranges enforced: energy/100 clamped, kelvin maps to near-white", () => {
    expect(rigEnergyToThreeIntensity(500)).toBe(5);
    expect(rigEnergyToThreeIntensity(234.6667)).toBeCloseTo(2.35, 2);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(colorForTemperatureK(5000)).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
