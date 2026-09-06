/**
 * Room-prop material colours from authored manifest hex (#100).
 *
 * Builds MeshStandardMaterial instances so callers read colours off materials
 * (`material.color.getHex()`), not a bare parse helper. Consumer accepts CSS
 * `#rrggbb` and bare `rrggbb` via parseRuntimeRoomPropColorHex (convention
 * pinned next to EncounterRuntimeRoomProp).
 */

import {
  parseRuntimeRoomPropColorHex,
  ROOM_PROP_ACCENT_COLOR_FALLBACK,
  ROOM_PROP_BODY_COLOR_FALLBACK,
} from "@openclinxr/asset-registry";
import { MeshStandardMaterial } from "three";

export type RoomPropColourInput = {
  propId: string;
  colorHex: string;
  accentColorHex: string;
};

export type RoomPropMaterialColours = {
  propId: string;
  bodyColor: number;
  accentColor: number;
};

/**
 * Resolve body + accent for a prop and apply them to real MeshStandardMaterials.
 * Returns the hex values read back from those materials (not the parse input).
 */
export function resolveRoomPropMaterialColours(prop: RoomPropColourInput): RoomPropMaterialColours {
  const bodyParsed = parseRuntimeRoomPropColorHex(prop.colorHex, ROOM_PROP_BODY_COLOR_FALLBACK);
  const accentParsed = parseRuntimeRoomPropColorHex(prop.accentColorHex, ROOM_PROP_ACCENT_COLOR_FALLBACK);
  const bodyMaterial = new MeshStandardMaterial({ color: bodyParsed, roughness: 0.7 });
  const accentMaterial = new MeshStandardMaterial({ color: accentParsed, roughness: 0.62 });
  try {
    return {
      propId: prop.propId,
      bodyColor: bodyMaterial.color.getHex(),
      accentColor: accentMaterial.color.getHex(),
    };
  } finally {
    bodyMaterial.dispose();
    accentMaterial.dispose();
  }
}

/**
 * Build material colours for a list of room props. Vitest-callable; same path
 * the runtime consumer uses for colour → material (not a palette by role).
 */
export async function buildRoomPropMaterialColours(input: {
  props: RoomPropColourInput[];
}): Promise<{ props: RoomPropMaterialColours[] }> {
  return {
    props: input.props.map((prop) => resolveRoomPropMaterialColours(prop)),
  };
}

/** Body/accent numbers for createDetailedEdRoomProps / roomProp meshes. */
export function roomPropColourNumbers(prop: {
  colorHex: string;
  accentColorHex: string;
}): { color: number; accentColor: number } {
  return {
    color: parseRuntimeRoomPropColorHex(prop.colorHex, ROOM_PROP_BODY_COLOR_FALLBACK),
    accentColor: parseRuntimeRoomPropColorHex(prop.accentColorHex, ROOM_PROP_ACCENT_COLOR_FALLBACK),
  };
}
