/**
 * materialize-guard-withdraw-clip.ts — inject a LoopOnce guard/withdraw flinch clip
 * into a patient GLB (no Blender), for the animation-driven clinical-touch interaction.
 *
 * The clip `openclinxr_role_patient_guard_withdraw` is a 3-keyframe upper-body flinch:
 * neutral -> guard peak (torso recoil + protective right hand toward chest + chin tuck)
 * -> settle back toward neutral. The runtime plays it once when the examinee touches a
 * guarding region (see apps/ui-xr/src/main.ts handleClinicalTouch).
 *
 * notEvidenceFor: clinical_validity / biomechanical_validity / production_animation_quality.
 *
 * Run: tsx tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts \
 *   --input apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb
 */

import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Accessor, NodeIO } from "@gltf-transform/core";

const ANIMATION_NAME = "openclinxr_role_patient_guard_withdraw";
const DEFAULT_INPUT =
  "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb";
const KEYFRAME_TIMES = [0.0, 0.32, 0.9]; // neutral -> guard peak -> settle

type PoseTrack = { nodeNames: string[]; eulerFrames: { x: number; y: number; z: number }[] };

// Right-side protective flinch for a chest_R / abdomen guard: torso recoils, chin tucks,
// right arm draws the hand up toward the chest, then relaxes most of the way back.
const GUARD_WITHDRAW: PoseTrack[] = [
  { nodeNames: ["spine"], eulerFrames: [z0(), { x: -0.14, y: 0.06, z: 0.0 }, { x: -0.04, y: 0.02, z: 0.0 }] },
  { nodeNames: ["chest"], eulerFrames: [z0(), { x: -0.16, y: 0.08, z: 0.0 }, { x: -0.05, y: 0.02, z: 0.0 }] },
  { nodeNames: ["head"], eulerFrames: [z0(), { x: 0.14, y: -0.06, z: 0.0 }, { x: 0.04, y: -0.02, z: 0.0 }] },
  { nodeNames: ["clavicle.R", "clavicleR"], eulerFrames: [z0(), { x: -0.1, y: 0.0, z: -0.18 }, { x: -0.03, y: 0.0, z: -0.05 }] },
  { nodeNames: ["upper_arm.R", "upper_armR"], eulerFrames: [z0(), { x: -0.55, y: 0.25, z: 0.55 }, { x: -0.12, y: 0.06, z: 0.12 }] },
  { nodeNames: ["forearm.R", "forearmR"], eulerFrames: [z0(), { x: -0.9, y: 0.0, z: 0.15 }, { x: -0.2, y: 0.0, z: 0.04 }] },
  { nodeNames: ["hand.R", "handR"], eulerFrames: [z0(), { x: -0.2, y: 0.1, z: 0.1 }, { x: -0.05, y: 0.02, z: 0.02 }] },
  { nodeNames: ["upper_arm.L", "upper_armL"], eulerFrames: [z0(), { x: -0.2, y: -0.08, z: -0.15 }, { x: -0.05, y: -0.02, z: -0.04 }] },
];

function z0() {
  return { x: 0, y: 0, z: 0 };
}

type CliOptions = { inputPath: string; outputPath: string; backupPath: string; reportPath: string };

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    inputPath: DEFAULT_INPUT,
    outputPath: DEFAULT_INPUT,
    backupPath: `.openclinxr/asset-production/realism-backups/${path.basename(DEFAULT_INPUT, ".glb")}-pre-guard-withdraw-${new Date().toISOString().slice(0, 10)}.glb`,
    reportPath: `docs/openclinxr/materialize-guard-withdraw-clip-${new Date().toISOString().slice(0, 10)}.json`,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input") opts.inputPath = args[++i]!;
    else if (a === "--output") opts.outputPath = args[++i]!;
    else if (a === "--backup") opts.backupPath = args[++i]!;
    else if (a === "--report") opts.reportPath = args[++i]!;
  }
  if (opts.outputPath === DEFAULT_INPUT && opts.inputPath !== DEFAULT_INPUT) opts.outputPath = opts.inputPath;
  return opts;
}

function eulerXyzToQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(path.dirname(opts.backupPath), { recursive: true });
  await cp(opts.inputPath, opts.backupPath);

  const io = new NodeIO();
  const document = await io.read(opts.inputPath);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer("guard_withdraw_buffer");
  const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));

  for (const existing of root.listAnimations().filter((a) => a.getName() === ANIMATION_NAME)) existing.dispose();

  const times = document.createAccessor(`${ANIMATION_NAME}_times`)
    .setArray(new Float32Array(KEYFRAME_TIMES))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const animation = document.createAnimation(ANIMATION_NAME);
  const applied: string[] = [];
  const missing: string[] = [];

  for (const track of GUARD_WITHDRAW) {
    const nodeName = track.nodeNames.find((c) => nodesByName.has(c));
    const node = nodeName ? nodesByName.get(nodeName) : undefined;
    if (!nodeName || !node) {
      missing.push(track.nodeNames.join("|"));
      continue;
    }
    const quats = track.eulerFrames.flatMap((e) => eulerXyzToQuaternion(e.x, e.y, e.z));
    const out = document.createAccessor(`${ANIMATION_NAME}_${nodeName}_rot`)
      .setArray(new Float32Array(quats))
      .setType(Accessor.Type.VEC4)
      .setBuffer(buffer);
    const sampler = document.createAnimationSampler(`${ANIMATION_NAME}_${nodeName}_sampler`)
      .setInput(times)
      .setOutput(out)
      .setInterpolation("LINEAR");
    const channel = document.createAnimationChannel(`${ANIMATION_NAME}_${nodeName}_channel`)
      .setSampler(sampler)
      .setTargetNode(node)
      .setTargetPath("rotation");
    animation.addSampler(sampler);
    animation.addChannel(channel);
    applied.push(nodeName);
  }

  if (applied.length === 0) throw new Error(`No target nodes found in ${opts.inputPath} — clip not injected.`);

  await io.write(opts.outputPath, document);
  const report = {
    schemaVersion: "openclinxr.materialize-guard-withdraw-clip.v1",
    generatedAt: new Date().toISOString(),
    animationName: ANIMATION_NAME,
    inputPath: opts.inputPath,
    outputPath: opts.outputPath,
    backupPath: opts.backupPath,
    keyframeTimes: KEYFRAME_TIMES,
    appliedNodeCount: applied.length,
    appliedNodes: applied,
    missingNodes: missing,
    claimScope: "animation_interaction_response_not_clinical_validity",
    notEvidenceFor: ["clinical_validity", "biomechanical_validity", "production_animation_quality", "quest_readiness"],
  };
  await mkdir(path.dirname(opts.reportPath), { recursive: true });
  await writeFile(opts.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Injected ${ANIMATION_NAME} (${applied.length} nodes) into ${opts.outputPath}`);
  console.log(`Wrote ${opts.reportPath}`);
}

await main();
