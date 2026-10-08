import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildStationEnvironment } from "@openclinxr/xr-station";
import { searchClinicalLayouts } from "./layout-search.js";
import { sitContact } from "./contact-solvers.js";

type Tuple3 = [number, number, number];
type Tuple2 = [number, number];

function readSnapshot(scenarioId: string) {
  const candidates = [
    `.openclinxr/staging-solver/${scenarioId}/scene-snapshot.json`,
    `tools/openclinxr/staging-solver/snapshots/${scenarioId}.json`,
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
  }
  throw new Error(`missing snapshot ${scenarioId}`);
}

function entryMinMax(entry: { min?: number[]; max?: number[]; box?: { min?: number[]; max?: number[] } }) {
  const min = entry.min ?? entry.box?.min;
  const max = entry.max ?? entry.box?.max;
  if (min === undefined || max === undefined) throw new Error("support missing box");
  return { min, max };
}

function patientChestTuple(snapshot: { actors: Array<{ id: string; chest?: number[] }> }): Tuple3 {
  const patient = snapshot.actors.find((a) => Array.isArray(a.chest) && a.id !== "parent_mei_chen_v1")
    ?? snapshot.actors.find((a) => Array.isArray(a.chest));
  if (patient === undefined || patient.chest === undefined) throw new Error("missing patient chest");
  const chest = patient.chest;
  return [chest[0], chest[1], chest[2]];
}

function frameForSnapshot(snapshot: {
  actors: Array<{ id: string; chest?: number[] }>;
  patientSupports: Array<{ min?: number[]; max?: number[]; box?: { min?: number[]; max?: number[] } }>;
}) {
  const chest = patientChestTuple(snapshot);
  let largest = snapshot.patientSupports[0];
  let largestArea = -1;
  for (const entry of snapshot.patientSupports) {
    const { min, max } = entryMinMax(entry);
    const area = (max[0] - min[0]) * (max[2] - min[2]);
    if (area > largestArea) {
      largestArea = area;
      largest = entry;
    }
  }
  const { min, max } = entryMinMax(largest);
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const dx = max[0] - min[0];
  const dz = max[2] - min[2];
  let long: Tuple2 = dx >= dz ? [1, 0] : [0, 1];
  const toPatient: Tuple2 = [chest[0] - cx, chest[2] - cz];
  if (long[0] * toPatient[0] + long[1] * toPatient[1] < 0) {
    long = [-long[0], -long[1]];
  }
  const side: Tuple2 = [-long[1], long[0]];
  const halfLong = (dx >= dz ? dx : dz) / 2;
  const head: Tuple2 = [cx + long[0] * halfLong, cz + long[1] * halfLong];
  const foot: Tuple2 = [cx - long[0] * halfLong, cz - long[1] * halfLong];
  const nurseAnchor: Tuple2 = [
    head[0] + long[0] * -0.35 + side[0] * -0.62,
    head[1] + long[1] * -0.35 + side[1] * -0.62,
  ];
  const supportNameValue: unknown = Reflect.get(largest, "name");
  const supportName = typeof supportNameValue === "string" ? supportNameValue : "patient_support";
  const patientHead: Tuple3 = [chest[0], chest[1], chest[2]];
  return { supportName, long, side, head, foot, patientHead, nurseAnchor };
}

function builtFamilyChair() {
  const group = buildStationEnvironment({ environmentId: "pediatric_fever_urgent_care_bay_v1" });
  const chairs: Array<{ x: number; z: number; seat: number }> = [];
  group.traverse((obj) => {
    const slot = obj.userData["fixtureSlotId"];
    const seat = obj.userData["seatHeightMeters"];
    if (slot === "family_chair" && typeof seat === "number") {
      chairs.push({ x: obj.position.x, z: obj.position.z, seat });
    }
  });
  return chairs;
}

describe("fever family chair", () => {
  it("mounts the shared chair on the fever shell", () => {
    const chairs = builtFamilyChair();
    expect(chairs.length).toBeGreaterThan(0);
    expect(chairs[0].x).toBeCloseTo(-0.55, 2);
    expect(chairs[0].z).toBeCloseTo(-0.75, 2);
    expect(typeof chairs[0].seat).toBe("number");
  });

  it("unmodified fever snapshot resolves family chair", () => {
    const snapshot = readSnapshot("peds_fever_v1");
    const result = searchClinicalLayouts(snapshot);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.bindingConstraint).toBeUndefined();
    expect(result.learnerStance?.slotId).toBe("physician_bedside");
    expect(result.learnerStance?.world[1]).toBe(1.7);
    const parent = snapshot.actors.find((a: { id: string }) => a.id === "parent_mei_chen_v1");
    const frame = frameForSnapshot(snapshot);
    const plants = sitContact(snapshot, parent, frame);
    expect(plants.length).toBeGreaterThan(0);
    for (const plant of plants) {
      expect(plant.slotId).toBe("companion_chair");
      expect(plant.placement.plantOffsetMeters.y).toBe(0);
    }
    const seat = snapshot.companionSeats.find((s: { name: string }) => s.name.endsWith("family_chair.seat"));
    expect(seat).toBeDefined();
    if (!seat) return;
    const seatBoxValue = seat.box as { min: number[]; max: number[] };
    const centreX = (seatBoxValue.min[0] + seatBoxValue.max[0]) / 2;
    const centreZ = (seatBoxValue.min[2] + seatBoxValue.max[2]) / 2;
    const deck = snapshot.fixtures.find(
      (f: { name: string }) => f.name === "openclinxr.station-environment.fixture-slot.stretcher.deck.seat.mesh",
    );
    expect(deck).toBeDefined();
    if (!deck) return;
    const deckBox = deck.box as { min: number[]; max: number[] };
    for (const plant of plants) {
      expect(Math.abs(plant.world[0] - centreX)).toBeLessThanOrEqual(0.31);
      expect(Math.abs(plant.world[2] - centreZ)).toBeLessThanOrEqual(0.31);
      const plantBox = plant.box as { min: number[]; max: number[] };
      const overlaps =
        plantBox.min[0] < deckBox.max[0] + 0.03 && plantBox.max[0] > deckBox.min[0] - 0.03
        && plantBox.min[1] < deckBox.max[1] && plantBox.max[1] > deckBox.min[1]
        && plantBox.min[2] < deckBox.max[2] + 0.03 && plantBox.max[2] > deckBox.min[2] - 0.03;
      expect(overlaps).toBe(false);
    }
  });

  it("one built seat resolves parent contact", () => {
    const chairs = builtFamilyChair();
    const cx = chairs[0].x;
    const cz = chairs[0].z;
    const snapshot = readSnapshot("peds_fever_v1");
    const augmented = structuredClone(snapshot);
    const min: Tuple3 = [cx - 0.24, 0.4, cz - 0.24];
    const max: Tuple3 = [cx + 0.24, 0.45, cz + 0.24];
    const seatEntry = {
      name: "openclinxr.station-environment.fixture-slot.family_chair.seat",
      kind: "companion_chair",
      slotId: "companion_chair",
      box: { min, max },
      min,
      max,
    };
    augmented.companionSeats.push(seatEntry);
    const frame = frameForSnapshot(augmented);
    const parent = augmented.actors.find((a: { id: string }) => a.id === "parent_mei_chen_v1");
    const resolved = sitContact(augmented, parent, frame);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0].slotId).toBe("companion_chair");
    expect(resolved[0].placement.plantOffsetMeters.y).toBe(0);
    const seatCentre: Tuple2 = [cx, cz];
    const gap = Math.hypot(seatCentre[0] - frame.nurseAnchor[0], seatCentre[1] - frame.nurseAnchor[1]);
    expect(gap).toBeGreaterThanOrEqual(1.2);
  });

  it("adult scenario keeps a bedside learner stance", () => {
    const snapshot = readSnapshot("adult_abdominal_pain_v1");
    const result = searchClinicalLayouts(snapshot);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.learnerStance.slotId).toBe("physician_bedside");
    expect(result.learnerStance.world[1]).toBe(1.7);
  });
});
