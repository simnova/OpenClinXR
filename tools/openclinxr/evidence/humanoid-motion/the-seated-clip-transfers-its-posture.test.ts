/**
 * The seated-talking BVH holds thigh_l at -86.823 deg Xrotation across all 89 frames.
 * A correct retarget must transfer that held posture onto the MPFB rig. Measured
 * 2026-09-12 from the source BVH and three baked .motion-bind.glb files.
 *
 * SOURCE tools/openclinxr/asset-pipeline/makeclothes/mesh2motion-sitting-talking-single-clip.bvh:
 *   thigh_l Xrotation = -86.823 deg CONSTANT (range 0.000 deg)
 *   calf_l  Xrotation = +80.378 deg CONSTANT (range 0.000 deg)
 *
 * BAKED GLBs (rest-to-frame-0 quaternion angle per bone):
 *   mpfb-ob-patient-aisha:       upperleg01.L 11.33 deg  (expected ~87 deg)
 *   mpfb-peds-parent-aisha:      upperleg01.L 18.44 deg  (expected ~87 deg)
 *   mpfb-family-partner-adult:   upperleg01.L 18.47 deg  (expected ~87 deg)
 *
 * The retarget_bvh addon (retarget.py:267-272) computes aMatrix = src_tpose^-1 @ trg_tpose,
 * then at each frame: trg_global = src_global @ aMatrix. At frame 0, putInTPose overwrites
 * the source's seated pose with the T-pose, so frame 0 becomes the target's T-pose — not the
 * target's seated pose. The held offset (86.823 deg from T-pose) is lost because the retarget
 * transfers rotations relative to the T-pose, and the source's seated pose is only 3.177 deg
 * from the T-pose (thigh_l at -86.823 vs T-pose at -90).
 *
 * claimScope: whether the seated posture (hip flexion) transfers from source to target.
 * notEvidenceFor: visual quality, runtime playback, Quest readiness, clinical realism.
 *
 * ## FIXED (#0) — pass criteria documented; test currently BITES (fails) as designed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

const CANDIDATES_DIR = "apps/ui-xr/public/xr-assets/humanoids/candidates";
const BVH_PATH =
  "tools/openclinxr/asset-pipeline/makeclothes/mesh2motion-sitting-talking-single-clip.bvh";

// Source's held hip flexion: thigh_l Xrotation = -86.823 deg (magnitude 86.823 deg).
// Range on thigh_l = 0.000 deg, so the tolerance is purely measurement margin.
// Quaternion-angle representation and rest-pose differences between source and target
// rigs introduce up to ~15 deg of variance; 20 deg covers that with headroom.
const SOURCE_HELD_FLEXION_DEG = 86.823;
const TOLERANCE_DEG = 20;
const MIN_EXPECTED_FLEXION_DEG = SOURCE_HELD_FLEXION_DEG - TOLERANCE_DEG; // 66.823

// ── BVH parser (minimal: channels + frame data) ─────────────────────────────

interface BvhChannel {
  joint: string;
  channel: string;
  index: number;
}

function parseBvh(path: string) {
  const lines = readFileSync(path, "utf-8").split("\n");
  const channels: BvhChannel[] = [];
  let currentJoint = "";
  let channelOffset = 0;
  let motionStart = 0;
  let frameCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("JOINT ") || line.startsWith("ROOT ")) {
      currentJoint = line.split(/\s+/)[1];
    } else if (line.startsWith("CHANNELS")) {
      const parts = line.split(/\s+/);
      const n = parseInt(parts[1], 10);
      for (let j = 0; j < n; j++) {
        channels.push({
          joint: currentJoint,
          channel: parts[2 + j],
          index: channelOffset + j,
        });
      }
      channelOffset += n;
    } else if (line === "MOTION") {
      motionStart = i + 1;
    } else if (line.startsWith("Frames:")) {
      frameCount = parseInt(line.split(":")[1].trim(), 10);
    }
  }

  const data: number[][] = [];
  for (let f = 0; f < frameCount; f++) {
    const values = lines[motionStart + 2 + f]
      .trim()
      .split(/\s+/)
      .map(Number);
    data.push(values);
  }

  return { channels, frameCount, data };
}

// ── Quaternion helpers ──────────────────────────────────────────────────────

function quatAngleDeg(a: number[], b: number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  return (2 * Math.acos(Math.min(1, Math.abs(dot)))) * (180 / Math.PI);
}

// ── GLB reader (animation channels via @gltf-transform) ─────────────────────

interface BoneData {
  name: string;
  restRotation: number[] | null;
  frameRotations: number[][];
}

async function readGlbBones(glbPath: string): Promise<BoneData[]> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) return [];

  const joints = skin.listJoints();
  const animations = root.listAnimations();
  if (animations.length === 0) return [];

  // Use the SECOND animation (index 1) which contains the leg bone channels at 90 frames.
  // The first animation (index 0) has only 4 channels at 90 frames; the rest are 2-frame stubs.
  const anim = animations.length > 1 ? animations[1] : animations[0];

  const results: BoneData[] = [];
  for (const joint of joints) {
    const nodeName = joint.getName();
    const restRot = joint.getRotation();
    const restQuat = restRot
      ? [restRot[0], restRot[1], restRot[2], restRot[3]]
      : null;

    const frameRotations: number[][] = [];
    for (const ch of anim.listChannels()) {
      if (ch.getTargetNode() !== joint) continue;
      if (ch.getTargetPath() !== "rotation") continue;
      const sampler = ch.getSampler();
      if (!sampler) continue;
      const output = sampler.getOutput();
      if (!output) continue;
      const data = output.getArray();
      if (!data) continue;
      const count = output.getCount();
      for (let i = 0; i < count; i++) {
        const offset = i * 4;
        frameRotations.push([
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3],
        ]);
      }
      break;
    }

    results.push({ name: nodeName, restRotation: restQuat, frameRotations });
  }
  return results;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("the seated clip transfers its posture", () => {
  const bvh = parseBvh(BVH_PATH);

  it("source BVH has the expected held hip flexion", () => {
    const thighL = bvh.channels.find(
      (c) => c.joint === "thigh_l" && c.channel === "Xrotation"
    );
    expect(thighL).toBeDefined();
    if (!thighL) return;

    const values = bvh.data.map((row) => row[thighL.index]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    // Held posture: constant across all frames
    expect(range).toBe(0);
    // The held value is -86.823 deg
    expect(Math.abs(values[0])).toBeCloseTo(SOURCE_HELD_FLEXION_DEG, 1);
  });

  const glbFiles = readdirSync(CANDIDATES_DIR)
    .filter((f) => f.endsWith(".motion-bind.glb"))
    .map((f) => `${CANDIDATES_DIR}/${f}`);

  for (const glbPath of glbFiles) {
    const glbName = glbPath.split("/").pop()!;

    // it.fails: the retarget_bvh T-pose overwrite drops the held posture. When the
    // retarget is fixed so seated posture transfers (hip flexion >= 66.823 deg), these
    // three lines must become plain it() — the defect is gone and the assertion is true.
    it.fails(`${glbName}: rest-to-frame-0 hip flexion within ${TOLERANCE_DEG} deg of source held value (retarget_bvh drops held posture — self-retiring)`, async () => {
      const bones = await readGlbBones(glbPath);
      const upperLegL = bones.find((b) => b.name === "upperleg01.L");
      const upperLegR = bones.find((b) => b.name === "upperleg01.R");

      expect(upperLegL).toBeDefined();
      expect(upperLegR).toBeDefined();
      if (!upperLegL || !upperLegR) return;

      expect(upperLegL.restRotation).not.toBeNull();
      expect(upperLegL.frameRotations.length).toBeGreaterThan(0);
      if (!upperLegL.restRotation || upperLegL.frameRotations.length === 0) return;
      expect(upperLegR.restRotation).not.toBeNull();
      expect(upperLegR.frameRotations.length).toBeGreaterThan(0);
      if (!upperLegR.restRotation || upperLegR.frameRotations.length === 0) return;

      // Rest-to-frame-0 angle = quaternion angle between rest pose and frame 0
      const angleL = quatAngleDeg(upperLegL.restRotation, upperLegL.frameRotations[0]);
      const angleR = quatAngleDeg(upperLegR.restRotation, upperLegR.frameRotations[0]);

      // The seated posture should transfer: hip flexion ~87 deg from rest.
      // Today's GLBs show 11-18 deg — this assertion fails.
      expect(angleL).toBeGreaterThanOrEqual(MIN_EXPECTED_FLEXION_DEG);
      expect(angleR).toBeGreaterThanOrEqual(MIN_EXPECTED_FLEXION_DEG);
    });
  }
});
