/**
 * Post-process seated motion-bind GLBs: restore held source flexion onto the
 * target animation. Invoked by seated_clip_bind_stage.py after export so a
 * re-bake reproduces the seated posture with no manual step.
 *
 * The retarget_bvh formula transfers offset-from-T-pose (~3 deg), not the
 * absolute seated rotation (~87 deg).  For every rotation key of the held
 * clip we set:
 *   q_anim[i] = q_rest_target @ q_source_global
 *
 * This guarantees quatAngle(q_rest, q_anim[i]) = quatAngle(identity, q_source) ≈ 87 deg.
 *
 * Usage: node postprocess-seated-glbs.mjs [--bvh <path>] <glb-path> [glb-path ...]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

// ── Quaternion math ──────────────────────────────────────────────────────────

function qMul(a, b) {
  return [
    a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
    a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
    a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
    a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0],
  ];
}

function qConj(q) { return [q[0], -q[1], -q[2], -q[3]]; }

function eulerXYZ(deg) {
  const r = deg.map(d => d * Math.PI / 180);
  const cx = Math.cos(r[0]/2), sx = Math.sin(r[0]/2);
  const cy = Math.cos(r[1]/2), sy = Math.sin(r[1]/2);
  const cz = Math.cos(r[2]/2), sz = Math.sin(r[2]/2);
  // XYZ order: q = qz @ qy @ qx
  return [
    cx*cy*cz + sx*sy*sz,
    sx*cy*cz - cx*sy*sz,
    cx*sy*cz + sx*cy*sz,
    cx*cy*sz - sx*sy*cz,
  ];
}

function qAngleDeg(a, b) {
  let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  dot = Math.min(1, Math.abs(dot));
  return 2 * Math.acos(dot) * 180 / Math.PI;
}

// ── BVH parser ───────────────────────────────────────────────────────────────

function parseBvh(path) {
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n");
  const joints = [];
  let stack = [];
  let motionStart = 0, frameCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("ROOT ") || s.startsWith("JOINT ")) {
      const name = s.split(/\s+/)[1];
      stack.push(name);
    } else if (s === "{") {
      // skip
    } else if (s === "}") {
      stack.pop();
    } else if (s.startsWith("CHANNELS")) {
      const parts = s.split(/\s+/);
      const n = parseInt(parts[1]);
      const joint = stack[stack.length - 1];
      for (let j = 0; j < n; j++) {
        joints.push({ joint, channel: parts[2 + j], index: joints.length });
      }
    } else if (s === "MOTION") {
      motionStart = i + 1;
    } else if (s.startsWith("Frames:")) {
      frameCount = parseInt(s.split(":")[1].trim());
    }
  }

  const frameData = lines[motionStart + 2].trim().split(/\s+/).map(Number);
  return { joints, frameData };
}

function getChannel(bvh, joint, channel) {
  const ch = bvh.joints.find(j => j.joint === joint && j.channel === channel);
  return ch ? bvh.frameData[ch.index] : 0;
}

// ── Source bone map: BVH joint → (parent_bvh_joint, is_root) ──────────────────
// We need the BVH hierarchy to compute global rotations.

function parseBvhHierarchy(path) {
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n");
  const hierarchy = [];  // [{name, parent, channels: [{name, index}]}]
  let stack = [];
  let chanOffset = 0;

  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("ROOT ") || s.startsWith("JOINT ")) {
      const name = s.split(/\s+/)[1];
      const parent = stack.length > 0 ? stack[stack.length - 1] : null;
      stack.push(name);
      hierarchy.push({ name, parent, chanStart: chanOffset });
    } else if (s === "}") {
      stack.pop();
    } else if (s.startsWith("CHANNELS")) {
      const parts = s.split(/\s+/);
      const n = parseInt(parts[1]);
      const last = hierarchy[hierarchy.length - 1];
      last.numChannels = n;
      last.channelNames = parts.slice(2, 2 + n);
      chanOffset += n;
    }
  }
  return hierarchy;
}

function getFrameChannels(bvhPath, frameIndex) {
  const text = readFileSync(bvhPath, "utf-8");
  const lines = text.split("\n");
  let motionStart = 0, frameCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s === "MOTION") motionStart = i + 1;
    else if (s.startsWith("Frames:")) frameCount = parseInt(s.split(":")[1].trim());
  }
  const frameLine = lines[motionStart + 2 + frameIndex].trim().split(/\s+/).map(Number);
  return frameLine;
}

function computeSourceGlobalRotation(bvhPath, targetJoint, frameIndex) {
  const hier = parseBvhHierarchy(bvhPath);
  const frameData = getFrameChannels(bvhPath, frameIndex);

  // Build chain from root to targetJoint
  const chain = [];
  let cur = targetJoint;
  while (cur) {
    const node = hier.find(h => h.name === cur);
    if (!node) break;
    chain.unshift(node);
    cur = node.parent;
  }

  // Compute global rotation by composing the chain
  let globalQ = [1, 0, 0, 0];  // identity
  for (const node of chain) {
    const xRot = frameData[node.chanStart + (node.channelNames.indexOf("Xrotation"))] || 0;
    const yRot = frameData[node.chanStart + (node.channelNames.indexOf("Yrotation"))] || 0;
    const zRot = frameData[node.chanStart + (node.channelNames.indexOf("Zrotation"))] || 0;
    const localQ = eulerXYZ([xRot, yRot, zRot]);
    globalQ = qMul(globalQ, localQ);
  }
  return globalQ;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const BONE_MAP = [
  { target: "upperleg01.L", source: "thigh_l" },
  { target: "upperleg01.R", source: "thigh_r" },
  { target: "lowerleg01.L", source: "calf_l" },
  { target: "lowerleg01.R", source: "calf_r" },
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BVH = path.join(HERE, "mesh2motion-sitting-talking-single-clip.bvh");

const argv = process.argv.slice(2);
let BVH_PATH = DEFAULT_BVH;
const glbPaths = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--bvh") {
    BVH_PATH = path.resolve(argv[++i] ?? "");
  } else {
    glbPaths.push(argv[i]);
  }
}

if (glbPaths.length === 0) {
  console.error("Usage: node postprocess-seated-glbs.mjs [--bvh <path>] <glb-path> [glb-path ...]");
  process.exit(2);
}

for (const glbPath of glbPaths) {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  const anims = root.listAnimations();

  const seated = anims.find(a => a.getName().includes("seated_talking"));
  if (!seated) {
    console.log(`${glbPath}: no seated animation, skipping`);
    continue;
  }

  let changed = 0;
  for (const { target, source } of BONE_MAP) {
    // Find the channel in the seated animation
    let sampler = null;
    for (const ch of seated.listChannels()) {
      if (ch.getTargetNode()?.getName() === target && ch.getTargetPath() === "rotation") {
        sampler = ch.getSampler();
        break;
      }
    }
    if (!sampler) continue;

    const inputArr = sampler.getInput().getArray();
    const outputArr = sampler.getOutput().getArray();
    const count = sampler.getInput().getCount();
    if (count < 2) continue;

    // Get the target bone's rest rotation from the GLB node
    const node = root.listNodes().find(n => n.getName() === target);
    if (!node) continue;
    const restQ = node.getRotation();  // [x, y, z, w] in glTF convention

    // glTF quaternion convention: [x, y, z, w]
    // Our internal convention: [w, x, y, z]
    const restQWX = [restQ[3], restQ[0], restQ[1], restQ[2]];

    // Get source bone's global rotation from BVH frame 1
    const srcGlobalQ = computeSourceGlobalRotation(BVH_PATH, source, 1);

    // Correct quaternion: q_rest @ q_source_global
    // This guarantees quatAngle(q_rest, q_anim) = quatAngle(identity, q_source) ≈ 87 deg
    const correctQWX = qMul(restQWX, srcGlobalQ);

    // Verify
    const angle = qAngleDeg(restQWX, correctQWX);
    console.log(`  ${target}: angle from rest = ${angle.toFixed(1)} deg (expected ~87)`);

    // Convert back to glTF convention [x, y, z, w] and write every key.
    // The source clip is held (range 0 on thigh/calf_l); every frame must sit.
    const glTFQ = [correctQWX[1], correctQWX[2], correctQWX[3], correctQWX[0]];
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      outputArr[o] = glTFQ[0];
      outputArr[o + 1] = glTFQ[1];
      outputArr[o + 2] = glTFQ[2];
      outputArr[o + 3] = glTFQ[3];
    }
    sampler.getOutput().setArray(outputArr);
    changed++;
  }

  if (changed > 0) {
    await io.write(glbPath, doc);
    console.log(`${glbPath}: wrote ${changed} bones`);
  }
}
