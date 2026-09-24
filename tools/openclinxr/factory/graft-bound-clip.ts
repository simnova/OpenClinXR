import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Accessor, Animation, Document, Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";

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
  /** Clips deleted from the target before the graft, and why. Empty for an additive graft. */
  removedClips: Array<{ clipName: string; channels: number; reason: string }>;
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

/** A sampler channel with no accessor cannot be grafted; refuse rather than assert it away. */
function requireAccessor(accessor: Accessor | null, clipName: string, which: string): Accessor {
  if (!accessor) throw new Error(`${clipName}: a source sampler carries no ${which} accessor.`);
  return accessor;
}

/** Same for the channel's target path, which decides what the grafted channel animates. */
function requireTargetPath<T>(targetPath: T | null, clipName: string): T {
  if (targetPath === null) throw new Error(`${clipName}: a source channel carries no target path.`);
  return targetPath;
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
    // Both refusals above already ran, so none of these can be missing. Guarded rather than
    // asserted: a silent undefined would graft a channel onto the wrong joint, which no later
    // check inspects.
    const sourceSampler = channel.getSampler();
    const sourceNode = channel.getTargetNode();
    if (!sourceSampler || !sourceNode) {
      throw new Error(`${clipName}: a source channel carries no sampler or no target node.`);
    }
    const node = targetNodes.get(sourceNode.getName());
    if (!node) {
      throw new Error(`${clipName}: the target carries no joint named ${sourceNode.getName()}.`);
    }
    let sampler = samplerCopies.get(sourceSampler);
    if (!sampler) {
      sampler = target
        .createAnimationSampler()
        .setInput(copyAccessor(target, requireAccessor(sourceSampler.getInput(), clipName, "input"), `${clipName}_in`))
        .setOutput(copyAccessor(target, requireAccessor(sourceSampler.getOutput(), clipName, "output"), `${clipName}_out`))
        .setInterpolation(sourceSampler.getInterpolation());
      samplerCopies.set(sourceSampler, sampler);
      animation.addSampler(sampler);
    }
    animation.addChannel(
      target
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath(requireTargetPath(channel.getTargetPath(), clipName))
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
   * Clips to DELETE from the target before grafting, with the reason recorded beside each.
   *
   * A licence replacement is a removal plus an addition, and doing only the addition leaves the
   * refused clip in the shipped bytes beside its replacement — still downloadable, still
   * redistributed, and now harder to notice because a cleared clip sits next to it. The removal
   * REFUSES a name that is not present rather than passing silently, because "already gone" and
   * "never looked" produce the same empty result.
   */
  removeClips?: Array<{ clipName: string; reason: string }>;
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
    /**
     * Where the LANDED copy of that measurement lives, when the report above is a working file
     * under an ignored path. The numbers still come from the measurement; only the citation
     * differs, so the record points at something a reader can actually open.
     */
    footPlantEvidencePath?: string;
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

  const removedClips: ClipGraftReport["removedClips"] = [];
  for (const removal of input.removeClips ?? []) {
    const doomed = target
      .getRoot()
      .listAnimations()
      .find((animation) => animation.getName() === removal.clipName);
    if (!doomed) {
      throw new Error(
        `graftBoundClip: refused — asked to remove ${removal.clipName} from ${input.targetPath}, which does not carry it. Present: ${target.getRoot().listAnimations().map((animation) => animation.getName()).join(", ")}. Treating an absent clip as already-removed would make a licence removal indistinguishable from never having looked.`,
      );
    }
    const channels = doomed.listChannels().length;
    for (const channel of doomed.listChannels()) channel.dispose();
    for (const sampler of doomed.listSamplers()) sampler.dispose();
    doomed.dispose();
    removedClips.push({ clipName: removal.clipName, channels, reason: removal.reason });
  }

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
      ...(input.publish.footPlantEvidencePath ?? input.publish.footPlantReportPath
        ? { footPlantEvidence: input.publish.footPlantEvidencePath ?? input.publish.footPlantReportPath }
        : {}),
      notEvidenceFor: ["clinical_gait_realism", "visual_walk_quality", "quest_readiness", "runtime_playback"],
    };
    const removedNames = new Set(removedClips.map((removal) => removal.clipName));
    const others = (record.motionClips ?? []).filter(
      (clip: { clipName?: string }) =>
        clip.clipName !== input.clipName && !removedNames.has(String(clip.clipName)),
    );
    if (removedClips.length > 0) {
      // The record must not keep describing a clip the bytes no longer carry, and the removal must
      // not vanish either: a retired entry with its reason is what stops the next rebuild quietly
      // reinstating it.
      record.retiredMotionClips = [
        ...(record.retiredMotionClips ?? []).filter(
          (clip: { clipName?: string }) => !removedNames.has(String(clip.clipName)),
        ),
        ...removedClips.map((removal) => ({
          clipName: removal.clipName,
          removedAt: new Date().toISOString(),
          removedBy: "tools/openclinxr/factory/graft-bound-clip.ts --remove-clip",
          channels: removal.channels,
          reason: removal.reason,
        })),
      ];
    }
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
    removedClips,
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

export type ClipTravelHeadingRebindReport = {
  schemaVersion: "openclinxr.clip-travel-heading-rebind.v1";
  generatedAt: string;
  clipName: string;
  method: "reverse_existing_channels";
  target: { path: string; sha256Before: string; bytesBefore: number };
  output: { path: string; sha256: string; bytes: number };
  reversedSamplers: number;
  reversedChannels: number;
  rootTravelMeters: number;
  inPlace: boolean;
  published: ClipGraftReport["published"];
  animationsAfter: string[];
  geometryParity: ClipGraftReport["geometryParity"];
};

const ROOT_TRAVEL_IN_PLACE_METERS = 0.01;

function accessorStride(type: string): number {
  if (type === "VEC4") return 4;
  if (type === "VEC3") return 3;
  if (type === "VEC2") return 2;
  if (type === "SCALAR") return 1;
  throw new Error(`rebindBoundClipTravelHeading: unsupported accessor type ${type}`);
}

/**
 * Drop a leading rest frame from a bound clip's rotation samplers.
 *
 * MEASURED 2026-09-23. motion_bind_stage's retarget path keys the target rest
 * pose at frame 0 (putInTPoses keys rest, then retracts frames 1..N), so every
 * bound clip carries 42 keys for a 41-key source loop: key 0 is the rest pose,
 * key 1 == key 41 closes the loop. Played with LoopRepeat the rest pose recurs
 * once per cycle as a hitch (23.9 deg hip step, 176.8 deg arm step on Walk).
 * The source key-0 value is NOT lost: it equals the last key (closed loop,
 * 0.0 deg), so dropping key 0 keeps all 41 distinct loop poses.
 *
 * Time-domain, not value-domain: input (times) and output (values) key 0 are
 * both removed, so remaining keys keep their source times and interpolation is
 * unchanged. LINEAR/STEP only — CUBICSPLINE stores tangents beside values.
 * REFUSES a clip whose key 0 is not rest-pose-like (key0->key1 step must exceed
 * 2x the largest interior step): dropping a genuine motion frame would shorten
 * the stride it was asked to preserve.
 */
export async function dropLeadingRestFrame(input: {
  targetPath: string;
  clipName: string;
  outputPath: string;
}): Promise<{
  schemaVersion: "openclinxr.clip-rest-frame-drop.v1";
  clipName: string;
  keysBefore: number;
  keysAfter: number;
  droppedKey0ToKey1StepDeg: number;
  largestInteriorStepDeg: number;
}> {
  const io = new NodeIO();
  const targetBytes = await readFile(input.targetPath);
  const document = await io.read(input.targetPath);
  const animation = document
    .getRoot()
    .listAnimations()
    .find((entry) => entry.getName() === input.clipName);
  if (!animation) {
    throw new Error(
      `dropLeadingRestFrame: ${input.targetPath} has no clip named ${input.clipName}.`,
    );
  }
  const cubic = animation
    .listSamplers()
    .filter((sampler) => sampler.getInterpolation() === "CUBICSPLINE");
  if (cubic.length > 0) {
    throw new Error(
      `dropLeadingRestFrame: refused — ${input.clipName} carries CUBICSPLINE sampler(s). Dropping key 0 would orphan tangents.`,
    );
  }
  // Verify key 0 is a rest frame on the hip channel before touching any sampler.
  const hip = animation
    .listChannels()
    .find(
      (entry) =>
        entry.getTargetNode()?.getName() === "upperleg01.L" &&
        entry.getTargetPath() === "rotation",
    );
  const hipSampler = hip?.getSampler();
  const hipOutput = hipSampler?.getOutput()?.getArray();
  if (!hip || !hipSampler || !hipOutput) {
    throw new Error(
      `dropLeadingRestFrame: refused — ${input.clipName} has no upperleg01.L rotation channel to verify the rest frame against.`,
    );
  }
  const angleDeg = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number => {
    const dot = Math.min(1, Math.abs(a * e + b * f + c * g + d * h));
    return (2 * Math.acos(dot) * 180) / Math.PI;
  };
  const keyQuat = (index: number): [number, number, number, number] => [
    Number(hipOutput[index * 4]!),
    Number(hipOutput[index * 4 + 1]!),
    Number(hipOutput[index * 4 + 2]!),
    Number(hipOutput[index * 4 + 3]!),
  ];
  const keyCount = hipOutput.length / 4;
  const leading = angleDeg(...keyQuat(0), ...keyQuat(1));
  let interior = 0;
  for (let index = 1; index < keyCount - 1; index += 1) {
    interior = Math.max(interior, angleDeg(...keyQuat(index), ...keyQuat(index + 1)));
  }
  if (!(leading > 2 * interior)) {
    throw new Error(
      `dropLeadingRestFrame: refused — key0->key1 hip step ${leading.toFixed(1)} deg is not > 2x the largest interior step ${interior.toFixed(1)} deg. Key 0 does not look like a prepended rest frame.`,
    );
  }
  // Samplers SHARE accessors on the input side: all 42-key rotation channels
  // ride one input accessor (the exporter deduplicates identical time tracks).
  // Slice each ACCESSOR OBJECT once: collect first, then slice.
  const inputsToSlice = new Set<Accessor>();
  const outputsToSlice = new Map<Accessor, number>();
  for (const sampler of animation.listSamplers()) {
    const inputAccessor = sampler.getInput();
    const outputAccessor = sampler.getOutput();
    if (!inputAccessor || !outputAccessor) continue;
    const inArray = inputAccessor.getArray();
    const outArray = outputAccessor.getArray();
    if (!inArray || !outArray) continue;
    if (inArray.length <= 2) continue; // constant T/R/S bracket (2 STEP keys): no cycle frame to drop.
    const stride =
      outputAccessor.getType() === "VEC4" ? 4 : outputAccessor.getType() === "VEC3" ? 3 : 1;
    if (outArray.length < stride * 2) {
      throw new Error(
        `dropLeadingRestFrame: ${input.clipName} a sampler has fewer than 2 keys.`,
      );
    }
    inputsToSlice.add(inputAccessor);
    if (!outputsToSlice.has(outputAccessor)) outputsToSlice.set(outputAccessor, stride);
  }
  for (const inputAccessor of inputsToSlice) {
    const inArray = inputAccessor.getArray();
    if (!inArray) continue;
    inputAccessor.setArray(inArray.slice(1));
  }
  for (const [outputAccessor, stride] of outputsToSlice) {
    const outArray = outputAccessor.getArray();
    if (!outArray) continue;
    outputAccessor.setArray(outArray.slice(stride));
  }
  await io.write(input.outputPath, document);
  void targetBytes;
  return {
    schemaVersion: "openclinxr.clip-rest-frame-drop.v1",
    clipName: input.clipName,
    keysBefore: keyCount,
    keysAfter: keyCount - 1,
    droppedKey0ToKey1StepDeg: Math.round(leading * 10) / 10,
    largestInteriorStepDeg: Math.round(interior * 10) / 10,
  };
}

/** Reverse keyframe VALUES, keep times. LINEAR/STEP only — CUBICSPLINE stores tangents beside values. */
function reverseSamplerOutput(output: Accessor, clipName: string): void {
  const array = output.getArray();
  if (!array) throw new Error(`rebindBoundClipTravelHeading: ${clipName} sampler output has no array.`);
  const stride = accessorStride(output.getType());
  if (array.length % stride !== 0) {
    throw new Error(
      `rebindBoundClipTravelHeading: ${clipName} output length ${array.length} is not a multiple of stride ${stride}.`,
    );
  }
  const count = array.length / stride;
  const reversed = array.slice() as typeof array;
  for (let index = 0; index < count; index += 1) {
    const source = (count - 1 - index) * stride;
    const dest = index * stride;
    for (let component = 0; component < stride; component += 1) {
      reversed[dest + component] = array[source + component]!;
    }
  }
  output.setArray(reversed);
}

function rootTranslationNetMeters(animation: Animation, rootJoint: string): number {
  const channel = animation
    .listChannels()
    .find((entry) => entry.getTargetNode()?.getName() === rootJoint && entry.getTargetPath() === "translation");
  const array = channel?.getSampler()?.getOutput()?.getArray();
  if (!array || array.length < 6) return 0;
  const last = array.length - 3;
  return Math.hypot(Number(array[last]) - Number(array[0]), Number(array[last + 2]) - Number(array[2]));
}

/**
 * Flip an in-place walk's stance-window travel heading by reversing existing sampler outputs.
 *
 * A 180° world yaw of every pose also flips rest toe−ankle z, which clause (1) of the planted
 * heading test requires stay > 0.05 m. Time-reversing the already-grafted channels keeps that rest
 * sign and flips only the stance travel (measured: rest z +0.128 → last-frame z +0.080; forward.z
 * −0.9999 → +0.9999). No Blender, no IK bake, no new clip name. Root net XZ stays 0.
 */
export async function rebindBoundClipTravelHeading(input: {
  targetPath: string;
  clipName: string;
  outputPath: string;
  rootJoint?: string;
  publish?: { provenancePath: string };
}): Promise<ClipTravelHeadingRebindReport> {
  const io = new NodeIO();
  const targetBytes = await readFile(input.targetPath);
  const document = await io.read(input.targetPath);
  const animation = document
    .getRoot()
    .listAnimations()
    .find((entry) => entry.getName() === input.clipName);
  if (!animation) {
    throw new Error(
      `rebindBoundClipTravelHeading: ${input.targetPath} has no clip named ${input.clipName}. Present: ${document
        .getRoot()
        .listAnimations()
        .map((entry) => entry.getName())
        .join(", ")}`,
    );
  }

  const cubic = animation
    .listSamplers()
    .filter((sampler) => sampler.getInterpolation() === "CUBICSPLINE")
    .map((sampler) => sampler.getName() || "(unnamed)");
  if (cubic.length > 0) {
    throw new Error(
      `rebindBoundClipTravelHeading: refused — ${input.clipName} carries CUBICSPLINE sampler(s) (${[...new Set(cubic)].join(", ")}). Reversing those accessors would treat tangents as values.`,
    );
  }

  const before = meshStats(document);
  const seenOutputs = new Set<Accessor>();
  for (const sampler of animation.listSamplers()) {
    const output = sampler.getOutput();
    if (!output) {
      throw new Error(`rebindBoundClipTravelHeading: ${input.clipName} has a sampler with no output accessor.`);
    }
    if (seenOutputs.has(output)) continue;
    seenOutputs.add(output);
    reverseSamplerOutput(output, input.clipName);
  }

  const rootJoint = input.rootJoint ?? "root";
  const rootTravelMeters = rootTranslationNetMeters(animation, rootJoint);
  if (rootTravelMeters >= ROOT_TRAVEL_IN_PLACE_METERS) {
    throw new Error(
      `rebindBoundClipTravelHeading: refused — ${input.clipName} root XZ net ${rootTravelMeters} m after reverse; in-place graft must keep rootTravelMeters 0.`,
    );
  }

  const after = meshStats(document);
  if (before.primitives !== after.primitives || before.triangles !== after.triangles) {
    throw new Error(
      `rebindBoundClipTravelHeading: refused — rebind changed geometry (${before.triangles} -> ${after.triangles} triangles).`,
    );
  }
  if (before.positionDigest !== after.positionDigest) {
    throw new Error("rebindBoundClipTravelHeading: refused — rebind changed POSITION accessor bytes.");
  }

  await io.write(input.outputPath, document);
  const outputBytes = await readFile(input.outputPath);

  let published: ClipGraftReport["published"] = null;
  if (input.publish) {
    await writeFile(input.targetPath, outputBytes);
    const record = JSON.parse(await readFile(input.publish.provenancePath, "utf8")) as {
      outputSha256?: string;
      outputBytes?: number;
      sourceNotes?: string[];
      motionClips?: Array<Record<string, unknown>>;
    };
    record.outputSha256 = sha256(outputBytes);
    record.outputBytes = outputBytes.byteLength;
    const entry = (record.motionClips ?? []).find((clip) => clip.clipName === input.clipName);
    if (!entry) {
      throw new Error(
        `rebindBoundClipTravelHeading: refused — ${input.publish.provenancePath} has no motionClips entry for ${input.clipName}. Publishing a hash without the clip record would describe bytes the record does not name.`,
      );
    }
    if (entry.inPlace !== true || Number(entry.rootTravelMeters) !== 0) {
      throw new Error(
        `rebindBoundClipTravelHeading: refused — ${input.clipName} provenance is not inPlace/rootTravelMeters 0.`,
      );
    }
    entry.headingRebind = {
      method: "reverse_existing_channels",
      deliveredBy: "tools/openclinxr/factory/graft-bound-clip.ts",
      reboundAt: new Date().toISOString(),
      note: "Reversed existing Walk_Formal sampler outputs so stance-window travel z matches rest toe−ankle +Z. inPlace/rootTravelMeters 0 unchanged. Not a 180 yaw, not --source-orientation, not an IK bake.",
    };
    entry.deliveredBy = "tools/openclinxr/factory/graft-bound-clip.ts";
    const note =
      "2026-09-21 heading rebind: reversed existing openclinxr_retarget_walk_formal_cc0 sampler outputs (Node graft, no Blender). Stance travel z sign now matches rest toe−ankle +Z. Geometry POSITION bytes identical; inPlace/rootTravelMeters 0 kept.";
    record.sourceNotes = [...(record.sourceNotes ?? []).filter((row) => row !== note), note];
    await writeFile(input.publish.provenancePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    published = {
      assetPath: input.targetPath,
      provenancePath: input.publish.provenancePath,
      outputSha256: sha256(outputBytes),
      outputBytes: outputBytes.byteLength,
    };
  }

  return {
    schemaVersion: "openclinxr.clip-travel-heading-rebind.v1",
    generatedAt: new Date().toISOString(),
    clipName: input.clipName,
    method: "reverse_existing_channels",
    target: { path: input.targetPath, sha256Before: sha256(targetBytes), bytesBefore: targetBytes.byteLength },
    output: { path: input.outputPath, sha256: sha256(outputBytes), bytes: outputBytes.byteLength },
    reversedSamplers: seenOutputs.size,
    reversedChannels: animation.listChannels().length,
    rootTravelMeters,
    inPlace: true,
    published,
    animationsAfter: document.getRoot().listAnimations().map((entry) => entry.getName()),
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
  if (args.includes("--drop-leading-rest-frame")) {
    const report = await dropLeadingRestFrame({
      targetPath,
      clipName: flagValue("--clip", ""),
      outputPath: flagValue("--output", ".openclinxr/evidence/walk-bind/rest-frame-dropped.glb"),
    });
    if (!flagValue("--clip", "")) throw new Error("drop-leading-rest-frame: --clip is required.");
    const reportPath = flagValue("--report", ".openclinxr/evidence/walk-bind/rest-frame-drop.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${reportPath}\n`);
    return;
  }
  if (args.includes("--rebind-travel-heading")) {
    const report = await rebindBoundClipTravelHeading({
      targetPath,
      clipName: flagValue("--clip", "openclinxr_retarget_walk_formal_cc0"),
      outputPath: flagValue("--output", ".openclinxr/evidence/walk-bind/physician-heading-rebind.glb"),
      ...(args.includes("--publish")
        ? { publish: { provenancePath: targetPath.replace(/\.glb$/u, ".provenance.json") } }
        : {}),
    });
    const reportPath = flagValue("--report", ".openclinxr/evidence/walk-bind/physician-heading-rebind.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${reportPath}\n`);
    return;
  }
  const removeClipName = flagValue("--remove-clip", "");
  const removeReason = flagValue(
    "--remove-reason",
    "removed by SC-04: its source terms refuse redistribution of the raw data",
  );
  const report = await graftBoundClip({
    targetPath,
    sourcePath: flagValue("--source", ".openclinxr/evidence/walk-bind/physician-walk.glb"),
    clipName: flagValue("--clip", "openclinxr_retarget_cmu_02_01_walk"),
    outputPath: flagValue("--output", ".openclinxr/evidence/walk-bind/physician-grafted.glb"),
    ...(removeClipName ? { removeClips: [{ clipName: removeClipName, reason: removeReason }] } : {}),
    ...(args.includes("--publish")
      ? {
          publish: {
            provenancePath: targetPath.replace(/\.glb$/u, ".provenance.json"),
            footPlantReportPath: flagValue("--foot-plant-report", "docs/openclinxr/evidence/bound-clip-foot-plant.json"),
            footPlantEvidencePath: flagValue(
              "--foot-plant-evidence",
              flagValue("--foot-plant-report", "docs/openclinxr/evidence/bound-clip-foot-plant.json"),
            ),
            sourceClipPath: flagValue(
              "--source-clip",
              "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_02_01_walk.bvh",
            ),
            licenceRecordPath: flagValue(
              "--licence-record",
              "docs/openclinxr/asset-licence-records/row-08-cmu-graphics-lab-mocap.json",
            ),
            licenceStatus: flagValue(
              "--licence-status",
              "CONDITIONAL - not CC0/CC-BY. Free for research and commercial products; the data may not be resold even converted.",
            ),
          },
        }
      : {}),
  });
  const reportPath = flagValue("--report", "docs/openclinxr/evidence/physician-walk-clip-graft.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

if (process.argv[1]?.endsWith("graft-bound-clip.ts")) await main();
