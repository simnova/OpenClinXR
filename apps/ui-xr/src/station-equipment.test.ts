import { describe, expect, it } from "vitest";
import {
  applyGltfEquipmentFootprintFit,
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

describe("gltf equipment footprint fit (#266)", () => {
  it("fits a unit-normalized floor GLB's footprint to its declared composite envelope", () => {
    // #266 — the bake pipeline unit-normalizes generated GLBs to ±0.5 on x/z
    // (bedside-monitor-generated.glb spans 1.00 m wide), while the placement
    // descriptor was authored against the parametric composite it replaced
    // (0.38 m wide × 0.22 m deep). A floor mount must scale to fit.
    const slot = new Group();
    slot.position.set(0.95, 0, 0.98);
    slot.userData.openClinXrEquipmentId = "bedside_monitor_equipment";

    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1)); // unit-normalized x/z span 1.0
    equipment.add(box);

    normalizeGltfEquipmentMount(equipment, slot);
    slot.add(equipment);
    slot.updateMatrixWorld(true);

    // Composite envelope x/z spans (measured): 0.38 × 0.22.
    expect(box.matrixWorld.elements[0]).toBeCloseTo(0.38, 3);
    expect(box.matrixWorld.elements[10]).toBeCloseTo(0.22, 3);
    // Y scale untouched: the vertical envelope is the #258/#260 contracts' job.
    expect(box.matrixWorld.elements[5]).toBeCloseTo(1, 3);
    // The hybrid stand is still added and the body still rests on its top.
    const standGroup = slot.children.find(
      (child) => child.name === "openclinxr.equipment.bedside_monitor_equipment.stand",
    );
    expect(standGroup).toBeDefined();
    const mountBounds = new Box3().setFromObject(slot);
    expect(mountBounds.min.y).toBeCloseTo(0, 5);
  });

  it("leaves the elevated wall-clock control untouched (no footprint to fit)", () => {
    const slot = new Group();
    slot.position.set(-2.4, 1.55, -1.15);
    slot.userData.openClinXrEquipmentId = "wall_clock_equipment";

    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1));
    equipment.add(box);

    normalizeGltfEquipmentMount(equipment, slot);
    slot.add(equipment);
    slot.updateMatrixWorld(true);

    expect(box.matrixWorld.elements[0]).toBeCloseTo(1, 5);
    expect(box.matrixWorld.elements[10]).toBeCloseTo(1, 5);
    expect(box.matrixWorld.elements[13]).toBeCloseTo(1.55, 5); // origin-centered mount height
  });

  it("leaves ids without a dedicated composite envelope untouched (ED bay library GLBs)", () => {
    const slot = new Group();
    slot.position.set(0, 0, 0);
    slot.userData.openClinXrEquipmentId = "ecg_cart_equipment";

    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1));
    equipment.add(box);

    normalizeGltfEquipmentMount(equipment, slot);
    slot.add(equipment);
    slot.updateMatrixWorld(true);

    expect(box.matrixWorld.elements[0]).toBeCloseTo(1, 5);
    expect(box.matrixWorld.elements[10]).toBeCloseTo(1, 5);
    expect(box.matrixWorld.elements[13]).toBeCloseTo(0.4, 5); // grounded only (#258)
  });

  it("never scales a GLB up and never scales an already-fitted footprint", () => {
    // A GLB already within its envelope must be left alone (shrink-only fit).
    const slot = new Group();
    slot.position.set(0.95, 0, 0.98);
    slot.userData.openClinXrEquipmentId = "bedside_monitor_equipment";

    const equipment = new Group();
    const box = new Mesh(new BoxGeometry(0.2, 0.8, 0.1)); // already within 0.38×0.22
    equipment.add(box);

    normalizeGltfEquipmentMount(equipment, slot);
    slot.add(equipment);
    slot.updateMatrixWorld(true);

    // Node scale untouched (1) — nothing was scaled up.
    expect(box.matrixWorld.elements[0]).toBeCloseTo(1, 5);
    expect(box.matrixWorld.elements[10]).toBeCloseTo(1, 5);
    const worldSpan = new Box3().setFromObject(slot);
    expect(worldSpan.max.x - worldSpan.min.x).toBeLessThanOrEqual(0.38 + 1e-4);

    // Direct call on an already-fitted GLB is a no-op.
    const direct = new Group();
    const directBox = new Mesh(new BoxGeometry(0.3, 0.8, 0.2));
    direct.add(directBox);
    applyGltfEquipmentFootprintFit(direct, "bedside_monitor_equipment");
    expect(directBox.matrixWorld.elements[0]).toBeCloseTo(1, 5);
    expect(directBox.matrixWorld.elements[10]).toBeCloseTo(1, 5);
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
