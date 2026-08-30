import { describe, expect, it } from "vitest";

import {
  violationsInTracks,
  type CompiledMotionTrack,
  type QuatTuple,
} from "./canonical-motion-contract.js";

/**
 * **OBSERVABLE: `ContactConstraint` is declared in three plants and enforced by none.**
 *
 * Card tsk_1c562c5c4ee99449. Brief section 14 gives the full schema — effector, target,
 * positionToleranceMeters, orientationToleranceRadians, startFraction, endFraction,
 * penetrationToleranceMeters, preserveWhileActive — and says plainly that many clinically meaningful
 * movements are primarily CONTACT problems: hand-chest, hand-abdomen, hand-bed-rail, pelvis-chair,
 * torso-stretcher, feet-floor.
 *
 * ## MEASURED ON HEAD — do not re-derive. This block is IMMUTABLE.
 *
 * Enumerated over `packages/openclinxr/motion-compiler/src` at 219c77d7:
 *
 *     `constraints: [ { kind: "contact", ... } ]` in plant FIXTURES  : 3 (keystone, M4, seam)
 *     assertions on contact BEHAVIOUR                                : 0
 *
 * The keystone proves the constraint survives the trip to a primitive unchanged. That is transport,
 * not enforcement, and it is satisfied by a compiler that reads the field and ignores it.
 *
 * ## WHY THIS PLANT MUST EXIST BEFORE M2 AND M4 ARE IMPLEMENTED
 *
 * Both reviewers reached this independently. Contacts filed downstream of M2 and M4 lets both
 * establish incompatible APIs first — M2 a target point mapped to a claimed reached point, M4 a
 * primitive mapped to an arbitrary channel set — and the retrofit then forces changes to
 * MotionAction, the primitive request, the trajectory phase representation, solver output AND
 * evidence input after workers have coded against all five. The contact SOLVER need not be
 * implemented before M2 begins; its contract must be planted first.
 *
 * ## THE TRAP THIS PLANT IS BUILT TO AVOID
 *
 * A clause asserting the type exists passes on a solver that never reads it. So every clause here
 * bounds a RELATIONSHIP:
 *
 *   (1) inside the window the effector stays within tolerance on EVERY SAMPLED FRAME, including
 *       times that are not keys — "at the keys only" is how an interpolating solver drifts through
 *       the middle of a contact;
 *   (2) outside the window it MOVES, by a margin referenced to the reach the fixture demands, so a
 *       solver that parks the hand on the target for the whole clip fails;
 *   (3) `preserveWhileActive: false` must produce a DIFFERENT clip, so the flag is read rather than
 *       assumed.
 *
 * ## NOT TESTED, and deliberately
 *
 * Orientation tolerance (`orientationToleranceRadians`): the fixture has no surface normal to hold
 * an orientation against, and inventing one here would freeze a geometry decision this card has no
 * business making. Penetration (`penetrationToleranceMeters`): same reason — penetration is depth
 * past a SURFACE, and a body point is not a surface. Both stay for the card that introduces collision
 * geometry. Whether contact solving changes any shipped clip. Whether the tolerance values are
 * clinically right.
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

type CompiledClip = { clipId: string; durationSeconds: number; tracks: CompiledMotionTrack[] };

type CompileEntry = (input: { program: unknown; skeletonProfile: unknown }) => CompiledClip;

async function loadEntry(): Promise<CompileEntry | undefined> {
  try {
    const mod = (await import(/* @vite-ignore */ plantModule(ENTRY_MODULE))) as Record<string, unknown>;
    return mod["compileMotionProgram"] as CompileEntry | undefined;
  } catch {
    return undefined;
  }
}

/**
 * NO INJECTED PRIMITIVE HERE, and that is the point.
 *
 * The keystone injects a fake primitive because it is proving orchestration. A fake primitive cannot
 * prove contact holding — it would supply the tracks the assertion then measures, so the fixture
 * would be grading itself. This clause compiles through the entry's OWN registry, which also states
 * a contract worth stating: `compileMotionProgram` resolves real primitives when none are injected.
 */

// ── the fixture rig ────────────────────────────────────────────────────────────────────────────

const SHOULDER: Vec3 = { x: 0.18, y: 1.38, z: 0 };
const UPPER_ARM_LEN = 0.28;
const FOREARM_LEN = 0.26;

const JOINTS = [
  { boneName: "upper_armR", bindLocalPosition: SHOULDER, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -UPPER_ARM_LEN, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -FOREARM_LEN, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
] as const;

const PROFILE = { rigFingerprint: "rig-fp-contact-fixture", effectorBone: "handR", joints: JOINTS };

/** Where the hand must arrive and stay. Reachable: 0.54 m of arm, target 0.46 m from the shoulder. */
const CONTACT_POINT: Vec3 = { x: 0.10, y: 0.94, z: 0.14 };

const START_FRACTION = 0.4;
const END_FRACTION = 0.72;
const POSITION_TOLERANCE_M = 0.03;

/** The hand's BIND position, from the chain above. The reach is measured against this. */
const BIND_EFFECTOR: Vec3 = { x: SHOULDER.x, y: SHOULDER.y - UPPER_ARM_LEN - FOREARM_LEN, z: SHOULDER.z };

/**
 * INPUT-REFERENCED EPSILON. The distance the fixture REQUIRES the hand to travel, fixed by the rig
 * and the contact point, and unmoved by whether contact solving works at all.
 *
 * A margin taken as a fraction of the OBSERVED motion would be circular: any nonzero movement would
 * clear it. This one is a property of the fixture, so a solver that parks the hand on the target for
 * the whole clip fails it however smooth its output looks.
 */
const REACH_DISTANCE_M = distance(BIND_EFFECTOR, CONTACT_POINT);
const MOVEMENT_FLOOR_M = REACH_DISTANCE_M * 0.1;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── the FK oracle, independent of the compiler ─────────────────────────────────────────────────

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

/** Nearest-sample lookup, then chain accumulation. Calls no compiler helper. */
function effectorAt(clip: CompiledClip, timeSeconds: number): Vec3 {
  const rotations = new Map<string, Quat>();
  for (const track of clip.tracks) {
    if (track.property !== "rotationAbsoluteNodeLocal") continue;
    let best = 0;
    for (let i = 1; i < track.times.length; i += 1) {
      if (Math.abs(track.times[i]! - timeSeconds) < Math.abs(track.times[best]! - timeSeconds)) best = i;
    }
    const q = track.values[best] as QuatTuple | undefined;
    if (q) rotations.set(track.boneName, { x: q[0], y: q[1], z: q[2], w: q[3] });
  }

  let worldQ: Quat = IDENTITY;
  let worldP: Vec3 = { x: 0, y: 0, z: 0 };
  for (const joint of JOINTS) {
    const offset = qRotate(worldQ, joint.bindLocalPosition);
    worldP = { x: worldP.x + offset.x, y: worldP.y + offset.y, z: worldP.z + offset.z };
    // ABSOLUTE node-local: an emitted rotation REPLACES the bind rotation, per the canonical
    // contract. Where no track exists the bind rotation applies.
    worldQ = qMul(worldQ, rotations.get(joint.boneName) ?? joint.bindLocalQuaternion);
    if (joint.boneName === PROFILE.effectorBone) return worldP;
  }
  return worldP;
}

// ── the program ────────────────────────────────────────────────────────────────────────────────

function contactProgram(preserveWhileActive: boolean) {
  return {
    schemaVersion: PROGRAM_SCHEMA,
    scenarioId: "adult_abdominal_pain_v1",
    actorId: "patient_elena_vasquez_v1",
    baseline: { posture: "supine" },
    actions: [
      {
        actionId: "guard_contact_probe",
        primitiveId: "guard_body_region",
        trigger: { kind: "clinical_touch", ref: "guard_rlq_v1" },
        timing: { durationMs: 1200 },
        intensity: 0.6,
        target: { kind: "body_region", id: "motion_guard_abdomen_rlq" },
        effector: PROFILE.effectorBone,
        constraints: [
          {
            kind: "contact",
            effector: PROFILE.effectorBone,
            target: { kind: "body_point", position: CONTACT_POINT },
            positionToleranceMeters: POSITION_TOLERANCE_M,
            startFraction: START_FRACTION,
            endFraction: END_FRACTION,
            penetrationToleranceMeters: 0.01,
            preserveWhileActive,
          },
        ],
      },
    ],
    provenance: { sourceKind: "deterministic_plan", sourceRefs: ["touch:abdomen_rlq"] },
  };
}

/** Sample times that deliberately fall BETWEEN plausible keyframes as well as on them. */
function sampleTimes(duration: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push((duration * i) / count);
  return out;
}

describe("the contact constraint holds across its window", () => {
  it.fails("(1) RED: inside the window the effector holds contact on every sampled frame, not only at the keys", async () => {
    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const clip = compileMotionProgram!({ program: contactProgram(true), skeletonProfile: structuredClone(PROFILE) });

    // The clip has to be a legal clip before any geometry claim about it means anything.
    expect(violationsInTracks(clip.tracks), "the compiled tracks violate the canonical clip contract").toEqual([]);
    expect(clip.durationSeconds, "a clip with no duration has no window").toBeGreaterThan(0);

    const times = sampleTimes(clip.durationSeconds, 24);
    const windowStart = clip.durationSeconds * START_FRACTION;
    const windowEnd = clip.durationSeconds * END_FRACTION;
    const inWindow = times.filter((t) => t >= windowStart && t <= windowEnd);

    // COUNTERWEIGHT, first: sampling three keyframes proves nothing about the interpolated middle.
    expect(
      inWindow.length,
      "fewer than four samples fall inside the contact window — this clause would only be checking keys",
    ).toBeGreaterThanOrEqual(4);

    for (const t of inWindow) {
      expect(
        distance(effectorAt(clip, t), CONTACT_POINT),
        `t=${t.toFixed(3)}s is inside the contact window and the effector is off the target`,
      ).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
    }
  });

  it.fails("(2) RED: outside the window the effector MOVES — a hand parked on the target is not a guard", async () => {
    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const clip = compileMotionProgram!({ program: contactProgram(true), skeletonProfile: structuredClone(PROFILE) });
    const times = sampleTimes(clip.durationSeconds, 24);
    const outside = times.filter((t) => t < clip.durationSeconds * START_FRACTION || t > clip.durationSeconds * END_FRACTION);

    expect(outside.length, "no samples fall outside the window, so this clause compares nothing").toBeGreaterThanOrEqual(4);

    // The margin is a property of the FIXTURE — the reach the rig and contact point demand — not a
    // fraction of whatever motion the compiler happened to emit.
    const furthest = Math.max(...outside.map((t) => distance(effectorAt(clip, t), CONTACT_POINT)));
    expect(
      furthest,
      `the effector never left the contact point by more than ${MOVEMENT_FLOOR_M.toFixed(3)} m (10% of the ${REACH_DISTANCE_M.toFixed(3)} m reach this fixture requires) — it is pinned, not reaching`,
    ).toBeGreaterThan(MOVEMENT_FLOOR_M);
  });

  it.fails("(3) RED: preserveWhileActive is READ — false produces a different clip", async () => {
    // Clauses (1) and (2) are both satisfiable by a solver that always holds contact and never looks
    // at the flag. This is the discriminator, and it needs no geometry.
    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const held = compileMotionProgram!({ program: contactProgram(true), skeletonProfile: structuredClone(PROFILE) });
    const free = compileMotionProgram!({ program: contactProgram(false), skeletonProfile: structuredClone(PROFILE) });

    const trackValues = (clip: CompiledClip): string =>
      JSON.stringify(clip.tracks.map((t) => [t.boneName, t.property, t.times, t.values]));

    expect(
      trackValues(held),
      "preserveWhileActive true and false compiled to identical tracks — the flag is being carried, not read",
    ).not.toBe(trackValues(free));

    // COUNTERWEIGHT: "different" must not be reachable by emitting nothing when the flag is false.
    expect(violationsInTracks(free.tracks), "the unconstrained clip is not a legal clip").toEqual([]);
    expect(free.tracks.length, "dropping the tracks is not a way to differ").toBeGreaterThan(0);
  });
});
