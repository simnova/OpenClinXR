import { describe, expect, it } from "vitest";

import { MOTION_REGION_GUARD_RLQ, REGION_ANCHOR_SPACE } from "./plant-motion-regions.js";
import {
  violationsInTracks,
  type CompiledMotionFragment,
  type CompiledMotionTrack,
  type PrimitiveRequest,
  type QuatTuple,
} from "./canonical-motion-contract.js";

/**
 * Emitted-track trajectory: minimum-jerk approach, flat contact hold, minimum-jerk release.
 *
 * M4 proves the isolated 15/8 quintic. This file proves EMITTED tracks carry it: the reach
 * primitive's sampled approach/hold/release envelope, and the registered guard's contact-window
 * hold plus its release, measured from compiled output — never from the profile function.
 * look_at and cough_recoil are exercised only as the counterweight that they are NOT
 * contact-bearing, so this file cannot be misread as claiming them.
 *
 * SCOPE: guard approach span (bind -> peak) is a single LINEAR span — the guard plant pins
 * values[1] as the solved peak, so no intermediate may precede it. Minimum-jerk approach on
 * emitted keys is proven on reach; on guard this file proves the flat contact hold, the
 * minimum-jerk release, contact/support preservation, and seed sensitivity.
 *
 * NOT TESTED: anatomical or clinical plausibility; pixels; seed distribution shape.
 */

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

const asQuat = (q: QuatTuple): Quat => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

/** Angular distance, sign-invariant. */
function quatAngle(a: QuatTuple, b: QuatTuple): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function qRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const IDENTITY_Q: Quat = { x: 0, y: 0, z: 0, w: 1 };

function slerpQuats(a: Quat, b: Quat, t: number): Quat {
  if (t <= 0) return a;
  if (t >= 1) return b;
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let end = b;
  if (dot < 0) {
    end = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    dot = -dot;
  }
  if (dot > 0.9995) {
    const lerped = {
      x: a.x + (end.x - a.x) * t,
      y: a.y + (end.y - a.y) * t,
      z: a.z + (end.z - a.z) * t,
      w: a.w + (end.w - a.w) * t,
    };
    const n = Math.hypot(lerped.x, lerped.y, lerped.z, lerped.w) || 1;
    return { x: lerped.x / n, y: lerped.y / n, z: lerped.z / n, w: lerped.w / n };
  }
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return {
    x: a.x * wa + end.x * wb,
    y: a.y * wa + end.y * wb,
    z: a.z * wa + end.z * wb,
    w: a.w * wa + end.w * wb,
  };
}

// ── guard fixture rig (the contact contract's 3-joint right arm) ──

const SHOULDER: Vec3 = { x: 0.18, y: 1.38, z: 0 };
const UPPER_ARM_LEN = 0.28;
const FOREARM_LEN = 0.26;

const JOINTS = [
  { boneName: "upper_armR", bindLocalPosition: SHOULDER, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -UPPER_ARM_LEN, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -FOREARM_LEN, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
] as const;

const CONTACT_POINT: Vec3 = { x: 0.1, y: 0.94, z: 0.14 };

const PROFILE = {
  rigFingerprint: "rig-fp-emitted-trajectory",
  effectorBone: "handR",
  joints: JOINTS,
  regionAnchorSpace: REGION_ANCHOR_SPACE,
  regionAnchors: { [MOTION_REGION_GUARD_RLQ]: CONTACT_POINT },
};

const START_FRACTION = 0.4;
const END_FRACTION = 0.72;
const POSITION_TOLERANCE_M = 0.03;

function guardAction() {
  return {
    actionId: "guard_emitted_trajectory",
    primitiveId: "guard_body_region",
    trigger: { kind: "clinical_touch", ref: "guard_rlq_v1" },
    timing: { durationMs: 1200 },
    intensity: 0.6,
    target: { kind: "body_region", id: MOTION_REGION_GUARD_RLQ },
    effector: "handR",
    constraints: [
      {
        kind: "contact",
        effector: "handR",
        target: { kind: "body_region", id: MOTION_REGION_GUARD_RLQ },
        positionToleranceMeters: POSITION_TOLERANCE_M,
        startFraction: START_FRACTION,
        endFraction: END_FRACTION,
        penetrationToleranceMeters: 0.01,
        preserveWhileActive: true,
      },
    ],
  };
}

function guardProgram() {
  return {
    schemaVersion: "openclinxr.motion-program.v1",
    scenarioId: "adult_abdominal_pain_v1",
    actorId: "patient_elena_vasquez_v1",
    baseline: { posture: "supine" },
    actions: [guardAction()],
  };
}

type CompiledClip = { durationSeconds: number; tracks: CompiledMotionTrack[] };

async function compileGuardThroughEntry(): Promise<CompiledClip> {
  const mod = (await import("./compile-motion-program.js")) as Record<string, unknown>;
  const compile = mod["compileMotionProgram"] as (input: {
    program: unknown;
    skeletonProfile: unknown;
  }) => CompiledClip;
  expect(typeof compile, "compile-motion-program must export compileMotionProgram").toBe("function");
  return compile({ program: guardProgram(), skeletonProfile: structuredClone(PROFILE) });
}

async function compilePrimitive(
  primitiveId: string,
  request: PrimitiveRequest,
): Promise<CompiledMotionFragment> {
  const mod = (await import("./primitive-registry.js")) as Record<string, unknown>;
  const resolve = mod["resolvePrimitive"] as (
    id: string,
  ) => { compile: (r: PrimitiveRequest) => CompiledMotionFragment } | undefined;
  const primitive = resolve(primitiveId);
  expect(primitive, `registry does not resolve ${primitiveId}`).toBeDefined();
  return primitive!.compile(request);
}

/** Interpolated effector position at clip time, as a glTF LINEAR sampler plays it. */
function effectorAt(clip: CompiledClip, timeSeconds: number): Vec3 {
  const rotations = new Map<string, Quat>();
  for (const track of clip.tracks) {
    if (track.property !== "rotationAbsoluteNodeLocal") continue;
    const times = track.times;
    const values = track.values as readonly QuatTuple[];
    if (times.length === 0) continue;
    if (timeSeconds <= times[0]!) {
      rotations.set(track.boneName, asQuat(values[0]!));
      continue;
    }
    const last = times.length - 1;
    if (timeSeconds >= times[last]!) {
      rotations.set(track.boneName, asQuat(values[last]!));
      continue;
    }
    let i = 0;
    while (i < last && times[i + 1]! < timeSeconds) i += 1;
    const span = times[i + 1]! - times[i]!;
    const t = span > 0 ? (timeSeconds - times[i]!) / span : 0;
    rotations.set(track.boneName, slerpQuats(asQuat(values[i]!), asQuat(values[i + 1]!), t));
  }
  let worldQ: Quat = IDENTITY_Q;
  let worldP: Vec3 = { x: 0, y: 0, z: 0 };
  for (const joint of JOINTS) {
    const offset = qRotate(worldQ, joint.bindLocalPosition);
    worldP = { x: worldP.x + offset.x, y: worldP.y + offset.y, z: worldP.z + offset.z };
    worldQ = qMul(worldQ, rotations.get(joint.boneName) ?? joint.bindLocalQuaternion);
    if (joint.boneName === "handR") return worldP;
  }
  return worldP;
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function rotationTrack(primitiveId: string, fragment: CompiledMotionFragment, bone: string): QuatTuple[] {
  const track = fragment.tracks.find(
    (t) => t.boneName === bone && t.property === "rotationAbsoluteNodeLocal",
  );
  expect(track, `${primitiveId} emits no rotation track on ${bone}`).toBeDefined();
  return track!.values as QuatTuple[];
}

describe("an emitted clip uses the minimum-jerk profile", () => {
  it("(1) reach emits a minimum-jerk approach, a flat hold, and a minimum-jerk release", async () => {
    const fragment = await compilePrimitive("reach_target", {
      action: {
        actionId: "reach_probe",
        primitiveId: "reach_target",
        effector: "handR",
        target: { kind: "body_region", id: "abdomen_epigastric" },
        timing: { startMs: 0, durationMs: 900 },
        constraints: [],
      },
      skeletonProfile: { rigFingerprint: "fixture", joints: {} },
      seed: "fixed-seed",
    });
    expect(violationsInTracks(fragment.tracks), "reach tracks violate the clip contract").toEqual([]);
    expect(
      new Set(fragment.tracks.map((t) => t.boneName)),
      "reach must drive the arm chain",
    ).toEqual(new Set(["upper_armR", "forearmR", "handR"]));

    const shoulder = rotationTrack("reach_target", fragment, "upper_armR");
    const rest = shoulder[0]!;
    const peak = Math.max(...shoulder.map((q) => quatAngle(rest, q)));
    expect(peak, "reach never leaves rest — there is no approach to measure").toBeGreaterThan(0.1);
    // The hold plateau: every sample at peak amplitude, pairwise identical.
    const plateau = shoulder.filter((q) => quatAngle(rest, q) === peak);
    expect(plateau.length, "reach has no hold plateau — approach meets release with no dwell").toBeGreaterThanOrEqual(2);
    for (let i = 1; i < plateau.length; i += 1) {
      expect(quatAngle(plateau[i - 1]!, plateau[i]!), "hold plateau is not flat").toBeLessThan(1e-9);
    }
    // Approach is the samples before the plateau; release the samples after it.
    const firstPlateau = shoulder.indexOf(plateau[0]!);
    const lastPlateau = shoulder.lastIndexOf(plateau[plateau.length - 1]!);
    const approachSteps: number[] = [];
    for (let i = 1; i <= firstPlateau; i += 1) approachSteps.push(quatAngle(shoulder[i - 1]!, shoulder[i]!));
    const releaseSteps: number[] = [];
    for (let i = lastPlateau + 1; i < shoulder.length; i += 1) {
      releaseSteps.push(quatAngle(shoulder[i - 1]!, shoulder[i]!));
    }
    const maxStep = Math.max(...approachSteps, ...releaseSteps);
    // Zero endpoint velocity, both ends: a linear ramp's first step IS its max step (ratio 1).
    expect(
      approachSteps[0]! / maxStep,
      "approach does not start at rest — first step is not small against the peak step",
    ).toBeLessThan(0.15);
    expect(
      releaseSteps[releaseSteps.length - 1]! / maxStep,
      "release does not come to rest — last step is not small against the peak step",
    ).toBeLessThan(0.15);
    // Non-linear approach: a quarter of the way through the approach the joint has covered far
    // less than a quarter of the travel (minimum-jerk covers ~0.10; linear covers 0.25).
    const quarter = shoulder[Math.round(firstPlateau / 4)]!;
    expect(
      quatAngle(rest, quarter) / peak,
      "approach is linear, not minimum-jerk — quarter-time travel is not well below a quarter",
    ).toBeLessThan(0.2);
    // Release returns to rest.
    expect(
      quatAngle(rest, shoulder[shoulder.length - 1]!),
      "release does not return to rest",
    ).toBeLessThan(1e-9);
  });

  it("(2) guard holds the contact flat across the window and releases on a minimum-jerk fall", async () => {
    const clip = await compileGuardThroughEntry();
    expect(violationsInTracks(clip.tracks), "guard clip violates the clip contract").toEqual([]);
    expect(
      new Set(clip.tracks.map((t) => t.boneName)),
      "guard must drive only the arm chain — support joints are preserved by staying untouched",
    ).toEqual(new Set(["upper_armR", "forearmR", "handR"]));

    const shoulder = clip.tracks.find((t) => t.boneName === "upper_armR")!;
    const times = shoulder.times;
    const values = shoulder.values as readonly QuatTuple[];
    // Flat hold: every key inside the contact window is the identical solved pose.
    const inWindow = values.filter(
      (_, i) => times[i]! >= clip.durationSeconds * START_FRACTION - 1e-9 && times[i]! <= clip.durationSeconds * END_FRACTION + 1e-9,
    );
    expect(inWindow.length, "fewer than two keys bracket the contact window").toBeGreaterThanOrEqual(2);
    for (let i = 1; i < inWindow.length; i += 1) {
      expect(quatAngle(inWindow[i - 1]!, inWindow[i]!), "contact hold is not flat across its window").toBeLessThan(1e-6);
    }
    // Contact is preserved on every sampled frame, including between keys.
    const windowStart = clip.durationSeconds * START_FRACTION;
    const windowEnd = clip.durationSeconds * END_FRACTION;
    for (let s = 0; s <= 24; s += 1) {
      const t = (clip.durationSeconds * s) / 24;
      if (t < windowStart || t > windowEnd) continue;
      expect(
        distance(effectorAt(clip, t), CONTACT_POINT),
        `t=${t.toFixed(3)}s is inside the window and the effector is off the contact`,
      ).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
    }
    // Minimum-jerk release: the fall past the window ends at rest velocity and is non-linear.
    // The schedule emits its window-hold keys plus the settle; the primitive inserts release
    // keys between the window end and the settle, so the release span holds several samples.
    const holdPose = inWindow[inWindow.length - 1]!;
    const settle = values[values.length - 1]!;
    const fall = quatAngle(holdPose, settle);
    expect(fall, "guard never releases — hold pose equals the final pose").toBeGreaterThan(0);
    const releaseIdx: number[] = [];
    for (let i = 0; i < times.length; i += 1) {
      if (times[i]! > windowEnd + 1e-9) releaseIdx.push(i);
    }
    expect(releaseIdx.length, "release emits no sampled keys past the window").toBeGreaterThanOrEqual(2);
    const releaseSteps = releaseIdx.map((i) => quatAngle(values[i - 1]!, values[i]!));
    const maxRelease = Math.max(...releaseSteps);
    expect(
      releaseSteps[0]! / maxRelease,
      "release does not start at rest velocity — the hold breaks instead of easing out",
    ).toBeLessThan(0.35);
    expect(
      releaseSteps[releaseSteps.length - 1]! / maxRelease,
      "release does not end at rest velocity",
    ).toBeLessThan(0.35);
    const quarterT = windowEnd + (clip.durationSeconds - windowEnd) / 4;
    let nearest = releaseIdx[0]!;
    for (const i of releaseIdx) {
      if (Math.abs(times[i]! - quarterT) < Math.abs(times[nearest]! - quarterT)) nearest = i;
    }
    expect(
      quatAngle(holdPose, values[nearest]!) / fall,
      "release fall is linear, not minimum-jerk — quarter-time fall is not well below a quarter",
    ).toBeLessThan(0.2);
  });

  it("(3) guard is reproducible under one seed and boundedly sensitive to another", async () => {
    const request = (seed: string): PrimitiveRequest => ({
      action: guardAction(),
      skeletonProfile: structuredClone(PROFILE),
      seed,
    });
    const canonical = (fragment: CompiledMotionFragment): string =>
      JSON.stringify(
        [...fragment.tracks]
          .sort((a, b) => `${a.boneName}::${a.property}`.localeCompare(`${b.boneName}::${b.property}`))
          .map((t) => [t.boneName, t.property, t.times, t.values]),
      );
    const seedA = "seed-emitted-minimum-jerk-A";
    const seedB = "seed-emitted-minimum-jerk-B";
    const underA = await compilePrimitive("guard_body_region", request(seedA));
    expect(canonical(underA), "guard is not reproducible under one seed").toBe(
      canonical(await compilePrimitive("guard_body_region", request(seedA))),
    );
    const underB = await compilePrimitive("guard_body_region", request(seedB));
    expect(canonical(underA), "guard ignores its seed — two seeds produce identical motion").not.toBe(
      canonical(underB),
    );
    // Bounded: no sample moves far, and the changed seed still holds the contact.
    // Bound from the seed jitter: ±0.12 amplitude on a hold whose peak is ~0.6 rad moves a
    // sample at most ~0.12 rad in angle space, measured with headroom below.
    let worst = 0;
    const aTracks = [...underA.tracks].sort((a, b) => `${a.boneName}::${a.property}`.localeCompare(`${b.boneName}::${b.property}`));
    const bTracks = [...underB.tracks].sort((a, b) => `${a.boneName}::${a.property}`.localeCompare(`${b.boneName}::${b.property}`));
    for (let t = 0; t < aTracks.length; t += 1) {
      const aValues = aTracks[t]!.values as readonly QuatTuple[];
      const bValues = bTracks[t]!.values as readonly QuatTuple[];
      for (let i = 0; i < aValues.length; i += 1) {
        worst = Math.max(worst, quatAngle(aValues[i]!, bValues[i]!));
      }
    }
    expect(worst, "a changed seed moves the motion further than a bounded variation allows").toBeLessThan(0.6);
    const clipB: CompiledClip = {
      durationSeconds: Math.max(
        ...underB.tracks.map((t) => t.times[t.times.length - 1] ?? 0),
      ),
      tracks: underB.tracks as CompiledMotionTrack[],
    };
    const windowStart = clipB.durationSeconds * START_FRACTION;
    const windowEnd = clipB.durationSeconds * END_FRACTION;
    for (let s = 0; s <= 24; s += 1) {
      const t = (clipB.durationSeconds * s) / 24;
      if (t < windowStart || t > windowEnd) continue;
      expect(
        distance(effectorAt(clipB, t), CONTACT_POINT),
        `seed B drifts off the contact at t=${t.toFixed(3)}s — variation does not preserve contact`,
      ).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
    }
  });

  it("(4) look_at and cough_recoil are not contact-bearing — a contact constraint moves nothing", async () => {
    for (const primitiveId of ["look_at", "cough_recoil"] as const) {
      const base = {
        actionId: `${primitiveId}_probe`,
        primitiveId,
        effector: "handR",
        target: { kind: "body_region", id: "abdomen_epigastric" },
        timing: { startMs: 0, durationMs: 900 },
      };
      const bare = await compilePrimitive(primitiveId, {
        action: { ...base, constraints: [] },
        skeletonProfile: { rigFingerprint: "fixture", joints: {} },
        seed: "fixed-seed",
      });
      const contacted = await compilePrimitive(primitiveId, {
        action: {
          ...base,
          constraints: [
            {
              kind: "contact",
              effector: "handR",
              target: { kind: "body_region", id: "abdomen_epigastric" },
              positionToleranceMeters: 0.03,
              startFraction: 0.4,
              endFraction: 0.72,
              preserveWhileActive: true,
            },
          ],
        },
        skeletonProfile: { rigFingerprint: "fixture", joints: {} },
        seed: "fixed-seed",
      });
      expect(
        JSON.stringify(contacted.tracks),
        `${primitiveId} changes under a contact constraint — it is contact-bearing, contrary to this file's scope`,
      ).toBe(JSON.stringify(bare.tracks));
      const bones = new Set(bare.tracks.map((t) => t.boneName));
      for (const arm of ["upper_armR", "forearmR", "handR"]) {
        expect(bones.has(arm), `${primitiveId} drives the guard arm chain`).toBe(false);
      }
    }
  });
});
