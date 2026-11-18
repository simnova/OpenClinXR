/** Capture spec model: P1a camera math and isolated-subject spec assembly (station render-parity). */

import type { CameraRec, Vec3 } from "./capture-args.js";

export const HDRI_URL = "/cagematch/aisha-parity/studio_small_09_2k.hdr";
const BODY_GLB = "generated-humanoids/mpfb-ob-patient-aisha.glb";
function vsub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vcross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vnorm(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  if (!(n > 0)) throw new Error("zero-length camera vector — refusing");
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** P1a calib placement in three-space: chrome = depth - gap*right, grey = depth + gap*right. */
export function calibSpheres(headFront: CameraRec): { radiusM: number; chromeCenter: Vec3; greyCenter: Vec3 } {
  const fwd = vnorm(vsub(headFront.three.target, headFront.three.position));
  const right = vnorm(vcross(fwd, headFront.three.up));
  const gap = 0.048;
  const t = headFront.three.target;
  return {
    radiusM: 0.035,
    chromeCenter: [t[0] - gap * right[0], t[1] - gap * right[1], t[2] - gap * right[2]],
    greyCenter: [t[0] + gap * right[0], t[1] + gap * right[1], t[2] + gap * right[2]],
  };
}

export function buildSpec(cam: CameraRec, opts: {
  levers: Record<string, unknown>;
  masks: boolean;
  calibSpheres: { radiusM: number; chromeCenter: Vec3; greyCenter: Vec3 } | null;
  nohair: boolean;
  /** P2d probe: forward the product eye path flag (lab refuses it in parity mode — recorded). */
  eyeShading?: boolean;
}): Record<string, unknown> {
  const cameraOverride = {
    position: cam.three.position,
    target: cam.three.target,
    up: cam.three.up,
    vfovDeg: cam.vfov_deg,
    width: cam.resolution[0],
    height: cam.resolution[1],
    near: cam.near,
    far: cam.far,
  };
  if (opts.masks) {
    return {
      subjectId: "aisha-parity",
      subjectKind: "glb",
      bodyGlb: BODY_GLB,
      skinShadeLoader: true,
      cameraOverride,
      masks: true,
      ...(opts.nohair ? { hideHair: true } : {}),
    };
  }
  const { rotationYDeg, intensity, ...parityLevers } = opts.levers as {
    rotationYDeg?: number;
    intensity?: number;
    [k: string]: unknown;
  };
  const spec: Record<string, unknown> = {
    subjectId: "aisha-parity",
    subjectKind: "glb",
    bodyGlb: BODY_GLB,
    skinShadeLoader: true,
    cameraOverride,
    rigOverride: {
      hdri: {
        url: HDRI_URL,
        rotationYDeg: rotationYDeg ?? 0,
        intensity: intensity ?? 1,
        background: true,
      },
    },
    parity: {
      toneMapping: "AgX",
      exposure: 1,
      ...parityLevers,
    },
    ...(opts.nohair ? { hideHair: true } : {}),
    ...(opts.eyeShading ? { eyeRuntimeShading: true } : {}),
  };
  if (opts.calibSpheres) {
    (spec as Record<string, unknown>)["calib"] = { spheres: opts.calibSpheres };
  }
  return spec;
}

export function subjectUrl(baseUrl: string, spec: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}
