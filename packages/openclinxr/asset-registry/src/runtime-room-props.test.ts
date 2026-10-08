import { describe, expect, it } from "vitest";

import { roomPropsForEnvironment } from "./runtime-room-props.js";
import { ENVIRONMENT_SHELL_DESCRIPTORS } from "./environment-descriptors.js";

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

  it("does not place an unused stretcher in the standing stroke handoff", () => {
    const slots = ENVIRONMENT_SHELL_DESCRIPTORS["ed_stroke_bay_v1"]?.fixtureSlots ?? [];
    expect(slots.some((slot) => /stretcher|bed/iu.test(slot.slotId))).toBe(false);
    expect(slots.map((slot) => slot.slotId)).toEqual(expect.arrayContaining(["door_leaf", "wall_board", "learner_start"]));
  });
});
