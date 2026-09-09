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
  /** Set when --publish moved the output over the target and rewrote its provenance record. */
  published: {
    assetPath: string;
    provenancePath: string;
    outputSha256: string;
    outputBytes: number;
  } | null;
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
  const samplerless: string[] = [];
  for (const channel of sourceAnimation.listChannels()) {
    const name = channel.getTargetNode()?.getName();
    if (!name || !targetNodes.has(name)) unresolvable.push(name ?? "(unnamed)");
    if (!channel.getSampler()) samplerless.push(name ?? "(unnamed)");
  }
  if (samplerless.length > 0) {
    throw new Error(
      `graftBoundClip: refused — ${samplerless.length} channel(s) carry no sampler: ${[...new Set(samplerless)].join(", ")}. Skipping them is the same silent drop this function refuses for an unresolvable joint.`,
    );
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
    // Both refusals above already ran, so neither of these can be missing here.
    const sourceSampler = channel.getSampler()!;
    const node = targetNodes.get(channel.getTargetNode()!.getName())!;
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
  /**
   * Move the output over the target and rewrite the target's provenance record from THIS run.
   *
   * Without it the provenance entry describing the clip is hand-authored, so it can name a frame
   * rate or a hash the pipeline never produced. Emitted here, the record cannot disagree with the
   * bytes it sits beside.
   */
  publish?: {
    provenancePath: string;
    /** A bound-clip foot-plant report, whose clip block is copied into the provenance entry. */
    footPlantReportPath?: string;
    sourceClipPath: string;
    licenceRecordPath: string;
    licenceStatus: string;
  };
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

  let published: ClipGraftReport["published"] = null;
  if (input.publish) {
    await writeFile(input.targetPath, outputBytes);
    const record = JSON.parse(await readFile(input.publish.provenancePath, "utf8"));
    const footPlant = input.publish.footPlantReportPath
      ? JSON.parse(await readFile(input.publish.footPlantReportPath, "utf8"))
      : null;
    record.outputSha256 = sha256(outputBytes);
    record.outputBytes = outputBytes.byteLength;
    record.animationMode = `${record.animationMode}`.includes("grafted")
      ? record.animationMode
      : `${record.animationMode}_plus_grafted_retargeted_clip`;
    const entry = {
      clipName: input.clipName,
      sourceClip: input.publish.sourceClipPath,
      // Copied from the measurement rather than restated, so the two cannot drift apart.
      ...(footPlant?.clip ?? {}),
      deliveredBy: "tools/openclinxr/factory/graft-bound-clip.ts",
      deliveryNote:
        "GRAFTED, not re-exported. motion_bind_stage.py's Blender round trip loses eyebrow and eyelash geometry; the graft copies channels onto joints already present here and leaves every POSITION accessor byte-identical.",
      graftedChannels: channels,
      graftedJoints: joints,
      licenceRow: input.publish.licenceRecordPath,
      licenceStatus: input.publish.licenceStatus,
      ...(input.publish.footPlantReportPath ? { footPlantEvidence: input.publish.footPlantReportPath } : {}),
      notEvidenceFor: ["clinical_gait_realism", "visual_walk_quality", "quest_readiness", "runtime_playback"],
    };
    const others = (record.motionClips ?? []).filter(
      (clip: { clipName?: string }) => clip.clipName !== input.clipName,
    );
    record.motionClips = [...others, entry];
    await writeFile(input.publish.provenancePath, `${JSON.stringify(record, null, 1)}\n`, "utf8");
    published = {
      assetPath: input.targetPath,
      provenancePath: input.publish.provenancePath,
      outputSha256: sha256(outputBytes),
      outputBytes: outputBytes.byteLength,
    };
  }

  return {
    schemaVersion: "openclinxr.clip-graft.v1",
    generatedAt: new Date().toISOString(),
    clipName: input.clipName,
    target: { path: input.targetPath, sha256Before: sha256(targetBytes), bytesBefore: targetBytes.byteLength },
    source: { path: input.sourcePath, sha256: sha256(sourceBytes), bytes: sourceBytes.byteLength },
    output: { path: input.outputPath, sha256: sha256(outputBytes), bytes: outputBytes.byteLength },
    graftedChannels: channels,
    graftedJoints: joints,
    published,
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
  const targetPath = flagValue("--target", "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
  const report = await graftBoundClip({
    targetPath,
    sourcePath: flagValue("--source", ".openclinxr/evidence/walk-bind/physician-walk.glb"),
    clipName: flagValue("--clip", "openclinxr_retarget_cmu_02_01_walk"),
    outputPath: flagValue("--output", ".openclinxr/evidence/walk-bind/physician-grafted.glb"),
    ...(args.includes("--publish")
      ? {
          publish: {
            provenancePath: targetPath.replace(/\.glb$/u, ".provenance.json"),
            footPlantReportPath: flagValue("--foot-plant-report", "docs/openclinxr/evidence/bound-clip-foot-plant.json"),
            sourceClipPath: flagValue(
              "--source-clip",
              "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_02_01_walk.bvh",
            ),
            licenceRecordPath: "docs/openclinxr/asset-licence-records/row-08-cmu-graphics-lab-mocap.json",
            licenceStatus:
              "CONDITIONAL - not CC0/CC-BY. Free for research and commercial products; the data may not be resold even converted.",
          },
        }
      : {}),
  });
  const reportPath = flagValue("--report", "docs/openclinxr/evidence/physician-walk-clip-graft.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

if (process.argv[1]?.endsWith("graft-bound-clip.ts")) await main();
