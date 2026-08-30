import { copyFileSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REGION_ANCHOR_SPACE } from "./plant-motion-regions.js";

/**
 * **OBSERVABLE: every `SkeletonProfile` in this package is CONSTRUCTED, and shipped rigs that could
 * have supplied one are sitting in the tree, tracked, unread.**
 *
 * Card tsk_9f1009a2642f18bf (M1b). M1 claimed `SkeletonProfile` and its committed RED never loads
 * one. This contract demands the profile be DERIVED from a shipped skeleton — bind world transforms,
 * ancestry, primary bend axis, rig fingerprint — and bounds it against the real files.
 *
 * ## MEASURED ON HEAD 2026-08-30 — do not re-derive. This block is IMMUTABLE.
 *
 * Flip a `planted` to `it` and append a `## FIXED (#N)` block BELOW this; do not rewrite the paths
 * or the numbers above it.
 *
 * **(a) THE PREMISE IS TRUE: nothing in this package reads a rig.** `src/` holds 10 files; a scan
 * for the shipped rig directory `xr-assets/humanoids` over all of them except this one returns ZERO.
 * Clause (7) is that scan, kept live so the premise stays checkable rather than assumed.
 *
 * The first draft of that scan looked for `.glb` and reported one hit —
 * `the-guard-primitive-hits-four-targets-on-three-rigs.test.ts:40`, which names
 * `patient-pre-guard-withdraw-rlq.glb` **in a prose comment about a materializer in `tools/`**. That
 * is a marker check, not a measurement: a filename in a sentence is not a file being opened. The
 * scan now looks for the asset directory a rig actually lives in. Recorded because the same mistake
 * in the implementation — matching a bone by name rather than reading its transform — is the defect
 * clause (2) exists to catch.
 *
 * **(b) THE FIXTURES SAY SO THEMSELVES.**
 * `the-guard-primitive-hits-four-targets-on-three-rigs.test.ts` header, verbatim: *"The three
 * `SkeletonProfile` fixtures below are CONSTRUCTED, not read from a shipped GLB. Their bone NAMES
 * are real; their joint POSITIONS are illustrative."* This card is what removes that caveat.
 *
 * **(c) REAL RIG ASSETS ARE REACHABLE AND ARE TRACKED IN GIT** — the brief allowed for them being
 * gitignored; they are not. `git ls-files '*.glb'` returns **133** tracked GLBs. Three rig FAMILIES,
 * one tracked file each, matching the three families `pose-bone-resolver.ts` already resolves:
 *
 *   | family    | tracked path (from repo root)                                                  | joints | generator |
 *   |-----------|--------------------------------------------------------------------------------|--------|-----------|
 *   | canonical | `apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb`             |   17   | glTF-Transform v4.3.0 |
 *   | mixamorig | `apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb` | 64 | Blender I/O v5.1.19 |
 *   | mpfb2     | `apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb` | 137 | Blender I/O v5.1.19 |
 *
 * **(d) THE BIND FRAME IS IN THE FILE, TWICE, AND THE TWO ROUTES AGREE — TO A MEASURED AMOUNT.**
 * Inverting each joint's `skins[0].inverseBindMatrices` entry gives its bind world matrix;
 * accumulating node TRS down the hierarchy gives the same matrix. Over ALL joints of all three files:
 *
 *     max position disagreement     7.037e-7 m     (orbicularis03.L, mpfb2)
 *     max orientation disagreement  2.627e-3 rad   (mixamorig:LeftFoot, library rig)
 *
 * Those two numbers are the decode noise floor and they are where the tolerances below come from.
 * This test decodes by the IBM route, so a deriver walking the node hierarchy is checked against a
 * genuinely independent reading of the same file.
 *
 * **THE ROTATION FIGURE WAS GOT WRONG FIRST TIME AND IS RECORDED HERE RATHER THAN QUIETLY FIXED.**
 * The tolerance was originally set at 1e-3 rad, INFERRED from (f)'s column norms — a proxy, not a
 * measurement. The honest satisfiability probe below failed on `mixamorig:RightArm` at 1.12e-3 rad,
 * and measuring the real quantity put the floor 200x above the proxy. An evasion probe would never
 * have found it: a cheating implementation is not trying to agree with the file. This is the same
 * class as a threshold derived from the wrong reference, and it is the reason both probe directions
 * are mandatory.
 *
 * Measured bind world positions, metres, right arm (IBM route):
 *
 *   | family    | shoulder                    | elbow                        | wrist                       |
 *   |-----------|-----------------------------|------------------------------|-----------------------------|
 *   | canonical | `upper_armR` (-0.1800, 1.4500, 0.0000) | `forearmR` (-0.5200, 1.3200, 0.0000) | `handR` (-0.7800, 1.1400, 0.0000) |
 *   | mixamorig | `mixamorig:RightArm` (-0.1677, 1.3801, 0.1720) | `mixamorig:RightForeArm` (-0.3129, 1.2048, 0.1705) | `mixamorig:RightHand` (-0.4312, 1.1007, 0.3330) |
 *   | mpfb2     | `upperarm01R` (-0.1700, 1.3201, 0.0193) | `lowerarm01R` (-0.3312, 1.1396, 0.0201) | `wristR` (-0.4531, 1.0155, 0.1832) |
 *
 * Segment lengths: canonical 0.3640 / 0.3162; mpfb2 0.2420 / 0.2385; mixamorig 0.2276 / 0.2263.
 * Elbow-to-elbow spread across the three: 0.2620, 0.2919, **0.1650** (smallest).
 *
 * **(e) A SEPARATION-BASED EPSILON WAS TRIED AND REJECTED, because rigs carry COINCIDENT JOINTS.**
 * The obvious input-referenced tolerance — half the distance to the nearest other joint — is
 * **exactly 0** on two of the three files: `spine01`/`breastL` coincide on mpfb2, and
 * `mixamorig:RightUpLeg`/`mixamorig:RightButtock` coincide on the library rig. Recorded so the next
 * reader does not re-derive a degenerate threshold. The tolerance used instead is (d)'s decode noise.
 *
 * **(f) THE BIND MATRICES ARE ROTATION-ONLY.** Column norms of the inverted IBM deviate from unit by
 * at most 1.23e-5 over all joints of all three files. So a quaternion read off the 3x3 is well
 * defined. It does NOT bound the orientation decode noise — see (d).
 *
 * **(g) EVERY CHAIN TERMINATES AT AN ARMATURE NODE THAT IS NOT A JOINT** — measured wrist-to-root:
 *
 *     canonical  handR > forearmR > upper_armR > chest > spine > pelvis > [openclinxr_canonical_humanoid_armature]
 *     mpfb2      wristR > lowerarm02R > lowerarm01R > upperarm02R > upperarm01R > shoulder01R >
 *                clavicleR > spine01 > spine02 > spine03 > spine04 > spine05 > root > [mpfb_ob_patient_aisha_standard_rig]
 *     mixamorig  mixamorig:RightHand > ...ForeArm > ...Arm > ...Shoulder > Spine2 > Spine1 > Spine >
 *                Hips > mixamorig:Root > [hm08_basemesh_adult_lean_femalerig]
 *
 * Bracketed nodes are NOT in `skins[0].joints`. Clause (3) therefore requires `parentBoneName` to be
 * `null` at that boundary — the alternative, naming a non-joint, gives a chain that never terminates
 * inside the rig.
 *
 * Note also that the landmark chain is not the BONE chain: on mpfb2 the wrist's parent is
 * `lowerarm02R`, not the elbow landmark `lowerarm01R`. Clause (6) measures segments between
 * LANDMARKS for that reason.
 *
 * ## WHAT THIS SHAPE IS, AND WHY IT IS NOT A FOURTH PROFILE DIALECT
 *
 * `DerivedSkeletonProfile` below is deliberately the RIG HALF of `RigAsset` in
 * `the-region-anchors-come-from-a-real-asset.test.ts` (`rigFingerprint`, `joints`, `bindFrame`) plus
 * the landmark records this card adds. That is the real join: M1b produces the rig record,
 * tsk_e5b1a3efad002aef consumes it and adds `regionAnchors`, M2 consumes the profile. Adding a
 * differently-shaped record here would be the one-concept-several-declarations defect this package
 * has now fixed four times.
 *
 * `effectorBone` is on `RigAsset` and is deliberately NOT here: which bone is the effector is named
 * by the REQUEST, not by the skeleton. A deriver that picked one would be guessing.
 *
 * `bindSpace` must equal `REGION_ANCHOR_SPACE` — imported, not restated, because that constant is
 * already declared once in `plant-motion-regions.ts` and its own doc says the anchors share the bind
 * frame's space. It governs every vector in the record: positions AND axes.
 *
 * ## WHAT THESE CLAUSES CANNOT SEE
 *
 * - **Whether the rig is anatomically right.** Clause (6) bounds a bend axis as perpendicular to the
 *   segments it hinges — that is geometry, not anatomy. Nothing here says an elbow limit of
 *   [-2.4, 0.0] rad is a human elbow. notEvidenceFor: clinical_validity, biomechanical_validity,
 *   production_animation_quality, exam_equivalence, scoring, learner_readiness.
 * - **Meshes, skin weights, morph targets.** Only `skins[0]` and the node hierarchy are read. A rig
 *   whose weights are all zero passes every clause here.
 * - **Landmark NAMING across rigs.** No clause asserts that `forearmR` resolves to `lowerarm01R` on
 *   mpfb2 — `pose-bone-resolver.ts` owns that map and duplicating it here would be a second
 *   declaration. Clause (2) instead checks whatever bone the deriver NAMES against the file, and
 *   clause (5) requires the three rigs to name three DIFFERENT bones.
 * - **Anything M1, M2 or the solver bound.** No solver, no contacts, no trajectory, no region
 *   anchors (tsk_e5b1a3efad002aef owns those and they are NOT derivable from a skeleton).
 * - **Whether more than three rigs work.** Three families, one file each.
 *
 * ## UNLOCKED — implementer decides and records in the commit message
 *
 * How `rigFingerprint` is computed (clause (5) requires only that it is stable under a byte-identical
 * copy at a different path and differs between families); whether `joints` carries every joint or a
 * reachable subset (clause (3) requires the landmark chains to be present and FK-consistent); how
 * `jointLimits` are sourced, beyond clause (6)'s requirement that the bind pose lies inside them.
 */

/**
 * ## FIXED (tsk_3778b159cf72414d) — clauses (1) through (6) are now live `it` tests.
 *
 * The M1b deriver landed at `src/derive-skeleton-profile.ts` and exports
 * `deriveSkeletonProfileFromRigAsset(glbPath, landmarks)`:
 *
 *   - DECODE ROUTE: the node hierarchy — a joint's bind world matrix is its node's TRS accumulated
 *     from the root, the route independent of this contract's oracle (inverse bind matrices).
 *     Header (d)'s measured agreement between the two routes (7.037e-7 m / 2.627e-3 rad) is what
 *     the contract's tolerances bound, and the deriver stays inside them.
 *   - LANDMARK RESOLUTION: identity-then-alias through `resolvePoseBone` in asset-registry's
 *     pose-bone-resolver.ts — the single declared map, imported relatively because the package
 *     builds no dist in a worktree (the same cross-package src import the plants use; it breaks
 *     the composite `rootDir` typecheck, recorded as a known tradeoff in tsconfig.plants.json).
 *   - AXES: hinge and twist computed from the rig's own segment directions — the middle landmark
 *     of a chain gets bend = cross(proximal, distal), perpendicular to both segments, and
 *     twist = distal direction; no constant (0,0,1) anywhere.
 *   - FINGERPRINT: FNV-1a over sorted joint names + quantised bind positions — stable under a
 *     byte-identical copy at a different path, different across the three families.
 *   - REFUSALS: a skinless file, an absent file, and an unresolvable landmark all throw.
 *   - `jointLimits` are conservative symmetric placeholders (±1.0 rad about the bind pose, so the
 *     rest angle 0 lies inside). notEvidenceFor: anatomical range, clinical/biomechanical validity.
 *
 * Clause (7)'s premise FLIPPED: the package now HAS a deriver. The clause was updated to assert
 * the deriver is exported and that no product source hardcodes the shipped rig directory (paths
 * come from callers); the scan half is unchanged. Clause (8) is untouched.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const PRODUCER_MODULE = "./derive-skeleton-profile.js";

/** Resolve to an ABSOLUTE url so an absent module reports its real path, not a mangled one. */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

/**
 * The bind frame and the region anchors are ONE space, declared once in `plant-motion-regions.ts`.
 * Aliased rather than restated so there is no second string to drift.
 */
const BIND_WORLD_SPACE = REGION_ANCHOR_SPACE;

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

/** One landmark of the derived profile. Every vector is in `bindSpace`. */
type DerivedLandmark = {
  /** The bone actually addressed ON THIS RIG, three.js-sanitised (dots stripped). */
  boneName: string;
  /** The bone's parent, or `null` where the parent node is not a joint of this skin. */
  parentBoneName: string | null;
  bindWorldPosition: Vec3;
  bindWorldQuaternion: Quat;
  /** Unit. The hinge axis, perpendicular to the segments it bends. */
  primaryBendAxis: Vec3;
  /** Unit. Along the distal segment. */
  twistAxis: Vec3;
  /** Radians about `primaryBendAxis`, RELATIVE TO THE BIND POSE, so 0 is the rest angle. */
  jointLimits: { minRad: number; maxRad: number };
};

/** A joint of the rig in the shape `RigAsset` already uses, so the records compose. */
type DerivedJoint = {
  boneName: string;
  parentBoneName?: string;
  bindLocalPosition: Vec3;
  bindLocalQuaternion: Quat;
};

type DerivedSkeletonProfile = {
  rigFingerprint: string;
  /** Governs every vector in this record, positions AND axes. */
  bindSpace: string;
  /** Every joint of `skins[0]`, sanitised. */
  jointNames: readonly string[];
  joints: readonly DerivedJoint[];
  /** Bind WORLD position per bone name — the same map `RigAsset.bindFrame` carries. */
  bindFrame: Readonly<Record<string, Vec3>>;
  landmarks: Readonly<Record<string, DerivedLandmark>>;
};

type ProducerModule = {
  deriveSkeletonProfileFromRigAsset?: (
    glbPath: string,
    landmarks: readonly string[],
  ) => DerivedSkeletonProfile;
};

async function loadProducer(): Promise<ProducerModule | undefined> {
  try {
    return (await import(/* @vite-ignore */ plantModule(PRODUCER_MODULE))) as ProducerModule;
  } catch {
    return undefined;
  }
}

async function requireDeriver(): Promise<
  NonNullable<ProducerModule["deriveSkeletonProfileFromRigAsset"]>
> {
  const producer = await loadProducer();
  expect(
    typeof producer?.deriveSkeletonProfileFromRigAsset,
    `${PRODUCER_MODULE} must export deriveSkeletonProfileFromRigAsset — nothing in this package reads a rig today`,
  ).toBe("function");
  return producer!.deriveSkeletonProfileFromRigAsset!;
}

// -- the shipped rigs under test ---------------------------------------------------------------

/** Landmark keys the deriver is asked for. The elbow chain the guard primitive drives, nothing more. */
const SHOULDER = "upper_armR";
const ELBOW = "forearmR";
const WRIST = "handR";
const ARM_LANDMARKS = [SHOULDER, ELBOW, WRIST] as const;

type RigFixture = {
  family: string;
  path: string;
  /** Measured 2026-08-30 — `skins[0].joints.length`. Only the real file supplies this. */
  jointCount: number;
  /** Measured — the bone this rig spells the elbow with. Used ONLY to read the file, never asserted as a mapping. */
  measuredElbowBone: string;
};

const RIGS: readonly RigFixture[] = [
  {
    family: "canonical",
    path: "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb",
    jointCount: 17,
    measuredElbowBone: "forearmR",
  },
  {
    family: "mixamorig",
    path: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
    jointCount: 64,
    measuredElbowBone: "mixamorig:RightForeArm",
  },
  {
    family: "mpfb2",
    path: "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb",
    jointCount: 137,
    measuredElbowBone: "lowerarm01R",
  },
];

/**
 * Where a shipped rig lives. Clause (7) scans package sources for this rather than for `.glb`, which
 * matched a filename inside a comment — see header (a).
 */
const SHIPPED_RIG_DIRECTORY = /xr-assets\/humanoids/;

/** Tracked, 10 KB, `skins: 0` — measured. The refusal case in clause (4). */
const SKINLESS_TRACKED_GLB = "apps/ui-xr/public/xr-assets/medical-equipment/clinic-chair-kenney-cc0.glb";

const rigPath = (rig: RigFixture): string => resolve(REPO_ROOT, rig.path);

// -- thresholds, each with its source ------------------------------------------------------------

/**
 * Position agreement, metres. Source: header (d) — two independent decodes of the SAME file (IBM
 * inverse vs node-TRS accumulation) agree to 7.037e-7 m across all joints of all three rigs. 1e-4 is
 * 142x that noise floor and 1650x below the smallest elbow-to-elbow spread between rigs (0.1650 m),
 * so it separates "read the file" from "read a different rig" with two orders of margin either way.
 *
 * NOT a fraction of anything the deriver outputs. The rejected alternative — half the nearest-joint
 * separation — is recorded in header (e) as degenerate on two of the three files.
 */
const BIND_POSITION_TOLERANCE_M = 1e-4;

/**
 * Orientation agreement, radians of angular distance. Source: header (d) — the SAME two decodes
 * disagree by up to 2.627e-3 rad, MEASURED. 1e-2 is 3.8x that floor.
 *
 * Beside its population: it is also exactly `ROTATION_EPSILON_RAD` in
 * `the-guard-primitive-hits-four-targets-on-three-rigs.test.ts`, which reached 0.01 by a completely
 * different route — a quarter of the 0.04 rad authoring resolution of the hand-authored pose table
 * this factory is replacing. Two unrelated derivations landing on one number is the best evidence
 * available that it is not fitted to an observation.
 */
const BIND_ROTATION_TOLERANCE_RAD = 1e-2;

/**
 * Unit-length tolerance for the axes. This one is about the DERIVER'S normalisation, not about decode
 * noise: a direction is either normalised or it is not, and 1e-3 is three orders above float epsilon.
 */
const UNIT_TOLERANCE = 1e-3;

/**
 * How far from perpendicular a bend axis may sit, as |cos|. 0.02 is ~1.15 deg.
 *
 * Above the noise: the segment directions are decoded to ~2e-6 rad (4.10e-7 m over segments of at
 * least 0.2263 m), so this is ~10^4 above the floor. Below the cheapest cheat: a CONSTANT (0,0,1)
 * axis — correct for the canonical rig, whose arm is planar in XY — has |cos| = 0.6842 against the
 * mpfb2 forearm and 0.7178 against the mixamorig forearm, 34x this bound. Both margins are properties
 * of the ASSETS, not of any output.
 */
const PERPENDICULAR_TOLERANCE = 0.02;

/** How parallel a twist axis must be to the segment it twists, as |cos|. The complement of the above. */
const PARALLEL_TOLERANCE = 0.99;

/**
 * Floor for the elbow spread in clause (1): a quarter of the SHORTEST forearm among the three rigs
 * (0.2263 m, mixamorig), so 0.0566 m. Referenced to a bone length in the inputs, not to the observed
 * spread; the smallest observed spread is 0.1650 m, a 2.9x margin.
 */
const SHORTEST_FOREARM_M = 0.2263;
const ELBOW_SPREAD_FLOOR_M = SHORTEST_FOREARM_M * 0.25;

// -- an INDEPENDENT oracle: this test reads the GLB itself ---------------------------------------
//
// Deliberately not a library and deliberately not the deriver's code path. The whole value of
// clause (2) is that the numbers it compares against come out of the file by a route the
// implementation does not control.

type OracleJoint = {
  boneName: string;
  /** null where the parent node is not a joint of this skin — see header (g). */
  parentBoneName: string | null;
  /** The parent node's name even when it is not a joint, so a wrong answer can be explained. */
  rawParentNodeName: string | null;
  bindWorldPosition: Vec3;
  bindWorldQuaternion: Quat;
};

type RigOracle = {
  jointNames: readonly string[];
  byBone: ReadonlyMap<string, OracleJoint>;
};

/** three.js `PropertyBinding.sanitizeNodeName` strips dots; colons survive. */
const sanitise = (name: string): string => name.replace(/\./g, "");

type GlbChunks = { json: GltfJson; bin: Buffer };

type GltfNode = { name?: string; children?: number[] };
type GltfAccessor = { bufferView: number; byteOffset?: number; count: number };
type GltfBufferView = { byteOffset?: number };
type GltfSkin = { joints: number[]; inverseBindMatrices: number };
type GltfJson = {
  nodes?: GltfNode[];
  skins?: GltfSkin[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
};

function readGlbChunks(path: string): GlbChunks {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${path}`);
  let offset = 12;
  let json: GltfJson | undefined;
  let bin: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const kind = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(body.toString("utf8")) as GltfJson;
    else if (kind === 0x004e4942) bin = Buffer.from(body);
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`no JSON chunk in ${path}`);
  return { json, bin: bin ?? Buffer.alloc(0) };
}

/** Column-major 4x4 inverse. */
function invert4(a: readonly number[]): number[] {
  const g = (i: number): number => a[i]!;
  const s0 = g(0) * g(5) - g(1) * g(4);
  const s1 = g(0) * g(6) - g(2) * g(4);
  const s2 = g(0) * g(7) - g(3) * g(4);
  const s3 = g(1) * g(6) - g(2) * g(5);
  const s4 = g(1) * g(7) - g(3) * g(5);
  const s5 = g(2) * g(7) - g(3) * g(6);
  const c5 = g(10) * g(15) - g(11) * g(14);
  const c4 = g(9) * g(15) - g(11) * g(13);
  const c3 = g(9) * g(14) - g(10) * g(13);
  const c2 = g(8) * g(15) - g(11) * g(12);
  const c1 = g(8) * g(14) - g(10) * g(12);
  const c0 = g(8) * g(13) - g(9) * g(12);
  const det = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
  if (Math.abs(det) < 1e-20) throw new Error("singular inverse bind matrix");
  const d = 1 / det;
  return [
    (g(5) * c5 - g(6) * c4 + g(7) * c3) * d,
    (-g(1) * c5 + g(2) * c4 - g(3) * c3) * d,
    (g(13) * s5 - g(14) * s4 + g(15) * s3) * d,
    (-g(9) * s5 + g(10) * s4 - g(11) * s3) * d,
    (-g(4) * c5 + g(6) * c2 - g(7) * c1) * d,
    (g(0) * c5 - g(2) * c2 + g(3) * c1) * d,
    (-g(12) * s5 + g(14) * s2 - g(15) * s1) * d,
    (g(8) * s5 - g(10) * s2 + g(11) * s1) * d,
    (g(4) * c4 - g(5) * c2 + g(7) * c0) * d,
    (-g(0) * c4 + g(1) * c2 - g(3) * c0) * d,
    (g(12) * s4 - g(13) * s2 + g(15) * s0) * d,
    (-g(8) * s4 + g(9) * s2 - g(11) * s0) * d,
    (-g(4) * c3 + g(5) * c1 - g(6) * c0) * d,
    (g(0) * c3 - g(1) * c1 + g(2) * c0) * d,
    (-g(12) * s3 + g(13) * s1 - g(14) * s0) * d,
    (g(8) * s3 - g(9) * s1 + g(10) * s0) * d,
  ];
}

/** Quaternion from the 3x3 of a column-major rotation matrix. Safe here: header (f) — norms are 1. */
function quaternionFromMatrix(m: readonly number[]): Quat {
  const g = (i: number): number => m[i]!;
  const trace = g(0) + g(5) + g(10);
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { x: (g(6) - g(9)) / s, y: (g(8) - g(2)) / s, z: (g(1) - g(4)) / s, w: 0.25 * s };
  }
  if (g(0) > g(5) && g(0) > g(10)) {
    const s = Math.sqrt(1 + g(0) - g(5) - g(10)) * 2;
    return { x: 0.25 * s, y: (g(4) + g(1)) / s, z: (g(8) + g(2)) / s, w: (g(6) - g(9)) / s };
  }
  if (g(5) > g(10)) {
    const s = Math.sqrt(1 + g(5) - g(0) - g(10)) * 2;
    return { x: (g(4) + g(1)) / s, y: 0.25 * s, z: (g(9) + g(6)) / s, w: (g(8) - g(2)) / s };
  }
  const s = Math.sqrt(1 + g(10) - g(0) - g(5)) * 2;
  return { x: (g(8) + g(2)) / s, y: (g(9) + g(6)) / s, z: 0.25 * s, w: (g(1) - g(4)) / s };
}

function readMat4(chunks: GlbChunks, accessorIndex: number, element: number): number[] {
  const accessor = chunks.json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`no accessor ${accessorIndex}`);
  const view = chunks.json.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`no bufferView ${accessor.bufferView}`);
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + element * 64;
  const out: number[] = [];
  for (let i = 0; i < 16; i += 1) out.push(chunks.bin.readFloatLE(base + i * 4));
  return out;
}

const oracleCache = new Map<string, RigOracle>();

function readRigOracle(path: string): RigOracle {
  const cached = oracleCache.get(path);
  if (cached) return cached;
  const chunks = readGlbChunks(path);
  const nodes = chunks.json.nodes ?? [];
  const skin = chunks.json.skins?.[0];
  if (!skin) throw new Error(`${path} carries no skin — it is not a rig`);
  const parentOf = new Map<number, number>();
  nodes.forEach((node, index) => (node.children ?? []).forEach((child) => parentOf.set(child, index)));
  const jointSet = new Set(skin.joints);
  const byBone = new Map<string, OracleJoint>();
  const jointNames: string[] = [];
  skin.joints.forEach((nodeIndex, element) => {
    const bind = invert4(readMat4(chunks, skin.inverseBindMatrices, element));
    const boneName = sanitise(nodes[nodeIndex]?.name ?? `node_${nodeIndex}`);
    const parentIndex = parentOf.get(nodeIndex);
    const rawParentNodeName =
      parentIndex === undefined ? null : sanitise(nodes[parentIndex]?.name ?? `node_${parentIndex}`);
    jointNames.push(boneName);
    byBone.set(boneName, {
      boneName,
      parentBoneName:
        parentIndex !== undefined && jointSet.has(parentIndex) ? rawParentNodeName : null,
      rawParentNodeName,
      bindWorldPosition: { x: bind[12]!, y: bind[13]!, z: bind[14]! },
      bindWorldQuaternion: quaternionFromMatrix(bind),
    });
  });
  const oracle: RigOracle = { jointNames, byBone };
  oracleCache.set(path, oracle);
  return oracle;
}

// -- small vector helpers ------------------------------------------------------------------------

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

function direction(from: Vec3, to: Vec3): Vec3 {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const n = norm3(d);
  return { x: d.x / n, y: d.y / n, z: d.z / n };
}

/** Angular distance between two unit quaternions, radians. Sign-insensitive: q and -q are one rotation. */
function angleBetween(a: Quat, b: Quat): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d));
}

/** The oracle's bind positions for the three landmark bones the profile named on this rig. */
function oracleChain(
  oracle: RigOracle,
  profile: DerivedSkeletonProfile,
): { shoulder: Vec3; elbow: Vec3; wrist: Vec3 } {
  const at = (landmark: string): Vec3 => {
    const boneName = profile.landmarks[landmark]?.boneName;
    const joint = boneName === undefined ? undefined : oracle.byBone.get(boneName);
    if (!joint) throw new Error(`the profile's ${landmark} bone "${boneName}" is not a joint of this rig`);
    return joint.bindWorldPosition;
  };
  return { shoulder: at(SHOULDER), elbow: at(ELBOW), wrist: at(WRIST) };
}

describe("the skeleton profile comes from a real rig", () => {
  it("(1) RED: the profile is DERIVED FROM THE ASSET — three shipped rigs give three answers", async () => {
    // A profile assembled from a constant table satisfies every presence check ever written, and the
    // three fixtures in the guard plant say in their own header that they are constructed.
    const derive = await requireDeriver();

    const profiles = RIGS.map((rig) => ({ rig, profile: derive(rigPath(rig), [...ARM_LANDMARKS]) }));

    for (const { rig, profile } of profiles) {
      expect(profile.bindSpace, `${rig.family}: the profile does not declare the space its vectors are in`).toBe(
        BIND_WORLD_SPACE,
      );
      // Joint COUNT is the cheapest thing only the real file can supply. Measured 2026-08-30.
      expect(
        profile.jointNames.length,
        `${rig.family}: ${profile.jointNames.length} joints, but ${rig.path} carries ${rig.jointCount}`,
      ).toBe(rig.jointCount);
    }

    const fingerprints = profiles.map((p) => p.profile.rigFingerprint);
    expect(new Set(fingerprints).size, `three rig families produced ${JSON.stringify(fingerprints)}`).toBe(3);

    // The elbow lands somewhere different on each rig, by more than a quarter of the shortest forearm
    // among them. A shared table cannot do that.
    for (let i = 0; i < profiles.length; i += 1) {
      for (let j = i + 1; j < profiles.length; j += 1) {
        const a = profiles[i]!;
        const b = profiles[j]!;
        const spread = distance(
          a.profile.landmarks[ELBOW]!.bindWorldPosition,
          b.profile.landmarks[ELBOW]!.bindWorldPosition,
        );
        expect(
          spread,
          `${a.rig.family} and ${b.rig.family} put the elbow ${spread.toFixed(4)} m apart — under the ${ELBOW_SPREAD_FLOOR_M.toFixed(4)} m floor, these are one table rather than two rigs`,
        ).toBeGreaterThan(ELBOW_SPREAD_FLOOR_M);
      }
    }
  });

  it("(2) RED: the bind frame is THE ASSET'S OWN, checked against the file by an independent decode", async () => {
    // The point of the card. This test reads the bind transform by inverting the file's
    // inverseBindMatrices; a deriver accumulating node TRS is a different route to the same number,
    // and header (d) measures the two agreeing to 4.10e-7 m. Nothing here is taken from the deriver.
    const derive = await requireDeriver();

    for (const rig of RIGS) {
      const profile = derive(rigPath(rig), [...ARM_LANDMARKS]);
      const oracle = readRigOracle(rigPath(rig));

      for (const landmark of ARM_LANDMARKS) {
        const record = profile.landmarks[landmark];
        expect(record, `${rig.family}: no landmark record for ${landmark}`).toBeDefined();

        const joint = oracle.byBone.get(record!.boneName);
        expect(
          joint,
          `${rig.family}: ${landmark} names bone "${record!.boneName}", which is not among the ${oracle.jointNames.length} joints of ${rig.path}`,
        ).toBeDefined();

        const gap = distance(record!.bindWorldPosition, joint!.bindWorldPosition);
        expect(
          gap,
          `${rig.family}: ${landmark} (${record!.boneName}) reported at (${record!.bindWorldPosition.x.toFixed(4)}, ${record!.bindWorldPosition.y.toFixed(4)}, ${record!.bindWorldPosition.z.toFixed(4)}) but the file's inverse bind matrix puts it at (${joint!.bindWorldPosition.x.toFixed(4)}, ${joint!.bindWorldPosition.y.toFixed(4)}, ${joint!.bindWorldPosition.z.toFixed(4)}) — ${gap.toExponential(3)} m apart`,
        ).toBeLessThanOrEqual(BIND_POSITION_TOLERANCE_M);

        const q = record!.bindWorldQuaternion;
        expect(
          Math.abs(norm3({ x: q.x, y: q.y, z: q.z }) ** 2 + q.w * q.w - 1),
          `${rig.family}: ${landmark} bindWorldQuaternion is not unit length`,
        ).toBeLessThanOrEqual(UNIT_TOLERANCE);
        const swing = angleBetween(q, joint!.bindWorldQuaternion);
        expect(
          swing,
          `${rig.family}: ${landmark} bindWorldQuaternion is ${swing.toFixed(5)} rad from the orientation in the file`,
        ).toBeLessThanOrEqual(BIND_ROTATION_TOLERANCE_RAD);
      }

      // `bindFrame` is the map `RigAsset` consumes; it must agree with the landmark records rather
      // than being a second, unrelated set of numbers on the same object.
      for (const landmark of ARM_LANDMARKS) {
        const record = profile.landmarks[landmark]!;
        const fromMap = profile.bindFrame[record.boneName];
        expect(fromMap, `${rig.family}: bindFrame has no entry for ${record.boneName}`).toBeDefined();
        expect(
          distance(fromMap!, record.bindWorldPosition),
          `${rig.family}: bindFrame and landmarks disagree about ${record.boneName}`,
        ).toBeLessThanOrEqual(BIND_POSITION_TOLERANCE_M);
      }
    }
  });

  it("(3) RED: ancestry is REAL — parents are joints, chains terminate, and the wrist reaches the root", async () => {
    // A profile whose parent links are decorative solves cleanly and moves the wrong chain. The
    // effector must be reachable from the root THROUGH DECLARED PARENTS, which is the property an FK
    // walk depends on and the one a flat list of positions silently lacks.
    const derive = await requireDeriver();

    for (const rig of RIGS) {
      const profile = derive(rigPath(rig), [...ARM_LANDMARKS]);
      const oracle = readRigOracle(rigPath(rig));
      const declared = new Map(profile.joints.map((joint) => [joint.boneName, joint]));
      const jointNames = new Set(profile.jointNames);

      // Every declared parent is a joint of this rig, and matches the file's hierarchy.
      for (const joint of profile.joints) {
        if (joint.parentBoneName !== undefined) {
          expect(
            jointNames.has(joint.parentBoneName),
            `${rig.family}: ${joint.boneName} claims parent "${joint.parentBoneName}", which is not a joint of this rig`,
          ).toBe(true);
        }
        const truth = oracle.byBone.get(joint.boneName);
        if (truth) {
          expect(
            joint.parentBoneName ?? null,
            `${rig.family}: ${joint.boneName} parent disagrees with the file (the file's parent node is "${truth.rawParentNodeName}", a joint: ${truth.parentBoneName !== null})`,
          ).toBe(truth.parentBoneName);
        }
      }

      // The wrist's chain terminates at a parentless root, visiting each bone at most once, and
      // passes through the elbow and the shoulder on the way.
      const wristBone = profile.landmarks[WRIST]!.boneName;
      const seen = new Set<string>();
      const chain: string[] = [];
      let cursor: string | undefined = wristBone;
      while (cursor !== undefined) {
        expect(seen.has(cursor), `${rig.family}: the chain from ${wristBone} revisits ${cursor} — this is a cycle`).toBe(
          false,
        );
        seen.add(cursor);
        chain.push(cursor);
        const joint: DerivedJoint | undefined = declared.get(cursor);
        expect(joint, `${rig.family}: the chain from ${wristBone} reaches "${cursor}", which is not in joints[]`).toBeDefined();
        cursor = joint!.parentBoneName;
      }
      expect(
        chain.length,
        `${rig.family}: the chain from ${wristBone} is ${chain.join(" > ")} — it never reaches a parentless root`,
      ).toBeGreaterThan(1);
      for (const landmark of [ELBOW, SHOULDER]) {
        expect(
          chain.includes(profile.landmarks[landmark]!.boneName),
          `${rig.family}: ${landmark} (${profile.landmarks[landmark]!.boneName}) is not an ancestor of the wrist — chain was ${chain.join(" > ")}`,
        ).toBe(true);
      }

      // The LOCAL chain must accumulate to the WORLD frame: sum the local translations up the wrist's
      // ancestry (rotations included by way of the world positions already checked in (2)) and the
      // shoulder-to-wrist span must survive. A `joints[]` whose bindLocalPosition values are unrelated
      // to bindFrame is two records pretending to be one.
      const spanWorld = distance(
        profile.landmarks[SHOULDER]!.bindWorldPosition,
        profile.landmarks[WRIST]!.bindWorldPosition,
      );
      const localSum = chain
        .slice(0, chain.indexOf(profile.landmarks[SHOULDER]!.boneName))
        .reduce((total, bone) => total + norm3(declared.get(bone)!.bindLocalPosition), 0);
      expect(
        localSum,
        `${rig.family}: the local translations from the shoulder to the wrist sum to ${localSum.toFixed(4)} m of bone, which cannot span the ${spanWorld.toFixed(4)} m the bind frame puts between them`,
      ).toBeGreaterThanOrEqual(spanWorld - BIND_POSITION_TOLERANCE_M);
    }
  });

  it("(4) RED: a file that is not a rig is REFUSED, never defaulted", async () => {
    // A silent default is a WRONG skeleton that solves cleanly and puts the hand somewhere else. The
    // chair is tracked, 10 KB, and carries `skins: 0` — measured 2026-08-30.
    const derive = await requireDeriver();

    expect(
      () => derive(resolve(REPO_ROOT, SKINLESS_TRACKED_GLB), [...ARM_LANDMARKS]),
      `${SKINLESS_TRACKED_GLB} has no skin and produced a profile anyway — a defaulted skeleton is a wrong skeleton nobody can see`,
    ).toThrow();

    expect(
      () => derive(resolve(REPO_ROOT, "apps/ui-xr/public/xr-assets/humanoids/no-such-rig.glb"), [...ARM_LANDMARKS]),
      "an absent rig file produced a profile — that is a default wearing a path",
    ).toThrow();

    expect(
      () => derive(rigPath(RIGS[0]!), ["landmark_no_rig_can_carry"]),
      "an unresolvable landmark returned quietly — the caller cannot tell a missing bone from a placed one",
    ).toThrow();
  });

  it("(5) RED: only the real file can supply this — counterweight to a plausible fixture", async () => {
    // COUNTERWEIGHT. A deriver returning a copy of some fixture profile satisfies (1) through (4) if
    // the fixture is plausible: it can carry three fingerprints, three sets of positions, and a valid
    // parent chain. Three things a fixture cannot do, all read from the files:
    //
    //   (a) 17 / 64 / 137 joints, and every landmark bone drawn from those exact name sets.
    //   (b) three DIFFERENT spellings of the same landmark, because the rigs disagree about names.
    //       No mapping is asserted here — `pose-bone-resolver.ts` owns that and duplicating it would
    //       be a second declaration.
    //   (c) a fingerprint that survives a byte-identical copy at a different path, so it is a property
    //       of the RIG rather than of the filename or the directory.
    const derive = await requireDeriver();

    const elbowBones: string[] = [];
    for (const rig of RIGS) {
      const profile = derive(rigPath(rig), [...ARM_LANDMARKS]);
      const oracle = readRigOracle(rigPath(rig));

      expect(
        [...profile.jointNames].sort(),
        `${rig.family}: jointNames is not the joint set of ${rig.path}`,
      ).toEqual([...oracle.jointNames].sort());

      for (const landmark of ARM_LANDMARKS) {
        expect(
          oracle.byBone.has(profile.landmarks[landmark]!.boneName),
          `${rig.family}: ${landmark} names "${profile.landmarks[landmark]!.boneName}", a bone this rig does not have`,
        ).toBe(true);
      }
      elbowBones.push(profile.landmarks[ELBOW]!.boneName);
    }

    expect(
      new Set(elbowBones).size,
      `the three rigs spell the elbow ${JSON.stringify(elbowBones)} — one spelling across three families means the bone names are invented, not read`,
    ).toBe(3);

    // A byte-identical copy under a different name: same rig, so the same fingerprint.
    const source = rigPath(RIGS[0]!);
    const copy = join(mkdtempSync(join(tmpdir(), "openclinxr-rig-")), "renamed-rig.glb");
    copyFileSync(source, copy);
    expect(
      derive(copy, [...ARM_LANDMARKS]).rigFingerprint,
      "the same rig fingerprinted differently under a different filename — the fingerprint is keyed on the path, not on the skeleton",
    ).toBe(derive(source, [...ARM_LANDMARKS]).rigFingerprint);
  });

  it("(6) RED: the elbow's axes are THE ASSET'S, not a constant", async () => {
    // The cheapest wrong answer here is a constant (0,0,1). It is CORRECT for the canonical rig,
    // whose arm is planar in XY, and 0.6842 / 0.7178 off perpendicular on mpfb2 and mixamorig
    // (header, measured). So the clause must run on all three or the constant survives.
    //
    // Both properties are definitional rather than anatomical: a hinge axis is perpendicular to the
    // segments it bends, a twist axis runs along the segment. Both segment directions are computed
    // here from the file's own bind positions.
    const derive = await requireDeriver();

    for (const rig of RIGS) {
      const profile = derive(rigPath(rig), [...ARM_LANDMARKS]);
      const oracle = readRigOracle(rigPath(rig));
      const { shoulder, elbow, wrist } = oracleChain(oracle, profile);
      const upperArm = direction(shoulder, elbow);
      const forearm = direction(elbow, wrist);

      const record = profile.landmarks[ELBOW]!;
      const bend = record.primaryBendAxis;
      const twist = record.twistAxis;

      expect(
        Math.abs(norm3(bend) - 1),
        `${rig.family}: primaryBendAxis has length ${norm3(bend).toFixed(6)} — it is not a direction`,
      ).toBeLessThanOrEqual(UNIT_TOLERANCE);
      expect(
        Math.abs(norm3(twist) - 1),
        `${rig.family}: twistAxis has length ${norm3(twist).toFixed(6)} — it is not a direction`,
      ).toBeLessThanOrEqual(UNIT_TOLERANCE);

      for (const [label, segment] of [
        ["upper arm", upperArm],
        ["forearm", forearm],
      ] as const) {
        expect(
          Math.abs(dot3(bend, segment)),
          `${rig.family}: primaryBendAxis is ${Math.abs(dot3(bend, segment)).toFixed(4)} off perpendicular to the ${label} measured from this rig's own bind frame — a hinge axis that leans along its own bone is a twist`,
        ).toBeLessThanOrEqual(PERPENDICULAR_TOLERANCE);
      }

      expect(
        Math.abs(dot3(twist, forearm)),
        `${rig.family}: twistAxis is ${Math.abs(dot3(twist, forearm)).toFixed(4)} parallel to the forearm — a twist axis runs along the segment it twists`,
      ).toBeGreaterThanOrEqual(PARALLEL_TOLERANCE);

      expect(
        Math.abs(dot3(bend, twist)),
        `${rig.family}: the bend and twist axes are not independent`,
      ).toBeLessThanOrEqual(PERPENDICULAR_TOLERANCE);

      // Limits are radians about primaryBendAxis RELATIVE TO THE BIND POSE, so the rest angle is 0.
      // This refuses {0,0} and refuses limits that exclude the pose the rig actually ships in. It
      // says nothing about whether the range is anatomically right.
      const { minRad, maxRad } = record.jointLimits;
      expect(Number.isFinite(minRad) && Number.isFinite(maxRad), `${rig.family}: jointLimits are not finite`).toBe(true);
      expect(minRad, `${rig.family}: jointLimits ${minRad}..${maxRad} is empty or inverted`).toBeLessThan(maxRad);
      expect(
        minRad <= 0 && maxRad >= 0,
        `${rig.family}: jointLimits ${minRad}..${maxRad} exclude the bind pose, which is 0 by the declared convention`,
      ).toBe(true);
      expect(maxRad - minRad, `${rig.family}: jointLimits span more than a full turn`).toBeLessThanOrEqual(2 * Math.PI);
    }
  });

  it("(7) LIVE PREMISE: the deriver is exported, and no other product source hardcodes the rig directory", async () => {
    // Flipped 2026-08-30 by tsk_3778b159cf72414d: the premise that nothing derives a profile from a
    // rig no longer holds — `derive-skeleton-profile.ts` IS that deriver. What stays live is that
    // it is the ONLY one: no product source here hardcodes the shipped rig directory; paths come
    // from callers. The scan half below is unchanged.
    expect(
      typeof (await loadProducer())?.deriveSkeletonProfileFromRigAsset,
      "derive-skeleton-profile.js no longer exports deriveSkeletonProfileFromRigAsset — the M1b deriver has been removed",
    ).toBe("function");

    // No PRODUCT source here reaches the shipped rig directory — which is exactly why every
    // SkeletonProfile in the package is constructed.
    //
    // NARROWED 2026-08-30 to product sources only. It excluded this file alone, so the first sibling
    // PLANT to name a rig path tripped it — the anchors contract, whose new cross-seam clause reads a
    // real rig through this card's producer, exactly as intended. A premise about what the PRODUCT
    // does must not fire on a test that names the asset in order to demand it.
    //
    // The same exclusion the M3 provider ban already uses, for the same reason: test files
    // legitimately name what product code may not.
    //
    // NOT a scan for `.glb`: that matched a filename inside a prose comment on the guard plant, which
    // is a marker check rather than a measurement. See header (a).
    const selfPath = fileURLToPath(import.meta.url);
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(entry) && full !== selfPath) sources.push(full);
      }
    };
    walk(HERE);
    const readers = sources.filter((path) => SHIPPED_RIG_DIRECTORY.test(readFileSync(path, "utf8")));
    expect(
      readers.map((p) => p.slice(HERE.length + 1)),
      `a source in this package now reaches ${SHIPPED_RIG_DIRECTORY.source} — the premise that every SkeletonProfile is constructed no longer holds`,
    ).toEqual([]);
  });

  it("(8) LIVE INSTRUMENT: the rigs this contract is written against are on disk", () => {
    // Stays green for the life of the contract. Without it, a clause that reds because an asset moved
    // is indistinguishable from one that reds because the deriver is absent — the instrument-failure
    // class the probe runner exists to catch, arriving through the filesystem instead of the code.
    for (const rig of RIGS) {
      expect(statSync(rigPath(rig)).size, `${rig.path} is missing or empty`).toBeGreaterThan(0);
    }
    expect(
      statSync(resolve(REPO_ROOT, SKINLESS_TRACKED_GLB)).size,
      `${SKINLESS_TRACKED_GLB} is missing — clause (4) has no refusal case without it`,
    ).toBeGreaterThan(0);
  });
});
