/**
 * S0 diagnostic for AISHA-TONGUE-AT-OPEN-VISEME: why the tongue leads the crown
 * at open visemes on Aisha but not on the controls.
 *
 * Per actor (GLB path in) and per pose (bind, viseme_aa), in a FRESH scene per
 * pose (P1/MED1: a reused scene aa->bind returns aa geometry), returns the
 * runtime drive report (activeTargetName), the jaw bone rotation angle measured
 * off the bones (angle of the jaw local quaternion vs its bind local
 * quaternion, both normalized), the tongue-tip argmax vertex (head-local z over
 * tongue verts, after skinning/morphs) with its top-3 skin joints, the crown
 * argmax vertex (jaw-set max per the landed rule in tongue-channel.ts) with its
 * dominant joint, head-local positions (x,y,z mm) of tip and crown, and the
 * mesh morph-dictionary keys (A2: on any P2-failing row these distinguish an
 * instrument miss from mechanism class (b)).
 *
 * No product change: diagnostic only, no new package exports beyond what the
 * proof test consumes (own-test). GLBs are never edited.
 */
import { Matrix4, type Quaternion, Vector3 } from "three";
import { applyNamedSpeechVisemes } from "@openclinxr/xr-dialogue/package-viseme";
import { loadHeadlessScene, type HeadlessMesh, type HeadlessScene } from "./headless-scene.js";
import { boneMatrices, morphedPositions, round3, skinPositions } from "./scene-math.js";
import { headLocalMaxZ, lowerArchIndices } from "./tongue-channel.js";

/** Poses the S0 diagnostic reports, in order. */
export const AA_MECHANISM_POSES = ["bind", "viseme_aa"] as const;

/** One pose label. */
export type AaMechanismPose = (typeof AA_MECHANISM_POSES)[number];

/** Head-local position in millimetres. */
export type Vec3Mm = [number, number, number];

/** One skin joint with its normalized weight on a vertex. */
export type JointWeight = {
  joint: string;
  weight: number;
};

/** One posed tongue-vs-crown diagnostic row. */
export type AaMechanismPoseRow = {
  /** Pose label. */
  pose: AaMechanismPose;
  /** Active viseme target reported by the runtime drive (null at bind). */
  activeTargetName: string | null;
  /** Jaw bone rotation angle vs its bind local quaternion, radians. */
  jawAngleRad: number;
  /** Jaw aperture reported by the runtime drive, radians. */
  jawDriveRad: number;
  /** Meshes the drive wrote morph weights to. */
  appliedMeshCount: number;
  /** Tongue-tip vertex index (argmax head-local z over tongue verts). */
  tipIndex: number;
  /** Top-3 skin joints of the tip vertex by weight. */
  tipTopJoints: JointWeight[];
  /** Head-local position of the tip vertex, mm (unrounded, c5/F1). */
  tipPosMm: Vec3Mm;
  /** Crown vertex index (argmax head-local z over the jaw-set arch). */
  crownIndex: number;
  /** Dominant skin joint of the crown vertex. */
  crownDominantJoint: string;
  /** Head-local position of the crown vertex, mm (unrounded, c5/F1). */
  crownPosMm: Vec3Mm;
  /** Teeth mesh morph-target dictionary keys. */
  teethTargetNames: string[];
  /** Body mesh morph-target dictionary keys containing "viseme_aa" (case-insensitive). */
  bodyAaKeys: string[];
  /** Tongue vertex count measured. */
  tongueVerts: number;
  /** Lower-arch vertex count measured. */
  archVerts: number;
};

/** Per-actor S0 diagnostic: one fresh-scene row per pose plus same-index reads. */
export type AaMechanismReport = {
  /** GLB path probed. */
  glbPath: string;
  /** Fresh-scene bind row. */
  bind: AaMechanismPoseRow;
  /** Fresh-scene viseme_aa row. */
  aa: AaMechanismPoseRow;
  /** Head-local position at aa of the BIND tip vertex (same-index disp; unrounded, c5/F1). */
  aaTipAtBindIndexMm: Vec3Mm;
  /** Head-local position at aa of the BIND crown vertex (same-index disp; unrounded, c5/F1). */
  aaCrownAtBindIndexMm: Vec3Mm;
};

/**
 * Jaw bone rotation angle (radians) vs a bind local quaternion. Both inputs
 * are normalized first: a denormalized asset quat reads a phantom ~3e-4 rad
 * otherwise (physician bind, S0 probe). Pure orientation angle, 2*acos(|dot|).
 */
export function jawAngleVsBindQuat(scene: HeadlessScene, bindQuat: Quaternion): number {
  const current = scene.jawBone.quaternion.clone().normalize();
  const bind = bindQuat.clone().normalize();
  return current.angleTo(bind);
}

/** Top-N skin joints of one vertex by weight (descending). */
function topJoints(mesh: HeadlessMesh, vertex: number, take: number): JointWeight[] {
  const slots: JointWeight[] = [0, 1, 2, 3].map((slot) => ({
    joint: mesh.jointNodes[mesh.joints[vertex * 4 + slot] ?? 0]?.getName?.() ?? "",
    weight: mesh.weights[vertex * 4 + slot] ?? 0,
  }));
  slots.sort((a, b) => b.weight - a.weight);
  return slots.slice(0, take).map((slot) => ({ joint: slot.joint, weight: round3(slot.weight) }));
}

/** Dominant skin-joint name of one vertex. */
function dominantJoint(mesh: HeadlessMesh, vertex: number): string {
  return topJoints(mesh, vertex, 1)[0]?.joint ?? "";
}

/** Refresh world matrices plus every skeleton after the drive (F1 fix shape). */
function refreshAfterDrive(scene: HeadlessScene): void {
  scene.root.updateMatrixWorld(true);
  scene.body.skeleton.update();
  scene.teeth.skeleton.update();
  scene.tongue?.skeleton.update();
  scene.root.updateMatrixWorld(true);
}

/** Posed world positions of a mesh under the current scene drive state. */
function posedWorld(mesh: HeadlessScene["body"]): Float32Array {
  const influences = mesh.skinned.morphTargetInfluences ?? [];
  return skinPositions(mesh, morphedPositions(mesh, influences), boneMatrices(mesh));
}

/** Head-local positions (mm) of every vertex of a posed world buffer. */
function headLocalPositionsMm(scene: HeadlessScene, world: Float32Array): Vec3Mm[] {
  // c5/F1: intentionally UNROUNDED. Argmax, same-index displacements, and the
  // contribution all read these values; rounding here collapsed distinct
  // vertices (kevin tip 116 vs 229) and flipped the strict <-0.05 split at a
  // 1% delta scale (-0.050479 read as -0.0500). Round only in log/print lines.
  scene.root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const point = new Vector3();
  const out: Vec3Mm[] = [];
  for (let vertex = 0; vertex < world.length / 3; vertex += 1) {
    point
      .set(world[vertex * 3] ?? 0, world[vertex * 3 + 1] ?? 0, world[vertex * 3 + 2] ?? 0)
      .applyMatrix4(inverse);
    out.push([point.x * 1000, point.y * 1000, point.z * 1000]);
  }
  return out;
}

/** Argmax head-local z vertex over an index set. */
function argmaxZ(positions: Vec3Mm[], indices: readonly number[]): number {
  let best = -Infinity;
  let bestVertex = -1;
  for (const vertex of indices) {
    const z = positions[vertex]?.[2] ?? -Infinity;
    if (z > best) {
      best = z;
      bestVertex = vertex;
    }
  }
  return bestVertex;
}

/** Measure one pose in a fresh scene. */
function measureRow(
  scene: HeadlessScene,
  pose: AaMechanismPose,
  drive: { activeTargetName: string | null; jawDriveRad: number; appliedMeshCount: number },
  bindQuat: Quaternion,
): AaMechanismPoseRow {
  if (!scene.tongue) throw new Error("asset has no fitted tongue mesh");
  refreshAfterDrive(scene);
  const tongueWorld = posedWorld(scene.tongue);
  const teethWorld = posedWorld(scene.teeth);
  const tongueHl = headLocalPositionsMm(scene, tongueWorld);
  const teethHl = headLocalPositionsMm(scene, teethWorld);
  const allTongue = tongueHl.map((_, vertex) => vertex);
  const arch = lowerArchIndices(scene.teeth, scene.jawBone);
  if (arch.length === 0) throw new Error("lower-arch vertex set is empty");
  // Cross-check the argmax against the landed channel's own max (same frame).
  const landedTipZ = headLocalMaxZ(scene, tongueWorld, allTongue) * 1000;
  const landedCrownZ = headLocalMaxZ(scene, teethWorld, arch) * 1000;
  const tipIndex = argmaxZ(tongueHl, allTongue);
  const crownIndex = argmaxZ(teethHl, arch);
  const tipPosMm = tongueHl[tipIndex];
  const crownPosMm = teethHl[crownIndex];
  if (!tipPosMm || !crownPosMm) throw new Error("argmax vertex out of range");
  if (Math.abs(tipPosMm[2] - landedTipZ) > 0.005 || Math.abs(crownPosMm[2] - landedCrownZ) > 0.005) {
    throw new Error(
      `helper/channel argmax disagree: tip ${tipPosMm[2]} vs ${landedTipZ}, crown ${crownPosMm[2]} vs ${landedCrownZ}`,
    );
  }
  const bodyAaKeys = scene.body.targetNames.filter((name) => /viseme_aa/i.test(name));
  return {
    pose,
    activeTargetName: drive.activeTargetName,
    jawAngleRad: round3(jawAngleVsBindQuat(scene, bindQuat)),
    jawDriveRad: round3(drive.jawDriveRad),
    appliedMeshCount: drive.appliedMeshCount,
    tipIndex,
    tipTopJoints: topJoints(scene.tongue, tipIndex, 3),
    tipPosMm,
    crownIndex,
    crownDominantJoint: dominantJoint(scene.teeth, crownIndex),
    crownPosMm,
    teethTargetNames: [...scene.teeth.targetNames],
    bodyAaKeys,
    tongueVerts: allTongue.length,
    archVerts: arch.length,
  };
}

/**
 * Shared probe path: fresh scene per pose (P1), same runtime drive, same S0
 * measureRow math. An optional in-memory plant runs on the bind scene before
 * measuring and on the aa scene before the drive. GLBs are never edited.
 */
async function probeWithPlant(
  glbPath: string,
  plant?: (scene: HeadlessScene) => void,
): Promise<AaMechanismReport> {
  const bindScene = await loadHeadlessScene(glbPath);
  const bindQuat = bindScene.jawBone.quaternion.clone();
  plant?.(bindScene);
  const bind = measureRow(
    bindScene,
    "bind",
    { activeTargetName: null, jawDriveRad: 0, appliedMeshCount: 0 },
    bindQuat,
  );

  const aaScene = await loadHeadlessScene(glbPath);
  const aaBindQuat = aaScene.jawBone.quaternion.clone();
  plant?.(aaScene);
  const drive = applyNamedSpeechVisemes(
    {
      root: aaScene.root,
      activeSpeech: { phonemeSequence: ["AA"], startedAtMs: 0, durationMs: 1000 },
    },
    500,
  );
  if (drive.appliedMeshCount === 0) throw new Error("pose viseme_aa drove no viseme mesh");
  const aa = measureRow(
    aaScene,
    "viseme_aa",
    {
      activeTargetName: drive.activeTargetName,
      jawDriveRad: drive.jawOpenRadians,
      appliedMeshCount: drive.appliedMeshCount,
    },
    aaBindQuat,
  );

  // Same-index reads inside the aa scene: no second drive call, no scene reuse.
  if (!aaScene.tongue) throw new Error("asset has no fitted tongue mesh");
  refreshAfterDrive(aaScene);
  const aaTongueHl = headLocalPositionsMm(aaScene, posedWorld(aaScene.tongue));
  const aaTeethHl = headLocalPositionsMm(aaScene, posedWorld(aaScene.teeth));
  const aaTipAtBindIndexMm = aaTongueHl[bind.tipIndex];
  const aaCrownAtBindIndexMm = aaTeethHl[bind.crownIndex];
  if (!aaTipAtBindIndexMm || !aaCrownAtBindIndexMm) throw new Error("bind vertex out of range at aa");
  return { glbPath, bind, aa, aaTipAtBindIndexMm, aaCrownAtBindIndexMm };
}

/**
 * Probe one actor: fresh scene per pose (P1). Bind = as-loaded (no drive call);
 * viseme_aa = the runtime's own `applyNamedSpeechVisemes` speech path (a held AA
 * phoneme at mid-utterance progress), the same entry the landed channel uses.
 * The aa row additionally carries the aa-pose positions of the bind-chosen tip
 * and crown vertices, so same-index displacements do not reuse a scene (MED1).
 */
export async function probeTongueAaMechanism(glbPath: string): Promise<AaMechanismReport> {
  return probeWithPlant(glbPath);
}

/** Options for measureTeethAaContribution. */
export type TeethAaContributionOpts = {
  /**
   * In-memory plant applied to the SHIPPED leg's bind scene (before measuring)
   * and driven scene (before the drive); the zeroed leg stays unplanted. GLBs
   * are never edited. A bind-pose plant is position-neutral: bind morph
   * influences are all zero, so zeroing a delta or dropping a dictionary entry
   * changes only what the drive resolves, never the bind positions.
   */
  plant?: (scene: HeadlessScene) => void;
};

/**
 * Teeth viseme_aa CONTRIBUTION (DEF1, coordinator cap52): dispDiffZ of the
 * shipped scene at aa minus dispDiffZ of the same GLB in a fresh scene with the
 * teeth viseme_aa delta zeroed in memory (dictionary entry kept), same drive,
 * same bind-chosen tip/crown indices. dispDiff = tipDisp.z - crownDisp.z as in
 * deriveS0b. With no viseme_aa entry the zeroed scene zeroes nothing; the
 * contribution is still measured from two fresh scene pairs (expected 0.000).
 * Two independent probe pairs (four fresh scenes) feed the two terms, and the
 * bind-chosen indices must agree across legs, so the contribution can never
 * pass trivially off one scene read twice.
 */
export type TeethAaContribution = {
  /** Shipped scene carries a teeth viseme_aa morph target (exact dictionary name). */
  present: boolean;
  /** Shipped-leg aa dispDiff z, mm. */
  shippedDispDiffZ: number;
  /** Delta-zeroed-leg aa dispDiff z, mm. */
  zeroedDispDiffZ: number;
  /** shippedDispDiffZ - zeroedDispDiffZ, mm. */
  contribution: number;
  /** Max |delta| of the zeroed leg's teeth viseme_aa delta before zeroing (0 when absent). */
  zeroedDeltaMaxAbsBefore: number;
  /** Max |delta| after zeroing (0 by construction; scanned, not assumed). */
  zeroedDeltaMaxAbsAfter: number;
};

/** Max absolute value of a morph-target delta buffer. */
function maxAbsDelta(delta: ArrayLike<number>): number {
  let best = 0;
  for (let index = 0; index < delta.length; index += 1) {
    const magnitude = Math.abs(delta[index] ?? 0);
    if (magnitude > best) best = magnitude;
  }
  return best;
}

/** Same-index aa dispDiff z of one S0 report (tipDisp.z - crownDisp.z). */
function dispDiffZOf(report: AaMechanismReport): number {
  const tipDispZ = report.aaTipAtBindIndexMm[2] - report.bind.tipPosMm[2];
  const crownDispZ = report.aaCrownAtBindIndexMm[2] - report.bind.crownPosMm[2];
  return tipDispZ - crownDispZ;
}

/**
 * Measure the teeth viseme_aa morph's CONTRIBUTION to the aa dispDiff z for
 * one actor (DEF1): shipped-leg dispDiffZ minus the delta-zeroed-leg
 * dispDiffZ, same drive, same bind-chosen tip/crown indices.
 */
export async function measureTeethAaContribution(
  glbPath: string,
  opts?: TeethAaContributionOpts,
): Promise<TeethAaContribution> {
  const shipped = await probeWithPlant(glbPath, opts?.plant);
  const shippedDispDiffZ = dispDiffZOf(shipped);
  const present = shipped.bind.teethTargetNames.includes("viseme_aa");

  // Zeroed leg: fresh scenes, teeth viseme_aa delta zeroed in memory BEFORE the
  // drive, dictionary entry kept (port of c3/scratch-deltazero.mts). The plant
  // runs on the bind scene first and the driven scene second, so the recorded
  // before/after values are the driven scene's.
  let zeroedDeltaMaxAbsBefore = 0;
  let zeroedDeltaMaxAbsAfter = 0;
  const zeroed = await probeWithPlant(glbPath, (scene) => {
    const targetIndex = scene.teeth.targetNames.indexOf("viseme_aa");
    if (targetIndex < 0) {
      zeroedDeltaMaxAbsBefore = 0;
      zeroedDeltaMaxAbsAfter = 0;
      return;
    }
    const delta = scene.teeth.targetDeltas[targetIndex];
    if (!delta) {
      zeroedDeltaMaxAbsBefore = 0;
      zeroedDeltaMaxAbsAfter = 0;
      return;
    }
    zeroedDeltaMaxAbsBefore = maxAbsDelta(delta);
    delta.fill(0);
    zeroedDeltaMaxAbsAfter = maxAbsDelta(delta);
  });
  if (zeroed.bind.tipIndex !== shipped.bind.tipIndex || zeroed.bind.crownIndex !== shipped.bind.crownIndex) {
    throw new Error(
      `bind-chosen indices disagree across legs: shipped tip ${shipped.bind.tipIndex}/crown ${shipped.bind.crownIndex} ` +
        `vs zeroed tip ${zeroed.bind.tipIndex}/crown ${zeroed.bind.crownIndex}`,
    );
  }
  const zeroedDispDiffZ = dispDiffZOf(zeroed);
  return {
    present,
    shippedDispDiffZ,
    zeroedDispDiffZ,
    contribution: shippedDispDiffZ - zeroedDispDiffZ,
    zeroedDeltaMaxAbsBefore,
    zeroedDeltaMaxAbsAfter,
  };
}
