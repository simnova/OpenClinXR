/** Hair Editor slider ranges (trial spec §4.1 and §4.2). Exact bounds; do not invent sliders. */

export type HairRange = { min: number; max: number };

export const HAIR_RANGES: Record<string, HairRange> = {
  length: { min: 0, max: 10 },
  density: { min: 0, max: 1 },
  thickness: { min: 0, max: 0.003 },
  frizz: { min: 0, max: 1 },
  roll: { min: 0, max: 1 },
  roll_radius: { min: 0.001, max: 0.005 },
  roll_length: { min: 0.001, max: 0.1 },
  clump: { min: 0, max: 1 },
  clump_distance: { min: 0.003, max: 0.05 },
  clump_shape: { min: -1, max: 1 },
  clump_tip_spread: { min: 0, max: 0.02 },
  noise: { min: 0, max: 1 },
  noise_distance: { min: 0, max: 0.01 },
  noise_scale: { min: 0, max: 20 },
  noise_shape: { min: 0, max: 1 },
  curl: { min: 0, max: 1 },
  curl_guide_distance: { min: 0, max: 0.1 },
  curl_radius: { min: 0, max: 0.1 },
  curl_frequency: { min: 0, max: 20 },
  color_noise_scale: { min: 0, max: 500 },
  darken_root: { min: 0, max: 1 },
  root_color_length: { min: 0, max: 1 },
};

/** Fur-only extras: use only when family is `fur`; refuse them on scalp hair. */
export const FUR_EXTRA_RANGES: Record<string, HairRange> = {
  length: { min: 0, max: 20 },
  roll_radius: { min: 0.001, max: 0.1 },
  noise_distance: { min: 0, max: 0.1 },
  holes: { min: 0, max: 1 },
  holes_scale: { min: 0, max: 200 },
};

export const FAMILIES = [
  "short",
  "bob",
  "long",
  "ponytail",
  "braid",
  "curly_voluminous",
  "facial",
  "eyebrow",
  "fur",
] as const;

export type Family = (typeof FAMILIES)[number];

export const COLOR_KEYS = ["color1", "color2"] as const;

export function rangeFor(name: string, family: string): HairRange | null {
  if (name === "length" && family === "fur") return FUR_EXTRA_RANGES["length"]!;
  if (name === "roll_radius" && family === "fur") return FUR_EXTRA_RANGES["roll_radius"]!;
  if (name === "noise_distance" && family === "fur") return FUR_EXTRA_RANGES["noise_distance"]!;
  if (name === "holes" || name === "holes_scale") {
    return family === "fur" ? (FUR_EXTRA_RANGES[name] ?? null) : null;
  }
  return HAIR_RANGES[name] ?? null;
}
