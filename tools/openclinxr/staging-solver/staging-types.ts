import type { SweepSceneSnapshot } from "../evidence/station-capture/camera-sweep-scene.js";
import type { GateCamera, GateReading } from "../evidence/station-capture/gate-geometry.js";

export type SupportSurface = "stretcher" | "bed" | "exam_table" | "chair" | "none";
export type SolverPlacement = {
  supportSurface: SupportSurface;
  plantOffsetMeters: { x: number; y: number; z: number };
  headingRadians?: number;
};

export type CachedSceneSnapshot = Omit<SweepSceneSnapshot, "actors"> & {
  schemaVersion: "openclinxr.staging-solver-snapshot.v1";
  scenarioId: string;
  inputHash: string;
  capturedAt: string;
  actors: Array<SweepSceneSnapshot["actors"][number] & {
    role: string;
    currentPlacement: SolverPlacement;
    bodyDimensions: [number, number, number];
  }>;
};

export type SlotAssignment = {
  actorId: string;
  slotId: string;
  world: [number, number, number];
  headingRadians: number;
  placement: SolverPlacement;
  cost: number;
};

export type StagingSolveResult = {
  scenarioId: string;
  feasible: boolean;
  bindingConstraint?: string;
  solveMs: number;
  predictedGate: GateReading | null;
  realGate: GateReading | null;
  parity?: { visibilityDelta: number; nearDelta: number; containmentDelta: number };
  slots: SlotAssignment[];
  camera: GateCamera | null;
};
