import { describe, expect, it } from "vitest";

import { ENVIRONMENT_SHELL_DESCRIPTORS } from "./index.js";
import { resolveActorPosture } from "./actor-posture.js";
import { createEdChestPainRuntimeSceneManifest } from "./runtime-bundles-entry.js";

function roomPropsForEnvironment(environmentId: string) {
  return createEdChestPainRuntimeSceneManifest({ environmentId }).roomProps;
}

describe("environment-owned room props", () => {
  it("keeps the detailed prop sets on the two environments that own them", () => {
    expect(roomPropsForEnvironment("ed_exam_bay_v1").length).toBeGreaterThan(20);
    expect(roomPropsForEnvironment("inpatient_ward_room_v1").length).toBeGreaterThan(10);
  });

  it.each([
    "adult_ed_abdominal_bay_v1",
    "primary_care_clinic_v1",
    "ed_stroke_bay_v1",
  ])("does not inject the ED prop set into %s", (environmentId) => {
    expect(roomPropsForEnvironment(environmentId)).toEqual([]);
  });

  it("ships the one supported telehealth physical prop at its authored case position", () => {
    const props = roomPropsForEnvironment("telehealth_home_visit_v1");
    expect(props).toHaveLength(1);
    expect(props[0]?.propId).toBe("telehealth-tablet-stand");
    expect(props[0]?.position).toEqual({ x: 0.5, y: -0.1, z: 0.3 });
    expect(props[0]?.generatedBy).toBe("scene_manifest");
    expect(props[0]?.semanticRole).toBe("scenario_context");
  });

  it("mounts the support required by the recumbent stroke patient", () => {
    const slots = ENVIRONMENT_SHELL_DESCRIPTORS["ed_stroke_bay_v1"]?.fixtureSlots ?? [];
    expect(slots.some((slot) => slot.slotId === "stretcher")).toBe(true);
    expect(slots.map((slot) => slot.slotId)).toEqual(expect.arrayContaining(["door_leaf", "wall_board", "learner_start"]));
    expect(resolveActorPosture({
      environmentId: "ed_stroke_bay_v1",
      scenarioId: "ed_stroke_alert_handoff_v1",
      slotKind: "primary_patient",
    })).toBe("supine");
  });
});
