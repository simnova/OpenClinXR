import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureTransform } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";
import {
  glbBytesUseMeshopt,
  glbJsonTextUsesMeshopt,
  isMeshoptCompressedGlb,
  prepareBlenderReadableGlb,
} from "./prepare-blender-input.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Snapshot = {
  positions: number[];
  indices: number[];
  normals: number[];
  uvs: number[];
  morphPositions: number[];
  baseColorFactor: number[];
  imageBytes: string;
  nodeNames: string[];
  nodeTranslations: number[][];
  skinJointNames: string[];
  animChannelTargets: string[];
  transformOffset: number[];
  extensionsUsed: string[];
};

function buildRichDoc(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer("buffer");
  const mesh = doc.createMesh("shell_mesh");
  const prim = doc.createPrimitive();
  prim.setAttribute(
    "POSITION",
    doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])).setBuffer(buffer),
  );
  prim.setAttribute(
    "NORMAL",
    doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer),
  );
  prim.setAttribute(
    "TEXCOORD_0",
    doc.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])).setBuffer(buffer),
  );
  prim.setAttribute(
    "JOINTS_0",
    doc.createAccessor().setType("VEC4").setArray(new Uint8Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0])).setBuffer(buffer),
  );
  prim.setAttribute(
    "WEIGHTS_0",
    doc.createAccessor().setType("VEC4").setArray(new Float32Array([0.7, 0.3, 0, 0, 0.7, 0.3, 0, 0, 0.7, 0.3, 0, 0, 0.7, 0.3, 0, 0])).setBuffer(buffer),
  );
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer));
  const target = doc.createPrimitiveTarget();
  target.setAttribute(
    "POSITION",
    doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0, 0, 0.1])).setBuffer(buffer),
  );
  prim.addTarget(target);

  const texture = doc.createTexture("embedded_tex").setMimeType("image/png").setImage(new Uint8Array(PNG_1X1));
  const material = doc.createMaterial("shell_mat").setBaseColorFactor([0.7, 0.78, 0.84, 1]).setBaseColorTexture(texture);
  const transformExt = doc.createExtension(KHRTextureTransform);
  const transform = transformExt.createTransform().setOffset([0.1, 0.2]);
  material.getBaseColorTextureInfo()!.setExtension("KHR_texture_transform", transform);
  prim.setMaterial(material);
  mesh.addPrimitive(prim);

  const jointA = doc.createNode("joint_a").setTranslation([0, 0, 0]);
  const jointB = doc.createNode("joint_b").setTranslation([0, 1, 0]);
  const skin = doc.createSkin("shell_skin").addJoint(jointA).addJoint(jointB);
  skin.setInverseBindMatrices(
    doc.createAccessor().setType("MAT4").setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).setBuffer(buffer),
  );
  const shellNode = doc.createNode("ed_exam_bay_shell").setMesh(mesh).setSkin(skin).setTranslation([0.5, 0, -0.25]);
  shellNode.setRotation([0, 0, 0, 1]);
  const trimNode = doc.createNode("ed_exam_bay_skirting_back").setTranslation([0, 0.05, -1.79]);

  const times = doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const translations = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0, 0.5, 0])).setBuffer(buffer);
  const animation = doc.createAnimation("shell_breathe");
  const sampler = doc.createAnimationSampler().setInput(times).setOutput(translations).setInterpolation("LINEAR");
  animation.addSampler(sampler);
  animation.addChannel(doc.createAnimationChannel().setTargetNode(jointB).setTargetPath("translation").setSampler(sampler));

  const scene = doc.createScene("scene");
  scene.addChild(jointA);
  scene.addChild(jointB);
  scene.addChild(shellNode);
  scene.addChild(trimNode);
  return doc;
}

async function snapshot(glbPath: string): Promise<Snapshot> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0]!.listPrimitives()[0]!;
  const get = (semantic: string): number[] => Array.from(prim.getAttribute(semantic)!.getArray()!);
  const morph = prim.listTargets()[0]!.getAttribute("POSITION")!;
  const material = prim.getMaterial()!;
  const image = material.getBaseColorTexture()!.getImage()!;
  const transform = material.getBaseColorTextureInfo()!.getExtension("KHR_texture_transform") as unknown as {
    getOffset: () => number[];
  };
  const json = JSON.parse(Buffer.from(await readFile(glbPath)).subarray(20, 20 + Buffer.from(await readFile(glbPath)).subarray(12, 16).readUInt32LE(0)).toString("utf8")) as {
    extensionsUsed?: string[];
  };
  return {
    positions: get("POSITION"),
    indices: Array.from(prim.getIndices()!.getArray()!),
    normals: get("NORMAL"),
    uvs: get("TEXCOORD_0"),
    morphPositions: Array.from(morph.getArray()!),
    baseColorFactor: [...material.getBaseColorFactor()],
    imageBytes: Buffer.from(image).toString("base64"),
    nodeNames: root.listNodes().map((node) => node.getName()).sort(),
    nodeTranslations: root.listNodes().map((node) => [...node.getTranslation()]),
    skinJointNames: root.listSkins()[0]!.listJoints().map((joint) => joint.getName()).sort(),
    animChannelTargets: root.listAnimations()[0]!.listChannels().map((channel) => `${channel.getTargetNode()!.getName()}:${channel.getTargetPath()}`),
    transformOffset: [...transform.getOffset()],
    extensionsUsed: [...(json.extensionsUsed ?? [])].sort(),
  };
}

describe("prepare-blender-input (meshopt boundary)", () => {
  it("decodes compressed input with identical semantics and cleans up its own temp", async () => {
    const jobTmp = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-unit-"));
    try {
      const plainPath = path.join(jobTmp, "plain.glb");
      const compressedPath = path.join(jobTmp, "compressed.glb");
      const plainIo = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      await plainIo.write(plainPath, buildRichDoc());
      const plainSnap = await snapshot(plainPath);
      expect(await isMeshoptCompressedGlb(plainPath)).toBe(false);

      await MeshoptEncoder.ready;
      await MeshoptDecoder.ready;
      const encodeIo = new NodeIO()
        .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
        .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
      const toCompress = await encodeIo.read(plainPath);
      await toCompress.transform(meshopt({ encoder: MeshoptEncoder }));
      await encodeIo.write(compressedPath, toCompress);
      expect(await isMeshoptCompressedGlb(compressedPath)).toBe(true);
      expect(glbBytesUseMeshopt(new Uint8Array(await readFile(compressedPath)))).toBe(true);
      const sourceBytes = await readFile(compressedPath);
      // Baseline is the decoder's view of the compressed source artifact:
      // the meshopt ENCODER quantizes positions (lossy by design, owned by
      // the existing simplify-after-bake stage), so the bridge must reproduce
      // the decoded artifact exactly — never resample it further.
      const before = await snapshot(compressedPath);

      const first = await prepareBlenderReadableGlb(compressedPath);
      const second = await prepareBlenderReadableGlb(compressedPath);
      try {
        expect(first.decompressed).toBe(true);
        expect(second.decompressed).toBe(true);
        expect(first.blenderInputPath).not.toBe(compressedPath);
        expect(first.blenderInputPath).not.toBe(second.blenderInputPath);
        expect(await isMeshoptCompressedGlb(first.blenderInputPath)).toBe(false);
        const after = await snapshot(first.blenderInputPath);
        expect(after.indices).toEqual(before.indices);
        expect(after.positions).toEqual(before.positions);
        expect(after.normals).toEqual(before.normals);
        expect(after.uvs).toEqual(before.uvs);
        expect(after.morphPositions).toEqual(before.morphPositions);
        expect(after.baseColorFactor).toEqual(before.baseColorFactor);
        expect(after.imageBytes).toBe(before.imageBytes);
        expect(after.nodeNames).toEqual(before.nodeNames);
        expect(after.nodeTranslations).toEqual(before.nodeTranslations);
        expect(after.skinJointNames).toEqual(before.skinJointNames);
        expect(after.animChannelTargets).toEqual(before.animChannelTargets);
        expect(after.transformOffset).toEqual(before.transformOffset);
        expect(after.extensionsUsed).not.toContain("EXT_meshopt_compression");
        expect(after.extensionsUsed).toContain("KHR_texture_transform");
        // Embedded PNG bytes survive both the encoder and the bridge untouched.
        expect(after.imageBytes).toBe(plainSnap.imageBytes);
        // Input artifact immutable.
        expect(await readFile(compressedPath)).toEqual(sourceBytes);
      } finally {
        await first.cleanup();
        await second.cleanup();
      }
      expect(existsSync(path.dirname(first.blenderInputPath))).toBe(false);
      expect(existsSync(path.dirname(second.blenderInputPath))).toBe(false);
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
    }
  }, 120_000);

  it("leaves already-uncompressed input alone (no-op, idempotent)", async () => {
    const jobTmp = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-plain-"));
    try {
      const plainPath = path.join(jobTmp, "plain.glb");
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(plainPath, buildRichDoc());
      const prepared = await prepareBlenderReadableGlb(plainPath);
      try {
        expect(prepared.decompressed).toBe(false);
        expect(prepared.blenderInputPath).toBe(plainPath);
      } finally {
        await prepared.cleanup();
      }
      expect(await readFile(plainPath)).toBeTruthy();
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("fails closed on invalid input and cleans up its own root", async () => {
    const jobTmp = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-invalid-"));
    const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-scratch-"));
    try {
      const badPath = path.join(jobTmp, "bad.glb");
      await writeFile(badPath, "not a glb payload", "utf8");
      await expect(prepareBlenderReadableGlb(badPath, { tmpRoot: scratchRoot })).rejects.toThrow();
      expect(await readdir(scratchRoot)).toEqual([]);

      const truncatedPath = path.join(jobTmp, "truncated.glb");
      await writeFile(truncatedPath, Buffer.from("glTFxxxx", "utf8"));
      await expect(prepareBlenderReadableGlb(truncatedPath, { tmpRoot: scratchRoot })).rejects.toThrow();
      expect(await readdir(scratchRoot)).toEqual([]);

      const controller = new AbortController();
      controller.abort(new Error("test abort"));
      const plainPath = path.join(jobTmp, "plain.glb");
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(plainPath, buildRichDoc());
      await expect(prepareBlenderReadableGlb(plainPath, { signal: controller.signal, tmpRoot: scratchRoot })).rejects.toThrow();
      expect(await readdir(scratchRoot)).toEqual([]);
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
      await rm(scratchRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("does not mistake metadata text for compression (literal mention is a NOOP)", async () => {
    const jobTmp = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-literal-"));
    try {
      const doc = buildRichDoc();
      doc.getRoot().setExtras({ note: "mentions EXT_meshopt_compression but carries no encoded bufferViews" });
      const literalPath = path.join(jobTmp, "literal.glb");
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(literalPath, doc);
      const beforeBytes = await readFile(literalPath);
      // The literal is genuinely present in the JSON chunk, yet no extension
      // record claims it — this is the D1 false-positive counterweight.
      expect(Buffer.from(beforeBytes).toString("utf8")).toContain("EXT_meshopt_compression");
      expect(glbJsonTextUsesMeshopt(JSON.stringify({ extras: { note: "EXT_meshopt_compression" } }))).toBe(false);
      expect(glbBytesUseMeshopt(new Uint8Array(beforeBytes))).toBe(false);
      expect(await isMeshoptCompressedGlb(literalPath)).toBe(false);
      const prepared = await prepareBlenderReadableGlb(literalPath);
      try {
        expect(prepared.decompressed).toBe(false);
        expect(prepared.blenderInputPath).toBe(literalPath);
      } finally {
        await prepared.cleanup();
      }
      expect(await readFile(literalPath)).toEqual(beforeBytes);
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects malformed headers and broken JSON instead of misclassifying them", async () => {
    const jobTmp = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-header-"));
    const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "ocxr-meshopt-header-scratch-"));
    const setU32 = (bytes: Buffer, offset: number, value: number): void => {
      bytes.writeUInt32LE(value, offset);
    };
    try {
      const plainPath = path.join(jobTmp, "plain.glb");
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(plainPath, buildRichDoc());
      const valid = Buffer.from(await readFile(plainPath));

      // Broken plain JSON: same lengths, first JSON byte corrupted.
      const brokenJson = Buffer.from(valid);
      brokenJson[20] = 0x58; // "X", was "{"
      const brokenJsonPath = path.join(jobTmp, "broken-json.glb");
      await writeFile(brokenJsonPath, brokenJson);
      await expect(isMeshoptCompressedGlb(brokenJsonPath)).rejects.toThrow(/malformed/i);
      await expect(prepareBlenderReadableGlb(brokenJsonPath, { tmpRoot: scratchRoot })).rejects.toThrow(/malformed|invalid/i);
      expect(await readdir(scratchRoot)).toEqual([]);

      // Wrong version (1 instead of 2).
      const wrongVersion = Buffer.from(valid);
      setU32(wrongVersion, 4, 1);
      const wrongVersionPath = path.join(jobTmp, "wrong-version.glb");
      await writeFile(wrongVersionPath, wrongVersion);
      await expect(prepareBlenderReadableGlb(wrongVersionPath, { tmpRoot: scratchRoot })).rejects.toThrow(/version/i);
      expect(await readdir(scratchRoot)).toEqual([]);

      // Wrong declared total length.
      const wrongLength = Buffer.from(valid);
      setU32(wrongLength, 8, wrongLength.length + 100);
      const wrongLengthPath = path.join(jobTmp, "wrong-length.glb");
      await writeFile(wrongLengthPath, wrongLength);
      await expect(prepareBlenderReadableGlb(wrongLengthPath, { tmpRoot: scratchRoot })).rejects.toThrow(/length/i);
      expect(await readdir(scratchRoot)).toEqual([]);

      // Wrong first-chunk type (BIN instead of JSON).
      const wrongChunk = Buffer.from(valid);
      setU32(wrongChunk, 16, 0x004e4942);
      const wrongChunkPath = path.join(jobTmp, "wrong-chunk.glb");
      await writeFile(wrongChunkPath, wrongChunk);
      await expect(prepareBlenderReadableGlb(wrongChunkPath, { tmpRoot: scratchRoot })).rejects.toThrow(/chunk/i);
      expect(await readdir(scratchRoot)).toEqual([]);

      // Truncated: declared length exceeds actual bytes.
      const truncated = valid.subarray(0, valid.length - 10);
      const truncatedPath = path.join(jobTmp, "short.glb");
      await writeFile(truncatedPath, truncated);
      await expect(prepareBlenderReadableGlb(truncatedPath, { tmpRoot: scratchRoot })).rejects.toThrow(/length|truncated/i);
      expect(await readdir(scratchRoot)).toEqual([]);
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
      await rm(scratchRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
