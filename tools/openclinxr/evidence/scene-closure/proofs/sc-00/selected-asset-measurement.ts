/**
 * Turn the ACTUAL selected SC-04 bodies, rig and clip into a `MotionMeasurement` the rubric grades.
 *
 * This is the independent measurement operation the card names. It decodes the shipped GLB bytes
 * directly — node hierarchy, animation samplers, skin joints and POSITION accessors — rather than
 * asking the runtime what it thinks happened. proof-contract-v2.md for SC-00: "Include loaded/skinned
 * geometry or independently decoded selected-asset samples, their exact frame transformations and
 * sampling rules."
 *
 * SAMPLING RULES, stated because a measurement without them is a number without a method:
 *  - Frame times come from the clip's own densest input accessor; nothing is resampled.
 *  - Joint world positions are forward kinematics over the node chain from scene root to joint,
 *    composed in float64 from the GLB's float32 TRS, with slerp on rotation channels. A CUBICSPLINE
 *    sampler is refused rather than read linearly.
 *  - A clip that bakes no root translation is IN PLACE, so the world track of a stance foot moves
 *    backwards relative to the body. Slide is therefore measured on the track COMPOSED with the
 *    consumer's ground advance, and the advance is supplied by the caller — it is the driver of the
 *    causal chain, and deriving it from the very stance displacement being graded would null the
 *    metric by construction.
 *
 * WHY THE ADVANCE IS NOT TAKEN FROM THE CLIP. sc-04.json derives a ground speed from the clip's own
 * longest stance window. That measures internal consistency and is a fair thing to report, but a
 * speed fitted to the stance displacement makes the residual slide small by construction. What
 * SHIPS is the executor's `CLINICIAN_WALK_SPEED_MPS`, which moves whether or not the plant works.
 * Both are measured and both are recorded; the rubric grade of record uses the executor's.
 *
 * claimScope: decoded geometry and joint tracks of named GLB bytes under a named clip.
 * notEvidenceFor: what the runtime displays, what a capture shows, or that any encounter ran.
 */

import { NodeIO } from "@gltf-transform/core";
import { boundClipJointTrack } from "../../../foot-plant/bound-clip-foot-track.js";
import type { JointSample, JointTrack, MotionMeasurement } from "./measurement-rubric.js";

/** Counts of skinned geometry actually present in the bytes. Zero is a refusal, not a pass. */
export type SkinnedGeometryCensus = {
  skinnedBodyCount: number;
  skinnedVertexSampleCount: number;
  skinNames: string[];
};

export async function censusSkinnedGeometry(glbPath: string): Promise<SkinnedGeometryCensus> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  let skinnedBodyCount = 0;
  let skinnedVertexSampleCount = 0;
  const skinNames: string[] = [];
  for (const node of root.listNodes()) {
    const skin = node.getSkin();
    const mesh = node.getMesh();
    if (!skin || !mesh) continue;
    skinnedBodyCount += 1;
    skinNames.push(node.getName());
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      const joints = primitive.getAttribute("JOINTS_0");
      if (!position || !joints) continue;
      skinnedVertexSampleCount += position.getCount();
    }
  }
  return { skinnedBodyCount, skinnedVertexSampleCount, skinNames };
}

/** Per-frame length of the segment between two joints, from their world tracks. */
export async function boneLengthSeries(input: {
  glbPath: string;
  clipName: string;
  bones: ReadonlyArray<{ name: string; from: string; to: string }>;
}): Promise<Array<{ bone: string; lengthsMeters: number[] }>> {
  const series: Array<{ bone: string; lengthsMeters: number[] }> = [];
  for (const bone of input.bones) {
    const head = await boundClipJointTrack({ glbPath: input.glbPath, clipName: input.clipName, boneName: bone.from });
    const tail = await boundClipJointTrack({ glbPath: input.glbPath, clipName: input.clipName, boneName: bone.to });
    const frames = Math.min(head.samples.length, tail.samples.length);
    const lengthsMeters: number[] = [];
    for (let index = 0; index < frames; index += 1) {
      const a = head.samples[index];
      const b = tail.samples[index];
      if (a === undefined || b === undefined) continue;
      lengthsMeters.push(
        Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z),
      );
    }
    series.push({ bone: bone.name, lengthsMeters });
  }
  return series;
}

export async function jointTracks(input: {
  glbPath: string;
  clipName: string;
  joints: readonly string[];
}): Promise<JointTrack[]> {
  const tracks: JointTrack[] = [];
  for (const joint of input.joints) {
    const track = await boundClipJointTrack({ glbPath: input.glbPath, clipName: input.clipName, boneName: joint });
    tracks.push({ joint, samples: track.samples.map((sample): JointSample => ({ atMs: sample.atMs, position: { ...sample.position } })) });
  }
  return tracks;
}

/**
 * The stance-derived ground speed of a clip, for REPORTING beside the executor's.
 *
 * Takes the longest contact window of the reference joint and divides its body-frame displacement
 * by its duration. This is exactly the construction sc-04.json used, reproduced here so the two
 * numbers are comparable — and labelled, because a speed derived from the stance displacement makes
 * that window's slide zero by construction and must never be the advance a grade of record uses.
 */
export function stanceDerivedGroundAdvance(
  track: JointTrack,
  contactHeightMeters: number,
  floorOriginY: number,
): { metersPerSecond: number; forward: { x: number; z: number }; windowFrames: number } {
  const inContact = track.samples.map((sample) => sample.position.y - floorOriginY <= contactHeightMeters);
  let best = { start: -1, end: -1, length: 0 };
  let index = 0;
  while (index < inContact.length) {
    if (inContact[index] !== true) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < inContact.length && inContact[end + 1] === true) end += 1;
    if (end - index + 1 > best.length) best = { start: index, end, length: end - index + 1 };
    index = end + 1;
  }
  const first = track.samples[best.start];
  const last = track.samples[best.end];
  if (first === undefined || last === undefined || best.length < 2) {
    return { metersPerSecond: 0, forward: { x: 0, z: -1 }, windowFrames: best.length };
  }
  const dx = first.position.x - last.position.x;
  const dz = first.position.z - last.position.z;
  const distance = Math.hypot(dx, dz);
  const seconds = (last.atMs - first.atMs) / 1000;
  if (distance === 0 || seconds === 0) {
    return { metersPerSecond: 0, forward: { x: 0, z: -1 }, windowFrames: best.length };
  }
  return {
    metersPerSecond: distance / seconds,
    forward: { x: dx / distance, z: dz / distance },
    windowFrames: best.length,
  };
}

export type SelectedAssetMeasurementInput = {
  measurementId: string;
  runId: string;
  actorId: string;
  glbPath: string;
  clipName: string;
  contactJoints: readonly string[];
  bones: ReadonlyArray<{ name: string; from: string; to: string }>;
  floorOriginY: number;
  floorFrameId: string;
  groundAdvanceMetersPerSecond: number;
  forward: { x: number; z: number };
  clipDeclaredPlayed: boolean;
};

/**
 * A `MotionMeasurement` covering everything the shipped BYTES can establish.
 *
 * Support, route, arrival and settled heading are left null here on purpose: they are properties of
 * a placement and a run, which SC-03 and SC-05 own and which do not exist at this card's baseline.
 * A null is graded as a violation by the rubric, which is correct — this measurement alone is not a
 * passing encounter and must not be able to look like one. The controls supply those sections
 * explicitly.
 */
export async function measureSelectedAssetClip(
  input: SelectedAssetMeasurementInput,
): Promise<MotionMeasurement> {
  const [census, tracks, bones] = await Promise.all([
    censusSkinnedGeometry(input.glbPath),
    jointTracks({ glbPath: input.glbPath, clipName: input.clipName, joints: input.contactJoints }),
    boneLengthSeries({ glbPath: input.glbPath, clipName: input.clipName, bones: input.bones }),
  ]);
  return {
    measurementId: input.measurementId,
    runId: input.runId,
    actorId: input.actorId,
    skinnedBodyCount: census.skinnedBodyCount,
    skinnedVertexSampleCount: census.skinnedVertexSampleCount,
    clipDeclaredPlayed: input.clipDeclaredPlayed,
    clipName: input.clipName,
    groundAdvanceMetersPerSecond: input.groundAdvanceMetersPerSecond,
    forward: input.forward,
    floor: { frameId: input.floorFrameId, originY: input.floorOriginY, normal: { x: 0, y: 1, z: 0 } },
    support: null,
    supportedContactSamples: null,
    contactTracks: tracks,
    boneLengthSeries: bones,
    route: null,
    arrival: null,
    settled: null,
  };
}

/** The leg segments whose length must not change, named on the shipped MPFB standard rig. */
export const SHIPPED_PHYSICIAN_LEG_BONES = [
  { name: "upperleg.L", from: "upperleg01.L", to: "lowerleg01.L" },
  { name: "lowerleg.L", from: "lowerleg01.L", to: "foot.L" },
  { name: "upperleg.R", from: "upperleg01.R", to: "lowerleg01.R" },
  { name: "lowerleg.R", from: "lowerleg01.R", to: "foot.R" },
] as const;
