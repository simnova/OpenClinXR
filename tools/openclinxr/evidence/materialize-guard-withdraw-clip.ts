/**
 * materialize-guard-withdraw-clip.ts — inject a LoopOnce guard/withdraw flinch clip
 * into a patient GLB (no Blender), for the animation-driven clinical-touch interaction.
 *
 * The clip `openclinxr_role_patient_guard_withdraw_rlq` is a short 3-keyframe upper-body
 * flinch: neutral -> guard peak (torso recoil + protective hand toward abdomen/RLQ +
 * head dip) -> settle. Runtime plays it once on examinee touch of a guarding region.
 *
 * notEvidenceFor: clinical_validity / biomechanical_validity / production_animation_quality.
 *
 * Run: tsx tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts \
 *   --glb <in.glb> --out <out.glb>
 * Aliases: --input/--output also accepted.
 */

import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Accessor, NodeIO } from "@gltf-transform/core";

const ANIMATION_NAME = "openclinxr_role_patient_guard_withdraw_rlq";
/** Legacy clip name disposed on inject so renames do not leave dual clips. */
const LEGACY_ANIMATION_NAME = "openclinxr_role_patient_guard_withdraw";

const defaultInputPath =
  "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb";
const defaultOutputPath = defaultInputPath;
const defaultBackupPath =
  ".openclinxr/asset-production/realism-backups/patient-pre-guard-withdraw-rlq.glb";
// Registered generated-artifact path (do not invent new docs/openclinxr filenames).
const defaultReportPath = "docs/openclinxr/materialize-guard-withdraw-clip-2026-08-03.json";

/** Keyframe times (seconds): neutral -> guard peak -> settle. LoopOnce short flinch. */
const KEYFRAME_TIMES = [0.0, 0.28, 0.85];

type CliOptions = {
  inputPath: string;
  outputPath: string;
  backupPath: string;
  reportPath: string;
};

type PoseTrack = {
  nodeNames: string[];
  eulerFrames: { x: number; y: number; z: number }[];
};

function z0(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

/**
 * RLQ guard/withdraw: torso recoils, head dips, right hand protects abdomen/RLQ,
 * left arm lightly braces. Alternate bone names without dots accepted.
 */
const guardWithdrawRlq: PoseTrack[] = [
  {
    nodeNames: ["spine"],
    eulerFrames: [z0(), { x: -0.12, y: 0.08, z: 0.04 }, { x: -0.03, y: 0.02, z: 0.01 }],
  },
  {
    nodeNames: ["chest"],
    eulerFrames: [z0(), { x: -0.14, y: 0.1, z: 0.05 }, { x: -0.04, y: 0.03, z: 0.01 }],
  },
  {
    nodeNames: ["head"],
    eulerFrames: [z0(), { x: 0.18, y: -0.08, z: 0.0 }, { x: 0.05, y: -0.02, z: 0.0 }],
  },
  {
    nodeNames: ["upper_arm.L", "upper_armL"],
    eulerFrames: [z0(), { x: -0.18, y: -0.1, z: -0.12 }, { x: -0.05, y: -0.03, z: -0.03 }],
  },
  {
    nodeNames: ["upper_arm.R", "upper_armR"],
    // Right upper arm draws hand toward lower abdomen / RLQ
    eulerFrames: [z0(), { x: -0.72, y: 0.35, z: 0.62 }, { x: -0.18, y: 0.08, z: 0.14 }],
  },
  {
    nodeNames: ["forearm.L", "forearmL"],
    eulerFrames: [z0(), { x: -0.25, y: 0.0, z: 0.08 }, { x: -0.06, y: 0.0, z: 0.02 }],
  },
  {
    nodeNames: ["forearm.R", "forearmR"],
    // Strong flex so hand reaches RLQ/abdomen
    eulerFrames: [z0(), { x: -1.05, y: 0.05, z: 0.2 }, { x: -0.28, y: 0.02, z: 0.05 }],
  },
  {
    nodeNames: ["hand.L", "handL"],
    eulerFrames: [z0(), { x: 0.04, y: 0.04, z: -0.04 }, { x: 0.01, y: 0.01, z: -0.01 }],
  },
  {
    nodeNames: ["hand.R", "handR"],
    // Protective palm orientation toward abdomen/RLQ
    eulerFrames: [z0(), { x: -0.28, y: 0.18, z: 0.12 }, { x: -0.07, y: 0.04, z: 0.03 }],
  },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await materializeGuardWithdrawClip(options);
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Injected ${ANIMATION_NAME} (${report.appliedNodeCount} nodes) into ${options.outputPath}`);
  console.log(`Wrote ${options.reportPath}`);
}

async function materializeGuardWithdrawClip(options: CliOptions): Promise<Record<string, unknown>> {
  await mkdir(path.dirname(options.backupPath), { recursive: true });
  await cp(options.inputPath, options.backupPath);

  const io = new NodeIO();
  const document = await io.read(options.inputPath);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer("guard_withdraw_rlq_buffer");
  const nodesByName = new Map(root.listNodes().map((node) => [node.getName(), node]));

  // Dispose target name and legacy name so renames do not leave dual clips.
  for (const existing of root.listAnimations().filter((animation) => {
    const name = animation.getName();
    return name === ANIMATION_NAME || name === LEGACY_ANIMATION_NAME;
  })) {
    existing.dispose();
  }

  const inputAccessor = document
    .createAccessor(`${ANIMATION_NAME}_times`)
    .setArray(new Float32Array(KEYFRAME_TIMES))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const animation = document.createAnimation(ANIMATION_NAME);
  const applied: string[] = [];
  const missing: string[] = [];

  for (const track of guardWithdrawRlq) {
    const nodeName = track.nodeNames.find((candidate) => nodesByName.has(candidate));
    const node = nodeName ? nodesByName.get(nodeName) : undefined;
    if (!nodeName || !node) {
      missing.push(track.nodeNames.join("|"));
      continue;
    }
    const quats = track.eulerFrames.flatMap((e) => eulerXyzToQuaternion(e.x, e.y, e.z));
    const outputAccessor = document
      .createAccessor(`${ANIMATION_NAME}_${nodeName}_rotation`)
      .setArray(new Float32Array(quats))
      .setType(Accessor.Type.VEC4)
      .setBuffer(buffer);
    const sampler = document
      .createAnimationSampler(`${ANIMATION_NAME}_${nodeName}_sampler`)
      .setInput(inputAccessor)
      .setOutput(outputAccessor)
      .setInterpolation("LINEAR");
    const channel = document
      .createAnimationChannel(`${ANIMATION_NAME}_${nodeName}_channel`)
      .setSampler(sampler)
      .setTargetNode(node)
      .setTargetPath("rotation");
    animation.addSampler(sampler);
    animation.addChannel(channel);
    node.setExtras({
      ...node.getExtras(),
      openClinXrGuardWithdrawClip: ANIMATION_NAME,
    });
    applied.push(nodeName);
  }

  if (applied.length === 0) {
    throw new Error(
      `No target nodes found in ${options.inputPath} — clip ${ANIMATION_NAME} not injected. ` +
        `Missing: ${missing.join(", ")}`,
    );
  }

  await io.write(options.outputPath, document);

  // Verify clip present after injection (re-read output).
  const verifyDoc = await io.read(options.outputPath);
  const verified = verifyDoc
    .getRoot()
    .listAnimations()
    .some((a) => a.getName() === ANIMATION_NAME);
  if (!verified) {
    throw new Error(
      `Verification failed: animation "${ANIMATION_NAME}" missing from ${options.outputPath} after write.`,
    );
  }
  // Ensure legacy name is not left behind.
  const legacyStillPresent = verifyDoc
    .getRoot()
    .listAnimations()
    .some((a) => a.getName() === LEGACY_ANIMATION_NAME);
  if (legacyStillPresent) {
    throw new Error(
      `Verification failed: legacy animation "${LEGACY_ANIMATION_NAME}" still present in ${options.outputPath}.`,
    );
  }

  return {
    schemaVersion: "openclinxr.materialize-guard-withdraw-clip.v1",
    generatedAt: new Date().toISOString(),
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    backupPath: options.backupPath,
    animationName: ANIMATION_NAME,
    legacyAnimationNameDisposed: LEGACY_ANIMATION_NAME,
    keyframeTimes: KEYFRAME_TIMES,
    appliedNodeCount: applied.length,
    appliedNodes: applied,
    missingNodes: missing,
    verified: true,
    claimBoundaries: {
      claimScope: "animation_interaction_response_not_clinical_validity",
      notEvidenceFor: [
        "clinical_validity",
        "biomechanical_validity",
        "production_animation_quality",
        "quest_readiness",
      ],
    },
  };
}

function eulerXyzToQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: defaultInputPath,
    outputPath: defaultOutputPath,
    backupPath: defaultBackupPath,
    reportPath: defaultReportPath,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--glb" || arg === "--input") {
      options.inputPath = requireNext(args, ++index, arg);
    } else if (arg === "--out" || arg === "--output") {
      options.outputPath = requireNext(args, ++index, arg);
    } else if (arg === "--backup") {
      options.backupPath = requireNext(args, ++index, arg);
    } else if (arg === "--report") {
      options.reportPath = requireNext(args, ++index, arg);
    }
  }
  // If only --glb/--input was set, default out to same path (in-place inject).
  if (options.outputPath === defaultOutputPath && options.inputPath !== defaultInputPath) {
    options.outputPath = options.inputPath;
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

await main();
