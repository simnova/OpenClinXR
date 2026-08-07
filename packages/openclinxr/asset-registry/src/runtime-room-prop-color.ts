/**
 * Room-prop colour convention for `EncounterRuntimeRoomProp.colorHex` /
 * `accentColorHex` (see runtime-bundles.ts).
 *
 * Convention (pinned here next to the type surface): CSS hex strings —
 * either `#rrggbb` / `#RRGGBB` or bare `rrggbb` / `RRGGBB`. Producers may emit
 * either form; consumers MUST strip an optional leading `#` before parsing.
 * A producer-only bare-hex fix would leave shipped public manifests broken.
 *
 * Malformed / empty / non-hex values fall back — scene load must not throw for
 * a typo.
 */

/** Body / primary material fallback when colour is missing or unparseable. */
export const ROOM_PROP_BODY_COLOR_FALLBACK = 0xd9dde3;

/** Accent material fallback when colour is missing or unparseable. */
export const ROOM_PROP_ACCENT_COLOR_FALLBACK = 0x2563eb;

/**
 * Parse a room-prop colourHex / accentColorHex value into a three.js-ready
 * 0xRRGGBB number. Accepts CSS `#` prefix or bare hex. Returns `fallback`
 * for empty, non-string, wrong-length, or non-hex input (never throws).
 */
export function parseRuntimeRoomPropColorHex(
  value: string | null | undefined,
  fallback: number,
): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const bare = value.trim().replace(/^#/u, "");
  if (!/^[0-9a-fA-F]{6}$/u.test(bare)) {
    return fallback;
  }
  const parsed = Number.parseInt(bare, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}
