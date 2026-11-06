/**
 * Face landmark UVs and mask radii for the portrait skin-shade flag.
 *
 * Split from skin-shade.ts (file-size zone budget 500); skin-shade.ts
 * re-exports every name, so callers keep importing from skin-shade.js.
 */

/** Aisha landmark UVs (derive/A/landmarks-uv.json, size 4096, row v*S). */
export const SKIN_NOSE_UV: readonly [number, number] = [0.86579, 0.51683];
export const SKIN_NOSTRIL_L_UV: readonly [number, number] = [0.87877, 0.49666];
export const SKIN_NOSTRIL_R_UV: readonly [number, number] = [0.87877, 0.53701];
export const SKIN_CHIN_UV: readonly [number, number] = [0.95968, 0.51683];
export const SKIN_BROW_INNER_L_UV: readonly [number, number] = [0.82466, 0.50067];
export const SKIN_BROW_INNER_R_UV: readonly [number, number] = [0.82745, 0.53292];
export const SKIN_LIP_CORNER_L_UV: readonly [number, number] = [0.91006, 0.50143];
export const SKIN_LIP_CORNER_R_UV: readonly [number, number] = [0.90978, 0.53211];
/**
 * lip-mid-upper (0.92046, 0.9082) is EXCLUDED: its v jumps 0.39 off the
 * corner/lower-mid line (v~0.517), a seam-side outlier. Lip centre is the
 * corner midpoint, consistent with lip-mid-lower (0.90664, 0.51684).
 */
export const SKIN_LIP_UV: readonly [number, number] = [
  (0.91006 + 0.90978) / 2,
  (0.50143 + 0.53211) / 2,
];

/** Disk radii as fractions of map size S: build_roughness.py R_NOSE/R_CHIN/R_FOREHEAD. */
export const SKIN_R_NOSE = 0.035;
export const SKIN_R_CHIN = 0.03;
export const SKIN_R_FOREHEAD = 0.055;
/** Forehead push past the brows: build_roughness.py FOREHEAD_PUSH 0.5. */
export const SKIN_FOREHEAD_PUSH = 0.5;
/** Lip/nostril disk radii (recorded implementation constants, sweep-graded). */
export const SKIN_R_LIP = 0.02;
export const SKIN_R_NOSTRIL = 0.012;
/** Mask feather in UV: blur-12 at 4096 ~= 0.0029 (build_roughness.py). */
export const SKIN_FEATHER_UV = 0.004;
