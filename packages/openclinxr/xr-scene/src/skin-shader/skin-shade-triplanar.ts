/**
 * Bind-pose object-space triplanar carrier for skin detail normals.
 *
 * Coordinates follow three r184 TriplanarTextures.js (local position and
 * local normal); normal reorientation is the whiteout blend from Ben Golus,
 * "Normal Mapping for a Triplanar Shader" (2017). Raw bind attributes keep
 * runtime viseme/motion morphs from moving the pore field.
 *
 * Detail perturbs the incoming view-space normal instead of replacing it:
 *   normal' = normalize(normal + B * (nDetailObject - nBindObject))
 * where B's columns are the bind object axes carried through the current
 * skin matrix and normalMatrix into view space. This preserves both the glTF
 * normal-map result and the skin blur applied before this detail block.
 */

export const SKIN_TRIPLANAR_BLEND_EXPONENT = 4.0;

/**
 * Derived by measure-triplanar-frequency.ts from mpfb-street-adult-male.glb:
 * 5,460 head-joint triangles (16,380 edges), UV Jacobian anisotropy < 4;
 * median |dUV|/|dPos| 0.890469879495367 /m * face UV scale 90.
 */
export const SKIN_FACE_DETAIL_TILES_PER_METRE = 80.14228915458304;

/**
 * Physical primary+secondary furrow-cell area used for cast actors under 60:
 * Aurégan JC, Bosser C, Bachy-Razzouk M, Bensidhoum M, Hoc T, Bioengineering
 * 2023;10(12):1338, doi:10.3390/bioengineering10121338, Table 3: healthy
 * volar-forearm replica, mean polygon (primary+secondary furrow cell) area
 * 0.09 +/- 0.007 mm^2, mean age 15.5 +/- 2.4 y.
 *
 * The >60 comparison is an upper bound: Bachy M, Bosser C, Villain B,
 * Aurégan JC, Materials 2022;15(22):8258, doi:10.3390/ma15228258, Table 1:
 * anterior forearm, 0.54 +/- 0.30 mm^2, women 61-96 y (n=22).
 */
export const SKIN_BODY_CELL_AREA_MM2 = 0.09;

/**
 * measure-body-tile-period.ts on the shipped street GLB's
 * OPENCLINXR_skin_shade.bodyDetailNormalTexture: image SHA-256 0d7f18ff...,
 * 256x256 px; radially averaged X/Y relief peaks are 18 cycles/tile at
 * 300624274.46643335 power, 21 at 287128804.7677376, and 24 at
 * 271735582.2127548. The second peak is >= 0.8 of the first, so the ruled
 * ambiguity tie-break uses 18: its 14.22 px period is closest to the visible
 * approximately 14 px primary+secondary furrow cell in the tile.
 */
export const SKIN_BODY_TILE_PEAK_CYCLES = 18;

/**
 * Physical spacing d = sqrt(0.09 mm^2) = 0.30 mm. One tile carries 18 cells,
 * so tiles/m = (1 / 0.00030 m) / 18. The area citations and >60 upper bound
 * are pinned on SKIN_BODY_CELL_AREA_MM2 above; tile provenance is pinned on
 * SKIN_BODY_TILE_PEAK_CYCLES.
 */
export const SKIN_BODY_DETAIL_TILES_PER_METRE =
  (1 / Math.sqrt(SKIN_BODY_CELL_AREA_MM2 * 1e-6)) / SKIN_BODY_TILE_PEAK_CYCLES;

export type SkinTriplanarPlane = "x" | "y" | "z";
export type SkinVec2 = readonly [number, number];
export type SkinVec3 = readonly [number, number, number];

/** CPU mirror of the GLSL projected coordinates (Golus plane orientation). */
export function skinTriplanarPlaneCoordinate(
  position: SkinVec3,
  plane: SkinTriplanarPlane,
  tilesPerMetre: number,
): SkinVec2 {
  if (plane === "x") return [position[2] * tilesPerMetre, position[1] * tilesPerMetre];
  if (plane === "y") return [position[0] * tilesPerMetre, position[2] * tilesPerMetre];
  return [position[0] * tilesPerMetre, position[1] * tilesPerMetre];
}

/** Dominant projection plane, matching the largest triplanar blend weight. */
export function dominantSkinTriplanarPlane(normal: SkinVec3): SkinTriplanarPlane {
  const absolute = normal.map(Math.abs);
  if (absolute[0]! >= absolute[1]! && absolute[0]! >= absolute[2]!) return "x";
  return absolute[1]! >= absolute[2]! ? "y" : "z";
}

/** CPU mirror of the object-space deviation added by the fragment shader. */
export function skinDetailObjectDeviation(detail: SkinVec3, bind: SkinVec3): SkinVec3 {
  return [detail[0] - bind[0], detail[1] - bind[1], detail[2] - bind[2]];
}

/** Varyings and whiteout reorientation shared by the face and body tiles. */
/**
 * The pinned triplanar detail constants as one frozen record, for consumers outside this module
 * (the package tests read them through the entrypoint). Each value's provenance is on its source
 * constant above; this record adds no number of its own.
 */
export const SKIN_TRIPLANAR_DETAIL = Object.freeze({
  faceTilesPerMetre: SKIN_FACE_DETAIL_TILES_PER_METRE,
  bodyTilesPerMetre: SKIN_BODY_DETAIL_TILES_PER_METRE,
  bodyCellAreaMm2: SKIN_BODY_CELL_AREA_MM2,
  bodyTilePeakCycles: SKIN_BODY_TILE_PEAK_CYCLES,
});

/**
 * CPU mirror of the GLSL triplanar math (plane coordinate, dominant plane, detail deviation),
 * built from the same constants as the shader strings so the two cannot drift.
 */
export const skinTriplanarCpuMirror = Object.freeze({
  planeCoordinate: skinTriplanarPlaneCoordinate,
  dominantPlane: dominantSkinTriplanarPlane,
  detailObjectDeviation: skinDetailObjectDeviation,
});

export function skinShadeTriplanarVaryingsGlsl(): string {
  return `varying vec3 vSkinBindPos;
varying vec3 vSkinBindN;
varying vec3 vSkinAxisX;
varying vec3 vSkinAxisY;
varying vec3 vSkinAxisZ;`;
}

/** Fragment declarations and whiteout reorientation shared by both tiles. */
export function skinShadeTriplanarParsGlsl(): string {
  return /* glsl */ `${skinShadeTriplanarVaryingsGlsl()}
vec3 skinTriplanarWeights(vec3 bindNormal) {
  vec3 weights = pow(abs(bindNormal), vec3(${SKIN_TRIPLANAR_BLEND_EXPONENT.toFixed(1)}));
  return weights / max(dot(weights, vec3(1.0)), 0.0001);
}
vec2 skinTriplanarUvX(vec3 bindPosition, float frequency) { return bindPosition.zy * frequency; }
vec2 skinTriplanarUvY(vec3 bindPosition, float frequency) { return bindPosition.xz * frequency; }
vec2 skinTriplanarUvZ(vec3 bindPosition, float frequency) { return bindPosition.xy * frequency; }
vec3 skinTriplanarWhiteout(vec3 tangentX, vec3 tangentY, vec3 tangentZ, vec3 bindNormal) {
  tangentX = vec3(tangentX.xy + bindNormal.zy, tangentX.z * bindNormal.x);
  tangentY = vec3(tangentY.xy + bindNormal.xz, tangentY.z * bindNormal.y);
  tangentZ = vec3(tangentZ.xy + bindNormal.xy, tangentZ.z * bindNormal.z);
  vec3 weights = skinTriplanarWeights(bindNormal);
  return normalize(tangentX.zyx * weights.x + tangentY.xzy * weights.y + tangentZ.xyz * weights.z);
}
`;
}

/** Raw bind attributes are captured before morph-target and skinning chunks. */
export function skinShadeTriplanarVertexGlsl(): string {
  return /* glsl */ `vSkinBindPos = position;
vSkinBindN = normal;`;
}

/** View-space bind-axis basis, emitted after Three's skinning_vertex chunk. */
export function skinShadeTriplanarAxisVertexGlsl(): string {
  return /* glsl */ `#ifdef USE_SKINNING
vSkinAxisX = normalize(normalMatrix * (skinMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
vSkinAxisY = normalize(normalMatrix * (skinMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vSkinAxisZ = normalize(normalMatrix * (skinMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
#else
vSkinAxisX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
vSkinAxisY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
vSkinAxisZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
#endif`;
}

/** Face sampling plus the optional body-mask mix supplied by skin-shade-detail.ts. */
export function skinShadeTriplanarNormalGlsl(bodyNormalGlsl = ""): string {
  const faceFrequency = SKIN_FACE_DETAIL_TILES_PER_METRE.toFixed(14);
  return /* glsl */ `if (uSkinDetailNormalStrength > 0.0) {
  vec3 skinBindNormal = normalize(vSkinBindN);
  vec2 skinFaceUvX = skinTriplanarUvX(vSkinBindPos, ${faceFrequency});
  vec2 skinFaceUvY = skinTriplanarUvY(vSkinBindPos, ${faceFrequency});
  vec2 skinFaceUvZ = skinTriplanarUvZ(vSkinBindPos, ${faceFrequency});
  vec3 skinFaceNormalX = texture2D(uSkinDetailNormalMap, skinFaceUvX).xyz * 2.0 - 1.0;
  vec3 skinFaceNormalY = texture2D(uSkinDetailNormalMap, skinFaceUvY).xyz * 2.0 - 1.0;
  vec3 skinFaceNormalZ = texture2D(uSkinDetailNormalMap, skinFaceUvZ).xyz * 2.0 - 1.0;
  float skinFaceStrength = uSkinDetailNormalStrength * (1.0 - skinLip);
  skinFaceNormalX.xy *= skinFaceStrength;
  skinFaceNormalY.xy *= skinFaceStrength;
  skinFaceNormalZ.xy *= skinFaceStrength;
  vec3 skinDetailObjectNormal = skinTriplanarWhiteout(
    normalize(skinFaceNormalX), normalize(skinFaceNormalY), normalize(skinFaceNormalZ), skinBindNormal
  );
${bodyNormalGlsl}  vec3 skinDetailObjectDeviation = skinDetailObjectNormal - skinBindNormal;
  vec3 skinDetailViewDeviation = mat3(vSkinAxisX, vSkinAxisY, vSkinAxisZ) * skinDetailObjectDeviation;
  normal = normalize(normal + skinDetailViewDeviation);
}`;
}
