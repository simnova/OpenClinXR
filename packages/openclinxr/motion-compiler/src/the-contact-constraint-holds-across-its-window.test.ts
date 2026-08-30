import { describe, expect, it } from "vitest";

import {
  MOTION_REGION_GUARD_RLQ,
} from "./plant-motion-regions.js";

import { planted } from "./planted.js";

import {
  violationsInTracks,
  type CompiledMotionFragment,
  type CompiledMotionTrack,
  type PrimitiveRequest,
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
const REGISTRY_MODULE = "./primitive-registry.js";

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
  /** Clause (1b) reads `deterministicSeed` from here; the keystone freezes this block. */
  compileIdentity?: { deterministicSeed?: string };
};

type CompileEntry = (input: { program: unknown; skeletonProfile: unknown }) => CompiledClip;

type RegistryModule = {
  resolvePrimitive?: (id: string) => { compile: (r: PrimitiveRequest) => CompiledMotionFragment } | undefined;
};

async function loadRegistry(): Promise<RegistryModule | undefined> {
  try {
    return (await import(/* @vite-ignore */ plantModule(REGISTRY_MODULE))) as RegistryModule;
  } catch {
    return undefined;
  }
}

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

/**
 * A SECOND contact point for clause (3), far enough from the first that no pose satisfies both:
 * 0.21 m apart against a 0.03 m tolerance, and 0.30 m from the shoulder so the 0.54 m arm reaches it.
 */
const RELEASE_POINT: Vec3 = { x: 0.24, y: 1.10, z: 0.10 };
const SECOND_START_FRACTION = 0.55;
const SECOND_END_FRACTION = 0.9;

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

/**
 * Shortest-path normalised quaternion interpolation, matching what a glTF `"LINEAR"` rotation
 * channel means at playback.
 *
 * ADDED 2026-08-30, and the clause was wrong without it. The first version did NEAREST-SAMPLE
 * lookup, so twenty-four sample times inspected three or four KEY poses over and over while the
 * interpolated motion between them was never evaluated at all. The exact cheap pass an external
 * reviewer named: emit sparse keys that reach the target, let the interpolation between them swing
 * the effector outside tolerance, and the oracle keeps reading the nearest endpoint and passes.
 *
 * That is the defect this whole plant exists to prevent — an assertion whose instrument cannot see
 * the thing it claims to measure — written into the instrument itself.
 */
function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let end = b;
  if (dot < 0) {
    // Shortest path. q and -q are the same rotation; without this the interpolation takes the long
    // way round and invents motion nobody emitted.
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
function effectorAt(clip: CompiledClip, timeSeconds: number): Vec3 {
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
        target: { kind: "body_region", id: MOTION_REGION_GUARD_RLQ },
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

/**
 * The clause (3) fixture: TWO contacts on ONE effector, at points 0.21 m apart, with OVERLAPPING
 * windows. No pose satisfies both, so one must yield — which is what makes the flag observable.
 */
function competingContactProgram(firstPreserve: boolean, secondPreserve: boolean) {
  const base = contactProgram(firstPreserve);
  const action = base.actions[0]!;
  return {
    ...base,
    actions: [
      {
        ...action,
        constraints: [
          ...action.constraints,
          {
            kind: "contact",
            effector: PROFILE.effectorBone,
            target: { kind: "body_point", position: RELEASE_POINT },
            positionToleranceMeters: POSITION_TOLERANCE_M,
            startFraction: SECOND_START_FRACTION,
            endFraction: SECOND_END_FRACTION,
            penetrationToleranceMeters: 0.01,
            preserveWhileActive: secondPreserve,
          },
        ],
      },
    ],
  };
}

/** Sample times that deliberately fall BETWEEN plausible keyframes as well as on them. */
function sampleTimes(duration: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push((duration * i) / count);
  return out;
}

describe("the contact constraint holds across its window", () => {
  planted("(1) RED: inside the window the effector holds contact on every sampled frame, not only at the keys", async () => {
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

  planted(
    "(1b) RED: the canonical entry uses the REAL registry — the registered guard is what runs",
    async () => {
      // THE LAST HOP, and it was only ever implied. M2 clause (2b) proves the registry resolves a
      // guard that returns a canonical fragment and reaches its target; the clauses in this file
      // compile through `compileMotionProgram` with no injected primitives. Between them the path is
      // covered — but only by COMBINING two tests, and neither one states it. External review called
      // that a near-miss rather than a closure, and it is: nothing fails if the entry quietly carries
      // its own fallback primitive and never consults the registry at all.
      //
      // So this asserts the join directly: compile with NO primitives override, and require the clip
      // to carry the fragment the REGISTERED guard produces for the same action.
      const compileMotionProgram = await loadEntry();
      const registry = await loadRegistry();
      expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");
      expect(
        typeof registry?.resolvePrimitive,
        `${REGISTRY_MODULE} must export resolvePrimitive — the entry has to have a registry to consult`,
      ).toBe("function");

      const program = contactProgram(true);
      const action = program.actions[0]!;

      // THE ENTRY FIRST, so its own seed can be read back and reused. Corrected 2026-08-30: the first
      // version passed a test literal (`"seed-registry-join"`) to the direct call while the entry
      // derived its own, then required byte-equal values. An honest seed-SENSITIVE primitive would
      // fail that even when the entry invoked exactly it, and passing would pressure the primitive to
      // ignore its seed or the compiler to adopt a test constant. Two calls that look equivalent and
      // do not share a load-bearing input — the family this plant set keeps finding.
      const clip = compileMotionProgram!({ program, skeletonProfile: structuredClone(PROFILE) });

      const seed = clip.compileIdentity?.deterministicSeed;
      expect(
        typeof seed === "string" && seed.length > 0,
        "the clip does not record the seed it compiled under, so no direct call can be made under the same input",
      ).toBe(true);

      // SINGLE-ACTION PROGRAM, stated explicitly: this fixture carries one action, so the clip-level
      // deterministic seed IS the seed that action's primitive saw. A multi-action program will need
      // per-action seed derivation before this comparison generalises, and that belongs to the
      // stable-identity card, not here.
      expect(program.actions.length, "this comparison assumes one action, so one seed").toBe(1);

      // What the REGISTERED primitive produces under THAT SAME seed.
      const registered = registry!.resolvePrimitive!(action.primitiveId)!.compile({
        action,
        skeletonProfile: structuredClone(PROFILE),
        seed: seed as string,
      });

      /**
       * NORMALISED, then compared whole. Corrected 2026-08-30 on review: this sorted track KEYS for
       * one assertion and then compared `values` POSITIONALLY for the counterweight.
       *
       * Two ways that was wrong at once. An honest entry may sort fragment tracks before composing
       * the clip while the primitive returns them in another order — sorted keys agree, the content
       * is identical, and the positional comparison reports a second implementation that does not
       * exist. And `values` alone omits times, interpolation and canonicalLandmark, so a clip with
       * the right numbers on the wrong schedule passed.
       *
       * Ordering is a legitimate degree of freedom; content is not.
       */
      const canonicalTracks = (tracks: readonly CompiledMotionTrack[]) =>
        [...tracks]
          .sort((a, b) => `${a.boneName}::${a.property}`.localeCompare(`${b.boneName}::${b.property}`))
          .map((track) => ({
            property: track.property,
            boneName: track.boneName,
            canonicalLandmark: track.canonicalLandmark,
            interpolation: track.interpolation,
            times: track.times,
            values: track.values,
          }));

      expect(
        canonicalTracks(clip.tracks),
        "the entry produced a clip whose tracks are not the registered guard's — it is not consulting the registry, or a second implementation ran",
      ).toEqual(canonicalTracks(registered.tracks));
    },
  );

  planted("(2) RED: outside the window the effector MOVES — a hand parked on the target is not a guard", async () => {
    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const clip = compileMotionProgram!({ program: contactProgram(true), skeletonProfile: structuredClone(PROFILE) });
    const times = sampleTimes(clip.durationSeconds, 24);
    const outside = times.filter((t) => t < clip.durationSeconds * START_FRACTION || t > clip.durationSeconds * END_FRACTION);

    const inside = times.filter((t) => t >= clip.durationSeconds * START_FRACTION && t <= clip.durationSeconds * END_FRACTION);
    expect(outside.length, "no samples fall outside the window, so this clause compares nothing").toBeGreaterThanOrEqual(4);
    expect(inside.length, "no samples fall inside the window, so there is nothing to travel from").toBeGreaterThanOrEqual(4);

    // A TRAVEL assertion, not a distance one — corrected 2026-08-30 while probing clause (3).
    //
    // This first measured only the maximum distance from the contact point outside the window, which
    // a solver that parks the hand 0.21 m away for the entire clip satisfies without ever moving. It
    // failed clause (1), so the PAIR was sound, but the clause was narrower than its own sentence and
    // that is the defect family both reviewers keep finding.
    //
    // The relationship instead: the hand must be measurably FURTHER from the contact point outside
    // the window than its closest approach inside it. A parked hand gives a difference of zero
    // wherever it is parked; a pinned hand likewise.
    const maxOutside = Math.max(...outside.map((t) => distance(effectorAt(clip, t), CONTACT_POINT)));
    const minInside = Math.min(...inside.map((t) => distance(effectorAt(clip, t), CONTACT_POINT)));
    expect(
      maxOutside - minInside,
      `the effector travelled ${(maxOutside - minInside).toFixed(3)} m between its closest approach inside the window and its furthest point outside, against a floor of ${MOVEMENT_FLOOR_M.toFixed(3)} m (10% of the ${REACH_DISTANCE_M.toFixed(3)} m reach this fixture requires) — it is parked, not reaching`,
    ).toBeGreaterThan(MOVEMENT_FLOOR_M);
  });

  planted(
    "(3) RED: preserveWhileActive is OBEYED — a releasable contact yields to a competing one",
    async () => {
      // REWRITTEN 2026-08-30 after external review. The first version compared serialised tracks
      // between a `true` and a `false` compile and asserted they differed. A solver reading the flag
      // and perturbing an unrelated head track satisfies that: the bytes differ, the contact
      // behaviour does not. The clause claimed the flag was OBEYED and proved only that it was
      // noticed.
      //
      // The reviewer's other point is the one that shaped this: `false` PERMITS release, it does not
      // command it, so a fixture with one contact cannot make release observable — a solver that
      // holds anyway is not wrong. The fixture must supply a COMPETING objective.
      //
      // So: two contacts on one effector, 0.21 m apart against a 0.03 m tolerance, with overlapping
      // windows. Inside the overlap they are mutually unsatisfiable. With the first releasable, the
      // second must win; with both preserved, the program is unbuildable and must be REFUSED.
      const compileMotionProgram = await loadEntry();
      expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

      // FIXTURE CHECK, before either assertion: if the points were close enough to satisfy together,
      // everything below would pass on a solver that ignores the flag entirely.
      expect(
        distance(CONTACT_POINT, RELEASE_POINT),
        "the two contact points are close enough that one pose satisfies both — this clause would prove nothing",
      ).toBeGreaterThan(POSITION_TOLERANCE_M * 3);

      const clip = compileMotionProgram!({
        program: competingContactProgram(false, true),
        skeletonProfile: structuredClone(PROFILE),
      });
      expect(violationsInTracks(clip.tracks), "the compiled tracks violate the canonical clip contract").toEqual([]);

      const overlapStart = clip.durationSeconds * SECOND_START_FRACTION;
      const overlapEnd = clip.durationSeconds * END_FRACTION;
      const overlap = sampleTimes(clip.durationSeconds, 24).filter((t) => t >= overlapStart && t <= overlapEnd);
      expect(overlap.length, "no samples fall in the overlap, so this clause compares nothing").toBeGreaterThanOrEqual(3);

      for (const t of overlap) {
        // The PRESERVED contact is the one that must be satisfied.
        expect(
          distance(effectorAt(clip, t), RELEASE_POINT),
          `t=${t.toFixed(3)}s: the preserved contact was not honoured, so the releasable one was never released`,
        ).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
      }

      // COUNTERWEIGHT: with BOTH preserved the program is unsatisfiable, and a compiler that silently
      // picks one has invented a precedence nobody authored. It must refuse.
      expect(
        () =>
          compileMotionProgram!({
            program: competingContactProgram(true, true),
            skeletonProfile: structuredClone(PROFILE),
          }),
        "two preserved contacts 0.21 m apart compiled without complaint — the compiler chose one silently",
      ).toThrow();
    },
  );
});
