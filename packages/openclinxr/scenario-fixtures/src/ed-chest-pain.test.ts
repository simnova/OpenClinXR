import { validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "./index.js";

describe("ED chest pain fixture", () => {
  it("is approved, multi-actor, and schema-valid", () => {
    expect(validateScenario(edChestPainScenario).ok).toBe(true);
    expect(edChestPainScenario.actors.map((actor) => actor.role)).toEqual(["patient", "family", "nurse"]);
    expect(edChestPainScenario.requiredTraceTags).toContain("ecg_request");
    expect(edChestPainScenario.requiredTraceTags).toContain("team_communication");
  });

  it("contains asset and environment guidance for downstream XR work", () => {
    expect(edChestPainScenario.environment?.name).toBe("Emergency Department Exam Bay");
    expect(edChestPainScenario.equipment).toContain("12-lead ECG machine");
    expect((edChestPainScenario.assetNeeds ?? []).some((asset) => asset.assetType === "character")).toBe(true);
  });
});
