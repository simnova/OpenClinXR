import { type RoomFinishFeatures, validateRoomFinishFeatures } from "../room_clinic_finish/finish-features.js";

/** One authoritative, strictly validated mapping from runtime ids to room-chain recipes. */
export type RoomChainRecipe = {
  environmentId: string;
  defaultSeed: number;
  infinigenPrompt: string;
  layoutVariant: string;
  footprintMeters: { width: number; depth: number; ceilingHeight: number };
  door: {
    doorWall: "+x" | "-x" | "+y" | "-y";
    wallOffsetM: number;
    hingeSide: "+x" | "-x" | "+y" | "-y";
    style: "panel" | "lite";
    widthM: number;
    heightM: number;
    handle: "lever";
    liteRect?: readonly [number, number, number, number];
    bevelMm: number;
    casingMarginM: number;
    panelMarginM: number;
    transom?: "infill" | "tall-casing";
    kickPlate?: boolean;
  };
  finishPreset: string;
  finish?: RoomFinishFeatures;
  lightingMood: string;
};

export class RoomChainRecipeValidationError extends Error {
  override readonly name = "RoomChainRecipeValidationError";
}

const RECIPE_KEYS = ["environmentId", "defaultSeed", "infinigenPrompt", "layoutVariant", "footprintMeters", "door", "finishPreset", "finish", "lightingMood"] as const;
const FOOTPRINT_KEYS = ["width", "depth", "ceilingHeight"] as const;
const DOOR_KEYS = ["doorWall", "wallOffsetM", "hingeSide", "style", "widthM", "heightM", "handle", "liteRect", "bevelMm", "casingMarginM", "panelMarginM", "transom", "kickPlate"] as const;

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RoomChainRecipeValidationError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RoomChainRecipeValidationError(`${path} has unknown field(s): ${unknown.join(", ")}`);
}

function finite(value: unknown, path: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) throw new RoomChainRecipeValidationError(`${path} must be a ${positive ? "positive " : ""}finite number`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new RoomChainRecipeValidationError(`${path} must be a non-empty string`);
  return value;
}

export function validateRoomChainRecipe(value: unknown, registryKey?: string): RoomChainRecipe {
  const path = registryKey === undefined ? "room recipe" : `room recipe ${registryKey}`;
  const recipe = object(value, path);
  rejectUnknown(recipe, RECIPE_KEYS, path);
  const footprint = object(recipe["footprintMeters"], `${path}.footprintMeters`);
  const door = object(recipe["door"], `${path}.door`);
  rejectUnknown(footprint, FOOTPRINT_KEYS, `${path}.footprintMeters`);
  rejectUnknown(door, DOOR_KEYS, `${path}.door`);
  const environmentId = string(recipe["environmentId"], `${path}.environmentId`);
  if (registryKey !== undefined && environmentId !== registryKey) throw new RoomChainRecipeValidationError(`${path}.environmentId must equal its registry key`);
  const doorWall = door["doorWall"];
  const hingeSide = door["hingeSide"];
  if (!["+x", "-x", "+y", "-y"].includes(String(doorWall))) throw new RoomChainRecipeValidationError(`${path}.door.doorWall is invalid`);
  if (!["+x", "-x", "+y", "-y"].includes(String(hingeSide))) throw new RoomChainRecipeValidationError(`${path}.door.hingeSide is invalid`);
  if (!["panel", "lite"].includes(String(door["style"]))) throw new RoomChainRecipeValidationError(`${path}.door.style must be panel or lite`);
  if (door["handle"] !== "lever") throw new RoomChainRecipeValidationError(`${path}.door.handle must be lever`);
  if (door["transom"] !== undefined && !["infill", "tall-casing"].includes(String(door["transom"]))) throw new RoomChainRecipeValidationError(`${path}.door.transom must be infill or tall-casing when present`);
  if (door["kickPlate"] !== undefined && typeof door["kickPlate"] !== "boolean") throw new RoomChainRecipeValidationError(`${path}.door.kickPlate must be a boolean when present`);
  const liteRect = door["liteRect"];
  if (door["style"] === "lite" && (!Array.isArray(liteRect) || liteRect.length !== 4 || liteRect.some((part) => typeof part !== "number" || !Number.isFinite(part) || part < 0 || part > 1))) throw new RoomChainRecipeValidationError(`${path}.door.liteRect must be four finite fractions in [0, 1] for lite doors`);
  if (door["style"] === "panel" && liteRect !== undefined) throw new RoomChainRecipeValidationError(`${path}.door.liteRect must be absent for panel doors`);
  const finish = recipe["finish"] === undefined ? undefined : validateRoomFinishFeatures(recipe["finish"], `${path}.finish`);
  return {
    environmentId,
    defaultSeed: finite(recipe["defaultSeed"], `${path}.defaultSeed`),
    infinigenPrompt: string(recipe["infinigenPrompt"], `${path}.infinigenPrompt`),
    layoutVariant: string(recipe["layoutVariant"], `${path}.layoutVariant`),
    footprintMeters: {
      width: finite(footprint["width"], `${path}.footprintMeters.width`, true),
      depth: finite(footprint["depth"], `${path}.footprintMeters.depth`, true),
      ceilingHeight: finite(footprint["ceilingHeight"], `${path}.footprintMeters.ceilingHeight`, true),
    },
    door: {
      doorWall: doorWall as RoomChainRecipe["door"]["doorWall"],
      wallOffsetM: finite(door["wallOffsetM"], `${path}.door.wallOffsetM`),
      hingeSide: hingeSide as RoomChainRecipe["door"]["hingeSide"],
      style: door["style"] as "panel" | "lite",
      widthM: finite(door["widthM"], `${path}.door.widthM`, true),
      heightM: finite(door["heightM"], `${path}.door.heightM`, true),
      handle: "lever",
      ...(liteRect === undefined ? {} : { liteRect: [...(liteRect as number[])] as [number, number, number, number] }),
      bevelMm: finite(door["bevelMm"], `${path}.door.bevelMm`, true),
      casingMarginM: finite(door["casingMarginM"], `${path}.door.casingMarginM`, true),
      panelMarginM: finite(door["panelMarginM"], `${path}.door.panelMarginM`, true),
      ...(door["transom"] === undefined ? {} : { transom: door["transom"] as "infill" | "tall-casing" }),
      ...(door["kickPlate"] === undefined ? {} : { kickPlate: door["kickPlate"] as boolean }),
    },
    finishPreset: string(recipe["finishPreset"], `${path}.finishPreset`),
    ...(finish === undefined ? {} : { finish }),
    lightingMood: string(recipe["lightingMood"], `${path}.lightingMood`),
  };
}

function defineRoomChainRecipes<const T extends Record<string, RoomChainRecipe>>(recipes: T): T {
  for (const [key, recipe] of Object.entries(recipes)) validateRoomChainRecipe(recipe, key);
  return recipes;
}

/**
 * Brown-band fix: a painted ceiling finish deletes the shell cornice and
 * the shell ceiling plane AFTER the occlusion bake, so the bake must not
 * count them as occluders (phantom contact shadow, browned by the warm
 * rig). Returns the stage-1 occlusionExcludes payload for painted
 * finishes, undefined otherwise (other rooms keep identical stage-1 keys).
 */
export function paintedCeilingOcclusionExcludes(
  finish: Pick<RoomFinishFeatures, "ceiling"> | undefined,
): { shellCornice: true; shellCeiling: true } | undefined {
  if (finish?.ceiling?.kind === "painted") {
    return { shellCornice: true, shellCeiling: true };
  }
  return undefined;
}

/** Spread-ready form for a room_generate input: `{}` unless the finish paints the ceiling. */
export function occlusionExcludesParam(
  finish: Pick<RoomFinishFeatures, "ceiling"> | undefined,
): { occlusionExcludes?: { shellCornice: true; shellCeiling: true } } {
  const occlusionExcludes = paintedCeilingOcclusionExcludes(finish);
  return occlusionExcludes === undefined ? {} : { occlusionExcludes };
}

const WARD_LIKE_FINISH = {
  preserveShell: true,
  floor: { kind: "vinyl-tile", moduleM: 0.6 },
  cove: { kind: "cove", heightM: 0.1 },
  door: { kind: "hospital", photoPbr: true, casing: true, lite: true, lever: true, hinges: true },
  ceiling: {
    kind: "acoustic-tbar",
    troffer: true,
    tbarMm: 24,
    cornice: "wall-angle",
    corniceProfile: "flush",
    corniceMaterial: "tile",
    corniceWidthMm: 24,
    corniceColorSource: "wall",
  },
  wallMatteRoughness: 0.85,
  neutralTints: { casingRgb: [0.79, 0.81, 0.83], coveRgb: [0.313, 0.323, 0.352] },
} as const satisfies RoomFinishFeatures;

const CLINICAL_FINISH = WARD_LIKE_FINISH;

const BEHAVIORAL_FINISH = {
  preserveShell: true,
  floor: { kind: "sheet-vinyl", moduleM: 1.2 },
  cove: { kind: "cove", heightM: 0.1 },
  door: { kind: "behavioral-solid", photoPbr: true, casing: false, lite: false, lever: true, hinges: false },
  ceiling: { kind: "painted", troffer: false, tbarMm: 24, cornice: "none" },
  wallMatteRoughness: 0.9,
  neutralTints: { casingRgb: [0.86, 0.87, 0.88], coveRgb: [0.42, 0.44, 0.46] },
} as const satisfies RoomFinishFeatures;

const RESIDENTIAL_FINISH = {
  preserveShell: true,
  floor: { kind: "wood-plank", moduleM: 0.18 },
  cove: { kind: "baseboard", heightM: 0.09 },
  door: { kind: "residential", photoPbr: true, casing: true, lite: false, lever: true, hinges: true },
  ceiling: { kind: "painted", troffer: false, tbarMm: 24, cornice: "none" },
  wallMatteRoughness: 0.88,
  neutralTints: { casingRgb: [0.9, 0.87, 0.81], coveRgb: [0.9, 0.87, 0.81] },
} as const satisfies RoomFinishFeatures;

const LITE_DOOR = {
  doorWall: "+y", wallOffsetM: 0.25, hingeSide: "+x", style: "lite",
  widthM: 0.95, heightM: 2.1, handle: "lever", liteRect: [0.64, 0.8, 0.58, 0.87],
  bevelMm: 2.5, casingMarginM: 0.055, panelMarginM: 0.1,
} as const;

const SOLID_DOOR = {
  doorWall: "+y", wallOffsetM: 0.25, hingeSide: "+x", style: "panel",
  widthM: 0.9, heightM: 2.05, handle: "lever",
  bevelMm: 2.5, casingMarginM: 0.055, panelMarginM: 0.1,
} as const;

export const ROOM_CHAIN_RECIPES = defineRoomChainRecipes({
  ed_exam_bay_v1: {
    environmentId: "ed_exam_bay_v1", defaultSeed: 22, infinigenPrompt: "emergency department exam bay", layoutVariant: "default",
    footprintMeters: { width: 5.882, depth: 2.882, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "clinic_day", finish: CLINICAL_FINISH, lightingMood: "ed_exam_bright",
  },
  pediatric_urgent_care_bay_v1: {
    environmentId: "pediatric_urgent_care_bay_v1", defaultSeed: 13, infinigenPrompt: "pediatric urgent care exam bay", layoutVariant: "default",
    footprintMeters: { width: 5.39, depth: 5.28, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "peds_calm", finish: CLINICAL_FINISH, lightingMood: "clinic_day",
  },
  primary_care_clinic_room_v1: {
    environmentId: "primary_care_clinic_room_v1", defaultSeed: 1, infinigenPrompt: "primary care clinic room", layoutVariant: "default",
    footprintMeters: { width: 6.5, depth: 6.26, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "clinic_day", finish: CLINICAL_FINISH, lightingMood: "clinic_day",
  },
  ed_stroke_bay_v1: {
    environmentId: "ed_stroke_bay_v1", defaultSeed: 2, infinigenPrompt: "emergency department stroke bay", layoutVariant: "default",
    footprintMeters: { width: 6.89, depth: 6.77, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "clinic_day", finish: CLINICAL_FINISH, lightingMood: "ed_exam_bright",
  },
  adult_ed_abdominal_bay_v1: {
    environmentId: "adult_ed_abdominal_bay_v1", defaultSeed: 0, infinigenPrompt: "adult emergency department abdominal bay", layoutVariant: "default",
    footprintMeters: { width: 6.25, depth: 6.25, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "clinic_day", finish: CLINICAL_FINISH, lightingMood: "ed_exam_bright",
  },
  telehealth_home_visit_v1: {
    environmentId: "telehealth_home_visit_v1", defaultSeed: 14, infinigenPrompt: "residential home room for a telehealth visit", layoutVariant: "default",
    footprintMeters: { width: 9.5, depth: 6.38, ceilingHeight: 2.65 }, door: SOLID_DOOR,
    finishPreset: "evening_calm", finish: RESIDENTIAL_FINISH, lightingMood: "evening_calm",
  },
  behavioral_health_private_room_v1: {
    environmentId: "behavioral_health_private_room_v1", defaultSeed: 16, infinigenPrompt: "behavioral health private room", layoutVariant: "default",
    footprintMeters: { width: 5.0, depth: 5.88, ceilingHeight: 2.65 }, door: SOLID_DOOR,
    finishPreset: "evening_calm", finish: BEHAVIORAL_FINISH, lightingMood: "evening_calm",
  },
  oncology_consult_room_v1: {
    environmentId: "oncology_consult_room_v1", defaultSeed: 17, infinigenPrompt: "oncology consultation room", layoutVariant: "default",
    footprintMeters: { width: 5.5, depth: 5.26, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "evening_calm", finish: CLINICAL_FINISH, lightingMood: "evening_calm",
  },
  urgent_care_clinic_room_v1: {
    environmentId: "urgent_care_clinic_room_v1", defaultSeed: 22, infinigenPrompt: "urgent care clinic room", layoutVariant: "default",
    footprintMeters: { width: 7.5, depth: 8.0, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "clinic_day", finish: CLINICAL_FINISH, lightingMood: "clinic_day",
  },
  surgical_ward_room_v1: {
    environmentId: "surgical_ward_room_v1", defaultSeed: 25, infinigenPrompt: "surgical ward room", layoutVariant: "default",
    footprintMeters: { width: 7.4, depth: 7.4, ceilingHeight: 2.65 }, door: { ...LITE_DOOR, kickPlate: true },
    finishPreset: "ward_photo", finish: WARD_LIKE_FINISH, lightingMood: "clinic_day",
  },
  ob_triage_room_v1: {
    environmentId: "ob_triage_room_v1", defaultSeed: 27, infinigenPrompt: "obstetric triage room", layoutVariant: "default",
    footprintMeters: { width: 6.0, depth: 4.8, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "peds_calm", finish: CLINICAL_FINISH, lightingMood: "clinic_day",
  },
  pediatric_fever_urgent_care_bay_v1: {
    environmentId: "pediatric_fever_urgent_care_bay_v1", defaultSeed: 34, infinigenPrompt: "pediatric fever urgent care bay", layoutVariant: "default",
    footprintMeters: { width: 6.5, depth: 6.5, ceilingHeight: 2.65 }, door: LITE_DOOR,
    finishPreset: "peds_calm", finish: CLINICAL_FINISH, lightingMood: "clinic_day",
  },
  inpatient_ward_room_v1: {
    environmentId: "inpatient_ward_room_v1",
    defaultSeed: 205,
    infinigenPrompt: "inpatient ward room",
    layoutVariant: "default",
    footprintMeters: { width: 4.3, depth: 3.9, ceilingHeight: 2.4 },
    door: {
      doorWall: "+y", wallOffsetM: 0.25, hingeSide: "+x", style: "lite",
      widthM: 0.95, heightM: 2.1, handle: "lever", liteRect: [0.64, 0.8, 0.58, 0.87],
      bevelMm: 2.5, casingMarginM: 0.055, panelMarginM: 0.1,
    },
    finishPreset: "ward_photo",
    finish: WARD_LIKE_FINISH,
    lightingMood: "clinic_day",
  },
  stepdown_room_v1: {
    environmentId: "stepdown_room_v1",
    defaultSeed: 205,
    infinigenPrompt: "ICU stepdown room",
    layoutVariant: "default",
    footprintMeters: { width: 6.2, depth: 3.25, ceilingHeight: 2.6 },
    door: {
      doorWall: "+y", wallOffsetM: 0.25, hingeSide: "+x", style: "lite",
      widthM: 0.95, heightM: 2.1, handle: "lever", liteRect: [0.64, 0.8, 0.58, 0.87],
      bevelMm: 2.5, casingMarginM: 0.055, panelMarginM: 0.1,
      transom: "infill", kickPlate: true,
    },
    finishPreset: "ward_photo",
    finish: WARD_LIKE_FINISH,
    lightingMood: "clinic_day",
  },
});

export type RoomChainEnvironmentId = keyof typeof ROOM_CHAIN_RECIPES;

export function roomChainRecipeFor(environmentId: string): RoomChainRecipe | undefined {
  return ROOM_CHAIN_RECIPES[environmentId as RoomChainEnvironmentId];
}
