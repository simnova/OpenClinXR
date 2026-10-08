import { describe, expect, it } from "vitest";
import type { ContactFrame } from "./contact-solvers.js";
import { layContact, sitContact, standContact } from "./contact-solvers.js";
import type { CachedSceneSnapshot } from "./staging-types.js";

const actorSource = {
  id: "parent_mei_chen_v1",
  role: "family",
  box: {
    min: [0, 0.4, 0] as [number, number, number],
    max: [0.4, 1.4, 0.4] as [number, number, number],
  },
  heading: 0,
  standing: false,
  recumbent: false,
  chest: [0.2, 1.0, 0.2] as [number, number, number],
  root: [0.2, 0.4, 0.2] as [number, number, number],
  currentPlacement: {
    supportSurface: "chair" as const,
    plantOffsetMeters: { x: 0, y: 0, z: 0 },
  },
  bodyDimensions: [0.3, 0.3, 0.9] as [number, number, number],
} as CachedSceneSnapshot["actors"][number];

const seatBox = {
  min: [0.8, 0, 1.8] as [number, number, number],
  max: [1.2, 0.5, 2.2] as [number, number, number],
};

const snapshotSource = {
  schemaVersion: "openclinxr.staging-solver-snapshot.v1",
  scenarioId: "contact-solvers-fixture",
  inputHash: "fixture",
  capturedAt: "2026-10-07T00:00:00.000Z",
  actorIds: ["parent_mei_chen_v1"],
  primaryId: "parent_mei_chen_v1",
  interior: {
    min: [-5, 0, -5] as [number, number, number],
    max: [5, 3, 5] as [number, number, number],
  },
  unionCentre: [0, 1, 0] as [number, number, number],
  sphereCentre: [0, 1, 0] as [number, number, number],
  patientChest: [0, 1, 0] as [number, number, number],
  occluders: [],
  placards: [],
  eyeYs: [1.68],
  orbitBounds: { xMin: -4.1, xMax: 4.1, zMin: -4.78, zMax: 4.78 },
  fixtures: [],
  patientSupports: [],
  companionSeats: [{ name: "companion_chair_1", box: seatBox, kind: "chair" as const }],
  door: null,
  actors: [actorSource],
} as CachedSceneSnapshot;

const frame0: ContactFrame = {
  supportName: "exam_bed_1",
  long: [1, 0],
  side: [0, 1],
  head: [0, 0],
  foot: [0, 0],
  patientHead: [0, 1, 0],
  nurseAnchor: [10, 10],
};

describe("contact solvers", () => {
  it("sits on first seat with offset plant", () => {
    const out = sitContact(snapshotSource, actorSource, frame0);
    const list = Array.isArray(out) ? out : [out];
    const hit = list.find(
      (entry) =>
        entry.placement.plantOffsetMeters.x === 0.1 &&
        entry.placement.plantOffsetMeters.z === -0.2,
    );
    expect(hit).toBeDefined();
    expect(hit?.placement.plantOffsetMeters).toEqual({ x: 0.1, y: 0, z: -0.2 });
    expect(hit?.slotId).toBe("companion_chair");
    expect(hit?.world[0]).toBeCloseTo(1.1, 5);
    expect(hit?.world[2]).toBeCloseTo(1.8, 5);
    expect(hit?.world[1]).toBeCloseTo(0.9, 5);
  });

  it("lies on authored support keeping centre", () => {
    const solo = layContact(snapshotSource);
    expect(solo.slotId).toBe("patient_on_authored_support");
    expect(solo.world[0]).toBeCloseTo(0.2, 5);
    expect(solo.world[1]).toBeCloseTo(0.9, 5);
    expect(solo.world[2]).toBeCloseTo(0.2, 5);
  });

  it("rotates the captured root-to-centre bias when authoring a new heading", () => {
    const actor = {
      ...actorSource,
      standing: true,
      root: [0, 0, 0] as [number, number, number],
      currentPlacement: { supportSurface: "none" as const, plantOffsetMeters: { x: 0, y: 0, z: 0 } },
    };
    const snapshot = { ...snapshotSource, actors: [actor], companionSeats: [] };
    const candidate = standContact(snapshot, actor, frame0)[0];
    expect(candidate).toBeDefined();
    if (!candidate) return;
    const delta = candidate.headingRadians - actor.heading;
    const rotatedBiasX = Math.cos(delta) * 0.2 + Math.sin(delta) * 0.2;
    const rotatedBiasZ = -Math.sin(delta) * 0.2 + Math.cos(delta) * 0.2;
    expect(candidate.placement.plantOffsetMeters.x + rotatedBiasX).toBeCloseTo(candidate.world[0], 8);
    expect(candidate.placement.plantOffsetMeters.z + rotatedBiasZ).toBeCloseTo(candidate.world[2], 8);
  });
});
