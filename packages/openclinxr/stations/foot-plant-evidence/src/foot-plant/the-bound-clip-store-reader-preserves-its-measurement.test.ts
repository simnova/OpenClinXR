import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { afterEach, describe, expect, it } from "vitest";
import { measureBoundClipFootPlant } from "../../../../../../tools/openclinxr/evidence/foot-plant/bound-clip-foot-plant.js";
import { boundClipJointTrack } from "../../../../../../tools/openclinxr/evidence/foot-plant/bound-clip-foot-track.js";

/** A rig where root "root" carries joint "foot" 0->2 m over 1 s on clip WALK. */
async function walkGlb(clipName: string, filePath: string): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer();
  const rootJoint = document.createNode("root");
  const foot = document.createNode("foot");
  rootJoint.addChild(foot);
  const scene = document.createScene("Scene").addChild(rootJoint);
  void scene;
  const times = document
    .createAccessor("times").setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const positions = document
    .createAccessor("positions").setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 2, 0, 0])).setBuffer(buffer);
  const animation = document.createAnimation(clipName);
  const sampler = document.createAnimationSampler()
    .setInput(times).setOutput(positions).setInterpolation("LINEAR");
  animation.addSampler(sampler);
  animation.addChannel(
    document.createAnimationChannel().setTargetNode(rootJoint).setTargetPath("translation").setSampler(sampler),
  );
  await new NodeIO().write(filePath, document);
}

const previousStoreRoot = process.env.OPENCLINXR_ASSET_STORE;
const tempDirs: string[] = [];

afterEach(async () => {
  if (previousStoreRoot === undefined) delete process.env.OPENCLINXR_ASSET_STORE;
  else process.env.OPENCLINXR_ASSET_STORE = previousStoreRoot;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function buildStore(bytes: Buffer, basename: string): Promise<{ root: string; ref: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "openclinxr-store-"));
  tempDirs.push(root);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await mkdir(path.join(root, sha), { recursive: true });
  await writeFile(path.join(root, sha, basename), bytes);
  return { root, ref: `store:${sha}/${basename}` };
}

const CLIP = "walk_probe";

describe("bound-clip store reader preserves its measurement", () => {
  it("(1) the track from a store reference matches the same bytes by path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-plant-"));
    tempDirs.push(dir);
    const glbPath = path.join(dir, "probe.glb");
    await walkGlb(CLIP, glbPath);
    const bytes = await readFile(glbPath);
    const { root, ref } = await buildStore(bytes, "probe.glb");
    const byPath = await boundClipJointTrack({ glbPath, clipName: CLIP, boneName: "foot" });
    process.env.OPENCLINXR_ASSET_STORE = root;
    const byStoreEnv = await boundClipJointTrack({ glbPath: ref, clipName: CLIP, boneName: "foot" });
    expect(byStoreEnv.samples).toEqual(byPath.samples);
    const last = byPath.samples[byPath.samples.length - 1]!;
    expect(last.position.x).toBeCloseTo(2, 5);
  });

  it("(2) the plant report from a store reference keeps the logical ref and measured bytes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-plant-"));
    tempDirs.push(dir);
    const glbPath = path.join(dir, "probe.glb");
    await walkGlb(CLIP, glbPath);
    const bytes = await readFile(glbPath);
    const { root, ref } = await buildStore(bytes, "probe.glb");
    process.env.OPENCLINXR_ASSET_STORE = root;
    const report = await measureBoundClipFootPlant({ glbPath: ref, clipName: CLIP, joints: ["foot"] });
    expect(report.asset.glbPath).toBe(ref);
    expect(report.asset.bytes).toBe(bytes.byteLength);
    expect(report.asset.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(report.joints.map((j) => j.joint)).toEqual(["foot"]);
  });

  it("(3) missing store root, bad hash, and traversal are refused", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-plant-neg-"));
    tempDirs.push(dir);
    const glbPath = path.join(dir, "probe.glb");
    await walkGlb(CLIP, glbPath);
    const bytes = await readFile(glbPath);
    const { root, ref } = await buildStore(bytes, "probe.glb");
    const sha = ref.slice("store:".length).split("/")[0]!;
    delete process.env.OPENCLINXR_ASSET_STORE;
    await expect(boundClipJointTrack({ glbPath: ref, clipName: CLIP, boneName: "foot" })).rejects.toThrow(/no asset store root/);
    process.env.OPENCLINXR_ASSET_STORE = path.join(root, "does-not-exist");
    await expect(boundClipJointTrack({ glbPath: ref, clipName: CLIP, boneName: "foot" })).rejects.toThrow(/store root does not exist/);
    process.env.OPENCLINXR_ASSET_STORE = root;
    await expect(
      boundClipJointTrack({ glbPath: `store:${"0".repeat(64)}/probe.glb`, clipName: CLIP, boneName: "foot" }),
    ).rejects.toThrow(/names no file/);
    await expect(
      boundClipJointTrack({ glbPath: "store:xyz/probe.glb", clipName: CLIP, boneName: "foot" }),
    ).rejects.toThrow(/malformed/);
    await expect(
      boundClipJointTrack({ glbPath: `store:${sha}/../evil.glb`, clipName: CLIP, boneName: "foot" }),
    ).rejects.toThrow(/unsafe basename/);
  });

  it("(4) content that disagrees with its hash is refused", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-plant-corrupt-"));
    tempDirs.push(dir);
    const glbPath = path.join(dir, "probe.glb");
    await walkGlb(CLIP, glbPath);
    const bytes = await readFile(glbPath);
    const { root, ref } = await buildStore(bytes, "probe.glb");
    process.env.OPENCLINXR_ASSET_STORE = root;
    await writeFile(path.join(root, ref.slice("store:".length)), Buffer.from("corrupted bytes"));
    await expect(boundClipJointTrack({ glbPath: ref, clipName: CLIP, boneName: "foot" })).rejects.toThrow(/content hashes/);
  });
});
