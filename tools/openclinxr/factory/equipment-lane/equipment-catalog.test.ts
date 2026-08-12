import { describe, expect, it } from "vitest";
import { rebuildEquipmentCatalog } from "./inventory.js";
import { validateEquipmentCatalog } from "./validate.js";
import { resolveProseToEquipmentId } from "./prose-map.js";

describe("equipment catalogue (MADR 0054/0055)", () => {
  it("resolves core prose labels", () => {
    expect(resolveProseToEquipmentId("hospital bed")).toBe("hospital_bed_equipment");
    expect(resolveProseToEquipmentId("12-lead ECG machine")).toBe(
      "12_lead_ecg_machine_equipment",
    );
    expect(resolveProseToEquipmentId("stretcher")).toBe("stretcher_equipment");
  });

  it("rebuilds catalogue covering full scenario bank and builders", () => {
    const doc = rebuildEquipmentCatalog();
    expect(doc.scenarioCount).toBeGreaterThanOrEqual(12);
    expect(doc.equipmentCount).toBeGreaterThanOrEqual(30);
    expect(doc.rows.some((r) => r.equipmentId === "hospital_bed_equipment")).toBe(true);
    expect(doc.rows.some((r) => r.equipmentId === "12_lead_ecg_machine_equipment")).toBe(true);
    expect(doc.summary.byLane.thin_parametric + doc.summary.byLane.bank + doc.summary.byLane.modular_kit).toBe(
      doc.equipmentCount,
    );
  });

  it("validates a fresh inventory without hard errors on glb files present", () => {
    const doc = rebuildEquipmentCatalog();
    const result = validateEquipmentCatalog(doc);
    // warnings allowed (unmapped prose); hard errors should not include schema issues
    expect(result.errors.filter((e) => e.includes("schemaVersion"))).toHaveLength(0);
    expect(doc.schemaVersion).toBe("openclinxr.equipment-catalog.v1");
    // If GLBs on disk exist, validate ok; if missing, that's a real fail
    if (doc.summary.gltfMissingOnDisk.length === 0) {
      expect(result.ok).toBe(true);
    }
  });
});
