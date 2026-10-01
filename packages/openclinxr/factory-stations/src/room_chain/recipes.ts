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
    style: "lite";
    widthM: number;
    heightM: number;
    handle: "lever";
    liteRect: readonly [number, number, number, number];
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
  if (door["style"] !== "lite") throw new RoomChainRecipeValidationError(`${path}.door.style must be lite`);
  if (door["handle"] !== "lever") throw new RoomChainRecipeValidationError(`${path}.door.handle must be lever`);
  if (door["transom"] !== undefined && !["infill", "tall-casing"].includes(String(door["transom"]))) throw new RoomChainRecipeValidationError(`${path}.door.transom must be infill or tall-casing when present`);
  if (door["kickPlate"] !== undefined && typeof door["kickPlate"] !== "boolean") throw new RoomChainRecipeValidationError(`${path}.door.kickPlate must be a boolean when present`);
  const liteRect = door["liteRect"];
  if (!Array.isArray(liteRect) || liteRect.length !== 4 || liteRect.some((part) => typeof part !== "number" || !Number.isFinite(part) || part < 0 || part > 1)) throw new RoomChainRecipeValidationError(`${path}.door.liteRect must be four finite fractions in [0, 1]`);
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
      style: "lite",
      widthM: finite(door["widthM"], `${path}.door.widthM`, true),
      heightM: finite(door["heightM"], `${path}.door.heightM`, true),
      handle: "lever",
      liteRect: [...liteRect] as [number, number, number, number],
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

const WARD_LIKE_FINISH = {
  preserveShell: true,
  floor: { kind: "vinyl-tile", moduleM: 0.6 },
  cove: { heightM: 0.1 },
  door: { kind: "hospital", photoPbr: true, casing: true, lite: true, lever: true, hinges: true },
  ceiling: {
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

export const ROOM_CHAIN_RECIPES = defineRoomChainRecipes({
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
