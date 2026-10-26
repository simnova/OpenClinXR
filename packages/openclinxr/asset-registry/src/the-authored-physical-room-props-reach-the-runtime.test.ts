import { describe, expect, it } from "vitest";

import { createEdChestPainRuntimeSceneManifest } from "./runtime-bundles-entry.js";

function roomPropsForEnvironment(environmentId: string) {
  return createEdChestPainRuntimeSceneManifest({ environmentId }).roomProps;
}

const PSYCH_PHYSICAL = [
  { propId: "safe-room-soft-chair", position: { x: -0.8, y: 0, z: -0.2 } },
  { propId: "observer-station", position: { x: 1.65, y: 0, z: -1.0 } },
  { propId: "safety-plan-whiteboard", position: { x: 0.4, y: 0, z: -0.95 } },
] as const;

describe("the authored physical room props reach the runtime", () => {
  it("ships the three psych physical props once at authored case positions", () => {
    const props = roomPropsForEnvironment("behavioral_health_private_room_v1");
    expect(props).toHaveLength(3);
    for (const expected of PSYCH_PHYSICAL) {
      const matches = props.filter((prop) => prop.propId === expected.propId);
      expect(matches, expected.propId).toHaveLength(1);
      expect(matches[0]?.position).toEqual(expected.position);
      expect(matches[0]?.generatedBy).toBe("scene_manifest");
      expect(matches[0]?.semanticRole).not.toBe("environmental_detail");
    }
  });

  it("ships the telehealth physical prop offset onto the real laptop-desk top", () => {
    const props = roomPropsForEnvironment("telehealth_home_visit_v1");
    expect(props).toHaveLength(1);
    expect(props[0]?.propId).toBe("telehealth-tablet-stand");
    // Tablet composite is tabletop-offset geometry (bezel local y≈0.9–1.2);
    // mount y=-0.1 + surrounding desk top at 0.76 lands the slab ≈0.76–0.8 m on the
    // real laptop_desk top (x 0.11–0.89, z 0.06–0.54). Floor-rooted y=0 floats it.
    expect(props[0]?.position).toEqual({ x: 0.5, y: -0.1, z: 0.3 });
    expect(props[0]?.generatedBy).toBe("scene_manifest");
    expect(props[0]?.semanticRole).not.toBe("environmental_detail");
    expect(props[0]?.position.y).toBe(-0.1);
  });

  it("floor-roots every psych floor-standing prop so builders land on the floor", () => {
    const props = roomPropsForEnvironment("behavioral_health_private_room_v1");
    // Only floor-standing furniture (chair, desk) is floor-rooted; the wallboard is
    // wall-mounted (position y is a horizontal offset along its mount axis, not height).
    for (const prop of props) {
      if (prop.propId === "safety-plan-whiteboard") continue;
      expect(prop.position.y).toBe(0);
    }
  });

  it("keeps the observer desk composite inside the psych interior", () => {
    const props = roomPropsForEnvironment("behavioral_health_private_room_v1");
    const desk = props.find((p) => p.propId === "observer-station");
    // Builder half-extent x=0.55 (desk 1.1 wide); interior maxX=2.6099, wall≈2.4.
    // centerX 1.65 → extent 1.1–2.2, clear of wall, actors, and nurse box.
    expect(desk?.position.x).toBe(1.65);
    expect((desk?.position.x ?? 0) + 0.55).toBeLessThan(2.4);
  });

  it("leaves known ED/ward sets and unknown-env empty behavior unchanged", () => {
    expect(roomPropsForEnvironment("ed_exam_bay_v1")).toHaveLength(30);
    expect(roomPropsForEnvironment("inpatient_ward_room_v1")).toHaveLength(20);
    expect(roomPropsForEnvironment("primary_care_clinic_v1")).toEqual([]);
  });
});
