import { describe, expect, it } from "vitest";
import {
  normalizeGltfEquipmentMount,
  planStationEquipmentMounts,
  REAL_EQUIPMENT_GLTF_BY_ID,
} from "./station-equipment.js";
import { Box3, BoxGeometry, Group, Mesh } from "three";

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

describe("gltf equipment hybrid stand mount (#260)", () => {
  it("keeps the parametric stand and rests the GLB body on it for a composite floor placement", () => {
    // #260 — the parametric bedside-monitor composite emits base + pole + body;
    // the GLB swap substitutes a single body mesh for the WHOLE id, dropping the
    // pole and leaving the monitor on the floor. The hybrid keeps the parametric
    // stand (MADR 0050 step 10) and mounts the body's base on the stand top.
    const slot = new Group();
    slot.position.set(0.95, 0, 0.98);
    slot.userData.openClinXrEquipmentId = "bedside_monitor_equipment";

    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1)); // object-centered: local y∈[-0.4, +0.4]
    equipment.add(box);

    normalizeGltfEquipmentMount(equipment, slot);
    slot.add(equipment);
    slot.updateMatrixWorld(true);

    // The parametric stand (base + pole) is added to the slot with its base on the floor.
    const standGroup = slot.children.find(
      (child) => child.name === "openclinxr.equipment.bedside_monitor_equipment.stand",
    );
    expect(standGroup, "the parametric stand was not added to the mount slot").toBeDefined();
    const standBounds = new Box3().setFromObject(standGroup!);
    expect(standBounds.min.y).toBeCloseTo(0, 5); // base on the floor
    const standTop = standBounds.max.y;
    expect(standTop).toBeCloseTo(0.975, 3); // pole top (measured pre-fix)

    // The GLB body rests its base on the stand top — NOT on the floor.
    const bodyWorldMinY = box.matrixWorld.elements[13] - 0.4;
    expect(bodyWorldMinY).toBeCloseTo(standTop, 3);
    // The whole mount stays anchored at the floor (the #258 envelope contract
    // requires the declared placement y=0 to lie inside the mount's world AABB).
    const mountBounds = new Box3().setFromObject(slot);
    expect(mountBounds.min.y).toBeCloseTo(0, 5);
  });

  it("leaves elevated placements origin-centered and ids without a stand grounded", () => {
    // Elevated placement (wall-clock convention): origin-centered, no stand added.
    const elevatedSlot = new Group();
    elevatedSlot.position.set(-2.4, 1.55, -1.15);
    elevatedSlot.userData.openClinXrEquipmentId = "bedside_monitor_equipment";
    const elevatedEquipment = new Group();
    const elevatedBox = new Mesh(new BoxGeometry(1, 0.8, 1));
    elevatedEquipment.add(elevatedBox);
    normalizeGltfEquipmentMount(elevatedEquipment, elevatedSlot);
    elevatedSlot.add(elevatedEquipment);
    elevatedSlot.updateMatrixWorld(true);
    expect(elevatedSlot.children.some((c) => c.name.endsWith(".stand"))).toBe(false);
    expect(elevatedBox.matrixWorld.elements[13]).toBeCloseTo(1.55, 5);

    // Floor placement of an id WITHOUT a stand (ECG cart): grounding unchanged.
    const plainSlot = new Group();
    plainSlot.position.set(0, 0, 0);
    plainSlot.userData.openClinXrEquipmentId = "ecg_cart_equipment";
    const plainEquipment = new Group();
    const plainBox = new Mesh(new BoxGeometry(1, 0.8, 1));
    plainEquipment.add(plainBox);
    normalizeGltfEquipmentMount(plainEquipment, plainSlot);
    plainSlot.add(plainEquipment);
    plainSlot.updateMatrixWorld(true);
    expect(plainSlot.children.some((c) => c.name.endsWith(".stand"))).toBe(false);
    expect(plainBox.matrixWorld.elements[13]).toBeCloseTo(0.4, 5); // grounded, base at floor
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
