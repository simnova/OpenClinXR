import { describe, expect, it } from "vitest";

import {
  MOTION_REGION_GUARD_RLQ,
  REGION_ANCHOR_SPACE,
} from "./plant-motion-regions.js";
import {
  violationsInTracks,
  type CompiledMotionTrack,
  type QuatTuple,
} from "./canonical-motion-contract.js";

/**
 * **OBSERVABLE: `ContactConstraint` declares `penetrationToleranceMeters` and
 * `orientationToleranceRadians` and nothing on this tree reads either one.**
 *
 * Card tsk_4a7f639c1fc453e6 (contact surfaces from real geometry — A-grade final). The sibling
 * contract, `the-contact-constraint-holds-across-its-window.test.ts:60-66`, defers both fields with
 * the reason this plant exists to close: *"penetration is depth past a SURFACE, and a body point is
 * not a surface. Both stay for the card that introduces collision geometry."* This file is that
 * card's planted contract: a contact region is upgraded from a POINT (the anchor the guard's arm
 * solve reaches) to a SURFACE (a point on the skin plus an outward normal), and both tolerances
 * become checkable relationships against it.
 *
 * IN-SCOPE: the contact-surface contract a compiled guard clip must satisfy — bounded penetration,
 * achieved contact, orientation to the surface normal, and refusal of a wrong-facing surface — all
 * measured by the interpolating FK oracle on every sampled frame of the contact window.
 * OUT-OF-SCOPE: implementing the surface solver (no product edit on this plant); how region surface
 * records are DERIVED from shipped rig/mesh geometry (the producer that emits them, upstream of
 * this consumer); self-collision, environment collision, a physics engine, walking; non-torso
 * contact styles (bed rail, chair, floor).
 * CLAIM: against a profile whose contact region carries a surface record (point + outward normal in
 * `REGION_ANCHOR_SPACE`), the current point-clamp solver violates every clause below by the margins
 * in the measured table, and a solver that aims the effector at the SURFACE point, orients its
 * contact axis to the outward normal, and refuses wrong-facing surfaces satisfies all four — flip
 * arithmetic verified by an injected-primitive probe on this tree, not assumed.
 * NOT TESTED: whether the surface records are right for non-torso contacts; whether a production
 * `SkeletonProfile` read from a shipped GLB carries surfaces or references a mesh-derived record;
 * per-surface tolerance values; clinical plausibility of any contact pose. A surface record here is
 * fixture data in the shape a producer must emit; fixture surfaces support fixture claims only.
 *
 * ## MEASURED ON HEAD (5c70c589) — do not re-derive. This block is IMMUTABLE.
 *
 * Compiled through the REAL registry (no injected primitive) with the fixture below — contact on
 * `motion_guard_abdomen_rlq`, whose region anchor `A` sits 0.05 m INSIDE the surface point `S`
 * along −n, and whose surface record the guard never reads. Measured over 24 samples, 8 inside the
 * 0.4..0.72 window, with the FK oracle:
 *
 *   | relationship                                   | tolerance        | point clamp | red? |
 *   |------------------------------------------------|------------------|-------------|------|
 *   | max penetration past the surface plane         | 0.01 m           | 0.0500 m    | yes  |
 *   | max distance of the wrist from the surface pt. | 0.03 m           | 0.0500 m    | yes  |
 *   | max angle of wrist +Z axis off the normal      | 0.35 rad         | 0.7796 rad  | yes  |
 *   | wrong-facing surface (normal flipped)          | compile refused  | 3 tracks    | yes  |
 *
 * The guard's arm solve puts the wrist exactly ON the region anchor it is handed and holds it there
 * across the window; the anchor is a bind-frame proxy at half-depth, and 0.05 m of that proxy sits
 * PAST the surface. The wrist +Z axis lands 44.7 deg off the +z outward normal. A flipped normal
 * compiles to a normal 3-track clip: the surface is never consulted, so nothing can be wrong-facing.
 *
 * ## THE MODEL FROZEN HERE — a surface is what a point is not
 *
 * A contact region may carry a profile record `regionSurfaces[region] = { point, outwardNormal }`
 * in the same bind-world space as `regionAnchors`. The ANCHOR stays what the guard already reaches
 * (the bind-frame proxy the region-anchor producer places at the body's reference depth); the
 * SURFACE POINT `S` is where contact is actually made, and `outwardNormal` says which face the
 * effector may touch. The constraint's `penetrationToleranceMeters` bounds how far the effector may
 * pass past the plane through `S`; `orientationToleranceRadians` bounds the effector's own axis
 * against `outwardNormal`; position tolerance is measured to `S`, never to the buried proxy — a
 * wrist resting on the proxy has NOT contacted the surface, it has crossed it.
 *
 * ## THE CHEAP EVASIONS THIS PLANT IS BUILT TO REFUSE — point clamp, ignore orientation
 *
 * The current solver IS the cheapest evasion: solve to the anchor, ignore the surface record. A
 * worker could re-satisfy a position clause by calling the buried anchor the "surface"; this plant
 * refuses that by construction — `D` (the anchor's depth inside the surface) independently exceeds
 * every tolerance, so each evasion fails a DIFFERENT clause:
 *
 *   | evasion                                              | fails on                         |
 *   |------------------------------------------------------|----------------------------------|
 *   | point clamp to the anchor (today's solver)           | (1) penetration 0.05 > 0.01      |
 *   |                                                      | (2) wrist 0.05 m from the surface |
 *   |                                                      | (3) axis 0.78 rad off the normal  |
 *   |                                                      | (4) wrong-facing not refused     |
 *   | hover: keep the hand safely OFF the surface          | (2) no contact within 0.03 m     |
 *   | orientation tolerance near pi (any pose "satisfies") | fixture fixes 0.35 rad; (4)      |
 *   | normal carried on the constraint as a caller summary | closed CONTACT_KEYS allowlist    |
 *   |                                                      | (motion-program.ts) refuses it   |
 *
 * ## WHY THE HONEST FLIP IS SATISFIABLE — verified, not assumed
 *
 * An injected surface-aware primitive (probe, deleted before commit) compiled the SAME program to a
 * clip measuring 0.0000 m penetration, 0.0000 m from the surface point, and 0.0000 rad off the
 * normal, and threw for the flipped normal. The arithmetic it used is the contract: solve the arm
 * to `S` (the wrist position is set by shoulder + elbow alone), then choose the wrist rotation so
 * the wrist-local +Z maps onto `outwardNormal` in world space (a free single-joint rotation; it
 * cannot move the wrist position), and refuse when the outward normal does not point from the
 * anchor toward the surface point. The guard's contact path is where that lands — this plant only
 * fixes the contract it must satisfy.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block BELOW this
 * comment. Do not rewrite the measured table, the fixture geometry (S, n, A, D) or the tolerances:
 * a flip achieved by editing the fixture is not a fix.
 */

/**
 * ## FIXED (tsk_ba168fa10b064fa3) — a contact surface now bounds penetration AND orients the limb.
 *
 * The surface-aware contact geometry landed — `src/contact.ts` owns the surface half of the
 * contact solver (per-region `regionSurfaces` records: refusal of a wrong-facing or malformed
 * surface, the contact target at the SURFACE point, and the free single-joint wrist rotation that
 * maps the effector's own axis onto the outward normal), and the registered guard
 * (`src/primitives/guard-body-region.ts`) now consults `profile.regionSurfaces` through it when a
 * contact's region carries a surface record. All four clauses are flipped and pass:
 *   - (1) the guard solves to the SURFACE point, so the wrist rests ON the surface plane, not the
 *     buried anchor 0.05 m inside it — measured 0.0000 m penetration past the plane against the
 *     0.01 m tolerance on every sampled frame of the window;
 *   - (2) contact is ACHIEVED at the surface point — measured 0.0000 m from `S` against the
 *     0.03 m tolerance (the anchor clamp measured 0.05 m, past both tolerances);
 *   - (3) the wrist rotation is chosen so the wrist-local +Z maps onto the outward normal —
 *     measured 0.0000 rad off the normal against the 0.35 rad tolerance;
 *   - (4) a wrong-facing surface (normal flipped) is REFUSED at compile — the surface record is
 *     consulted, so the wrong-facing fixture throws instead of compiling to a 3-track clip.
 *
 * The counterweights still bind: a profile with NO `regionSurfaces` (every pre-surface profile in
 * the package) is passed through untouched, so the anchor clamp remains for regions without a
 * surface record and the guard plant's own contracts stay green. Clause (4) passes only because a
 * surface whose outward normal does not point from the anchor toward the surface point throws.
 */

const PROGRAM_SCHEMA = "openclinxr.motion-program.v1";
const ENTRY_MODULE = "./compile-motion-program.js";

/**
 * Resolve to an ABSOLUTE url before the deferred import. A bare `./x.js` in a variable is resolved
 * natively and reports a MANGLED path when the module is absent, which reads as a broken test rather
 * than the missing module this RED demands.
 */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

type CompiledClip = {
  clipId: string;
  durationSeconds: number;
  tracks: CompiledMotionTrack[];
};

type CompileEntry = (input: { program: unknown; skeletonProfile: unknown }) => CompiledClip;

async function loadEntry(): Promise<CompileEntry | undefined> {
  try {
    const mod = (await import(/* @vite-ignore */ plantModule(ENTRY_MODULE))) as Record<string, unknown>;
    return mod["compileMotionProgram"] as CompileEntry | undefined;
  } catch {
    return undefined;
  }
}

// ── the fixture rig ────────────────────────────────────────────────────────────────────────────
// The same 3-joint right arm the sibling contract's oracle walks; bind rotations are identity, so
// the wrist +Z axis is the fixture's declared "effector's own axis" in world space at bind.

const SHOULDER: Vec3 = { x: 0.18, y: 1.38, z: 0 };
const UPPER_ARM_LEN = 0.28;
const FOREARM_LEN = 0.26;

const JOINTS = [
  { boneName: "upper_armR", bindLocalPosition: SHOULDER, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -UPPER_ARM_LEN, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -FOREARM_LEN, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
] as const;

// ── the contact surface fixture ────────────────────────────────────────────────────────────────
// S is the point on the surface the effector must contact; A is the region anchor the guard's arm
// solve is handed today, D metres INSIDE the surface along −n. The anchor depth D independently
// exceeds both tolerances, so reaching the anchor is unambiguously a penetration and a missed
// contact, whatever a solver calls it. S is reachable: 0.466 m from the shoulder against 0.54 m of
// arm (the sibling contract's own contact point).

const SURFACE_POINT: Vec3 = { x: 0.10, y: 0.94, z: 0.14 };
const SURFACE_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };
/** The region anchor sits this far INSIDE the surface along −n. */
const ANCHOR_DEPTH_M = 0.05;
const REGION_ANCHOR: Vec3 = {
  x: SURFACE_POINT.x - SURFACE_NORMAL.x * ANCHOR_DEPTH_M,
  y: SURFACE_POINT.y - SURFACE_NORMAL.y * ANCHOR_DEPTH_M,
  z: SURFACE_POINT.z - SURFACE_NORMAL.z * ANCHOR_DEPTH_M,
};

const POSITION_TOLERANCE_M = 0.03;
const PENETRATION_TOLERANCE_M = 0.01;
const ORIENTATION_TOLERANCE_RAD = 0.35;
const START_FRACTION = 0.4;
const END_FRACTION = 0.72;

function profileWith(outwardNormal: Vec3) {
  return {
    rigFingerprint: "rig-fp-surface-contract",
    effectorBone: "handR",
    joints: JOINTS,
    regionAnchorSpace: REGION_ANCHOR_SPACE,
    regionAnchors: { [MOTION_REGION_GUARD_RLQ]: REGION_ANCHOR },
    regionSurfaces: {
      [MOTION_REGION_GUARD_RLQ]: { point: SURFACE_POINT, outwardNormal },
    },
  };
}

const PROFILE = profileWith(SURFACE_NORMAL);

function contactProgram() {
  return {
    schemaVersion: PROGRAM_SCHEMA,
    scenarioId: "adult_abdominal_pain_v1",
    actorId: "patient_elena_vasquez_v1",
    baseline: { posture: "supine" },
    actions: [
      {
        actionId: "guard_surface_contact",
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
            penetrationToleranceMeters: PENETRATION_TOLERANCE_M,
            orientationToleranceRadians: ORIENTATION_TOLERANCE_RAD,
            startFraction: START_FRACTION,
            endFraction: END_FRACTION,
            preserveWhileActive: true,
          },
        ],
      },
    ],
    provenance: { sourceKind: "deterministic_plan", sourceRefs: ["touch:abdomen_rlq"] },
  };
}

// ── the FK oracle, independent of the compiler ─────────────────────────────────────────────────
// Walked whole, not nearest-key: the sibling contract's instrument corrected exactly this defect
// (its file header records that the first version sampled three key poses over and over while the
// interpolated motion between them was never evaluated).

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

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

function slerp(a: Quat, b: Quat, t: number): Quat {
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

const asQuat = (q: QuatTuple): Quat => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

/** The pose a player would show at this instant: bracket the keys, interpolate, then run FK. */
function poseAt(clip: CompiledClip, timeSeconds: number): { wrist: Vec3; wristWorldQ: Quat } {
  const rotations = new Map<string, Quat>();
  for (const track of clip.tracks) {
    if (track.property !== "rotationAbsoluteNodeLocal") continue;
    const times = track.times;
    const values = track.values as readonly QuatTuple[];
    if (times.length === 0) continue;

    // Clamp outside the track's own range, as a glTF sampler does.
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
    rotations.set(track.boneName, slerp(asQuat(values[i]!), asQuat(values[i + 1]!), t));
  }

  let worldQ: Quat = IDENTITY;
  let worldP: Vec3 = { x: 0, y: 0, z: 0 };
  for (const joint of JOINTS) {
    const offset = qRotate(worldQ, joint.bindLocalPosition);
    worldP = { x: worldP.x + offset.x, y: worldP.y + offset.y, z: worldP.z + offset.z };
    // ABSOLUTE node-local: an emitted rotation REPLACES the bind rotation, per the canonical
    // contract. Where no track exists the bind rotation applies.
    worldQ = qMul(worldQ, rotations.get(joint.boneName) ?? joint.bindLocalQuaternion);
    if (joint.boneName === "handR") return { wrist: worldP, wristWorldQ: worldQ };
  }
  return { wrist: worldP, wristWorldQ: worldQ };
}

/** Sample times that deliberately fall BETWEEN plausible keyframes as well as on them. */
function sampleTimes(duration: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push((duration * i) / count);
  return out;
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * How far the wrist sits PAST the surface plane, in metres. Positive only on the inward side: an
 * effector safely OFF the surface measures zero here — which is exactly why clause (2) exists.
 */
function penetrationPast(wrist: Vec3): number {
  return Math.max(0, dot3({ x: SURFACE_POINT.x - wrist.x, y: SURFACE_POINT.y - wrist.y, z: SURFACE_POINT.z - wrist.z }, SURFACE_NORMAL));
}

/** The world direction of the effector's own axis — the wrist-local +Z at bind is the fixture's contact axis. */
function effectorAxis(wristWorldQ: Quat): Vec3 {
  return qRotate(wristWorldQ, { x: 0, y: 0, z: 1 });
}

function angleBetween(a: Vec3, b: Vec3): number {
  const cos = dot3(a, b) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/** Sample times inside the contact window; a clause that checks only keys proves nothing. */
function inWindowSamples(clip: CompiledClip): number[] {
  const windowStart = clip.durationSeconds * START_FRACTION;
  const windowEnd = clip.durationSeconds * END_FRACTION;
  return sampleTimes(clip.durationSeconds, 24).filter((t) => t >= windowStart && t <= windowEnd);
}

describe("the contact surface bounds penetration and orientation", () => {
  it("(1) RED: the effector does not pass more than penetrationToleranceMeters past the surface on any sampled frame", async () => {
    // FIXTURE VACUITY, first: if the tolerance covered the anchor's depth, a wrist parked on the
    // buried anchor would pass this clause and clause (2) would be doing all the work.
    expect(
      PENETRATION_TOLERANCE_M,
      "the penetration tolerance is not smaller than the anchor's depth inside the surface — reaching the anchor would not penetrate",
    ).toBeLessThan(ANCHOR_DEPTH_M);

    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const clip = compileMotionProgram!({ program: contactProgram(), skeletonProfile: structuredClone(PROFILE) });
    expect(violationsInTracks(clip.tracks), "the compiled tracks violate the canonical clip contract").toEqual([]);
    expect(clip.durationSeconds, "a clip with no duration has no window").toBeGreaterThan(0);

    const samples = inWindowSamples(clip);
    expect(samples.length, "fewer than four samples fall inside the contact window — this clause would only be checking keys").toBeGreaterThanOrEqual(4);

    for (const t of samples) {
      const { wrist } = poseAt(clip, t);
      expect(
        penetrationPast(wrist),
        `t=${t.toFixed(3)}s: the wrist sits ${penetrationPast(wrist).toFixed(4)} m past the surface plane against a ${PENETRATION_TOLERANCE_M} m tolerance — contact solved to a point buried in the surface, not bounded by it`,
      ).toBeLessThanOrEqual(PENETRATION_TOLERANCE_M);
    }
  });

  it("(2) RED: contact is ACHIEVED — the wrist rests on the surface point, not a safe distance off it and not through it", async () => {
    // COUNTERWEIGHT to (1): bounding penetration is trivial for a solver that keeps the hand well
    // OFF the surface, so the clause pair must also demand that contact happens. Position is
    // measured to the SURFACE POINT; the buried region anchor is a bind-frame proxy, and a wrist
    // resting on it has crossed the surface, not contacted it.
    expect(
      POSITION_TOLERANCE_M,
      "the position tolerance is not smaller than the anchor's depth inside the surface — a wrist on the buried anchor would count as contact",
    ).toBeLessThan(ANCHOR_DEPTH_M);

    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const clip = compileMotionProgram!({ program: contactProgram(), skeletonProfile: structuredClone(PROFILE) });
    expect(violationsInTracks(clip.tracks), "the compiled tracks violate the canonical clip contract").toEqual([]);
    expect(clip.durationSeconds, "a clip with no duration has no window").toBeGreaterThan(0);

    const samples = inWindowSamples(clip);
    expect(samples.length, "fewer than four samples fall inside the contact window — this clause would only be checking keys").toBeGreaterThanOrEqual(4);

    for (const t of samples) {
      const { wrist } = poseAt(clip, t);
      const err = distance(wrist, SURFACE_POINT);
      expect(
        err,
        `t=${t.toFixed(3)}s: the wrist is ${err.toFixed(4)} m from the surface point against a ${POSITION_TOLERANCE_M} m tolerance — the effector has not reached the surface`,
      ).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
    }
  });

  it("(3) RED: the effector's own axis stays within orientationToleranceRadians of the surface normal across the window", async () => {
    // COUNTERWEIGHT to vacuity: an orientation bound with a tolerance near pi is satisfied by any
    // pose. The fixture fixes 0.35 rad — well under a right angle — so a wrong-facing axis (up to
    // pi rad off) cannot pass by tolerance alone.
    expect(
      ORIENTATION_TOLERANCE_RAD,
      "the orientation tolerance is at or above a right angle — a perpendicular or wrong-facing effector would satisfy it",
    ).toBeLessThan(Math.PI / 2);

    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const clip = compileMotionProgram!({ program: contactProgram(), skeletonProfile: structuredClone(PROFILE) });
    expect(violationsInTracks(clip.tracks), "the compiled tracks violate the canonical clip contract").toEqual([]);
    expect(clip.durationSeconds, "a clip with no duration has no window").toBeGreaterThan(0);

    const samples = inWindowSamples(clip);
    expect(samples.length, "fewer than four samples fall inside the contact window — this clause would only be checking keys").toBeGreaterThanOrEqual(4);

    for (const t of samples) {
      const { wristWorldQ } = poseAt(clip, t);
      const off = angleBetween(effectorAxis(wristWorldQ), SURFACE_NORMAL);
      expect(
        off,
        `t=${t.toFixed(3)}s: the effector axis is ${off.toFixed(4)} rad off the surface normal against a ${ORIENTATION_TOLERANCE_RAD} rad tolerance — the limb was pointed at a point, never oriented to the surface`,
      ).toBeLessThanOrEqual(ORIENTATION_TOLERANCE_RAD);
    }
  });

  it("(4) RED: a deliberately WRONG-FACING surface is refused, never compiled to a clip that touches it from the wrong side", async () => {
    // The wrong-facing fixture differs from the positive one in EXACTLY the normal's sign. The
    // positive surface's outward normal points from the region anchor toward the surface point (out
    // of the body); the flipped one points the other way, so the effector would have to cross the
    // surface to touch its outside face. A solver that silently compiles that has not read the
    // surface at all — which is the point clamp on this tree, measured in the header table.
    const toSurface = {
      x: SURFACE_POINT.x - REGION_ANCHOR.x,
      y: SURFACE_POINT.y - REGION_ANCHOR.y,
      z: SURFACE_POINT.z - REGION_ANCHOR.z,
    };
    const flipped: Vec3 = { x: -SURFACE_NORMAL.x, y: -SURFACE_NORMAL.y, z: -SURFACE_NORMAL.z };
    expect(
      dot3(SURFACE_NORMAL, toSurface),
      "the positive surface does not face outward from the anchor — the fixture itself is wrong-facing",
    ).toBeGreaterThan(0);
    expect(dot3(flipped, toSurface), "the flipped normal is not inward — the two fixtures do not differ in facing").toBeLessThan(0);

    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    expect(
      () =>
        compileMotionProgram!({
          program: contactProgram(),
          skeletonProfile: structuredClone(profileWith(flipped)),
        }),
      "a wrong-facing contact surface compiled without complaint — the surface is never consulted, so nothing can be refused",
    ).toThrow();
  });
});
