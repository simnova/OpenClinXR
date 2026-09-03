import { describe, expect, it } from "vitest";
import {
  learnerVisiblePedsDialogueForTraceTag,
  pedsAddressableFirstNames,
  resolvePedsTurnByAddress,
} from "./peds-authored-turn-surface.js";

describe("learner-visible Peds authored turns", () => {
  it("shows Maya, Tara, and Kevin as separately addressable speakers", () => {
    expect(pedsAddressableFirstNames()).toEqual(["Maya", "Tara", "Kevin"]);

    const maya = resolvePedsTurnByAddress("Maya, can you show me how hard it feels to breathe?");
    const tara = resolvePedsTurnByAddress("Tara, what changed before this started?");
    const kevin = resolvePedsTurnByAddress("Kevin, please start oxygen now.");

    expect(maya).toMatchObject({
      actorId: "patient_maya_johnson_v1",
      displayName: "Maya Johnson",
      authoredBindingId: "peds_patient_work_of_breathing",
      spokenText: "It feels tight when I breathe.",
      caption: "It feels tight when I breathe.",
      affect: "anxious",
      learnerVisibleText: "Maya Johnson: It feels tight when I breathe.",
    });
    expect(tara).toMatchObject({
      actorId: "parent_tara_johnson_v1",
      displayName: "Tara Johnson",
      authoredBindingId: "peds_parent_trigger_history",
      learnerVisibleText: "Tara Johnson: I am really worried about Maya's breathing.",
      affect: "anxious",
    });
    expect(kevin).toMatchObject({
      actorId: "nurse_kevin_lee_v1",
      displayName: "Kevin Lee",
      authoredBindingId: "peds_nurse_oxygen_escalation",
      learnerVisibleText: "Kevin Lee: I am starting oxygen and keeping her positioned upright.",
      affect: "concerned",
    });
  });

  it("uses authored captions on learner-visible trace tags, never Jordan/Tanya stand-ins", () => {
    expect(learnerVisiblePedsDialogueForTraceTag("work_of_breathing_assessment")).toBe(
      "Maya Johnson: It feels tight when I breathe.",
    );
    expect(learnerVisiblePedsDialogueForTraceTag("parent_communication")).toBe(
      "Tara Johnson: I am really worried about Maya's breathing.",
    );
    expect(learnerVisiblePedsDialogueForTraceTag("oxygen_request")).toBe(
      "Kevin Lee: I am starting oxygen and keeping her positioned upright.",
    );
    expect(learnerVisiblePedsDialogueForTraceTag("work_of_breathing_assessment")).not.toContain("Jordan");
    expect(learnerVisiblePedsDialogueForTraceTag("parent_communication")).not.toContain("Tanya");
  });
});
