import { readFileSync } from "node:fs";

/**
 * Measure a BVH locomotion clip's own foot behaviour: do its feet PLANT, or do they slide?
 *
 * Brief §7 step 4 requires foot sliding measured. `asset-registry/src/approach-executor.ts` supplies
 * the metric, and on the root-driven executor it reports ~100% sliding because nothing drives the
 * legs. The open question that blocks step 4 is whether a locomotion clip on disk would fix that,
 * and that is answerable here rather than by adopting a clip and hoping.
 *
 * WHY FORWARD KINEMATICS AND NOT THE ROOT CHANNELS. A BVH's root translation says how far the hips
 * travelled; it says nothing about whether the feet counter-translated to stay planted, which is
 * the entire question. Only posing the chain gives foot world positions.
 *
 * SCOPE. Minimal FK: offsets, ZYX Euler rotation order (what CMU BVH files declare), root
 * translation. No rest-pose blending, no retargeting, no scale conversion beyond the file's own
 * units. It reads ONE chain to ONE joint and is not a general BVH loader.
 *
 * claimScope: the foot-world-position trajectory of the named joint in the named file.
 * notEvidenceFor: how that clip looks after retargeting onto a different skeleton, its licence, or
 * whether it suits a clinical walk.
 */

type Joint = {
  name: string;
  offset: [number, number, number];
  channels: string[];
  channelStart: number;
  parent: Joint | null;
};

export type BvhClip = {
  joints: Joint[];
  frames: number[][];
  frameTimeSeconds: number;
};

export function parseBvh(filePath: string): BvhClip {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/u);
  const joints: Joint[] = [];
  const stack: Joint[] = [];
  let channelCursor = 0;
  let index = 0;

  for (; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "MOTION") break;
    const jointMatch = /^(ROOT|JOINT)\s+(\S+)/u.exec(line);
    if (jointMatch) {
      const joint: Joint = {
        name: jointMatch[2]!,
        offset: [0, 0, 0],
        channels: [],
        channelStart: 0,
        parent: stack[stack.length - 1] ?? null,
      };
      joints.push(joint);
      stack.push(joint);
      continue;
    }
    if (line.startsWith("End Site")) {
      // Pushed so the matching "}" pops the right frame; End Sites carry no channels.
      stack.push({ name: "__end__", offset: [0, 0, 0], channels: [], channelStart: 0, parent: stack[stack.length - 1] ?? null });
      continue;
    }
    if (line.startsWith("OFFSET")) {
      const parts = line.split(/\s+/u).slice(1).map(Number);
      const current = stack[stack.length - 1];
      if (current) current.offset = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
      continue;
    }
    if (line.startsWith("CHANNELS")) {
      const parts = line.split(/\s+/u);
      const count = Number(parts[1]);
      const current = stack[stack.length - 1];
      if (current) {
        current.channels = parts.slice(2, 2 + count);
        current.channelStart = channelCursor;
      }
      channelCursor += count;
      continue;
    }
    if (line === "}") stack.pop();
  }

  let frameTimeSeconds = 1 / 120;
  const frames: number[][] = [];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.startsWith("Frames:")) continue;
    if (line.startsWith("Frame Time:")) {
      frameTimeSeconds = Number(line.split(":")[1]);
      continue;
    }
    if (line === "") continue;
    frames.push(line.split(/\s+/u).map(Number));
  }
  return { joints, frames, frameTimeSeconds };
}

type Mat = number[];

function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k]! * b[k * 4 + col]!;
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

function translation(x: number, y: number, z: number): Mat {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

function rotation(axis: "X" | "Y" | "Z", degrees: number): Mat {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  if (axis === "X") return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  if (axis === "Y") return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** World position of `jointName` on every frame. */
export function jointWorldTrack(
  clip: BvhClip,
  jointName: string,
): Array<{ atMs: number; position: { x: number; y: number; z: number } }> {
  const target = clip.joints.find((joint) => joint.name === jointName);
  if (!target) {
    throw new Error(
      `jointWorldTrack: no joint named ${jointName}. Present: ${clip.joints.map((joint) => joint.name).join(", ")}`,
    );
  }
  const chain: Joint[] = [];
  for (let joint: Joint | null = target; joint; joint = joint.parent) chain.unshift(joint);

  return clip.frames.map((frame, frameIndex) => {
    let matrix: Mat = translation(0, 0, 0);
    for (const joint of chain) {
      matrix = multiply(matrix, translation(joint.offset[0], joint.offset[1], joint.offset[2]));
      let cursor = joint.channelStart;
      for (const channel of joint.channels) {
        const value = frame[cursor] ?? 0;
        cursor += 1;
        if (channel === "Xposition") matrix = multiply(matrix, translation(value, 0, 0));
        else if (channel === "Yposition") matrix = multiply(matrix, translation(0, value, 0));
        else if (channel === "Zposition") matrix = multiply(matrix, translation(0, 0, value));
        else if (channel === "Xrotation") matrix = multiply(matrix, rotation("X", value));
        else if (channel === "Yrotation") matrix = multiply(matrix, rotation("Y", value));
        else if (channel === "Zrotation") matrix = multiply(matrix, rotation("Z", value));
      }
    }
    return {
      atMs: frameIndex * clip.frameTimeSeconds * 1000,
      position: { x: matrix[3]!, y: matrix[7]!, z: matrix[11]! },
    };
  });
}
