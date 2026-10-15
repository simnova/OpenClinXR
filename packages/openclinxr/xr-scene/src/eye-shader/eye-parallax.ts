/**
 * Eye shader: iris parallax (virtual-cornea plane-hit), limbus ring, pupil scale.
 *
 * RED state (measured, see eye-shader-report.json): the landed eye is an iris
 * texture on the globe under a clear alpha shell. A Cycles refraction probe of that
 * landed geometry (concentric shell R 12.24mm over globe R 11.9mm) measures 0.00px
 * of refractive shift: identical pupil centres with the shell refractive vs hidden.
 * There is no onBeforeCompile hook, no limbus term, no pupil uniform anywhere in
 * the material path (grep: parallax|limbus|pupil|onBeforeCompile = no hits).
 *
 * This module adds the missing parallax WITHOUT a transmission pass (Quest cost
 * rejected in consult47 r2 P4). Model selection, measured: the cheap Jimenez
 * tangent offset (uv -= k*Vtan.xy) cannot span the true curve -- a least-squares
 * single gain leaves 5.2px error at +-40deg against the Cycles reference. The
 * shipped model is the HDRP plane-hit contract (consult47 r2 P4, r3 B1:
 * "Cornea Refraction node ... default IOR 1.333" as KNOWN-GOOD): refract the view
 * ray (Snell) at a virtual corneal sphere and intersect the iris plane. Shape
 * constants are RECORDED ANATOMY, never fitted, never Unity's HDRP offset constant:
 *   IOR 1.376 (Gullstrand exact schematic eye cornea; AAO 'Optical Properties of
 *     the Eye' n~1.3765; PMC3972707), cornea anterior R 7.7mm, chamber 3.0mm,
 *     iris diameter 12mm. Posterior surface omitted (recorded ~10% systematic on
 *     gain only; the gate compares approx-vs-ref under identical single-surface
 *     optics, so the omission cancels).
 * Zero shape parameters are fitted: the validation below is pure prediction
 * (<=0.93px vs Cycles at +-25/+-40, 1280px plate).
 *
 * Frames: object space is the mesh local frame (landed eye: z-up, forward -Y;
 * verified by mesh census). Texture +u aligns world +X (corr 0.992) and +v aligns
 * world +Z (corr 0.991), measured on front-iris loops (report cites script), so
 * the tangent frame T=cross(up,N) -> +u, B=cross(N,T) -> +v needs no mirror.
 *
 * UV convention: three.js sampling (flipY=false, v=0 at image top). Iris disk
 * centres were measured in landed iris-centred-c.png (1024): disk A px-top
 * (299.55, 724.00), disk B px-top (724.65, 302.72), radius 135px, pupil dark core
 * to ~35px. The texture as landed is V-flipped relative to the runtime sampler
 * (disks land on-globe only under Blender-native sampling); the follow-up wiring
 * slice must V-flip the texture (or flipY=true the eye load). Defaults below are
 * for the FIXED (flipped) texture and cross-checked against mesh front-vert
 * median file-UVs anat-R (0.705, 0.699), anat-L (0.294, 0.298). Eye selection:
 * fragment u<0.5 -> anat-L.
 */

import type {
  MeshPhysicalMaterial,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from "three";

/** Gullstrand exact schematic eye cornea refractive index (AAO/PMC3972707). */
export const EYE_CORNEA_IOR = 1.376;
/** Gullstrand anterior corneal radius, metres. */
export const EYE_CORNEA_R_M = 0.0077;
/** Anterior chamber depth (corneal apex -> iris plane), metres. */
export const EYE_CHAMBER_M = 0.003;
/** Human iris diameter, metres. */
export const EYE_IRIS_DIAM_M = 0.012;

/** Iris disk radius in texture UV (135px / 1024), measured (report cites script). */
export const EYE_IRIS_RADIUS_UV = 135 / 1024;
/** Limbus transition width in texture UV (~120px -> ~150px profile), measured. */
export const EYE_LIMBUS_WIDTH_UV = 30 / 1024;
/** Pupil dark-core radius in texture UV (~35px / 1024), measured. */
export const EYE_PUPIL_RADIUS_UV = 35 / 1024;

/** Metres -> iris-UV scale at the iris ((2*135/1024)/0.012), measured geometry. */
export const EYE_UV_PER_METRE = (2 * EYE_IRIS_RADIUS_UV) / EYE_IRIS_DIAM_M;

/**
 * Iris disk centres in three-sampling UV numerals (v=0 at image top) for the
 * FIXED (V-flipped) texture: anat-L (0.2925, 0.2929), anat-R (0.7077, 0.7043).
 * Cross-checked against mesh front-vert median file-UVs (report).
 */
export const EYE_IRIS_CENTER_L_UV: readonly [number, number] = [
  299.55 / 1024, 300.0 / 1024,
];
export const EYE_IRIS_CENTER_R_UV: readonly [number, number] = [
  724.65 / 1024, 721.28 / 1024,
];

export type EyeSide = "L" | "R";

/** Select the iris centre for a fragment UV (charts split at u=0.5). */
export function irisCenterForUv(uv: readonly [number, number]): EyeSide {
  return uv[0] < 0.5 ? "L" : "R";
}

export function irisCenterUv(side: EyeSide): readonly [number, number] {
  return side === "L" ? EYE_IRIS_CENTER_L_UV : EYE_IRIS_CENTER_R_UV;
}

export type V3 = readonly [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const vnorm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** GLSL refract() mirrored exactly (I incident, N normal, eta n1/n2). */
export function snellRefract(I: V3, N: V3, eta: number): V3 | null {
  const cosi = -dot(I, N);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return vnorm(add(mul(I, eta), mul(N, eta * cosi - Math.sqrt(k))));
}

/** Lateral/up tangent frame: T -> texture +u, B -> texture +v (measured). */
export function frameOf(N: V3): { T: V3; B: V3 } {
  const up: V3 = [0, 0, 1];
  const T = vnorm([
    up[1] * N[2] - up[2] * N[1],
    up[2] * N[0] - up[0] * N[2],
    up[0] * N[1] - up[1] * N[0],
  ]);
  const B: V3 = vnorm([
    N[1] * T[2] - N[2] * T[1],
    N[2] * T[0] - N[0] * T[2],
    N[0] * T[1] - N[1] * T[0],
  ]);
  return { T, B };
}

export type PlaneHit = {
  /** Sample point minus fragment (object space, metres). Lies ~in-plane. */
  rel: V3;
  /** Virtual cornea surface point (object space, metres; debug/grading). */
  surface: V3;
};

/**
 * Virtual-cornea plane-hit for one fragment. P = fragment (object metres),
 * V = surface->camera (unit), N = outward normal (unit), C = virtual corneal
 * sphere centre (object metres; ONE sphere per eye, fixed). Returns null on
 * TIR/miss. This is the exact math the GLSL below evaluates per fragment.
 */
export function corneaPlaneHit(P: V3, V: V3, N: V3, C: V3): PlaneHit | null {
  const R = EYE_CORNEA_R_M;
  const oc = sub(P, C);
  const b = dot(oc, V);
  const c = dot(oc, oc) - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = -b + Math.sqrt(disc);
  if (s < 0) return null;
  const S = add(P, mul(V, s));
  const Ns = vnorm(sub(S, C));
  const Rr = snellRefract(mul(V, -1), Ns, 1 / EYE_CORNEA_IOR);
  if (!Rr) return null;
  const den = dot(Rr, N);
  if (Math.abs(den) < 1e-9) return null;
  const s2 = dot(sub(P, S), N) / den;
  const H = add(S, mul(Rr, s2));
  return { rel: sub(H, P), surface: S };
}

/**
 * Reconstruct the fixed per-eye sphere centre from a fragment: the fragment's
 * own UV gives its tangent offset from the iris centre (the uv<->metres map is
 * locally uniform at the iris, measured). Mirrors the GLSL reconstruction.
 */
export function eyeSphereCenter(
  P: V3,
  N: V3,
  uv: readonly [number, number],
  irisC: readonly [number, number],
): { C: V3; T: V3; B: V3 } {
  const { T, B } = frameOf(N);
  const du = uv[0] - irisC[0];
  const dv = uv[1] - irisC[1];
  const C: V3 = add(
    sub(sub(P, mul(T, du / EYE_UV_PER_METRE)), mul(B, dv / EYE_UV_PER_METRE)),
    mul(N, EYE_CHAMBER_M - EYE_CORNEA_R_M),
  );
  return { C, T, B };
}

/**
 * UV-space sample offset for a fragment: exact trace through the reconstructed
 * per-eye sphere, projected into the measured tangent frame. Mirrors the GLSL.
 */
export function sampleOffsetUv(
  P: V3,
  V: V3,
  N: V3,
  uv: readonly [number, number],
  irisC: readonly [number, number],
): [number, number] | null {
  const { C, T, B } = eyeSphereCenter(P, N, uv, irisC);
  const h = corneaPlaneHit(P, V, N, C);
  if (!h) return null;
  return [dot(h.rel, T) * EYE_UV_PER_METRE, dot(h.rel, B) * EYE_UV_PER_METRE];
}

/**
 * Pupil scale about the iris centre (disk-relative UV coords, centre 0).
 * scale=1 is an EXACT no-op (early return): max abs error 0 by construction,
 * mirrored by a `uPupilScale == 1.0` bypass in the GLSL.
 */
export function applyPupilScale(
  rel: readonly [number, number],
  scale: number,
): [number, number] {
  if (scale === 1) return [rel[0], rel[1]];
  return [rel[0] / scale, rel[1] / scale];
}

/**
 * Limbus mask: 0 deep inside the iris, 1 at/past the limbus edge.
 * r = radial distance in texture UV from the iris centre.
 */
export function limbusMask(
  r: number,
  irisRadiusUv: number = EYE_IRIS_RADIUS_UV,
  limbusWidthUv: number = EYE_LIMBUS_WIDTH_UV,
): number {
  const inner = irisRadiusUv - limbusWidthUv;
  const t = (r - inner) / Math.max(limbusWidthUv, 1e-9);
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/**
 * Predicted apparent pupil position (eye-frame metres, lateral x) for an eye
 * yawed `yawDeg` about the vertical through the iris centre, ortho camera
 * fixed. Solves sample==pupil for the apparent fragment (bisection on the
 * eye-frame x of corneaPlaneHit rel). Validated: <=0.93px vs the Cycles
 * single-surface reference at +-25/+-40 (1280px plate), ZERO fitted parameters.
 */
export function predictApparentMm(yawDeg: number): number {
  const th = (yawDeg * Math.PI) / 180;
  const V: V3 = [-Math.sin(th), -Math.cos(th), 0];
  const N: V3 = [0, -1, 0];
  const C: V3 = [0, EYE_CORNEA_R_M - EYE_CHAMBER_M, 0];
  const f = (x: number): number => {
    const h = corneaPlaneHit([x, 0, 0], V, N, C);
    return h ? h.rel[0] + x : NaN;
  };
  let a = -0.002;
  let b = 0.002;
  let fa = f(a);
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (Number.isNaN(fm)) break;
    if ((fa < 0) === (fm < 0)) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return (a + b) / 2;
}

/** Reference plate scale of the Cycles renders (1280px over 30mm ortho). */
export const EYE_REF_PLATE_PX_PER_MM = 1280 / 30;

/** Predicted apparent pupil shift in reference-plate px (for grading). */
export function predictApparentPx(yawDeg: number): number {
  const th = (yawDeg * Math.PI) / 180;
  return predictApparentMm(yawDeg) * 1000 * Math.cos(th) * EYE_REF_PLATE_PX_PER_MM;
}

export type EyeShaderOptions = {
  pupilScale?: number;
  limbusStrength?: number;
  /** Limbus tint multiplied at the ring (darkens the sclera-facing edge). */
  limbusTint?: [number, number, number];
};

export const EYE_SHADER_DEFAULTS = {
  pupilScale: 1,
  limbusStrength: 0.4,
  limbusTint: [0.35, 0.22, 0.16] as [number, number, number],
};

/**
 * GLSL injected AFTER `#include <map_fragment>` on the globe (iris) material
 * (guarded by USE_MAP: the globe always carries the iris map). No transmission
 * pass, no emissive term, no baked catch-light: specular stays on the cornea
 * shell material, which this hook never touches.
 */
export function eyeParallaxGlsl(): string {
  return /* glsl */ `
  #ifdef USE_MAP
  {
    vec2 irisC = vMapUv.x < 0.5 ? uIrisCenterL : uIrisCenterR;
    vec3 eyeN = normalize(vEyeNormalOS);
    vec3 eyeV = normalize(vEyeViewDirOS);
    vec3 Tup = vec3(0.0, 0.0, 1.0);
    vec3 T = normalize(cross(Tup, eyeN) + vec3(1e-6, 0.0, 0.0));
    vec3 B = cross(eyeN, T);
    // Fixed per-eye sphere, reconstructed from the fragment's own UV (its
    // tangent offset from the iris centre; uv<->metres locally uniform).
    vec2 duv = vMapUv - irisC;
    vec3 C = vEyePosOS - T * (duv.x / uUvPerMetre) - B * (duv.y / uUvPerMetre)
           + eyeN * (uChamberM - uCorneaRM);
    vec3 oc = vEyePosOS - C;
    float b = dot(oc, eyeV);
    float c = dot(oc, oc) - uCorneaRM * uCorneaRM;
    float disc = b * b - c;
    if (disc > 0.0) {
      float s = -b + sqrt(disc);
      vec3 S = vEyePosOS + eyeV * s;
      vec3 Ns = normalize(S - C);
      vec3 Rr = refract(-eyeV, Ns, 1.0 / uCorneaIOR);
      float den = dot(Rr, eyeN);
      if (abs(den) > 1e-6) {
        float s2 = dot(vEyePosOS - S, eyeN) / den;
        vec3 rel = (S + Rr * s2) - vEyePosOS;
        vec2 off = vec2(dot(rel, T), dot(rel, B)) * uUvPerMetre;
        vec2 suv = vMapUv + off;
        vec2 pc = suv - irisC;
        // Pupil scale about the iris centre; ==1.0 is an exact bypass (G2).
        vec2 ps = (uPupilScale == 1.0) ? pc : pc / uPupilScale;
        float r = length(ps);
        float irisM = 1.0 - smoothstep(uIrisRadiusU - uLimbusWidthU, uIrisRadiusU, r);
        vec2 fuv = irisC + ps;
        vec4 irisTex = texture2D(map, fuv);
        float lb = smoothstep(uIrisRadiusU - uLimbusWidthU, uIrisRadiusU, r);
        vec3 limbusRgb = irisTex.rgb * mix(vec3(1.0), uLimbusTint, lb * uLimbusStrength);
        diffuseColor.rgb = mix(diffuseColor.rgb, limbusRgb, irisM);
      }
    }
  }
  #endif
  `;
}

/** Vertex-stage GLSL: object-space position/normal/view varyings. */
export function eyeParallaxVertexGlsl(): string {
  return /* glsl */ `
  vEyePosOS = position;
  vEyeNormalOS = objectNormal;
  vec3 objCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vEyeViewDirOS = objCam - position;
  `;
}

/**
 * Hook a globe (iris) material. Chains with any existing onBeforeCompile.
 * Never touches transmission (stays 0: no extra pass on Quest) and never
 * adds emissive (catch-light stays on the shell).
 */
export function applyEyeShader(
  material: MeshPhysicalMaterial,
  options: EyeShaderOptions = {},
): MeshPhysicalMaterial {
  const pupilScale = options.pupilScale ?? EYE_SHADER_DEFAULTS.pupilScale;
  const limbusStrength =
    options.limbusStrength ?? EYE_SHADER_DEFAULTS.limbusStrength;
  const limbusTint = options.limbusTint ?? EYE_SHADER_DEFAULTS.limbusTint;
  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    prev?.(shader, renderer);
    shader.uniforms["uIrisCenterL"] = {
      value: [EYE_IRIS_CENTER_L_UV[0], EYE_IRIS_CENTER_L_UV[1]],
    };
    shader.uniforms["uIrisCenterR"] = {
      value: [EYE_IRIS_CENTER_R_UV[0], EYE_IRIS_CENTER_R_UV[1]],
    };
    shader.uniforms["uIrisRadiusU"] = { value: EYE_IRIS_RADIUS_UV };
    shader.uniforms["uLimbusWidthU"] = { value: EYE_LIMBUS_WIDTH_UV };
    shader.uniforms["uPupilScale"] = { value: pupilScale };
    shader.uniforms["uLimbusStrength"] = { value: limbusStrength };
    shader.uniforms["uLimbusTint"] = { value: limbusTint };
    shader.uniforms["uCorneaIOR"] = { value: EYE_CORNEA_IOR };
    shader.uniforms["uCorneaRM"] = { value: EYE_CORNEA_R_M };
    shader.uniforms["uChamberM"] = { value: EYE_CHAMBER_M };
    shader.uniforms["uUvPerMetre"] = { value: EYE_UV_PER_METRE };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vEyePosOS;\nvarying vec3 vEyeNormalOS;\nvarying vec3 vEyeViewDirOS;",
      )
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>\n${eyeParallaxVertexGlsl()}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vEyePosOS;\nvarying vec3 vEyeNormalOS;\nvarying vec3 vEyeViewDirOS;\nuniform vec2 uIrisCenterL;\nuniform vec2 uIrisCenterR;\nuniform float uIrisRadiusU;\nuniform float uLimbusWidthU;\nuniform float uPupilScale;\nuniform float uLimbusStrength;\nuniform vec3 uLimbusTint;\nuniform float uCorneaIOR;\nuniform float uCorneaRM;\nuniform float uChamberM;\nuniform float uUvPerMetre;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\n${eyeParallaxGlsl()}`,
      );
  };
  material.customProgramCacheKey = () =>
    `openclinxr-eye-shader:p${pupilScale}:l${limbusStrength}`;
  material.needsUpdate = true;
  return material;
}
