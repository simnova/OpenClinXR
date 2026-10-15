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
 * Frames (h1, derived from this mesh — never assumed): globe-object space is
 * Y-up, iris faces +Z (pupil-vert normals ≈ +Z both eyes); +u maps +X (corr
 * 0.992). The tangent frame comes from the per-eye uniforms below.
 *
 * UV convention: three.js sampling (flipY=false, v=0 at image top). Disk
 * centres in landed iris-centred-c.png (1024): A px-top (299.55, 724.00),
 * B px-top (724.65, 302.72), radius 135px, pupil core ~35px. Landed
 * orientation presents the iris unwired (h1 grade top row); no UV flip.
 */

import type {
  MeshPhysicalMaterial,
  MeshStandardMaterial,
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
 * Iris disk centres in file-UV numerals (three sampling, v=0 at image top,
 * no flip): anat-L (0.2925, 0.7070), anat-R (0.7077, 0.2956) — the landed
 * px-top pupils A (299.55, 724.00) and B (724.65, 302.72) over 1024.
 * The landed orientation presents the iris unwired (h1 grade top row).
 */
export const EYE_IRIS_CENTER_L_UV: readonly [number, number] = [
  299.55 / 1024, 724.0 / 1024,
];
export const EYE_IRIS_CENTER_R_UV: readonly [number, number] = [
  724.65 / 1024, 302.72 / 1024,
];

/**
 * Iris axes in globe-object space, h1-derived from this mesh (never assumed,
 * never fitted): mean outward normals of the 31 verts per chart whose file-UV
 * falls inside the pupil disc (aisha-realism.glb 9135b4a4). Falsifier: ~91deg
 * off the old forward -Y — proceed. (~1.6deg off the old up +Z, but +Z-as-up
 * was the degeneracy itself: cross(+Z, N≈+Z) collapses the frame. The forward
 * axis is what the model used; that is 90deg off.)
 */
export const EYE_IRIS_AXIS_L: readonly [number, number, number] = [
  0.013213, 0.023112, 0.999646,
];
export const EYE_IRIS_AXIS_R: readonly [number, number, number] = [
  -0.013361, -0.028234, 0.999512,
];

/**
 * Frame reference per eye (h1): the bake is Y-up in globe-object space, so +Y
 * anchors the frame. Mesh-derived like the axis: yields T≈+X per the fit.
 */
export const EYE_IRIS_UP_L: readonly [number, number, number] = [0, 1, 0];
export const EYE_IRIS_UP_R: readonly [number, number, number] = [0, 1, 0];

export type EyeSide = "L" | "R";

/** Select the iris centre for a fragment UV (charts split at u=0.5). */
export function irisCenterForUv(uv: readonly [number, number]): EyeSide {
  return uv[0] < 0.5 ? "L" : "R";
}

export function irisCenterUv(side: EyeSide): readonly [number, number] {
  return side === "L" ? EYE_IRIS_CENTER_L_UV : EYE_IRIS_CENTER_R_UV;
}

/** Per-eye iris axis (object space): u<0.5 -> anat-L. */
export function irisAxis(side: EyeSide): readonly [number, number, number] {
  return side === "L" ? EYE_IRIS_AXIS_L : EYE_IRIS_AXIS_R;
}

/** Per-eye frame reference (object space): u<0.5 -> anat-L. */
export function irisUp(side: EyeSide): readonly [number, number, number] {
  return side === "L" ? EYE_IRIS_UP_L : EYE_IRIS_UP_R;
}

export type V3 = readonly [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
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

/**
 * Per-eye tangent frame from the derived uniforms (h1): T along texture +u, B
 * along texture +v. NOTE the mirrored B order: the bake's V runs toward -Y
 * (position-vs-UV fit within ~7deg on both charts), so B = TxA, not AxT.
 * Replaces the old fixed +Z up, which collapses where this mesh faces +Z.
 */
export function eyeFrame(side: EyeSide): { T: V3; B: V3; A: V3 } {
  const A = vnorm(irisAxis(side));
  const U = irisUp(side);
  const T = vnorm(cross(U, A));
  const B = vnorm(cross(T, A));
  return { T, B, A };
}

export type PlaneHit = {
  /** Sample point minus fragment (object space, metres). Lies ~in-plane. */
  rel: V3;
  /** Virtual cornea surface point (object space, metres; debug/grading). */
  surface: V3;
};

/**
 * Virtual-cornea plane-hit for one fragment. P = fragment (object metres),
 * V = surface->camera (unit), A = iris axis (unit, per-eye uniform), C =
 * sphere centre (object metres, one per eye). Null on TIR/miss. Mirrors GLSL;
 * the iris plane is perpendicular to A.
 */
export function corneaPlaneHit(P: V3, V: V3, A: V3, C: V3): PlaneHit | null {
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
  const den = dot(Rr, A);
  if (Math.abs(den) < 1e-9) return null;
  const s2 = dot(sub(P, S), A) / den;
  const H = add(S, mul(Rr, s2));
  return { rel: sub(H, P), surface: S };
}

/**
 * Reconstruct the fixed per-eye sphere centre from a fragment's own UV (its
 * tangent offset from the iris centre; uv<->metres locally uniform at the
 * iris). Frame and axis are per-eye uniforms (derived, never fixed). Mirrors
 * the GLSL reconstruction.
 */
export function eyeSphereCenter(
  P: V3,
  uv: readonly [number, number],
  side: EyeSide,
): { C: V3; T: V3; B: V3; A: V3 } {
  const irisC = irisCenterUv(side);
  const { T, B, A } = eyeFrame(side);
  const du = uv[0] - irisC[0];
  const dv = uv[1] - irisC[1];
  const C: V3 = add(
    sub(sub(P, mul(T, du / EYE_UV_PER_METRE)), mul(B, dv / EYE_UV_PER_METRE)),
    mul(A, EYE_CHAMBER_M - EYE_CORNEA_R_M),
  );
  return { C, T, B, A };
}

/**
 * UV-space sample offset for a fragment through the reconstructed per-eye
 * sphere, projected into the measured tangent frame. Mirrors the GLSL.
 */
export function sampleOffsetUv(
  P: V3,
  V: V3,
  uv: readonly [number, number],
  side: EyeSide,
): [number, number] | null {
  const { C, T, B, A } = eyeSphereCenter(P, uv, side);
  const h = corneaPlaneHit(P, V, A, C);
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
 * Eye-frame-internal: the h1 axis fix keeps these numerals (rotation-invariant).
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

export type ResolvedEyeShaderOptions = {
  pupilScale: number;
  limbusStrength: number;
  limbusTint: [number, number, number];
};

/**
 * Fail-closed option resolution (tsk_4ca1eb82092e11bd wiring): non-finite or
 * non-positive pupil scales and non-finite/negative limbus strengths refuse
 * before any hook installs. Pupil scale 0 would divide in applyPupilScale
 * and in the GLSL pupil term, so the floor is strictly positive.
 */
export function resolveEyeShaderOptions(options: EyeShaderOptions = {}): ResolvedEyeShaderOptions {
  const pupilScale = options.pupilScale ?? EYE_SHADER_DEFAULTS.pupilScale;
  if (typeof pupilScale !== "number" || !Number.isFinite(pupilScale) || pupilScale <= 0) {
    throw new Error(`eyeShade.pupilScale must be a finite number > 0, got ${JSON.stringify(pupilScale)}`);
  }
  const limbusStrength = options.limbusStrength ?? EYE_SHADER_DEFAULTS.limbusStrength;
  if (typeof limbusStrength !== "number" || !Number.isFinite(limbusStrength) || limbusStrength < 0) {
    throw new Error(`eyeShade.limbusStrength must be a finite number >= 0, got ${JSON.stringify(limbusStrength)}`);
  }
  const limbusTint = options.limbusTint ?? EYE_SHADER_DEFAULTS.limbusTint;
  if (
    !Array.isArray(limbusTint) ||
    limbusTint.length !== 3 ||
    limbusTint.some((c) => typeof c !== "number" || !Number.isFinite(c))
  ) {
    throw new Error(`eyeShade.limbusTint must be a triple of finite numbers, got ${JSON.stringify(limbusTint)}`);
  }
  return {
    pupilScale,
    limbusStrength,
    limbusTint: [limbusTint[0]!, limbusTint[1]!, limbusTint[2]!],
  };
}

const eyeInstalled = new WeakSet<object>();

/**
 * True when applyEyeShader has hooked this material (drives the
 * applyMaterialOverrides eyeShade readback, not a JSON field).
 */
export function eyeShaderInstalled(material: object): boolean {
  return eyeInstalled.has(material);
}

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
    vec3 irisA = normalize(vMapUv.x < 0.5 ? uIrisAxisL : uIrisAxisR);
    vec3 irisU = vMapUv.x < 0.5 ? uIrisUpL : uIrisUpR;
    vec3 eyeV = normalize(vEyeViewDirOS);
    // Per-eye frame from the derived uniforms (h1): T along +u, B along +v.
    // Mirrored B order (bake V runs -Y; AxT would mirror v). Replaces the old
    // fixed +Z up, which collapses where this mesh faces +Z.
    vec3 T = normalize(cross(irisU, irisA));
    vec3 B = cross(T, irisA);
    // Sphere centre lies on the iris AXIS (uniform), not a fixed normal.
    vec2 duv = vMapUv - irisC;
    vec3 C = vEyePosOS - T * (duv.x / uUvPerMetre) - B * (duv.y / uUvPerMetre)
           + irisA * (uChamberM - uCorneaRM);
    vec3 oc = vEyePosOS - C;
    float b = dot(oc, eyeV);
    float c = dot(oc, oc) - uCorneaRM * uCorneaRM;
    float disc = b * b - c;
    if (disc > 0.0) {
      float s = -b + sqrt(disc);
      vec3 S = vEyePosOS + eyeV * s;
      vec3 Ns = normalize(S - C);
      vec3 Rr = refract(-eyeV, Ns, 1.0 / uCorneaIOR);
      float den = dot(Rr, irisA);
      if (abs(den) > 1e-6) {
        float s2 = dot(vEyePosOS - S, irisA) / den;
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

/** Vertex-stage GLSL: object-space position/view varyings (the eye block uses the per-eye axis, not the fragment normal). */
export function eyeParallaxVertexGlsl(): string {
  return /* glsl */ `
  vEyePosOS = position;
  vec3 objCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vEyeViewDirOS = objCam - position;
  `;
}

/**
 * Hook a globe (iris) material. Chains with any existing onBeforeCompile. No
 * transmission pass, no emissive (catch-light stays on the shell). No UV flip
 * (landed orientation presents the iris); the iris axis is a per-eye uniform.
 */
export function applyEyeShader(
  material: MeshStandardMaterial | MeshPhysicalMaterial,
  options: EyeShaderOptions = {},
): MeshStandardMaterial | MeshPhysicalMaterial {
  const resolved = resolveEyeShaderOptions(options);
  const { pupilScale, limbusStrength, limbusTint } = resolved;
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
    shader.uniforms["uIrisAxisL"] = {
      value: [EYE_IRIS_AXIS_L[0], EYE_IRIS_AXIS_L[1], EYE_IRIS_AXIS_L[2]],
    };
    shader.uniforms["uIrisAxisR"] = {
      value: [EYE_IRIS_AXIS_R[0], EYE_IRIS_AXIS_R[1], EYE_IRIS_AXIS_R[2]],
    };
    shader.uniforms["uIrisUpL"] = {
      value: [EYE_IRIS_UP_L[0], EYE_IRIS_UP_L[1], EYE_IRIS_UP_L[2]],
    };
    shader.uniforms["uIrisUpR"] = {
      value: [EYE_IRIS_UP_R[0], EYE_IRIS_UP_R[1], EYE_IRIS_UP_R[2]],
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
        "#include <common>\nvarying vec3 vEyePosOS;\nvarying vec3 vEyeViewDirOS;",
      )
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>\n${eyeParallaxVertexGlsl()}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vEyePosOS;\nvarying vec3 vEyeViewDirOS;\nuniform vec2 uIrisCenterL;\nuniform vec2 uIrisCenterR;\nuniform vec3 uIrisAxisL;\nuniform vec3 uIrisAxisR;\nuniform vec3 uIrisUpL;\nuniform vec3 uIrisUpR;\nuniform float uIrisRadiusU;\nuniform float uLimbusWidthU;\nuniform float uPupilScale;\nuniform float uLimbusStrength;\nuniform vec3 uLimbusTint;\nuniform float uCorneaIOR;\nuniform float uCorneaRM;\nuniform float uChamberM;\nuniform float uUvPerMetre;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\n${eyeParallaxGlsl()}`,
      );
  };
  material.customProgramCacheKey = () =>
    `openclinxr-eye-shader:p${pupilScale}:l${limbusStrength}`;
  material.needsUpdate = true;
  eyeInstalled.add(material);
  return material;
}
