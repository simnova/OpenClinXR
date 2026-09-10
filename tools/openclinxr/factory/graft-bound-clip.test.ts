import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { graftBoundClip } from "./graft-bound-clip.js";

/**
 * The graft exists because the Blender round trip loses geometry (see the module header). These
 * clauses prove the graft adds a clip and touches nothing else, and that it REFUSES rather than
 * dropping a channel it cannot place.
 */

async function writeGlb(document: Document, name: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-"));
  const filePath = path.join(directory, name);
  await new NodeIO().write(filePath, document);
  return filePath;
}

/** A rig with one triangle skinned to two named joints. */
function rigDocument(jointNames: readonly string[], withClip: string | null): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document
    .createAccessor("POSITION")
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = document
    .createAccessor("indices")
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
  const meshNode = document.createNode("mesh_node").setMesh(document.createMesh("body").addPrimitive(primitive));
  const scene = document.createScene("Scene").addChild(meshNode);
  const joints = jointNames.map((name) => document.createNode(name).setTranslation([0, 1, 0]));
  for (const joint of joints) scene.addChild(joint);

  if (withClip) {
    const times = document
      .createAccessor("t")
      .setType(Accessor.Type.SCALAR)
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer);
    const rotations = document
      .createAccessor("r")
      .setType(Accessor.Type.VEC4)
      .setArray(new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]))
      .setBuffer(buffer);
    const animation = document.createAnimation(withClip);
    for (const joint of joints) {
      const sampler = document.createAnimationSampler().setInput(times).setOutput(rotations).setInterpolation("LINEAR");
      animation.addSampler(sampler);
      animation.addChannel(
        document.createAnimationChannel().setTargetNode(joint).setTargetPath("rotation").setSampler(sampler),
      );
    }
  }
  return document;
}

const CLIP = "openclinxr_retarget_probe_walk";

describe("grafting a clip into a shipped rig", () => {
  it("(1) it adds the clip and leaves every POSITION byte identical", async () => {
    const targetPath = await writeGlb(rigDocument(["hip", "knee"], null), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "source.glb");
    const before = await readFile(targetPath);
    const report = await graftBoundClip({
      targetPath,
      sourcePath,
      clipName: CLIP,
      outputPath: path.join(path.dirname(targetPath), "out.glb"),
    });
    expect(report.animationsAfter).toEqual([CLIP]);
    expect(report.graftedJoints).toBe(2);
    expect(report.graftedChannels).toBe(2);
    expect(report.geometryParity.positionBytesIdentical).toBe(true);
    expect(report.geometryParity.trianglesAfter).toBe(report.geometryParity.trianglesBefore);
    // The target file itself is untouched; the graft writes a new path.
    expect(await readFile(targetPath)).toEqual(before);
  });

  it("(2) the grafted clip is READABLE from the output, not merely counted in a report", async () => {
    const targetPath = await writeGlb(rigDocument(["hip", "knee"], null), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "source.glb");
    const outputPath = path.join(path.dirname(targetPath), "out.glb");
    await graftBoundClip({ targetPath, sourcePath, clipName: CLIP, outputPath });
    const written = await new NodeIO().read(outputPath);
    const animation = written.getRoot().listAnimations().find((entry) => entry.getName() === CLIP);
    expect(animation?.listChannels().map((channel) => channel.getTargetNode()?.getName()).sort()).toEqual(["hip", "knee"]);
    // The samplers must have travelled with their data; an empty accessor plays nothing.
    expect(animation?.listSamplers()[0]?.getOutput()?.getCount()).toBe(2);
  });

  it("(3) COUNTERWEIGHT: it REFUSES a channel whose joint does not exist in the target", async () => {
    const targetPath = await writeGlb(rigDocument(["hip"], null), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "source.glb");
    await expect(
      graftBoundClip({
        targetPath,
        sourcePath,
        clipName: CLIP,
        outputPath: path.join(path.dirname(targetPath), "out.glb"),
      }),
    ).rejects.toThrow(/do not exist in the target rig: knee/u);
  });

  it("(4) COUNTERWEIGHT: it REFUSES to graft a clip name the target already carries", async () => {
    const targetPath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "source.glb");
    await expect(
      graftBoundClip({
        targetPath,
        sourcePath,
        clipName: CLIP,
        outputPath: path.join(path.dirname(targetPath), "out.glb"),
      }),
    ).rejects.toThrow(/already carries a clip named/u);
  });

  it("(5) it NAMES an absent clip rather than writing an output with nothing added", async () => {
    const targetPath = await writeGlb(rigDocument(["hip"], null), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip"], "some_other_clip"), "source.glb");
    await expect(
      graftBoundClip({
        targetPath,
        sourcePath,
        clipName: CLIP,
        outputPath: path.join(path.dirname(targetPath), "out.glb"),
      }),
    ).rejects.toThrow(/has no clip named/u);
  });

  it("(6) a licence replacement REMOVES the refused clip as well as adding its replacement", async () => {
    // Adding without removing leaves the refused clip in the shipped bytes beside its replacement:
    // still downloadable, still redistributed, and harder to notice for sitting next to a cleared
    // one. The removal reports the channel count it deleted so the swap is auditable.
    const targetPath = await writeGlb(rigDocument(["hip", "knee"], "openclinxr_retarget_refused"), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "source.glb");
    const outputPath = path.join(path.dirname(targetPath), "out.glb");
    const report = await graftBoundClip({
      targetPath,
      sourcePath,
      clipName: CLIP,
      outputPath,
      removeClips: [{ clipName: "openclinxr_retarget_refused", reason: "its source terms refuse redistribution" }],
    });
    expect(report.animationsAfter).toEqual([CLIP]);
    expect(report.removedClips).toEqual([
      { clipName: "openclinxr_retarget_refused", channels: 2, reason: "its source terms refuse redistribution" },
    ]);
    // Read it back rather than trusting the report: the refused clip is gone from the bytes.
    const written = await new NodeIO().read(outputPath);
    expect(written.getRoot().listAnimations().map((entry) => entry.getName())).toEqual([CLIP]);
    // And the removal did not cost geometry.
    expect(report.geometryParity.positionBytesIdentical).toBe(true);
  });

  it("(7) COUNTERWEIGHT: removing a clip the target does not carry REFUSES rather than passing quietly", async () => {
    // "Already gone" and "never looked" produce the same empty result, and a licence removal that
    // cannot tell them apart is not evidence of anything.
    const targetPath = await writeGlb(rigDocument(["hip", "knee"], null), "target.glb");
    const sourcePath = await writeGlb(rigDocument(["hip", "knee"], CLIP), "source.glb");
    await expect(
      graftBoundClip({
        targetPath,
        sourcePath,
        clipName: CLIP,
        outputPath: path.join(path.dirname(targetPath), "out.glb"),
        removeClips: [{ clipName: "openclinxr_retarget_never_here", reason: "fixture" }],
      }),
    ).rejects.toThrow(/does not carry it/u);
  });
});
