import { describe, expect, it } from "vitest";
import {
  planStationEquipmentMounts,
  REAL_EQUIPMENT_GLTF_BY_ID,
} from "./station-equipment.js";

describe("wall clock TRELLIS equipment wiring (#244)", () => {
  it("declares wall_clock_equipment in the real equipment GLB library", () => {
    expect(REAL_EQUIPMENT_GLTF_BY_ID.wall_clock_equipment).toBe("wall-clock-analog.glb");
  });

  it("resolves wall_clock_equipment with source gltf, not parametric", () => {
    const plan = planStationEquipmentMounts({
      scenarioId: "ob_headache_preeclampsia_triage_v1",
      equipment: [{ equipmentId: "wall_clock_equipment" }],
      equipmentPlacements: {
        wall_clock_equipment: { position: { x: 0, y: 2.6, z: -1.2 } },
      },
    });

    const item = plan.find((row) => row.equipmentId === "wall_clock_equipment");
    expect(item).toBeDefined();
    expect(item?.source).toBe("gltf");
    expect(item?.gltfFileName).toBe("wall-clock-analog.glb");
  });
});

describe("bedside monitor TRELLIS equipment wiring (#253)", () => {
  it("declares bedside_monitor_equipment in the real equipment GLB library", () => {
    expect(REAL_EQUIPMENT_GLTF_BY_ID.bedside_monitor_equipment).toBe("bedside-monitor-generated.glb");
  });

  it("resolves bedside_monitor_equipment with source gltf, not parametric", () => {
    const plan = planStationEquipmentMounts({
      scenarioId: "ed_stroke_alert_handoff_v1",
      equipment: [{ equipmentId: "bedside_monitor_equipment" }],
      equipmentPlacements: {
        bedside_monitor_equipment: { position: { x: 0.95, y: 0, z: 0.98 } },
      },
    });

    const item = plan.find((row) => row.equipmentId === "bedside_monitor_equipment");
    expect(item).toBeDefined();
    expect(item?.source).toBe("gltf");
    expect(item?.gltfFileName).toBe("bedside-monitor-generated.glb");
  });
});
