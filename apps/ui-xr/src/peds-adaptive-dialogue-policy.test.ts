import { describe, expect, it } from "vitest";
import { resolvePedsAdaptiveDialogueBranch } from "./peds-adaptive-dialogue-policy.js";

describe("peds adaptive dialogue policy", () => {
  it("escalates when history is taken before work-of-breathing assessment", () => {
    const branch = resolvePedsAdaptiveDialogueBranch("inhaler_history", [], "peds_asthma_parent_anxiety_v1");
    expect(branch).toMatchObject({
      policyTrigger: "ignored_breathing",
      branchType: "escalation",
      adaptiveTraceTags: ["urgent_escalation", "parent_communication"],
      emotionTransition: { from: "frightened", to: "frightened" },
    });
  });

  it("deescalates after breathing assessment when oxygen is requested", () => {
    const branch = resolvePedsAdaptiveDialogueBranch(
      "oxygen_request",
      ["work_of_breathing_assessment"],
      "peds_asthma_parent_anxiety_v1",
    );
    expect(branch).toMatchObject({
      policyTrigger: "breathing_effort_acknowledged",
      branchType: "deescalation",
      adaptiveTraceTags: ["empathy_statement"],
      emotionTransition: { from: "anxious", to: "reassured" },
    });
  });

  it("returns null for unrelated scenarios", () => {
    expect(resolvePedsAdaptiveDialogueBranch("oxygen_request", [], "ed_chest_pain_priority_v1")).toBeNull();
  });
});