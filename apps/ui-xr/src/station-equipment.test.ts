import { describe, expect, it } from "vitest";
import {
  normalizeGltfEquipmentMount,
  planStationEquipmentMounts,
  REAL_EQUIPMENT_GLTF_BY_ID,
} from "./station-equipment.js";
import { BoxGeometry, Group, Mesh } from "three";

describe("gltf equipment mount normalization (#258)", () => {
  it("grounds an object-centered GLB on a floor placement (base to floor, content above)", () => {
    // TRELLIS image-to-3D exports are object-centered: a BoxGeometry(1, 0.8, 1)
    // spans local y∈[-0.4, +0.4] around the origin. A floor placement (y=0) must
    // stand the object's base ON the floor — dropping the origin at y=0 would leave
    // it half-buried (#258 measured the bedside monitor's world min-Y at -0.403m).
    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1));
    equipment.add(box);

    const floorSlot = new Group();
    floorSlot.position.set(0.95, 0, 0.98);

    normalizeGltfEquipmentMount(equipment, floorSlot);
    floorSlot.add(equipment);
    floorSlot.updateMatrixWorld(true);
    // World Y of the box center: slot y(0) + equipment y(+0.4) + box local y(0).
    expect(box.matrixWorld.elements[13]).toBeCloseTo(0.4, 5);
    // World min-Y of the box must be at the floor (0), not below it.
    const worldMinY = box.matrixWorld.elements[13] - 0.4;
    expect(worldMinY).toBeGreaterThanOrEqual(0);
  });

  it("leaves an elevated (mount-height) placement origin-centered — the wall-clock control", () => {
    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1));
    equipment.add(box);

    const elevatedSlot = new Group();
    elevatedSlot.position.set(-2.4, 1.55, -1.15);

    normalizeGltfEquipmentMount(equipment, elevatedSlot);
    elevatedSlot.add(equipment);
    elevatedSlot.updateMatrixWorld(true);
    // No Y offset applied: the box stays centered on the mount height 1.55, spanning
    // y∈[1.15, 1.95] — the origin-centered mount-height convention.
    expect(box.matrixWorld.elements[13]).toBeCloseTo(1.55, 5);
  });

  it("is a no-op for an already-grounded GLB (min-Y ≥ 0)", () => {
    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1));
    box.position.y = 0.4; // base already at the origin
    equipment.add(box);

    const floorSlot = new Group();
    floorSlot.position.set(0, 0, 0);

    normalizeGltfEquipmentMount(equipment, floorSlot);
    floorSlot.add(equipment);
    floorSlot.updateMatrixWorld(true);
    expect(box.matrixWorld.elements[13]).toBeCloseTo(0.4, 5);
  });
});

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
