import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Accessor, NodeIO } from "@gltf-transform/core";

const defaultInputPath = "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb";
const defaultOutputPath = defaultInputPath;
const defaultBackupPath = ".openclinxr/asset-production/realism-backups/neutral-generated-human-pre-clinical-idle-pose-2026-05-23.glb";
const defaultReportPath = "docs/openclinxr/materialize-clinical-idle-pose-clip-2026-05-23.json";

type CliOptions = {
  inputPath: string;
  outputPath: string;
  backupPath: string;
  reportPath: string;
};

type PoseRotation = {
  nodeNames: string[];
  eulerRadians: { x: number; y: number; z: number };
};

const clinicalConversationPose: PoseRotation[] = [
  { nodeNames: ["head"], eulerRadians: { x: -0.035, y: 0, z: 0 } },
  { nodeNames: ["upper_arm.L", "upper_armL"], eulerRadians: { x: -0.34, y: 0.08, z: -0.18 } },
  { nodeNames: ["forearm.L", "forearmL"], eulerRadians: { x: -0.24, y: -0.12, z: 0.22 } },
  { nodeNames: ["hand.L", "handL"], eulerRadians: { x: 0.06, y: 0.08, z: -0.08 } },
  { nodeNames: ["upper_arm.R", "upper_armR"], eulerRadians: { x: -0.34, y: -0.08, z: 0.18 } },
  { nodeNames: ["forearm.R", "forearmR"], eulerRadians: { x: -0.24, y: 0.12, z: -0.22 } },
  { nodeNames: ["hand.R", "handR"], eulerRadians: { x: 0.06, y: -0.08, z: 0.08 } },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await materializeClinicalIdlePoseClip(options);
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.reportPath}`);
}

async function materializeClinicalIdlePoseClip(options: CliOptions): Promise<Record<string, unknown>> {
  await mkdir(path.dirname(options.backupPath), { recursive: true });
  await cp(options.inputPath, options.backupPath);

  const io = new NodeIO();
  const document = await io.read(options.inputPath);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer("clinical_idle_pose_buffer");
  const nodesByName = new Map(root.listNodes().map((node) => [node.getName(), node]));
  const animationName = "clinical_idle_conversation_pose";
  for (const existing of root.listAnimations().filter((animation) => animation.getName() === animationName)) {
    existing.dispose();
  }

  const inputAccessor = document.createAccessor(`${animationName}_times`)
    .setArray(new Float32Array([0, 1.6]))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const animation = document.createAnimation(animationName);
  const applied: string[] = [];
  const missing: string[] = [];
  for (const pose of clinicalConversationPose) {
    const nodeName = pose.nodeNames.find((candidate) => nodesByName.has(candidate));
    const node = nodeName ? nodesByName.get(nodeName) : undefined;
    if (!nodeName || !node) {
      missing.push(pose.nodeNames.join("|"));
      continue;
    }
    const quaternion = eulerXyzToQuaternion(pose.eulerRadians.x, pose.eulerRadians.y, pose.eulerRadians.z);
    const outputAccessor = document.createAccessor(`${animationName}_${nodeName}_rotation`)
      .setArray(new Float32Array([...quaternion, ...quaternion]))
      .setType(Accessor.Type.VEC4)
      .setBuffer(buffer);
    const sampler = document.createAnimationSampler(`${animationName}_${nodeName}_sampler`)
      .setInput(inputAccessor)
      .setOutput(outputAccessor)
      .setInterpolation("LINEAR");
    const channel = document.createAnimationChannel(`${animationName}_${nodeName}_channel`)
      .setSampler(sampler)
      .setTargetNode(node)
      .setTargetPath("rotation");
    animation.addSampler(sampler);
    animation.addChannel(channel);
    node.setExtras({
      ...node.getExtras(),
      openClinXrClinicalIdlePoseClip: animationName,
    });
    applied.push(nodeName);
  }

  await io.write(options.outputPath, document);
  return {
    schemaVersion: "openclinxr.materialize-clinical-idle-pose-clip.v1",
    generatedAt: new Date().toISOString(),
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    backupPath: options.backupPath,
    animationName,
    appliedNodeCount: applied.length,
    appliedNodes: applied,
    missingNodes: missing,
    claimBoundaries: {
      notEvidenceFor: ["production_animation_quality", "biomechanical_validity", "quest_readiness", "clinical_validity"],
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
    if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--backup") options.backupPath = requireNext(args, ++index, arg);
    else if (arg === "--report") options.reportPath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

await main();
