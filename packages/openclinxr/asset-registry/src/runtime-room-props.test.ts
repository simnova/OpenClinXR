import { describe, expect, it } from "vitest";

import { ENVIRONMENT_SHELL_DESCRIPTORS } from "./index.js";
import { defaultPostureForEnvironmentSlot } from "./actor-posture-mod.js";
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
    "telehealth_home_visit_v1",
    "primary_care_clinic_v1",
    "ed_stroke_bay_v1",
  ])("does not inject the ED prop set into %s", (environmentId) => {
    expect(roomPropsForEnvironment(environmentId)).toEqual([]);
  });

  it("mounts the support required by the recumbent stroke patient", () => {
    const slots = ENVIRONMENT_SHELL_DESCRIPTORS["ed_stroke_bay_v1"]?.fixtureSlots ?? [];
    expect(slots.some((slot) => slot.slotId === "stretcher")).toBe(true);
    expect(slots.map((slot) => slot.slotId)).toEqual(expect.arrayContaining(["door_leaf", "wall_board", "learner_start"]));
    expect(defaultPostureForEnvironmentSlot({
      environmentId: "ed_stroke_bay_v1",
      scenarioId: "ed_stroke_alert_handoff_v1",
      slotKind: "primary_patient",
    })).toBe("supine");
  });
});
