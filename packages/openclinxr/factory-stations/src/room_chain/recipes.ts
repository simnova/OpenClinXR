/** One authoritative mapping from runtime environment ids to room-chain recipes. */
export type RoomChainRecipe = {
  environmentId: string;
  defaultSeed: number;
  infinigenPrompt: string;
  layoutVariant: string;
  footprintMeters: { width: number; depth: number; ceilingHeight: number };
  door: {
    doorWall: "+y";
    wallOffsetM: number;
    hingeSide: "+x";
    style: "lite";
    widthM: number;
    heightM: number;
    handle: "lever";
    liteRect: readonly [number, number, number, number];
    bevelMm: number;
    casingMarginM: number;
    panelMarginM: number;
  };
  finishPreset: string;
  lightingMood: string;
};

export const ROOM_CHAIN_RECIPES = {
  inpatient_ward_room_v1: {
    environmentId: "inpatient_ward_room_v1",
    defaultSeed: 205,
    infinigenPrompt: "inpatient ward room",
    layoutVariant: "default",
    footprintMeters: { width: 4.3, depth: 3.9, ceilingHeight: 2.4 },
    door: {
      doorWall: "+y",
      wallOffsetM: 0.25,
      hingeSide: "+x",
      style: "lite",
      widthM: 0.95,
      heightM: 2.1,
      handle: "lever",
      liteRect: [0.64, 0.8, 0.58, 0.87],
      bevelMm: 2.5,
      casingMarginM: 0.055,
      panelMarginM: 0.1,
    },
    finishPreset: "ward_photo",
    lightingMood: "clinic_day",
  },
} as const satisfies Record<string, RoomChainRecipe>;

export type RoomChainEnvironmentId = keyof typeof ROOM_CHAIN_RECIPES;

export function roomChainRecipeFor(environmentId: string): RoomChainRecipe | undefined {
  return ROOM_CHAIN_RECIPES[environmentId as RoomChainEnvironmentId];
}
