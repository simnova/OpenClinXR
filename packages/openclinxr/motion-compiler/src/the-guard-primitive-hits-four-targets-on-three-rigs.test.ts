import { readdirSync, statSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: one hand-authored RLQ euler table is replayed for every guarding region on every
 * rig.** The card (tsk_87ee56f876ff1204, M2) asks for `guard_body_region(target)` — 4 body targets
 * x 3 rig families = 12 clips, with NO per-target euler tables.
 *
 * ## MEASURED ON HEAD — do not re-derive. This block is IMMUTABLE.
 *
 * Flip an `it.fails` to `it` and append a `## FIXED` block below; do not rewrite the paths or the
 * numbers above it.
 *
 * **(a) THE PRODUCER IS ONE HARDCODED RLQ POSE.**
 * `tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts`
 *   - `:20`  `ANIMATION_NAME = "openclinxr_role_patient_guard_withdraw_rlq"` — the region is in the
 *            clip's own identity, so a second region cannot be produced without a second constant.
 *   - `:28`  the backup path `patient-pre-guard-withdraw-rlq.glb` carries `rlq` too.
 *   - `:74`  `// Right upper arm draws hand toward lower abdomen / RLQ`
 *   - `:83`  `// Strong flex so hand reaches RLQ/abdomen`
 *   - `:92`  `// Protective palm orientation toward abdomen/RLQ`
 *   - `guardWithdrawRlq` (`:56-95`) is a 9-track x 3-keyframe pose table of ~10 non-zero float
 *     literals, hand-authored. The smallest non-zero authored euler in it is **0.04 rad**
 *     (`hand.L`, `:86`) — that is the authoring resolution of the artifact being replaced, and it
 *     is where the rotation epsilon below comes from. This is D1: a hand-authored geometry table
 *     where a solver belongs.
 *
 * **(b) THE CONSUMERS ARE SIX REGIONS SHARING ONE CLIP.** Measured over
 * `packages/openclinxr/scenario-fixtures/src/index.ts` `scenarioBank` (14 scenarios) on 2026-08-29:
 *
 *       touchResponses naming openclinxr_role_patient_guard_withdraw_rlq : 24
 *       scenarios carrying them                                          : 4
 *         ed_chest_pain_priority_v1, peds_asthma_parent_anxiety_v1,
 *         adult_abdominal_pain_v1, peds_fever_v1
 *       distinct regions on that one clip                                : 6
 *         abdomen_rlq, abdomen_ruq, abdomen_luq, abdomen_llq, chest_R, chest_L  (4 each)
 *       distinct responseClip values in the WHOLE bank                   : 1
 *
 * A learner palpating the left chest is played a right-lower-quadrant flinch. The four
 * `abdomen_rlq` rows all carry `emotion: "pain"`, `traceTag: "clinical_touch_guard_rlq"` and a
 * non-empty `dialogueLine` (`adult-abdominal-pain.ts:56-65` and siblings) — clause (3) is what
 * stops the generalisation deleting that.
 *
 * **(c) RIG RESOLUTION IS ALREADY SOLVED AND IS NOT BEING USED.**
 * `packages/openclinxr/asset-registry/src/pose-bone-resolver.ts` does IDENTITY-then-ALIAS landmark
 * resolution across three shipped families: the 23-bone canonical rig (identity), MPFB2's
 * 137-joint rig (`MPFB2_RIG_BONE_NAMES`, `:36-53`) and the 64-bone `mixamorig_unity` rig
 * (`MIXAMORIG_RIG_BONE_NAMES`, `:68-88`), via `resolvePoseBone` (`:95-108`). The materializer
 * instead carries its own two-name fallback lists (`["upper_arm.R", "upper_armR"]`, `:72`) and so
 * silently addresses NOTHING on the MPFB2 and mixamorig bodies a learner actually loads.
 *
 * ## WHAT THESE CLAUSES CANNOT SEE
 *
 * - **Whether the pose looks like guarding.** Every clause here is geometric: bone names resolve,
 *   an end effector lands within a tolerance, rotations vary with the target. None of it says the
 *   figure reads as a person protecting their abdomen. That is a pixel grade on a rendered clip and
 *   it is deliberately not in this file.
 * - **Clinical validity.** notEvidenceFor: clinical_validity, biomechanical_validity,
 *   production_animation_quality, exam_equivalence, scoring, learner_readiness.
 * - **The real bind frames.** The three `SkeletonProfile` fixtures below are CONSTRUCTED, not read
 *   from a shipped GLB. Their bone NAMES are real (cited above); their joint POSITIONS are
 *   illustrative and are chosen only so the three rigs have different limb lengths, which is what
 *   makes clause (1)'s "a shared euler table would emit identical numbers" counterweight bite. The
 *   implementation must read bind positions from the asset, not from these numbers.
 * - **Whether the clip plays.** Nothing here loads a GLB or steps an AnimationMixer.
 * - **Clause (4) is VACUOUS TODAY and says so.** `src/` currently holds only this test, so the scan
 *   has nothing to reject. Its far side is named: the moment `guard-body-region.ts` imports the
 *   solver directly it reds. The positive/negative detector probe inside the clause is what keeps
 *   the zero-file case honest rather than green-about-nothing.
 *
 * ## UNLOCKED — implementer decides and records in the commit message
 *
 * The exported names and the shape of `BodyRegionTarget.bodyPoint` (metres in the bind frame is
 * assumed below); which chain the solver drives (right arm only, or arm + torso recoil); whether
 * the 4th declared target is a chest region or a limb.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Shipped clip name — `materialize-guard-withdraw-clip.ts:20`. */
const SHIPPED_RLQ_CLIP = "openclinxr_role_patient_guard_withdraw_rlq";

/**
 * Rotation epsilon, INPUT-referenced: one quarter of 0.04 rad, the smallest non-zero euler the
 * shipped hand-authored table contains (`materialize-guard-withdraw-clip.ts:86`). Two poses that
 * differ by less than a quarter of the authoring resolution of the artifact being replaced are the
 * same pose. This is NOT a fraction of any measured output.
 */
const ROTATION_EPSILON_RAD = 0.01;

/**
 * Reach tolerance is expressed per rig as a fraction of THAT rig's own bind-frame forearm length,
 * so it scales with the subject instead of being a number fitted to an observation.
 */
const REACH_TOLERANCE_AS_FOREARM_FRACTION = 0.25;

/**
 * Perturbation distance for clause (2), sourced from the shipped case data: the bank partitions an
 * adult abdomen into 4 quadrants (`abdomen_rlq|ruq|luq|llq`), so ~0.10 m is one quadrant across.
 */
const ONE_QUADRANT_METERS = 0.1;

type Vec3 = { x: number; y: number; z: number };

type SkeletonProfile = {
  rigFingerprint: string;
  jointNames: readonly string[];
  /** Bind-frame joint position per sanitised bone name, metres. */
  bindFrame: Readonly<Record<string, Vec3>>;
  /**
   * The FK chain. Added 2026-08-30 with the reachedPoint removal: bind WORLD positions alone are
   * insufficient for general forward kinematics, so the oracle needs parent links plus local
   * transforms. Reviewer's words: "bind positions alone are insufficient for general FK."
   */
  joints: readonly FkJoint[];
  /**
   * The driven end effector on THIS rig, by its own bone name.
   *
   * Added after an external reviewer found the clause called the oracle with `names.wrist`, an
   * identifier scoped to `armProfile` and NOT in scope at the assertion. That was a BOOBY TRAP, not
   * a visible break: the clause dies earlier on the module-absence assertion, so the ReferenceError
   * would not have fired until a worker actually implemented compileGuardClip — at which point they
   * debug my test instead of their code. `it.fails` accepts ANY failure, which is exactly how a
   * broken RED hides inside a green suite.
   *
   * Named explicitly rather than taken positionally from jointNames: an index is the next silent
   * break when the array order changes.
   */
  effectorBone: string;
};

type BodyRegionTarget = {
  /** Shipped region id where one exists; an ad-hoc id in clause (2). */
  id: string;
  /** Where on the body the guarding hand must arrive, metres in the bind frame. */
  bodyPoint: Vec3;
};

type GuardTrack = { boneName: string; eulerFrames: readonly Vec3[] };

type GuardClip = {
  name: string;
  targetId: string;
  rigFingerprint: string;
  tracks: readonly GuardTrack[];
  /**
   * REMOVED 2026-08-30 after two independent reviews: `reachedPoint: Vec3`.
   *
   * It was SELF-REPORTED. The compiler could set `reachedPoint = bodyPoint` and emit any eulers at
   * all, and clause (1) would pass — a marker field standing in for the measurement the clause
   * claims to make. The euler-difference counterweight only proved three constructed rigs produced
   * different numbers, not that any of them reached anything.
   *
   * The endpoint is now DERIVED by the test from emitted tracks x bind frame (see `forwardKinematic`
   * below). The oracle lives here, not in the compiler, so the compiler cannot answer its own
   * question. A clip that still exposes reachedPoint is not read.
   *
   * Asked directly whether this had to stay marker-shaped until FK exists, the Codex reviewer
   * refused the exit: "Plant the FK derivation now; implement it after M1b." Writing the RED does not
   * require the production solver.
   */
};


/**
 * The FK oracle. Independently recovers the effector's world position from the EMITTED tracks and
 * the bind frame, so the compiler cannot self-report reach.
 *
 * Deliberately NOT calling any compiler helper: an oracle sharing code with the thing it checks is
 * two instruments with one blindness. Chain is accumulated parent-first as
 * bindLocalQuaternion x emittedLocalRotation.
 *
 * The chest carries a NON-IDENTITY bind rotation on purpose. An all-identity chain lets an incorrect
 * local/world multiplication order pass, which would make this oracle agree with a wrong compiler.
 */
type Quat4 = { x: number; y: number; z: number; w: number };

function qMul(a: Quat4, b: Quat4): Quat4 {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function qRotate(q: Quat4, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function qConj(q: Quat4): Quat4 {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** q and -q are the same rotation; normalise sign before any comparison. */
function qNorm(q: Quat4): Quat4 {
  return q.w < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
}

const IDENTITY_Q: Quat4 = { x: 0, y: 0, z: 0, w: 1 };

type FkJoint = {
  boneName: string;
  parentBoneName?: string;
  bindLocalPosition: Vec3;
  bindLocalQuaternion: Quat4;
};

function forwardKinematic(
  joints: readonly FkJoint[],
  emittedLocalRotation: ReadonlyMap<string, Quat4>,
  effectorBone: string,
): Vec3 {
  const byName = new Map(joints.map((j) => [j.boneName, j]));
  const chain: FkJoint[] = [];
  let cur = byName.get(effectorBone);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentBoneName ? byName.get(cur.parentBoneName) : undefined;
  }
  let worldQ: Quat4 = IDENTITY_Q;
  let worldP: Vec3 = { x: 0, y: 0, z: 0 };
  for (const joint of chain) {
    const offset = qRotate(worldQ, joint.bindLocalPosition);
    worldP = { x: worldP.x + offset.x, y: worldP.y + offset.y, z: worldP.z + offset.z };
    const local = qMul(joint.bindLocalQuaternion, emittedLocalRotation.get(joint.boneName) ?? IDENTITY_Q);
    worldQ = qNorm(qMul(worldQ, local));
  }
  return worldP;
}


/**
 * Recovers the effector endpoint from EMITTED euler tracks, at the frame of peak rotation.
 *
 * Tracks are euler triples per bone; convert to quaternions, feed the oracle. The compiler never
 * sees this function and never supplies its answer — that is the whole point of removing
 * reachedPoint.
 */
function eulerToQuat(e: Vec3): Quat4 {
  const cx = Math.cos(e.x / 2), sx = Math.sin(e.x / 2);
  const cy = Math.cos(e.y / 2), sy = Math.sin(e.y / 2);
  const cz = Math.cos(e.z / 2), sz = Math.sin(e.z / 2);
  return qNorm({
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  });
}

function derivedEffectorPoint(clip: GuardClip, profile: SkeletonProfile, effectorBone: string): Vec3 {
  const frameCount = Math.max(0, ...clip.tracks.map((t) => t.eulerFrames.length));
  let best: Vec3 = { x: 0, y: 0, z: 0 };
  let bestMagnitude = -1;
  for (let f = 0; f < frameCount; f += 1) {
    const rot = new Map<string, Quat4>();
    let magnitude = 0;
    for (const track of clip.tracks) {
      const e = track.eulerFrames[Math.min(f, track.eulerFrames.length - 1)];
      if (!e) continue;
      rot.set(track.boneName, eulerToQuat(e));
      magnitude += Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z);
    }
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      best = forwardKinematic(profile.joints, rot, effectorBone);
    }
  }
  return best;
}

type GuardModule = {
  compileGuardClip?: (input: {
    profile: SkeletonProfile;
    target: BodyRegionTarget;
    clipName?: string;
  }) => GuardClip;
  GUARD_BODY_TARGETS?: readonly BodyRegionTarget[];
};

/**
 * Computed so TypeScript cannot resolve a not-yet-written module at compile time, and so the
 * failure below is MODULE ABSENT rather than a transform error (repo idiom:
 * `a-gitignored-proof-target-is-caught-before-the-worker-runs.test.ts:112`).
 */
const GUARD_SPECIFIER = ["./guard", "body", "region.js"].join("-");

async function loadGuard(): Promise<GuardModule | undefined> {
  return (await import(GUARD_SPECIFIER).catch(() => undefined)) as GuardModule | undefined;
}

/** The bank, loaded by path so this file needs no cross-package manifest dependency. */
async function loadScenarioBank(): Promise<Record<string, unknown>[]> {
  const mod = (await import("../../scenario-fixtures/src/index.js").catch(() => undefined)) as
    | { scenarioBank?: Record<string, unknown>[] }
    | undefined;
  expect(Array.isArray(mod?.scenarioBank), "scenario-fixtures scenarioBank must load").toBe(true);
  return mod!.scenarioBank!;
}

// --- rig fixtures: real bone names (pose-bone-resolver.ts), illustrative positions -------------

function armProfile(
  rigFingerprint: string,
  names: { shoulder: string; elbow: string; wrist: string; spine: string; chest: string; head: string },
  upperArmLen: number,
  forearmLen: number,
): SkeletonProfile {
  const shoulder: Vec3 = { x: 0.18, y: 1.38, z: 0.0 };
  const elbow: Vec3 = { x: shoulder.x, y: shoulder.y - upperArmLen, z: 0.0 };
  const wrist: Vec3 = { x: elbow.x, y: elbow.y - forearmLen, z: 0.0 };
  // NON-IDENTITY chest bind rotation: ~12 degrees about X. Codex required at least one, because an
  // all-identity chain lets an incorrect local/world multiplication order pass and the oracle would
  // then agree with a wrong compiler. Local positions below are expressed in the PARENT's rotated
  // frame so the resulting world positions still equal bindFrame above.
  const chestQ: Quat4 = { x: Math.sin(0.105), y: 0, z: 0, w: Math.cos(0.105) };
  const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const spineW: Vec3 = { x: 0.0, y: 1.05, z: 0.0 };
  const chestW: Vec3 = { x: 0.0, y: 1.28, z: 0.0 };
  const inChest = (w: Vec3): Vec3 => qRotate(qConj(chestQ), sub(w, chestW));
  const joints: FkJoint[] = [
    { boneName: names.spine, bindLocalPosition: spineW, bindLocalQuaternion: IDENTITY_Q },
    { boneName: names.chest, parentBoneName: names.spine, bindLocalPosition: sub(chestW, spineW), bindLocalQuaternion: chestQ },
    { boneName: names.shoulder, parentBoneName: names.chest, bindLocalPosition: inChest(shoulder), bindLocalQuaternion: IDENTITY_Q },
    { boneName: names.elbow, parentBoneName: names.shoulder, bindLocalPosition: sub(elbow, shoulder), bindLocalQuaternion: IDENTITY_Q },
    { boneName: names.wrist, parentBoneName: names.elbow, bindLocalPosition: sub(wrist, elbow), bindLocalQuaternion: IDENTITY_Q },
  ];
  return {
    rigFingerprint,
    jointNames: [names.shoulder, names.elbow, names.wrist, names.spine, names.chest, names.head],
    joints,
    effectorBone: names.wrist,
    bindFrame: {
      [names.shoulder]: shoulder,
      [names.elbow]: elbow,
      [names.wrist]: wrist,
      [names.spine]: { x: 0.0, y: 1.05, z: 0.0 },
      [names.chest]: { x: 0.0, y: 1.28, z: 0.0 },
      [names.head]: { x: 0.0, y: 1.6, z: 0.0 },
    },
  };
}

/** 23-bone canonical rig — IDENTITY branch of resolvePoseBone (pose-bone-resolver.ts:104). */
const ANNY_23_BONE = armProfile(
  "anny_23_bone",
  { shoulder: "upper_armR", elbow: "forearmR", wrist: "handR", spine: "spine", chest: "chest", head: "head" },
  0.28,
  0.26,
);

/** MPFB2 137-joint rig — ALIAS branch, names from MPFB2_RIG_BONE_NAMES (:36-53). */
const MPFB2_137_JOINT = armProfile(
  "mpfb2_137_joint",
  { shoulder: "upperarm01R", elbow: "lowerarm01R", wrist: "wristR", spine: "spine03", chest: "spine01", head: "head" },
  0.3,
  0.27,
);

/** mixamorig_unity 64-bone rig — names from MIXAMORIG_RIG_BONE_NAMES (:68-88), colons preserved. */
const MIXAMORIG_64_BONE = armProfile(
  "mixamorig_unity_64_bone",
  {
    shoulder: "mixamorig:RightArm",
    elbow: "mixamorig:RightForeArm",
    wrist: "mixamorig:RightHand",
    spine: "mixamorig:Spine1",
    chest: "mixamorig:Spine2",
    head: "mixamorig:Head",
  },
  0.26,
  0.24,
);

const RIG_FAMILIES = [ANNY_23_BONE, MPFB2_137_JOINT, MIXAMORIG_64_BONE] as const;

/** Four targets, ids taken from the SHIPPED region vocabulary measured in (b) — not invented. */
const FOUR_TARGETS: readonly BodyRegionTarget[] = [
  { id: "abdomen_rlq", bodyPoint: { x: 0.08, y: 1.0, z: 0.12 } },
  { id: "abdomen_luq", bodyPoint: { x: -0.08, y: 1.12, z: 0.12 } },
  { id: "chest_R", bodyPoint: { x: 0.09, y: 1.3, z: 0.11 } },
  { id: "chest_L", bodyPoint: { x: -0.09, y: 1.3, z: 0.11 } },
];

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function forearmLengthOf(profile: SkeletonProfile): number {
  const [, elbow, wrist] = profile.jointNames;
  return distance(profile.bindFrame[elbow]!, profile.bindFrame[wrist]!);
}

function peakEulers(clip: GuardClip): Map<string, Vec3> {
  const peak = new Map<string, Vec3>();
  for (const track of clip.tracks) {
    // Frame 1 of the 3-keyframe neutral -> peak -> settle shape (KEYFRAME_TIMES, :33).
    const frame = track.eulerFrames[1] ?? track.eulerFrames[track.eulerFrames.length - 1];
    if (frame) peak.set(track.boneName, frame);
  }
  return peak;
}

function maxEulerDelta(a: Map<string, Vec3>, b: Map<string, Vec3>): number {
  let worst = 0;
  for (const [bone, ea] of a) {
    const eb = b.get(bone);
    if (!eb) continue;
    worst = Math.max(worst, Math.abs(ea.x - eb.x), Math.abs(ea.y - eb.y), Math.abs(ea.z - eb.z));
  }
  return worst;
}

/** Detector for clause (4). Kept pure so the clause can prove it discriminates. */
function namesTheSolverDirectly(source: string): boolean {
  return /CCDIKSolver/.test(source);
}

function listPackageSources(root: string, selfPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts")) continue;
      // Tests are excluded: this file names the symbol in its own detector, and a sibling contract
      // may legitimately quote it. The rule is about the PRODUCTION primitive layer.
      if (full.endsWith(".test.ts")) continue;
      if (full === selfPath) continue;
      out.push(full);
    }
  };
  walk(root);
  return out;
}

describe("the guard primitive hits four targets on three rigs", () => {
  it.fails(
    "(1) guard_body_region resolves one target on THREE rig families through the bind frame, not a per-rig euler table",
    async () => {
      const mod = await loadGuard();
      expect(
        typeof mod?.compileGuardClip,
        "guard-body-region must export compileGuardClip — it does not exist yet",
      ).toBe("function");
      const compile = mod!.compileGuardClip!;

      const rlq = FOUR_TARGETS[0]!;
      const perRig = RIG_FAMILIES.map((profile) => ({
        profile,
        clip: compile({ profile, target: rlq }),
      }));

      for (const { profile, clip } of perRig) {
        expect(clip.rigFingerprint, "the clip must declare which rig it was solved for").toBe(
          profile.rigFingerprint,
        );
        expect(clip.tracks.length, `${profile.rigFingerprint} produced no tracks`).toBeGreaterThan(0);

        // Every driven bone must EXIST on this rig. The shipped materializer's two-name fallback
        // (`["upper_arm.R", "upper_armR"]`, :72) resolves on none of the alias rigs.
        const present = new Set(profile.jointNames);
        for (const track of clip.tracks) {
          expect(
            present.has(track.boneName),
            `${profile.rigFingerprint}: track addresses ${track.boneName}, which is not on this rig`,
          ).toBe(true);
        }

        // The hand arrives at the region, within a tolerance scaled to THIS rig's own forearm.
        const tolerance = forearmLengthOf(profile) * REACH_TOLERANCE_AS_FOREARM_FRACTION;
        expect(
          // DERIVED from emitted tracks x bind frame, never read off the clip.
          distance(derivedEffectorPoint(clip, profile, profile.effectorBone), rlq.bodyPoint),
          `${profile.rigFingerprint}: hand missed ${rlq.id} by more than ${tolerance.toFixed(3)} m`,
        ).toBeLessThanOrEqual(tolerance);
      }

      // The three rigs share no bone names, so no single hardcoded name set could have driven them.
      const nameSets = perRig.map(({ clip }) => new Set(clip.tracks.map((t) => t.boneName)));
      for (let i = 0; i < nameSets.length; i += 1) {
        for (let j = i + 1; j < nameSets.length; j += 1) {
          const shared = [...nameSets[i]!].filter((n) => nameSets[j]!.has(n));
          expect(shared, `rigs ${i} and ${j} were driven through shared bone names`).toEqual([]);
        }
      }

      // COUNTERWEIGHT against a shared euler table: the three rigs have different limb lengths, so
      // a solved pose MUST differ between them. A table replayed onto aliased bones would not.
      const anny = peakEulers(perRig[0]!.clip);
      const mpfb = peakEulers(perRig[1]!.clip);
      const byIndex = (clip: GuardClip): Vec3[] => clip.tracks.map((t) => t.eulerFrames[1] ?? t.eulerFrames[0]!);
      const positional = byIndex(perRig[0]!.clip).map((a, index) => {
        const b = byIndex(perRig[1]!.clip)[index];
        return b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z)) : 0;
      });
      expect(
        Math.max(0, ...positional, maxEulerDelta(anny, mpfb)),
        "the 23-bone and MPFB2 rigs have different limb lengths but got identical rotations — that is a replayed table, not a solve",
      ).toBeGreaterThan(ROTATION_EPSILON_RAD);

      // The full grid the card asks for: 4 targets x 3 rigs = 12 distinct clips.
      const grid = RIG_FAMILIES.flatMap((profile) =>
        FOUR_TARGETS.map((target) => compile({ profile, target })),
      );
      expect(grid.length).toBe(12);
      expect(
        new Set(grid.map((c) => `${c.rigFingerprint}::${c.targetId}`)).size,
        "the 12 clips must be 12 distinct (rig, target) pairs",
      ).toBe(12);
      expect(
        (mod!.GUARD_BODY_TARGETS ?? []).length,
        "at least four body targets must be declared",
      ).toBeGreaterThanOrEqual(4);
    },
  );

  it.fails(
    "(2) a body target the module has never declared still compiles — there is no per-target pose table",
    async () => {
      const mod = await loadGuard();
      expect(typeof mod?.compileGuardClip, "guard-body-region must export compileGuardClip").toBe(
        "function",
      );
      const compile = mod!.compileGuardClip!;
      const profile = ANNY_23_BONE;
      const tolerance = forearmLengthOf(profile) * REACH_TOLERANCE_AS_FOREARM_FRACTION;

      // (a) An id no table could hold an entry for. This is the whole clause: a lookup keyed on the
      // region id cannot answer, so adding a fifth body target must cost zero new rotation constants.
      const adHoc: BodyRegionTarget = {
        id: "flank_R_ad_hoc_probe",
        bodyPoint: { x: 0.14, y: 1.06, z: 0.02 },
      };
      const adHocClip = compile({ profile, target: adHoc });
      expect(adHocClip.targetId).toBe(adHoc.id);
      expect(adHocClip.tracks.length).toBeGreaterThan(0);
      expect(
        distance(derivedEffectorPoint(adHocClip, ANNY_23_BONE, ANNY_23_BONE.effectorBone), adHoc.bodyPoint),
        "an undeclared target must still be reached — a per-target table cannot do this",
      ).toBeLessThanOrEqual(tolerance);

      // (b) The id is not the key: two different ids at the SAME point must give the SAME pose.
      const sameA = compile({ profile, target: { id: "abdomen_rlq", bodyPoint: adHoc.bodyPoint } });
      const sameB = compile({ profile, target: { id: "chest_L", bodyPoint: adHoc.bodyPoint } });
      expect(
        maxEulerDelta(peakEulers(sameA), peakEulers(sameB)),
        "two ids at one point produced different poses — the id is being looked up, not the geometry",
      ).toBeLessThanOrEqual(ROTATION_EPSILON_RAD);

      // (c) The geometry IS the key: moving the point one abdominal quadrant must move the pose.
      const moved = compile({
        profile,
        target: { id: adHoc.id, bodyPoint: { ...adHoc.bodyPoint, x: adHoc.bodyPoint.x - ONE_QUADRANT_METERS } },
      });
      expect(
        maxEulerDelta(peakEulers(adHocClip), peakEulers(moved)),
        `moving the target ${ONE_QUADRANT_METERS} m left changed no rotation — the output does not depend on the target`,
      ).toBeGreaterThan(ROTATION_EPSILON_RAD);
    },
  );

  it("(3) the shipped RLQ behaviour survives — clip name, emotion, dialogue and trace still ship", async () => {
    // LIVE COUNTERWEIGHT. Passes on arrival and fails independently of (1) and (2). It exists
    // because §6p's failure is deletion-without-replacement: generalising the producer must not
    // quietly drop the one clip 24 shipped touch responses already name.
    const bank = await loadScenarioBank();
    expect(bank.length, "the shipped bank measured 14 scenarios").toBeGreaterThanOrEqual(14);

    type TouchResponse = {
      region?: string;
      // Added 2026-08-30: the amended clause filters on responseKind, and omitting it here made the
      // filter read undefined and match nothing — a local type silently narrowing live data.
      responseKind?: string;
      emotion?: string;
      responseClip?: string;
      dialogueLine?: string;
      traceTag?: string;
    };
    const responses: { scenarioId: string; response: TouchResponse }[] = [];
    for (const scenario of bank) {
      const scenarioId = String((scenario as { scenarioId?: unknown }).scenarioId ?? "");
      for (const actor of ((scenario as { actors?: unknown[] }).actors ?? []) as {
        bodyMechanics?: { touchResponses?: TouchResponse[] };
      }[]) {
        for (const response of actor.bodyMechanics?.touchResponses ?? []) {
          responses.push({ scenarioId, response });
        }
      }
    }

    // AMENDED 2026-08-30 after two independent reviews found this clause CONTRADICTS its own successor.
    //
    // It originally required >= 24 rows still NAMING openclinxr_role_patient_guard_withdraw_rlq. But
    // those 24 rows span SIX distinct body regions across four scenarios, all playing one right-lower-
    // quadrant flinch — a left-chest palpation returns an RLQ response. The clip-binding card exists
    // to END that. Landing the successor would have REDDENED this predecessor, and the cheapest way
    // out would have been to weaken whichever clause was in the way.
    //
    // §6p is still the reason this clause exists: generalising a producer must not delete behaviour
    // without a replacement. What §6p actually protects is the BEHAVIOUR, not the binding. So the
    // assertion moves from "24 rows still name this clip" to "the guarding behaviour is still
    // producible and still reaches the same scenarios" — which survives per-region binding.
    const guardingRows = responses.filter((r) => r.response.responseKind === "guarding");
    expect(
      guardingRows.length,
      "the guarding behaviour must still ship — 24 rows carried it when this was planted",
    ).toBeGreaterThanOrEqual(24);
    expect(
      new Set(guardingRows.map((r) => r.scenarioId)).size,
      "the four scenarios carrying guarding responses must keep them",
    ).toBeGreaterThanOrEqual(4);
    // The clip itself must remain PRODUCIBLE — that is the §6p guarantee — but no row is required to
    // keep naming it, so per-region binding is free to land.
    expect(
      responses.some((r) => r.response.responseClip === SHIPPED_RLQ_CLIP)
        || guardingRows.length >= 24,
      `${SHIPPED_RLQ_CLIP} must stay producible, though rows may rebind to per-region clips`,
    ).toBe(true);

    // Every shipped touch response must still carry its full conversation payload. This is the half
    // that a "generalise the geometry" slice can silently drop.
    // Runs over GUARDING rows, not clip-name matches — the payload guarantee is about the
    // behaviour and must survive per-region rebinding.
    for (const { scenarioId, response } of guardingRows) {
      expect(response.responseClip, `${scenarioId} ${response.region}: clip`).toBeTruthy();
      expect(response.emotion, `${scenarioId} ${response.region}: emotion`).toBeTruthy();
      expect((response.dialogueLine ?? "").length, `${scenarioId} ${response.region}: dialogueLine`)
        .toBeGreaterThan(0);
      expect(response.traceTag, `${scenarioId} ${response.region}: traceTag`).toBeTruthy();
    }

    // The RLQ rows specifically keep the emotion and trace tag the runtime ledger writes.
    const rlqRows = guardingRows.filter((r) => r.response.region === "abdomen_rlq");
    expect(rlqRows.length, "four abdomen_rlq rows ship today").toBeGreaterThanOrEqual(4);
    for (const { scenarioId, response } of rlqRows) {
      expect(response.emotion, `${scenarioId} abdomen_rlq emotion`).toBe("pain");
      expect(response.traceTag, `${scenarioId} abdomen_rlq traceTag`).toBe("clinical_touch_guard_rlq");
    }

    // The producer must still exist and still name the shipped clip. Renaming it without keeping a
    // path to this name reds here, independently of whether the primitive was ever written.
    const producer = resolve(HERE, "../../../../tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts");
    const producerSource = readFileSync(producer, "utf8");
    expect(
      producerSource.includes(SHIPPED_RLQ_CLIP),
      "the shipped clip name disappeared from its producer",
    ).toBe(true);
  });

  it("(4) the primitive layer does not import three.js CCDIKSolver — solve-chain.ts owns that seam", () => {
    // COUNTERWEIGHT on architecture. The brief forbids depending on that exact API anywhere except
    // one seam file, so the cheap green — wire CCDIKSolver straight into guard-body-region.ts —
    // is refused before it is written.
    //
    // VACUOUS TODAY BY CONSTRUCTION, and the far side is named (§11o): `src/` holds only this test,
    // so nothing is scanned. The probe below proves the detector discriminates, so the zero-file
    // case is honest rather than green-about-nothing, and the clause bites the moment any
    // non-seam source appears.
    expect(
      namesTheSolverDirectly('import { CCDIKSolver } from "three/examples/jsm/animation/CCDIKSolver.js";'),
      "detector must catch a direct solver import",
    ).toBe(true);
    expect(
      namesTheSolverDirectly('import { solveChain } from "./solve-chain.js";'),
      "detector must not fire on the sanctioned seam import",
    ).toBe(false);

    const selfPath = fileURLToPath(import.meta.url);
    const sources = listPackageSources(HERE, selfPath);
    const offenders = sources
      .filter((path) => !path.endsWith("solve-chain.ts"))
      .filter((path) => namesTheSolverDirectly(readFileSync(path, "utf8")));
    expect(
      offenders.map((p) => p.slice(HERE.length + 1)),
      "only solve-chain.ts may name CCDIKSolver; the primitive layer must go through that seam",
    ).toEqual([]);
  });
});

// NOT TESTED: that the compiled clip LOOKS like guarding (pixel grade on a rendered clip, not here);
// that it plays through an AnimationMixer or survives glTF export; the real bind-frame positions of
// any shipped GLB (the three profiles above are constructed, bone names real, positions illustrative);
// whether solve-chain.ts itself converges, is stable, or is licence-clean; clinical or biomechanical
// validity of any pose; that the 24 shipped touch responses stop sharing one clip — clause (3) only
// forbids losing it, and pointing six regions at six clips is the NEXT card, not this one.
