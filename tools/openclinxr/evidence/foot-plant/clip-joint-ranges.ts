import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

/**
 * Per-joint rotation range over frames 1..N for one GLB clip.
 *
 * Range metric: max pairwise angle (degrees) between the joint's rotation keys,
 * 2*acos(|dot|). Same metric on source and target, so the ratio is comparable.
 * Frame 0 excluded from the range (it may be a rest frame); key times checked
 * separately for strict increase.
 */

function quatAngleDeg(a: number[], b: number[]): number {
  const dot = Math.min(
    1,
    Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!),
  );
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]!;
    if (key.startsWith("--")) {
      out[key.slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "1" : argv[i + 1]!;
      if (out[key.slice(2)] !== "1") i += 1;
    }
  }
  return out;
}

const args = parseArgs();
const glbPath = args["glb"] ?? "";
const clipName = args["clip"] ?? "";
const joints = (args["joints"] ?? "").split(",").filter(Boolean);
const outPath = args["out"] ?? "";

if (!glbPath || !clipName || joints.length === 0) {
  console.error("usage: clip-joint-ranges.ts --glb <path> --clip <name> --joints a,b,c [--out <json>]");
  process.exit(1);
}

const document = await new NodeIO().read(glbPath);
const root = document.getRoot();
const animation = root.listAnimations().find((a) => a.getName() === clipName);
if (!animation) {
  throw new Error(
    `no clip named ${clipName}. Present: ${root.listAnimations().map((a) => a.getName()).join(", ")}`,
  );
}

type Series = { times: number[]; quats: number[][]; interpolation: string };
const byJoint = new Map<string, Series[]>();
let keyCount = 0;
let strictlyIncreasing = true;
const firstLastDeg: Record<string, number> = {};
let maxKeyCount = 0;

for (const channel of animation.listChannels()) {
  const node = channel.getTargetNode();
  const sampler = channel.getSampler();
  const targetPath = channel.getTargetPath();
  if (!node || !sampler || targetPath !== "rotation") continue;
  const times = sampler.getInput()?.getArray();
  const values = sampler.getOutput()?.getArray();
  if (!times || !values) continue;
  const t = Array.from(times as ArrayLike<number>);
  const v = Array.from(values as ArrayLike<number>);
  maxKeyCount = Math.max(maxKeyCount, t.length);
  for (let i = 1; i < t.length; i += 1) {
    if (!(t[i]! > t[i - 1]!)) strictlyIncreasing = false;
  }
  const quats: number[][] = [];
  for (let i = 0; i < t.length; i += 1) quats.push([v[i * 4]!, v[i * 4 + 1]!, v[i * 4 + 2]!, v[i * 4 + 3]!]);
  const name = node.getName();
  if (!byJoint.has(name)) byJoint.set(name, []);
  byJoint.get(name)!.push({ times: t, quats, interpolation: sampler.getInterpolation() });
}
keyCount = maxKeyCount;

const ranges: Record<string, number> = {};
for (const joint of joints) {
  // Merge channels if a joint appears twice; use the first series' frames 1..N.
  const series = byJoint.get(joint);
  if (!series || series.length === 0) {
    ranges[joint] = NaN;
    continue;
  }
  const quats = series[0]!.quats.slice(1);
  let max = 0;
  for (let i = 0; i < quats.length; i += 1) {
    for (let j = i + 1; j < quats.length; j += 1) {
      max = Math.max(max, quatAngleDeg(quats[i]!, quats[j]!));
    }
  }
  ranges[joint] = Math.round(max * 10) / 10;
  const first = series[0]!.quats[0]!;
  const last = series[0]!.quats[series[0]!.quats.length - 1]!;
  firstLastDeg[joint] = Math.round(quatAngleDeg(first, last) * 10) / 10;
}

// Largest key-to-key step on hip/knee channels (for the loop-hitch check).
const steps: Record<string, number> = {};
for (const joint of joints) {
  const series = byJoint.get(joint);
  if (!series || series.length === 0) continue;
  let maxStep = 0;
  const quats = series[0]!.quats;
  for (let i = 1; i < quats.length; i += 1) {
    maxStep = Math.max(maxStep, quatAngleDeg(quats[i - 1]!, quats[i]!));
  }
  steps[joint] = Math.round(maxStep * 10) / 10;
}

const result = {
  glbPath,
  clipName,
  keyCount,
  keyTimesStrictlyIncreasing: strictlyIncreasing,
  rangesOverFrames1toN: ranges,
  firstLastKeyDiffDeg: firstLastDeg,
  maxKeyToKeyStepDeg: steps,
};
console.log(JSON.stringify(result, null, 1));
if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 1)}\n`, "utf8");
}
