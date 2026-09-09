import { NodeIO } from "@gltf-transform/core";
import type { Node as GltfNode } from "@gltf-transform/core";
// Not published from the entrypoint, and not published for this: the package arch-ceiling is
// shrink-only. Read the type from the module that declares it.
import type { FootSample } from "../../../../packages/openclinxr/asset-registry/src/approach-executor.js";

/**
 * Forward kinematics over a BOUND GLB clip, so a foot's world track can be measured on the rig that
 * would actually ship.
 *
 * Brief §7 step 4 requires foot sliding measured. Two measurements already exist and neither is
 * about the shipped rig: `approach-executor.ts` reports ~100% on a root-driven walk with no leg
 * animation, and `bvh-foot-plant.ts` measures the CMU source clip in its own BVH skeleton. The
 * question left open by both is whether the retarget preserved the plant once the clip was bound to
 * the MPFB physician armature — retargeting is exactly where a plant is lost, because the target
 * rig's limb lengths differ from the source's.
 *
 * WHY NOT three.js. The measurement is node hierarchy plus animation samplers plus quaternion
 * composition. Loading a renderer to obtain that would add a DOM shim, a texture decoder and a
 * skinning pass for numbers that come straight out of the glTF. `@gltf-transform/core` is already a
 * root dependency and reads the same bytes the runtime loads.
 *
 * claimScope: the world-space track of one named joint under one named clip in one named GLB.
 * notEvidenceFor: what the runtime displays (the runtime applies its own root transform and framing),
 * visual walk quality, or whether the clip suits a clinical approach.
 */

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Mat = Float64Array;

type Channel = {
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  /** Number of components per keyframe: 3 for TRS vectors, 4 for rotations. */
  stride: number;
  interpolation: string;
};

export type BoundClipTrack = {
  samples: FootSample[];
  /** Every sample time, in milliseconds, taken from the clip's own densest input accessor. */
  frameTimesMs: number[];
};

function identity(): Mat {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a: Mat, b: Mat): Mat {
  const out = new Float64Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k]! * b[k * 4 + col]!;
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

/** Column-major-free composition: rows times columns, translation in the last COLUMN. */
function compose(translation: Vec3, rotation: Quat, scale: Vec3): Mat {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return new Float64Array([
    (1 - 2 * (yy + zz)) * sx, (2 * (xy - wz)) * sy, (2 * (xz + wy)) * sz, translation[0],
    (2 * (xy + wz)) * sx, (1 - 2 * (xx + zz)) * sy, (2 * (yz - wx)) * sz, translation[1],
    (2 * (xz - wy)) * sx, (2 * (yz + wx)) * sy, (1 - 2 * (xx + yy)) * sz, translation[2],
    0, 0, 0, 1,
  ]);
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    const out: Quat = [
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ];
    const length = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    return [out[0] / length, out[1] / length, out[2] / length, out[3] / length];
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

function sampleChannel(channel: Channel, timeSeconds: number): number[] {
  const times = channel.times;
  const count = times.length;
  const stride = channel.stride;
  const at = (index: number): number[] =>
    Array.from(channel.values.subarray(index * stride, index * stride + stride));
  if (count === 0) throw new Error("bound-clip-foot-track: an animation sampler has no keyframes.");
  if (timeSeconds <= times[0]!) return at(0);
  if (timeSeconds >= times[count - 1]!) return at(count - 1);
  let upper = 1;
  while (upper < count && times[upper]! < timeSeconds) upper += 1;
  const lower = upper - 1;
  if (channel.interpolation === "STEP") return at(lower);
  const span = times[upper]! - times[lower]!;
  const t = span === 0 ? 0 : (timeSeconds - times[lower]!) / span;
  const a = at(lower);
  const b = at(upper);
  if (channel.path === "rotation") {
    return slerp(a as Quat, b as Quat, t);
  }
  return a.map((value, index) => value + (b[index]! - value) * t);
}

function channelsFor(
  clipChannels: ReadonlyArray<{ node: GltfNode; channel: Channel }>,
  node: GltfNode,
): Channel[] {
  return clipChannels.filter((entry) => entry.node === node).map((entry) => entry.channel);
}

/**
 * The world position of `boneName` on every frame of `clipName`, in the GLB's scene space.
 *
 * REFUSES a cubic-spline sampler rather than sampling it as if it were linear. A CUBICSPLINE
 * accessor stores in-tangent, value and out-tangent per keyframe, so reading it with a linear
 * stride returns tangents as positions — a wrong answer that looks like a measurement.
 */
export async function boundClipJointTrack(input: {
  glbPath: string;
  clipName: string;
  boneName: string;
}): Promise<BoundClipTrack> {
  const document = await new NodeIO().read(input.glbPath);
  const root = document.getRoot();
  const animation = root.listAnimations().find((candidate) => candidate.getName() === input.clipName);
  if (!animation) {
    throw new Error(
      `boundClipJointTrack: ${input.glbPath} has no clip named ${input.clipName}. Present: ${root
        .listAnimations()
        .map((candidate) => candidate.getName())
        .join(", ")}`,
    );
  }

  const clipChannels: Array<{ node: GltfNode; channel: Channel }> = [];
  let frameTimes: Float32Array | null = null;
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const sampler = channel.getSampler();
    const path = channel.getTargetPath();
    if (!node || !sampler || !path) continue;
    if (path !== "translation" && path !== "rotation" && path !== "scale") continue;
    const interpolation = sampler.getInterpolation();
    if (interpolation === "CUBICSPLINE") {
      throw new Error(
        `boundClipJointTrack: ${input.clipName} channel on ${node.getName()} is CUBICSPLINE. Its accessor stores tangents beside values, so sampling it linearly would report tangents as positions. Refused rather than measured.`,
      );
    }
    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    const stride = path === "rotation" ? 4 : 3;
    const entry: Channel = {
      path,
      times: Float32Array.from(times),
      values: Float32Array.from(values),
      stride,
      interpolation,
    };
    clipChannels.push({ node, channel: entry });
    if (!frameTimes || entry.times.length > frameTimes.length) frameTimes = entry.times;
  }
  if (!frameTimes) {
    throw new Error(`boundClipJointTrack: ${input.clipName} has no sampled channels.`);
  }

  const nodes = root.listNodes();
  const target = nodes.find((candidate) => candidate.getName() === input.boneName);
  if (!target) {
    throw new Error(
      `boundClipJointTrack: no node named ${input.boneName} in ${input.glbPath}.`,
    );
  }
  const parentOf = new Map<GltfNode, GltfNode>();
  for (const node of nodes) for (const child of node.listChildren()) parentOf.set(child, node);
  const chain: GltfNode[] = [];
  for (let node: GltfNode | undefined = target; node; node = parentOf.get(node)) chain.unshift(node);

  const samples: FootSample[] = [];
  const frameTimesMs: number[] = [];
  for (const timeSeconds of frameTimes) {
    let matrix = identity();
    for (const node of chain) {
      const animated = channelsFor(clipChannels, node);
      let translation = node.getTranslation() as unknown as Vec3;
      let rotation = node.getRotation() as unknown as Quat;
      let scale = node.getScale() as unknown as Vec3;
      for (const channel of animated) {
        const value = sampleChannel(channel, timeSeconds);
        if (channel.path === "translation") translation = value as Vec3;
        else if (channel.path === "rotation") rotation = value as Quat;
        else scale = value as Vec3;
      }
      matrix = multiply(matrix, compose(translation, rotation, scale));
    }
    frameTimesMs.push(timeSeconds * 1000);
    samples.push({
      atMs: timeSeconds * 1000,
      position: { x: matrix[3]!, y: matrix[7]!, z: matrix[11]! },
    });
  }
  return { samples, frameTimesMs };
}
