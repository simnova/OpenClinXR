/**
 * room_clinic_finish: deterministic finish recipe for the clinic room shell.
 *
 * Pure TypeScript recipe layer (no Blender): same room + finish preset + seed
 * produces the same finish plan. The Blender compose stage (compose.py)
 * materializes wall/trim paint, baseboard contrast, signage anchors,
 * and finish geometry (T-bar, door kit, rail, sign);
 * the TypeScript runner (run.ts) spawns it once per work GLB.
 *
 * No Quest, animation, or clinical claims. Palette stays in calm indoor
 * ranges; the finish pass paints materials and emits finish geometry.
 */

export const ROOM_CLINIC_FINISH_SCHEMA_VERSION = "openclinxr.room-clinic-finish.v1";

/** Closed finish-preset enum. No free text: the factory stays deterministic. */
export const ROOM_FINISH_PRESETS = ["peds_calm", "clinic_day", "evening_calm"] as const;

export type RoomFinishPreset = (typeof ROOM_FINISH_PRESETS)[number];

/** Known room ids, mirrored from the lighting_design station's KNOWN_ROOM_IDS. */
export const ROOM_FINISH_KNOWN_ROOMS = [
  "ed_exam_bay_v1",
  "pediatric_urgent_care_bay_v1",
  "primary_care_clinic_room_v1",
  "urgent_care_clinic_room_v1",
  "pediatric_fever_urgent_care_bay_v1",
] as const;

export type RoomFinishPalette = {
  wallAlbedo: [number, number, number];
  trimAlbedo: [number, number, number];
  accentAlbedo: [number, number, number];
  roughness: number;
  signageAnchors: string[];
};

export type RoomFinishModule = {
  module: "ceiling" | "floor" | "door" | "corridor_cues" | "geometry";
  version: string;
};

export const ROOM_FINISH_MODULES: RoomFinishModule[] = [
  { module: "ceiling", version: "clinic-finish-ceiling-v1" },
  { module: "floor", version: "clinic-finish-floor-v1" },
  { module: "door", version: "clinic-finish-door-v1" },
  { module: "corridor_cues", version: "clinic-finish-corridor-cues-v1" },
  { module: "geometry", version: "clinic-finish-geometry-v1" },
];

export type RoomFinishRecipe = {
  schemaVersion: typeof ROOM_CLINIC_FINISH_SCHEMA_VERSION;
  environmentId: string;
  preset: RoomFinishPreset;
  seed: number;
  palette: RoomFinishPalette;
  modules: RoomFinishModule[];
  light: { exposure: "xr"; floorResponse: "xt_matte" };
  finishPassLlm: false;
};

type PresetDef = {
  wallAlbedo: [number, number, number];
  trimAlbedo: [number, number, number];
  accentAlbedo: [number, number, number];
  roughness: number;
  signageAnchors: string[];
};

const PRESET_DEFS: Record<RoomFinishPreset, PresetDef> = {
  peds_calm: {
    wallAlbedo: [0.86, 0.9, 0.88],
    trimAlbedo: [0.94, 0.95, 0.93],
    accentAlbedo: [0.35, 0.62, 0.78],
    roughness: 0.85,
    signageAnchors: ["door_header", "handwash_station", "exam_table_foot"],
  },
  clinic_day: {
    wallAlbedo: [0.9, 0.9, 0.88],
    trimAlbedo: [0.96, 0.96, 0.94],
    accentAlbedo: [0.25, 0.5, 0.68],
    roughness: 0.8,
    signageAnchors: ["door_header", "exam_table_foot"],
  },
  evening_calm: {
    wallAlbedo: [0.82, 0.8, 0.76],
    trimAlbedo: [0.9, 0.89, 0.86],
    accentAlbedo: [0.45, 0.55, 0.7],
    roughness: 0.9,
    signageAnchors: ["door_header"],
  },
};

export type RoomFinishRecipeInput = {
  environmentId: string;
  preset: string;
  seed: number;
};

/** Parse + refusal rules shared by plan() and the runner. */
export function parseRoomFinishRecipe(input: Record<string, unknown>): { issues: string[] } | { recipe: RoomFinishRecipe; issues?: undefined } {
  const issues: string[] = [];
  const environmentId = input["environmentId"];
  const preset = input["preset"];
  const seed = input["seed"];
  if (typeof environmentId !== "string" || !(ROOM_FINISH_KNOWN_ROOMS as readonly string[]).includes(environmentId)) {
    issues.push(`unknown environmentId ${String(environmentId)}`);
  }
  if (typeof preset !== "string" || !(ROOM_FINISH_PRESETS as readonly string[]).includes(preset)) {
    issues.push(`unknown preset ${String(preset)}; expected one of ${ROOM_FINISH_PRESETS.join(", ")}`);
  }
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    issues.push("seed must be a finite number");
  }
  if (issues.length > 0) return { issues };
  const def = PRESET_DEFS[preset as RoomFinishPreset];
  return {
    recipe: {
      schemaVersion: ROOM_CLINIC_FINISH_SCHEMA_VERSION,
      environmentId: environmentId as string,
      preset: preset as RoomFinishPreset,
      seed: seed as number,
      palette: {
        wallAlbedo: [...def.wallAlbedo] as [number, number, number],
        trimAlbedo: [...def.trimAlbedo] as [number, number, number],
        accentAlbedo: [...def.accentAlbedo] as [number, number, number],
        roughness: def.roughness,
        signageAnchors: [...def.signageAnchors],
      },
      modules: ROOM_FINISH_MODULES.map((entry) => ({ ...entry })),
      light: { exposure: "xr", floorResponse: "xt_matte" },
      finishPassLlm: false,
    },
  };
}

/** Deterministic recipe builder: same room + preset + seed -> identical plan. */
export function designRoomFinishRecipe(input: RoomFinishRecipeInput): RoomFinishRecipe {
  const parsed = parseRoomFinishRecipe(input as unknown as Record<string, unknown>);
  if (parsed.issues !== undefined) throw new Error(parsed.issues.join("; "));
  return parsed.recipe;
}
