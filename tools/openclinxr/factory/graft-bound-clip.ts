import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import type { Accessor, Animation, Document, Node as GltfNode } from "@gltf-transform/core";

/**
 * Graft one animation clip from a bound GLB into a shipped GLB, by joint NAME.
 *
 * WHY THIS EXISTS, measured 2026-09-09. `motion_bind_stage.py` imports the shipped actor into
 * Blender, retargets a BVH onto it and re-exports the whole actor. The clip it produces is correct
 * and the round trip is not: comparing the re-export against the shipped physician, the eyebrow mesh
 * loses 1,035 triangles (16% of its surface area) and the eyelash mesh loses 118 (28%). Neither loss
 * is degenerate-face cleanup — both meshes report zero zero-area triangles before and after, so real
 * surface is gone. Publishing that re-export over the shipped actor would ship a face that has lost
 * its eyebrows to gain a walk.
 *
 * The clip does not need the round trip. It is animation data addressed to joints that already
 * exist in the shipped file, so grafting it leaves every mesh, material, texture and skin byte
 * untouched. Verified before writing this: the bound rig's 137 animated joints are ALL present in
 * the shipped rig with identical parent chains, and every channel carries absolute local TRS, so a
 * joint's rest transform cannot change the result.
 *
 * IT REFUSES rather than dropping a channel it cannot place. A graft that silently skipped an
 * unresolvable joint would produce a clip missing exactly the bones nobody checked.
 */

export type ClipGraftReport = {
  schemaVersion: "openclinxr.clip-graft.v1";
  generatedAt: string;
  clipName: string;
  target: { path: string; sha256Before: string; bytesBefore: number };
  source: { path: string; sha256: string; bytes: number };
  output: { path: string; sha256: string; bytes: number };
  graftedChannels: number;
  graftedJoints: number;
  animationsAfter: string[];
  /** Proof the graft touched nothing but the animation list. */
  geometryParity: {
    primitives: number;
    trianglesBefore: number;
    trianglesAfter: number;
    positionBytesIdentical: boolean;
  };
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function meshStats(document: Document): { primitives: number; triangles: number; positionDigest: string } {
  const hash = createHash("sha256");
  let primitives = 0;
  let triangles = 0;
  for (const mesh of [...document.getRoot().listMeshes()].sort((a, b) => (a.getName() < b.getName() ? -1 : 1))) {
    for (const primitive of mesh.listPrimitives()) {
      primitives += 1;
      triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      const position = primitive.getAttribute("POSITION")?.getArray();
      if (position) hash.update(new Uint8Array(position.buffer, position.byteOffset, position.byteLength));
    }
  }
  return { primitives, triangles, positionDigest: hash.digest("hex") };
}

function copyAccessor(target: Document, source: Accessor, name: string): Accessor {
  const array = source.getArray();
  if (!array) throw new Error(`graftBoundClip: accessor ${source.getName()} has no array to copy.`);
  return target
    .createAccessor(name)
    .setType(source.getType())
    .setArray(array.slice() as typeof array)
    .setBuffer(target.getRoot().listBuffers()[0] ?? target.createBuffer());
}

function graftAnimation(target: Document, sourceAnimation: Animation, clipName: string): {
  channels: number;
  joints: number;
} {
  const targetNodes = new Map<string, GltfNode>();
  for (const node of target.getRoot().listNodes()) targetNodes.set(node.getName(), node);

  const unresolvable: string[] = [];
  for (const channel of sourceAnimation.listChannels()) {
    const name = channel.getTargetNode()?.getName();
    if (!name || !targetNodes.has(name)) unresolvable.push(name ?? "(unnamed)");
  }
  if (unresolvable.length > 0) {
    throw new Error(
      `graftBoundClip: refused — ${unresolvable.length} channel target(s) do not exist in the target rig: ${[...new Set(unresolvable)].join(", ")}. Dropping them would produce a clip missing exactly the joints nobody checked.`,
    );
  }

  const animation = target.createAnimation(clipName);
  const samplerCopies = new Map<object, ReturnType<Document["createAnimationSampler"]>>();
  const joints = new Set<string>();
  let channels = 0;

  for (const channel of sourceAnimation.listChannels()) {
    const sourceSampler = channel.getSampler();
    const node = targetNodes.get(channel.getTargetNode()!.getName())!;
    if (!sourceSampler) continue;
    let sampler = samplerCopies.get(sourceSampler);
    if (!sampler) {
      sampler = target
        .createAnimationSampler()
        .setInput(copyAccessor(target, sourceSampler.getInput()!, `${clipName}_in`))
        .setOutput(copyAccessor(target, sourceSampler.getOutput()!, `${clipName}_out`))
        .setInterpolation(sourceSampler.getInterpolation());
      samplerCopies.set(sourceSampler, sampler);
      animation.addSampler(sampler);
    }
    animation.addChannel(
      target
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath(channel.getTargetPath()!)
        .setSampler(sampler),
    );
    joints.add(node.getName());
    channels += 1;
  }
  return { channels, joints: joints.size };
}

export async function graftBoundClip(input: {
  targetPath: string;
  sourcePath: string;
  clipName: string;
  outputPath: string;
}): Promise<ClipGraftReport> {
  const io = new NodeIO();
  const targetBytes = await readFile(input.targetPath);
  const sourceBytes = await readFile(input.sourcePath);
  const target = await io.read(input.targetPath);
  const source = await io.read(input.sourcePath);

  if (target.getRoot().listAnimations().some((animation) => animation.getName() === input.clipName)) {
    throw new Error(
      `graftBoundClip: refused — ${input.targetPath} already carries a clip named ${input.clipName}. Grafting a second copy would leave two clips of the same name and no way for a consumer to say which it played.`,
    );
  }
  const sourceAnimation = source
    .getRoot()
    .listAnimations()
    .find((animation) => animation.getName() === input.clipName);
  if (!sourceAnimation) {
    throw new Error(
      `graftBoundClip: ${input.sourcePath} has no clip named ${input.clipName}. Present: ${source
        .getRoot()
        .listAnimations()
        .map((animation) => animation.getName())
        .join(", ")}`,
    );
  }

  const before = meshStats(target);
  const { channels, joints } = graftAnimation(target, sourceAnimation, input.clipName);
  const after = meshStats(target);
  if (before.primitives !== after.primitives || before.triangles !== after.triangles) {
    throw new Error(
      `graftBoundClip: refused — grafting changed geometry (${before.triangles} -> ${after.triangles} triangles). The graft must touch nothing but the animation list.`,
    );
  }

  await io.write(input.outputPath, target);
  const outputBytes = await readFile(input.outputPath);

  return {
    schemaVersion: "openclinxr.clip-graft.v1",
    generatedAt: new Date().toISOString(),
    clipName: input.clipName,
    target: { path: input.targetPath, sha256Before: sha256(targetBytes), bytesBefore: targetBytes.byteLength },
    source: { path: input.sourcePath, sha256: sha256(sourceBytes), bytes: sourceBytes.byteLength },
    output: { path: input.outputPath, sha256: sha256(outputBytes), bytes: outputBytes.byteLength },
    graftedChannels: channels,
    graftedJoints: joints,
    animationsAfter: target.getRoot().listAnimations().map((animation) => animation.getName()),
    geometryParity: {
      primitives: after.primitives,
      trianglesBefore: before.triangles,
      trianglesAfter: after.triangles,
      positionBytesIdentical: before.positionDigest === after.positionDigest,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const report = await graftBoundClip({
    targetPath: flagValue("--target", "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb"),
    sourcePath: flagValue("--source", ".openclinxr/evidence/walk-bind/physician-walk.glb"),
    clipName: flagValue("--clip", "openclinxr_retarget_cmu_02_01_walk"),
    outputPath: flagValue("--output", ".openclinxr/evidence/walk-bind/physician-grafted.glb"),
  });
  const reportPath = flagValue("--report", "docs/openclinxr/evidence/physician-walk-clip-graft.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

if (process.argv[1]?.endsWith("graft-bound-clip.ts")) await main();
