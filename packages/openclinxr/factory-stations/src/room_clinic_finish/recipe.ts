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

import { type RoomFinishFeatures, validateRoomFinishFeatures } from "./finish-features.js";

export const ROOM_CLINIC_FINISH_SCHEMA_VERSION = "openclinxr.room-clinic-finish.v1";

/** Closed finish-preset enum. No free text: the factory stays deterministic. */
export const ROOM_FINISH_PRESETS = ["peds_calm", "clinic_day", "evening_calm", "ward_photo"] as const;

export type RoomFinishPreset = (typeof ROOM_FINISH_PRESETS)[number];

/** Known room ids, mirrored from the lighting_design station's KNOWN_ROOM_IDS. */
export const ROOM_FINISH_KNOWN_ROOMS = [
  "ed_exam_bay_v1",
  "pediatric_urgent_care_bay_v1",
  "primary_care_clinic_room_v1",
  "urgent_care_clinic_room_v1",
  "pediatric_fever_urgent_care_bay_v1",
  "inpatient_ward_room_v1",
  "stepdown_room_v1",
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
  /** S5: crash rail gate, off by default (compose.py reads options.crashRail). */
  options: { crashRail: boolean; door?: { hingeSide: string; lite?: [number, number, number, number]; margin?: number; transom?: "infill" | "tall-casing"; kickPlate?: boolean } };
  /** Optional feature block. Absence preserves every legacy preset behavior. */
  finish?: RoomFinishFeatures;
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
  // ward_photo: pixel-sampled from docs/openclinxr/room-realism/imagine-multiview/
  // (Grok Imagine session d7dd6d8a, see asset-licence-records row-31). Albedo
  // convention is sRGB/255, matching the presets above. wallAlbedo is the mean
  // of three daylight wall boxes (02 box 500,280,780,420; 06 box 250,230,550,300;
  // 01 box 200,200,500,450) -> (184.5, 187.8, 184.4)/255; the value bakes in the
  // reference lighting (lit-photo mean, not a paint chip). trimAlbedo is the
  // white door casing in 04 (box 200,100,232,700) -> (176.4, 186.4, 190.0)/255,
  // single clean box. accentAlbedo is the flat-lit grey vinyl cove base in 02
  // (box 500,600,780,625) -> (134.2, 140.4, 142.9)/255. roughness 0.85 is a
  // reasoned estimate (matte wall per peds_calm; vinyl sheen unresolvable
  // from stills; one palette-wide value).
  ward_photo: {
    wallAlbedo: [0.72, 0.74, 0.72],
    trimAlbedo: [0.69, 0.73, 0.75],
    accentAlbedo: [0.53, 0.55, 0.56],
    roughness: 0.85,
    signageAnchors: ["door_header", "bed_wall"],
  },
};

export type RoomFinishRecipeInput = {
  environmentId: string;
  preset: string;
  seed: number;
  /** Opt-in crash rail (some other room type may want it); default off. */
  crashRail?: boolean;
  /** Opt-in door furniture (hinge plates + lite fallback rect + leaf margin basis); absent = none. */
  door?: { hingeSide: string; lite?: [number, number, number, number]; margin?: number; transom?: "infill" | "tall-casing"; kickPlate?: boolean };
  finish?: RoomFinishFeatures;
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
  const crashRail = input["crashRail"];
  if (crashRail !== undefined && typeof crashRail !== "boolean") {
    issues.push("crashRail must be a boolean when present");
  }
  const doorOpt = input["door"] as unknown;
  let door: { hingeSide: string; lite?: [number, number, number, number]; margin?: number; transom?: "infill" | "tall-casing"; kickPlate?: boolean } | undefined;
  if (doorOpt !== undefined) {
    const hingeSide = (doorOpt as Record<string, unknown>)?.["hingeSide"];
    if (
      typeof hingeSide !== "string" ||
      !["+x", "-x", "+y", "-y"].includes(hingeSide)
    ) {
      issues.push('door.hingeSide must be one of "+x", "-x", "+y", "-y"');
    } else {
      door = { hingeSide };
      const lite = (doorOpt as Record<string, unknown>)?.["lite"];
      if (lite !== undefined) {
        const ok =
          Array.isArray(lite) &&
          lite.length === 4 &&
          lite.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) &&
          (lite[0] as number) < (lite[1] as number) &&
          (lite[2] as number) < (lite[3] as number);
        if (!ok) {
          issues.push("door.lite must be [xmin, xmax, ymin, ymax] leaf fractions in [0, 1]");
        } else {
          door.lite = [...(lite as number[])] as [number, number, number, number];
        }
      }
      const margin = (doorOpt as Record<string, unknown>)?.["margin"];
      if (margin !== undefined) {
        if (typeof margin !== "number" || !Number.isFinite(margin) || margin <= 0) {
          issues.push("door.margin must be a positive number when present");
        } else {
          door.margin = margin;
        }
      }
      const transom = (doorOpt as Record<string, unknown>)?.["transom"];
      if (transom !== undefined) {
        if (transom !== "infill" && transom !== "tall-casing") {
          issues.push("door.transom must be infill or tall-casing when present");
        } else {
          door.transom = transom;
        }
      }
      const kickPlate = (doorOpt as Record<string, unknown>)?.["kickPlate"];
      if (kickPlate !== undefined) {
        if (typeof kickPlate !== "boolean") {
          issues.push("door.kickPlate must be a boolean when present");
        } else {
          door.kickPlate = kickPlate;
        }
      }
    }
  }
  if (issues.length > 0) return { issues };
  let finish: RoomFinishFeatures | undefined;
  if (input["finish"] !== undefined) {
    try {
      finish = validateRoomFinishFeatures(input["finish"], "finish");
    } catch (error) {
      issues.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
  }
  if (issues.length > 0) return { issues };
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
      options: { crashRail: crashRail === true, ...(door !== undefined ? { door } : {}) },
      ...(finish === undefined ? {} : { finish }),
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
