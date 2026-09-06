/**
 * #525 — product-path interior lighting variants exist; default stays control.
 */
import { describe, expect, it } from "vitest";
import { Scene, type WebGLRenderer } from "three";
import {
  applyStationInteriorLighting,
  resolveStationInteriorLightingVariantId,
  STATION_INTERIOR_LIGHTING_VARIANT_IDS,
} from "./station-interior-lighting.js";

describe("station-interior-lighting (#525)", () => {
  it("resolves unknown/absent to control — does not invent a shipped pick", () => {
    expect(resolveStationInteriorLightingVariantId(null)).toBe("control");
    expect(resolveStationInteriorLightingVariantId("")).toBe("control");
    expect(resolveStationInteriorLightingVariantId("not-a-variant")).toBe("control");
    expect(resolveStationInteriorLightingVariantId("lab_ambient_fill")).toBe("lab_ambient_fill");
  });

  it("exposes control plus at least two candidates", () => {
    expect(STATION_INTERIOR_LIGHTING_VARIANT_IDS.length).toBeGreaterThanOrEqual(3);
    expect(STATION_INTERIOR_LIGHTING_VARIANT_IDS).toContain("control");
  });

  it("control adds hemisphere + key on the product scene (no WebGL required for light graph)", () => {
    const scene = new Scene();
    const renderer = {} as unknown as WebGLRenderer;
    const result = applyStationInteriorLighting({
      scene,
      renderer,
      variantId: "control",
      ambientLightName: "ambient",
      keyLightName: "key",
      keyCastShadow: false,
    });
    expect(result.variantId).toBe("control");
    expect(result.lights.length).toBeGreaterThanOrEqual(2);
    expect(scene.children.some((c) => c.name === "ambient")).toBe(true);
    expect(scene.children.some((c) => c.name === "key")).toBe(true);
  });

  it("lab_ambient_fill adds ambient + key + counter-fill on the product path", () => {
    const scene = new Scene();
    const renderer = {} as unknown as WebGLRenderer;
    applyStationInteriorLighting({
      scene,
      renderer,
      variantId: "lab_ambient_fill",
      ambientLightName: "ambient",
      keyLightName: "key",
      keyCastShadow: false,
    });
    const roles = scene.children
      .filter((c) => c.userData?.openClinXrStationInteriorLighting === true)
      .map((c) => c.userData.openClinXrStationInteriorLightingRole);
    expect(roles).toEqual(expect.arrayContaining(["ambient", "key", "fill"]));
  });
});
