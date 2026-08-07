import { describe, expect, it } from "vitest";
import {
  assignRuntimeActorSlots,
  filledStagedActorIds,
  MAX_VISIBLE_HUMANOID_SLOTS,
} from "./runtime-actor-slots.js";

describe("assignRuntimeActorSlots (#122)", () => {
  it("never stages the same person twice (oncology / telehealth shape)", () => {
    const a = assignRuntimeActorSlots([
      { actorId: "patient_david_miller_v1", role: "patient" },
      { actorId: "sister_rachel_miller_v1", role: "family" },
    ]);
    const filled = filledStagedActorIds(a);
    expect(filled).toEqual(["patient_david_miller_v1", "sister_rachel_miller_v1"]);
    expect(new Set(filled).size).toBe(filled.length);
    expect(a.clinicalTeamActorId).toBe("");
    expect(a.familyActorId).toBe("sister_rachel_miller_v1");
    expect(a.notStagedActorIds).toEqual([]);
  });

  it("stages physician as clinical or additional — not silently dropped (ward)", () => {
    const a = assignRuntimeActorSlots([
      { actorId: "patient_margaret_ellis_v1", role: "patient" },
      { actorId: "daughter_lena_ellis_v1", role: "family" },
      { actorId: "ward_nurse_patel_v1", role: "nurse" },
      { actorId: "senior_resident_ward_v1", role: "physician" },
    ]);
    const filled = filledStagedActorIds(a);
    expect(filled).toHaveLength(4);
    expect(filled).toContain("senior_resident_ward_v1");
    expect(new Set(filled).size).toBe(4);
    expect(a.patientActorId).toBe("patient_margaret_ellis_v1");
    expect(a.clinicalTeamActorId).toBe("ward_nurse_patel_v1");
    expect(a.familyActorId).toBe("daughter_lena_ellis_v1");
    expect(a.additionalActorId).toBe("senior_resident_ward_v1");
    expect(a.notStagedActorIds).toEqual([]);
  });

  it("ED bay still stages three distinct people", () => {
    const a = assignRuntimeActorSlots([
      { actorId: "patient_robert_hayes_v1", role: "patient" },
      { actorId: "spouse_anna_hayes_v1", role: "family" },
      { actorId: "nurse_maria_alvarez_v1", role: "nurse" },
    ]);
    const filled = filledStagedActorIds(a);
    expect(filled).toHaveLength(3);
    expect(new Set(filled).size).toBe(3);
    expect(a.patientActorId).toBe("patient_robert_hayes_v1");
    expect(a.clinicalTeamActorId).toBe("nurse_maria_alvarez_v1");
    expect(a.familyActorId).toBe("spouse_anna_hayes_v1");
  });

  it("records residual when humanoids exceed max slots", () => {
    const actors = [
      { actorId: "p", role: "patient" },
      { actorId: "n", role: "nurse" },
      { actorId: "f", role: "family" },
      { actorId: "d1", role: "physician" },
      { actorId: "d2", role: "consultant" },
    ];
    const a = assignRuntimeActorSlots(actors, { maxVisibleSlots: 3 });
    expect(filledStagedActorIds(a)).toHaveLength(3);
    expect(a.notStagedActorIds.map((n) => n.actorId).sort()).toEqual(["d1", "d2"]);
    for (const n of a.notStagedActorIds) {
      expect(n.reason.length).toBeGreaterThan(0);
    }
  });

  it("skips virtual_device and voice_only", () => {
    const a = assignRuntimeActorSlots([
      { actorId: "patient_x", role: "patient" },
      { actorId: "phone", role: "system", embodiment: "virtual_device" },
      { actorId: "voice", role: "nurse", embodiment: "voice_only" },
      { actorId: "nurse_y", role: "nurse" },
    ]);
    expect(filledStagedActorIds(a)).toEqual(["patient_x", "nurse_y"]);
  });

  it("exposes four slot capacity by default", () => {
    expect(MAX_VISIBLE_HUMANOID_SLOTS).toBe(4);
  });
});
