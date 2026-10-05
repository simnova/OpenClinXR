import { describe, expect, it } from "vitest";
import { searchClinicalLayouts } from "./layout-search.js";
import type { CachedSceneSnapshot } from "./staging-types.js";

function counterweightSnapshot(): CachedSceneSnapshot {
  const bed = { name: "bed.support", kind: "patient_support" as const,
    box: { min: [-1, 0.45, -0.5] as [number, number, number], max: [1, 0.75, 0.5] as [number, number, number] } };
  const door = { name: "door_leaf", kind: "door" as const,
    box: { min: [3.8, 0, -0.8] as [number, number, number], max: [4.2, 2.2, 0.8] as [number, number, number] } };
  return {
    schemaVersion: "openclinxr.staging-solver-snapshot.v1",
    scenarioId: "counterweight_doorway",
    inputHash: "fixture",
    capturedAt: "2026-10-05T00:00:00.000Z",
    actors: [
      { id: "patient", role: "patient", box: { min: [-0.8, 0.6, -0.35], max: [0.8, 1.15, 0.35] },
        heading: 0, standing: false, recumbent: true, chest: [-0.3, 1.1, 0], bodyDimensions: [1.6, 0.55, 0.7],
        currentPlacement: { supportSurface: "bed", plantOffsetMeters: { x: 0, y: 0, z: 0 } } },
      { id: "family", role: "family", box: { min: [3.75, 0, -0.25], max: [4.25, 1.7, 0.25] },
        heading: Math.PI, standing: true, recumbent: false, chest: [4, 1.1, 0], bodyDimensions: [0.5, 1.7, 0.5],
        currentPlacement: { supportSurface: "none", plantOffsetMeters: { x: 4, y: 0, z: 0 } } },
    ],
    actorIds: ["patient", "family"], primaryId: "family",
    interior: { min: [-3, 0, -3], max: [5, 3, 3] }, unionCentre: [1.7, 0.85, 0],
    sphereCentre: [1.7, 0.85, 0], patientChest: [-0.3, 1.1, 0], occluders: [], placards: [],
    eyeYs: [1.52, 1.68, 1.84, 2, 2.16], orbitBounds: { xMin: -2.1, xMax: 4.1, zMin: -2.78, zMax: 2.78 },
    fixtures: [bed, door], patientSupports: [bed], companionSeats: [], door,
  };
}

describe("clinical staging layout search", () => {
  it("forbids the cheaper doorway lineup and stays bedside", () => {
    const result = searchClinicalLayouts(counterweightSnapshot());
    expect(result.layouts.length).toBeGreaterThan(0);
    const family = result.layouts[0]?.find((row) => row.actorId === "family");
    expect(family?.slotId).toBe("companion_bedside");
    expect(Math.abs(family?.world[0] ?? 99)).toBeLessThan(2);
  });

  it("produces byte-identical output for two runs on the same snapshot", () => {
    const snapshot = counterweightSnapshot();
    expect(JSON.stringify(searchClinicalLayouts(snapshot))).toBe(JSON.stringify(searchClinicalLayouts(snapshot)));
  });
});
