import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { afterEach, describe, expect, it } from "vitest";

const previousStoreRoot = process.env.OPENCLINXR_ASSET_STORE;
const tempDirs: string[] = [];

afterEach(async () => {
  if (previousStoreRoot === undefined) delete process.env.OPENCLINXR_ASSET_STORE;
  else process.env.OPENCLINXR_ASSET_STORE = previousStoreRoot;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
import { graftBoundClip } from "./graft-bound-clip.js";

function rigDocument(jointNames: readonly string[], withClip: string | null): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document
    .createAccessor("POSITION").setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const indices = document
    .createAccessor("indices").setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
  const meshNode = document.createNode("mesh_node").setMesh(document.createMesh("body").addPrimitive(primitive));
  const scene = document.createScene("Scene").addChild(meshNode);
  const joints = jointNames.map((name) => document.createNode(name).setTranslation([0, 1, 0]));
  for (const joint of joints) scene.addChild(joint);
  if (withClip) {
    const times = document.createAccessor("t").setType(Accessor.Type.SCALAR)
      .setArray(new Float32Array([0, 1])).setBuffer(buffer);
    const rotations = document.createAccessor("r").setType(Accessor.Type.VEC4)
      .setArray(new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2])).setBuffer(buffer);
    const animation = document.createAnimation(withClip);
    for (const joint of joints) {
      const sampler = document.createAnimationSampler().setInput(times).setOutput(rotations).setInterpolation("LINEAR");
      animation.addSampler(sampler);
      animation.addChannel(document.createAnimationChannel().setTargetNode(joint).setTargetPath("rotation").setSampler(sampler));
    }
  }
  return document;
}

async function writeGlb(document: Document, filePath: string): Promise<void> {
  await new NodeIO().write(filePath, document);
}

async function buildStore(bytes: Buffer, basename: string): Promise<{ root: string; ref: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "openclinxr-store-"));
  tempDirs.push(root);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await mkdir(path.join(root, sha), { recursive: true });
  await writeFile(path.join(root, sha, basename), bytes);
  return { root, ref: `store:${sha}/${basename}` };
}

const CLIP = "openclinxr_retarget_probe_walk";

describe("the graft source can be a verified store reference", () => {
  it("(1) grafting from a store reference matches the path graft", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-"));
    tempDirs.push(dir);
    const targetPath = path.join(dir, "target.glb");
    const sourcePath = path.join(dir, "source.glb");
    await writeGlb(rigDocument(["hip", "knee"], null), targetPath);
    await writeGlb(rigDocument(["hip", "knee"], CLIP), sourcePath);
    const sourceBytes = await readFile(sourcePath);
    const { root, ref } = await buildStore(sourceBytes, "source.glb");
    process.env.OPENCLINXR_ASSET_STORE = root;
    const fromStore = await graftBoundClip({
      targetPath, sourcePath: ref, clipName: CLIP,
      outputPath: path.join(dir, "out-store.glb"),
    });
    const targetCopy = path.join(dir, "target-copy.glb");
    await writeFile(targetCopy, await readFile(targetPath));
    const fromPath = await graftBoundClip({
      targetPath: targetCopy, sourcePath, clipName: CLIP,
      outputPath: path.join(dir, "out-path.glb"),
    });
    expect(fromStore.source.path).toBe(ref);
    expect(fromStore.source.sha256).toBe(fromPath.source.sha256);
    expect(fromStore.graftedChannels).toBe(fromPath.graftedChannels);
    expect(fromStore.geometryParity.positionBytesIdentical).toBe(true);
  });

  it("(2) corrupt store bytes and a store output target are refused", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-neg-"));
    tempDirs.push(dir);
    const targetPath = path.join(dir, "target.glb");
    const sourcePath = path.join(dir, "source.glb");
    await writeGlb(rigDocument(["hip", "knee"], null), targetPath);
    await writeGlb(rigDocument(["hip", "knee"], CLIP), sourcePath);
    const { root, ref } = await buildStore(await readFile(sourcePath), "source.glb");
    process.env.OPENCLINXR_ASSET_STORE = root;
    await writeFile(path.join(root, ref.slice("store:".length)), Buffer.from("corrupted bytes"));
    await expect(graftBoundClip({
      targetPath, sourcePath: ref, clipName: CLIP, outputPath: path.join(dir, "out.glb"),
    })).rejects.toThrow(/content hashes/);
    await expect(graftBoundClip({
      targetPath, sourcePath, clipName: CLIP, outputPath: `store:${"0".repeat(64)}/out.glb`,
    })).rejects.toThrow(/not an output write target/);
  });

  it("(3) publish with a store targetPath is refused before any write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-pubtarget-"));
    tempDirs.push(dir);
    const targetPath = path.join(dir, "target.glb");
    const sourcePath = path.join(dir, "source.glb");
    await writeGlb(rigDocument(["hip", "knee"], null), targetPath);
    await writeGlb(rigDocument(["hip", "knee"], CLIP), sourcePath);
    const outPath = path.join(dir, "out.glb");
    await expect(graftBoundClip({
      targetPath: `store:${"0".repeat(64)}/target.glb`, sourcePath, clipName: CLIP, outputPath: outPath,
      publish: { provenancePath: path.join(dir, "prov.json"), sourceClipPath: sourcePath, licenceRecordPath: path.join(dir, "lic.json"), licenceStatus: "TEST" },
    })).rejects.toThrow(/publish\.target/);
    await expect(readFile(outPath).catch(() => null)).resolves.toBeNull();
  });

  it("(4) publish with a store provenancePath is refused before any write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-pubprov-"));
    tempDirs.push(dir);
    const targetPath = path.join(dir, "target.glb");
    const sourcePath = path.join(dir, "source.glb");
    await writeGlb(rigDocument(["hip", "knee"], null), targetPath);
    await writeGlb(rigDocument(["hip", "knee"], CLIP), sourcePath);
    const before = await readFile(targetPath);
    const outPath = path.join(dir, "out.glb");
    await expect(graftBoundClip({
      targetPath, sourcePath, clipName: CLIP, outputPath: outPath,
      publish: { provenancePath: `store:${"0".repeat(64)}/prov.json`, sourceClipPath: sourcePath, licenceRecordPath: path.join(dir, "lic.json"), licenceStatus: "TEST" },
    })).rejects.toThrow(/publish\.provenance/);
    await expect(readFile(outPath).catch(() => null)).resolves.toBeNull();
    expect(await readFile(targetPath)).toEqual(before);
  });

  it("(5) a bare store outputPath is refused before any write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-out-"));
    tempDirs.push(dir);
    const targetPath = path.join(dir, "target.glb");
    const sourcePath = path.join(dir, "source.glb");
    await writeGlb(rigDocument(["hip", "knee"], null), targetPath);
    await writeGlb(rigDocument(["hip", "knee"], CLIP), sourcePath);
    const before = await readFile(targetPath);
    await expect(graftBoundClip({
      targetPath, sourcePath, clipName: CLIP, outputPath: `store:${"0".repeat(64)}/out.glb`,
    })).rejects.toThrow(/not an output write target/);
    expect(await readFile(targetPath)).toEqual(before);
  });
});
