/**
 * The lighting-rig wire contract, shared by the parser and the runtime that applies it.
 *
 * The schema version string is declared in four places across the repo — here, the
 * lighting_design station's run.ts and lighting-rig.py, and room-albedo-ao-bake.py. This
 * module is the TypeScript side of that contract; the Python side is still its own copy.
 */
export const LIGHTING_RIG_SCHEMA_VERSION = "openclinxr.lighting-rig.v1";

/** Indoor ranges enforced by the station (lighting-rig.py MAX_ENERGY/MAX_SIZE_M). */
export const MAX_RIG_ENERGY = 500;
export const MAX_RIG_SIZE_M = 4;

export type RigLightType = "point" | "area" | "directional";

export type LightingRigLight = {
  name: string;
  type: RigLightType;
  position: [number, number, number];
  target?: [number, number, number];
  energy: number;
  size: number;
  colorTemperatureK: number;
};

export type LightingRig = {
  schemaVersion: typeof LIGHTING_RIG_SCHEMA_VERSION;
  room: { environmentId?: string };
  bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  exposure: number;
  lights: LightingRigLight[];
};
