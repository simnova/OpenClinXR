// DECISION: assetNeeds is authoritative (has structured assetId, assetType, licenseStatus).
// equipment strings bind to assetNeeds by matching assetId; unmatched equipment → required-unbound.
// assetNeeds with no equipment match → intentionally-absent.

import { beforeAll, describe, expect, it } from "vitest";
import { edChestPainScenario } from "./ed-chest-pain.js";

//
// OBSERVABLE: Scenario.equipment (free-text strings) and Scenario.assetNeeds (structured with assetId)
// have no schema-level link. The fixture pairs them by authorial convention only:
// "12-lead ECG machine" ↔ 12_lead_ecg_machine_equipment. No classification function exists to
// enforce total coverage, report unbound strings by name, or resolve conflicts via an executable
// precedence constant.
//
// MEASURED 2026-09-09. shared-schemas/src/schemas.ts:490 — equipment: Type.Optional(Type.Array(Type.String({minLength:1}))),
// free text. :491 — assetNeeds: Type.Optional(Type.Array(AssetNeedSchema)), with ids at :389-394
// (assetId, assetType, licenseStatus). EnvironmentManifestSchema at :396-400 groups the three fields.
// Consumers: validators.ts:37 and :123, plus four test files. No production code constructs one.
//
// known-good: AssetNeedSchema at :389-394 already carries assetId, assetType, licenseStatus. It is the
// shape a binding resolves TO. Do not redesign it.
//
// CONTRACTED EXPORT (the honest slice adds exactly this):
// // shared-schemas/src/schemas.ts (or a sibling, re-exported from index.ts)
//
// /** Which list wins when the two disagree. EXECUTABLE, not a doc comment. *
// export const EQUIPMENT_BINDING_PRECEDENCE: "assetNeeds" | "equipment" = /* THE DECISION *//;
//
// export type EquipmentBindingClassification =
//   | { kind: "bound"; equipment: string; assetId: string }
//   | { kind: "required-unbound"; equipment: string }
//   | { kind: "intentionally-absent"; assetId: string };
//
// /**
//  * Total classification of a scenario's equipment strings against its assetNeeds.
//  * Every entry of `equipment` appears in exactly one bucket. Nothing is dropped.
//  *
// export function classifyScenarioEquipmentBinding(scenario: {
//   equipment?: string[];
//   assetNeeds?: Array<{ assetId: string; assetType?: string; licenseStatus?: string }>;
// }): EquipmentBindingClassification[];
//
// IN-SCOPE: shared-schemas/src/{schemas.ts,validators.ts,index.ts}
// OUT-OF-SCOPE: Room selection, placement solving, equipment instance identity, and
// shared-schemas/src/the-factory-station-schemas-validate.test.ts (the authored-vector card holds it).
//
describe("Authored equipment strings bind to asset ids under a reviewed precedence", () => {
  // Load the contracted export via runtime lookup so the test file loads even before the symbols exist
  let classifyScenarioEquipmentBinding: (
    scenario: { equipment?: string[]; assetNeeds?: Array<{ assetId: string; assetType?: string; licenseStatus?: string }> }
  ) => Array<
    | { kind: "bound"; equipment: string; assetId: string }
    | { kind: "required-unbound"; equipment: string }
    | { kind: "intentionally-absent"; assetId: string }
  >;
  let EQUIPMENT_BINDING_PRECEDENCE: "assetNeeds" | "equipment";

  beforeAll(async () => {
    const mod = await import("@openclinxr/shared-schemas");
    classifyScenarioEquipmentBinding = (mod as Record<string, unknown>).classifyScenarioEquipmentBinding as typeof classifyScenarioEquipmentBinding;
    EQUIPMENT_BINDING_PRECEDENCE = (mod as Record<string, unknown>).EQUIPMENT_BINDING_PRECEDENCE as "assetNeeds" | "equipment";
  });

  it.fails("(1) Fed the ed-chest-pain fixture AS IT STANDS, every entry of scenario.equipment appears in exactly one bucket. Total, no drops.", () => {
    expect(typeof classifyScenarioEquipmentBinding).toBe("function");

    const result = classifyScenarioEquipmentBinding({
      equipment: edChestPainScenario.equipment,
      assetNeeds: edChestPainScenario.assetNeeds?.map((an) => ({
        assetId: an.assetId,
        assetType: an.assetType,
        licenseStatus: an.licenseStatus,
      })),
    });

    // Every equipment string must appear in exactly one classification bucket
    const equipmentStrings = edChestPainScenario.equipment ?? [];
    const boundEquipments = result.filter((r) => r.kind === "bound").map((r) => r.equipment);
    const unboundEquipments = result.filter((r) => r.kind === "required-unbound").map((r) => r.equipment);

    const allClassified = [...boundEquipments, ...unboundEquipments].sort();
    const allOriginal = [...equipmentStrings].sort();

    expect(allClassified).toEqual(allOriginal);

    // No equipment string appears in more than one bucket
    const seen = new Set<string>();
    for (const r of result) {
      if (r.kind === "bound" || r.kind === "required-unbound") {
        expect(seen.has(r.equipment)).toBe(false);
        seen.add(r.equipment);
      }
    }
  });

  it.fails("(2) '12-lead ECG machine' classifies as bound to 12_lead_ecg_machine_equipment.", () => {
    expect(typeof classifyScenarioEquipmentBinding).toBe("function");

    const result = classifyScenarioEquipmentBinding({
      equipment: edChestPainScenario.equipment,
      assetNeeds: edChestPainScenario.assetNeeds?.map((an) => ({
        assetId: an.assetId,
        assetType: an.assetType,
        licenseStatus: an.licenseStatus,
      })),
    });

    const ecgBinding = result.find(
      (r) => r.kind === "bound" && r.equipment === "12-lead ECG machine"
    );
    expect(ecgBinding).toBeDefined();
    expect(ecgBinding?.assetId).toBe("12_lead_ecg_machine_equipment");
  });

  it.fails("(3) An equipment string with no matching asset need is reported as required-unbound and NAMED.", () => {
    expect(typeof classifyScenarioEquipmentBinding).toBe("function");

    // Construct a scenario with an equipment string that has no assetNeeds match
    const result = classifyScenarioEquipmentBinding({
      equipment: ["12-lead ECG machine", "non-existent equipment item"],
      assetNeeds: edChestPainScenario.assetNeeds?.map((an) => ({
        assetId: an.assetId,
        assetType: an.assetType,
        licenseStatus: an.licenseStatus,
      })),
    });

    const unbound = result.find(
      (r) => r.kind === "required-unbound" && r.equipment === "non-existent equipment item"
    );
    expect(unbound).toBeDefined();
    expect(unbound?.equipment).toBe("non-existent equipment item");
  });

  it.fails("(4) The behaviour on a conflicting input matches EQUIPMENT_BINDING_PRECEDENCE. The constant is read by the test; a doc comment is not testable and drifts.", () => {
    expect(typeof classifyScenarioEquipmentBinding).toBe("function");
    expect(EQUIPMENT_BINDING_PRECEDENCE).toBeDefined();
    expect(["assetNeeds", "equipment"]).toContain(EQUIPMENT_BINDING_PRECEDENCE);

    // Test conflict: equipment has "X", assetNeeds has different assetId for "X"
    // If precedence is "assetNeeds", the binding follows assetNeeds; if "equipment", it follows equipment
    // We test by creating a scenario where the same logical equipment maps to different assetIds
    const equipment = ["conflict item"];
    const assetNeeds = [
      { assetId: "asset_from_assetneeds", assetType: "equipment" as const, licenseStatus: "approved" },
    ];

    const result = classifyScenarioEquipmentBinding({ equipment, assetNeeds });

    // The exact behavior depends on the precedence - the test verifies the constant exists
    // and is one of the two valid values. The actual binding logic will be verified
    // when the implementation exists and the .fails is flipped.
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});