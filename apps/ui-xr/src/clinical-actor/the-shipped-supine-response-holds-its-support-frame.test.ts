import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findRuntimeActorAsset } from "@openclinxr/asset-registry/runtime-bundle-lookups";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { playManifestMotionClip } from "@openclinxr/xr-humanoid-animation/manifest-motion-clip-playback";
import {
  applyAndPlantSupineOnDeck,
  applySupinePoseHoldingIncline,
  holdSupinePlantFrame,
  reapplySupineHeadToStoredPillow,
} from "@openclinxr/xr-pose";
import { buildPatientStretcher, STRETCHER_DECK_TOP_METERS } from "@openclinxr/xr-station";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  LoopOnce,
  Object3D,
  PropertyBinding,
  QuaternionKeyframeTrack,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

type Node = {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string };
type Channel = { target: { node: number; path: string }; sampler: number };
type Gltf = {
  nodes: Node[];
  skins: { joints: number[] }[];
  scenes: { nodes: number[] }[];
  scene?: number;
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  animations: { name: string; channels: Channel[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
};

function subject() {
  const actor = edChestPainScenario.actors.find((a) => a.actorId === "patient_robert_hayes_v1")!;
  const selected = actor.bodyMechanics!.touchResponses!.find((r) => r.region === "abdomen_rlq")!.responseClip;
  const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
    scenarioId: edChestPainScenario.scenarioId,
    scenario: edChestPainScenario,
  });
  const model = findRuntimeActorAsset(bundle, actor.actorId)!.model;
  expect(model.blob.url).toBe("/generated-humanoids/mpfb-gown-ed-robert-hayes.glb");
  const bytes = readFileSync(fileURLToPath(new URL(`../../public${model.blob.url}`, import.meta.url)));
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  const jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString()) as Gltf;
  const binStart = 20 + jsonSize + 8;
  return { selected, bytes, gltf, binStart };
}

function floats(s: ReturnType<typeof subject>, index: number, width: number) {
  const a = s.gltf.accessors[index]!;
  expect(a.componentType).toBe(5126);
  expect(a.type).toBe(width === 4 ? "VEC4" : "SCALAR");
  const v = s.gltf.bufferViews[a.bufferView]!;
  const offset = s.binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? width * 4;
  return Array.from({ length: a.count * width }, (_, i) =>
    s.bytes.readFloatLE(offset + Math.floor(i / width) * stride + (i % width) * 4),
  );
}

function buildRig(s: ReturnType<typeof subject>) {
  const root = new Group();
  const jointNodes = new Set(s.gltf.skins.flatMap((skin) => skin.joints));
  const objects = s.gltf.nodes.map((n, i) => {
    const o = jointNodes.has(i) ? new Bone() : new Object3D();
    o.name = PropertyBinding.sanitizeNodeName(n.name ?? "");
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation).normalize();
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  s.gltf.nodes.forEach((n, i) => {
    n.children?.forEach((j) => {
      objects[i]!.add(objects[j]!);
    });
  });
  s.gltf.scenes[s.gltf.scene ?? 0]!.nodes.forEach((i) => {
    root.add(objects[i]!);
  });
  return { root, objects, jointNodes };
}

function playSelected(root: Object3D, clip: AnimationClip) {
  const mixer = new AnimationMixer(root);
  playManifestMotionClip({
    mixer,
    manifestAddress: { clipId: clip.name },
    clips: [clip],
    overlayRoot: root,
  });
  const action = mixer.existingAction(clip)!;
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  return { mixer, action };
}

describe("the shipped ED patient response plays through the app boundary", () => {
  it("the selected response moves the MPFB right arm then settles without moving supine support", () => {
    const s = subject();
    const candidates = s.gltf.animations.filter((a) => a.name === s.selected);
    expect(candidates, `authored ${s.selected} absent from bound patient`).toHaveLength(1);
    const clip = candidates[0]!;
    const names = clip.channels.map((c) => s.gltf.nodes[c.target.node]!.name!);
    expect(names).toEqual(expect.arrayContaining(["upperarm01.R", "lowerarm01.R", "spine03", "spine01", "head"]));
    expect(new Set(names).size).toBe(names.length);
    for (const c of clip.channels) {
      expect(c.target.path).toBe("rotation");
      expect(s.gltf.nodes[c.target.node]!.name).not.toMatch(/root|pelvis|leg|foot|toe/i);
    }
    const { root, objects } = buildRig(s);
    root.userData.openClinXrActorPosture = "supine";
    expect(objects.filter((o) => o instanceof Bone).length).toBeGreaterThan(0);
    const pose = applySupinePoseHoldingIncline(root);
    expect(pose.bonesTouched).toHaveLength(0);
    root.updateMatrixWorld(true);
    const baseRoot = root.matrixWorld.clone();
    const legs = objects.filter((o) => /upperleg|lowerleg|foot|toe/i.test(o.name));
    const baseLegs = legs.map((o) => o.quaternion.clone());
    const tracks = clip.channels.map((c) => {
      const sampler = clip.samplers[c.sampler]!;
      const times = floats(s, sampler.input, 1);
      const values = floats(s, sampler.output, 4);
      expect(times).toEqual([0, expect.closeTo(0.28, 5), expect.closeTo(0.85, 5)]);
      for (let i = 0; i < values.length; i += 4) {
        expect(Math.hypot(...values.slice(i, i + 4))).toBeCloseTo(1, 5);
      }
      return new QuaternionKeyframeTrack(`${objects[c.target.node]!.name}.quaternion`, times, values);
    });
    const arm = objects[names.includes("upperarm01.R") ? clip.channels[names.indexOf("upperarm01.R")]!.target.node : -1]!;
    const baseline = arm.quaternion.clone();
    const responseClip = new AnimationClip(s.selected, -1, tracks);
    const { mixer } = playSelected(root, responseClip);
    mixer.update(0.28);
    applySupinePoseHoldingIncline(root);
    expect(arm.quaternion.angleTo(baseline)).toBeGreaterThan(0.05);
    root.updateMatrixWorld(true);
    expect(root.matrixWorld.elements).toEqual(baseRoot.elements);
    legs.forEach((o, i) => {
      expect(o.quaternion.angleTo(baseLegs[i]!)).toBeLessThan(1e-6);
    });
    mixer.update(1);
    applySupinePoseHoldingIncline(root);
    expect(arm.quaternion.angleTo(baseline)).toBeLessThan(0.01);
  });

  it("the touch path owns only response bones while held and releases on settle", () => {
    const s = subject();
    const { root, objects } = buildRig(s);
    root.userData.openClinXrActorPosture = "supine";
    applySupinePoseHoldingIncline(root);
    expect(root.userData.openClinXrOwnedBoneChains).toBeUndefined();
    const selected = s.gltf.animations.find((a) => a.name === s.selected)!;
    const tracks = selected.channels.map((c) => {
      const sampler = selected.samplers[c.sampler]!;
      return new QuaternionKeyframeTrack(
        `${objects[c.target.node]!.name}.quaternion`,
        floats(s, sampler.input, 1),
        floats(s, sampler.output, 4),
      );
    });
    const clip = new AnimationClip(s.selected, -1, tracks);
    const { mixer } = playSelected(root, clip);
    const owned = root.userData.openClinXrOwnedBoneChains as { ownerId: string; boneNames: string[] }[];
    const claim = owned.find((c) => c.ownerId === "one_shot_response_clip")!;
    expect(claim.boneNames.some((n) => /upperarm|lowerarm/i.test(n))).toBe(true);
    expect(claim.boneNames.some((n) => /pelvis|thigh|shin|foot|toe/i.test(n))).toBe(false);
    mixer.update(clip.duration + 0.2);
    mixer.existingAction(clip)!.fadeOut(0.12);
    mixer.update(0.2);
    applySupinePoseHoldingIncline(root);
    expect(root.userData.openClinXrOwnedBoneChains).toBeUndefined();
  });
});

async function supportFrameFixture(transformedParent = false) {
  const s = subject();
  const rig = buildRig(s);
  const parent = new Group();
  if (transformedParent) {
    parent.position.set(2, 0.4, -3);
    parent.rotation.set(0.15, 0.6, -0.1);
    parent.scale.set(1.3, 0.8, 1.1);
  }
  parent.add(rig.root);
  parent.updateMatrixWorld(true);
  const stretcher = buildPatientStretcher({
    slotId: "stretcher",
    position: { x: 0, y: 0, z: 0 },
    trimColor: 0x445566,
    inclineDegrees: 0,
  });
  const plant = (inclineDegrees = 0, supportedStretcher = false) => {
    // buildPatientStretcher writes the incline SSOT via setStretcherInclineDegrees.
    // That setter is published and still unconsumed; a new consumes row would shrink the ceiling.
    const deck = supportedStretcher
      ? buildPatientStretcher({
          slotId: "stretcher",
          position: { x: 0, y: 0, z: 0 },
          trimColor: 0x445566,
          inclineDegrees,
        })
      : stretcher;
    if (supportedStretcher) {
      parent.add(deck);
      parent.updateMatrixWorld(true);
    }
    return applyAndPlantSupineOnDeck(rig.root, {
      deckTopWorldY: supportedStretcher ? STRETCHER_DECK_TOP_METERS : 0,
      deckCenter: { x: 0, z: 0 },
      ...(supportedStretcher ? { stretcher: deck } : { inclineDegrees }),
      applyJointEulers: false,
    });
  };
  plant();
  rig.root.updateMatrixWorld(true);
  const head = rig.objects.find((o) => o.name === "head")!;
  expect(head).toBeDefined();
  const reference = rig.root.worldToLocal(head.getWorldPosition(new Vector3()));
  const restingTarget = rig.root.localToWorld(reference.clone());
  rig.root.userData.openClinXrSupinePillowWorld = { x: restingTarget.x, z: restingTarget.z };
  const base = () => ({
    x: rig.root.position.x,
    y: rig.root.position.y,
    z: rig.root.position.z,
    scaleX: rig.root.scale.x,
    scaleY: rig.root.scale.y,
    scaleZ: rig.root.scale.z,
  });
  const selected = s.gltf.animations.find((a) => a.name === s.selected)!;
  expect(selected).toBeDefined();
  const tracks = selected.channels.map((c) => {
    const sampler = selected.samplers[c.sampler]!;
    return new QuaternionKeyframeTrack(
      `${rig.objects[c.target.node]!.name}.quaternion`,
      floats(s, sampler.input, 1),
      floats(s, sampler.output, 4),
    );
  });
  const clip = new AnimationClip(s.selected, -1, tracks);
  const { mixer } = playSelected(rig.root, clip);
  const support = rig.objects.filter((o) => /^(pelvis|foot|toe)/i.test(o.name));
  expect(support.length).toBeGreaterThan(3);
  const arm = rig.objects.find((o) => o.name === "upperarm01R")!;
  expect(arm).toBeDefined();
  const frame = (time: number, captured = base(), breathing = 0) => {
    mixer.update(Math.max(0, time - mixer.time));
    if (time >= clip.duration) mixer.existingAction(clip)?.fadeOut(0.12);
    if (time >= clip.duration + 0.2) mixer.existingAction(clip)?.stop();
    applySupinePoseHoldingIncline(rig.root);
    holdSupinePlantFrame(rig.root, captured, breathing);
    reapplySupineHeadToStoredPillow(rig.root);
    rig.root.updateMatrixWorld(true);
  };
  const world = () => support.map((o) => o.matrixWorld.elements.slice());
  const local = () => support.map((o) => ({ q: o.quaternion.toArray(), t: o.position.toArray() }));
  const assertWorld = (before: number[][]) =>
    world().forEach((after, i) => expect(Math.max(...after.map((v, j) => Math.abs(v - before[i]![j]!)))).toBeLessThan(1e-12));
  const assertAnchor = (anchor: Vector3, target: Vector3) => {
    const actual = rig.root.localToWorld(anchor.clone());
    expect(actual.x).toBeCloseTo(target.x, 12);
    expect(actual.z).toBeCloseTo(target.z, 12);
  };
  return {
    ...rig,
    parent,
    plant,
    head,
    reference,
    restingTarget,
    base,
    mixer,
    clip,
    arm,
    frame,
    world,
    local,
    assertWorld,
    assertAnchor,
    Vector3,
    reapplySupineHeadToStoredPillow,
  };
}

describe("the shipped supine response retains its staged world support frame", () => {
  it("full plant stages the resting reference before playback; peak and settle retain world support while the arm moves", async () => {
    const f = await supportFrameFixture();
    const base = f.base();
    f.frame(0, base);
    const before = f.world();
    const local = f.local();
    // Rest baseline is the staged planted rest (post frame 0), not the pre-plant bind pose.
    const arm = f.arm.quaternion.clone();
    for (let i = 0; i < 3; i++) {
      f.frame(0, base);
      f.assertWorld(before);
      expect(f.local()).toEqual(local);
    }
    f.frame(0.28, base);
    expect(f.arm.quaternion.angleTo(arm)).toBeGreaterThan(0.05);
    f.assertWorld(before);
    expect(f.local()).toEqual(local);
    f.frame(f.clip.duration + 1, base);
    f.frame(f.clip.duration + 2, base);
    expect(f.arm.quaternion.angleTo(arm)).toBeLessThan(0.01);
    f.assertWorld(before);
    f.assertWorld(before);
  });

  it("resting staging alignment reaches world XZ without moving world Y under a nonidentity parent", async () => {
    const f = await supportFrameFixture(true);
    const before = f.head.getWorldPosition(new f.Vector3());
    const target = { x: before.x + 0.1, z: before.z - 0.04 };
    // alignSupineHeadToPillow is module-local. Public reapply is the XZ-only pillow shift (delta Y 0).
    f.root.userData.openClinXrSupinePillowWorld = { x: target.x, z: target.z };
    f.reapplySupineHeadToStoredPillow(f.root);
    f.root.updateMatrixWorld(true);
    const after = f.head.getWorldPosition(new f.Vector3());
    expect(after.x).toBeCloseTo(target.x, 12);
    expect(after.z).toBeCloseTo(target.z, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
  });

  it("a changed pillow aligns the staged rest reference rather than the animated head under a transformed parent", async () => {
    const f = await supportFrameFixture(true);
    const base = f.base();
    f.frame(0, base);
    const arm = f.arm.quaternion.clone();
    const target = f.restingTarget.clone().add(new f.Vector3(0.06, 0, 0.02));
    f.root.userData.openClinXrSupinePillowWorld = { x: target.x, z: target.z };
    f.frame(0.28, base);
    expect(f.arm.quaternion.angleTo(arm)).toBeGreaterThan(0.05);
    f.assertAnchor(f.reference, target);
  });

  it("full replant with a changed resting head and incline replaces the staged reference before subsequent motion", async () => {
    const f = await supportFrameFixture();
    f.mixer.stopAllAction();
    f.head.position.x += 0.02;
    f.plant(15, true);
    expect(f.root.userData.openClinXrPlantSteps.map((step: { step: string }) => step.step)).toEqual(
      expect.arrayContaining(["initial_plant", "head_align_xz"]),
    );
    const support = f.root.userData.openClinXrSupineArticulatedSupportResolved;
    if (support !== undefined) expect(typeof support).toBe("boolean");
    const postPlant = f.world();
    expect(postPlant.length).toBeGreaterThan(3);
    const newReference = f.root.worldToLocal(f.head.getWorldPosition(new f.Vector3()));
    expect(newReference.distanceTo(f.reference)).toBeGreaterThan(0.01);
    const target = f.root.localToWorld(newReference.clone()).add(new f.Vector3(0.06, 0, 0.02));
    f.root.userData.openClinXrSupinePillowWorld = { x: target.x, z: target.z };
    const base = f.base();
    playManifestMotionClip({
      mixer: f.mixer,
      manifestAddress: { clipId: f.clip.name },
      clips: [f.clip],
      overlayRoot: f.root,
    });
    f.frame(0.28, base);
    f.assertAnchor(newReference, target);
  });

  it("keeps missing and nonfinite pillow inputs as baseline no-ops", async () => {
    const f = await supportFrameFixture();
    const before = {
      position: f.root.position.toArray(),
      quaternion: f.root.quaternion.toArray(),
      scale: f.root.scale.toArray(),
    };
    delete f.root.userData.openClinXrSupinePillowWorld;
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(f.root.position.toArray()).toEqual(before.position);
    expect(f.root.quaternion.toArray()).toEqual(before.quaternion);
    expect(f.root.scale.toArray()).toEqual(before.scale);
    f.root.userData.openClinXrSupinePillowWorld = { x: Number.NaN, z: 0 };
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(f.root.position.toArray()).toEqual(before.position);
    expect(f.root.quaternion.toArray()).toEqual(before.quaternion);
    expect(f.root.scale.toArray()).toEqual(before.scale);
  });

  it("missing or nonfinite pillow and absent or malformed rest cache cannot move the root", async () => {
    const f = await supportFrameFixture();
    const cache = f.root.userData.openClinXrSupineRestHeadRoot;
    expect(cache).toBeDefined();
    const snapshot = () => ({
      position: f.root.position.toArray(),
      quaternion: f.root.quaternion.toArray(),
      scale: f.root.scale.toArray(),
    });
    const pillow = f.root.userData.openClinXrSupinePillowWorld;
    delete f.root.userData.openClinXrSupinePillowWorld;
    let before = snapshot();
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(snapshot()).toEqual(before);
    f.root.userData.openClinXrSupinePillowWorld = { x: Number.NaN, z: 0 };
    before = snapshot();
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(snapshot()).toEqual(before);
    // Private cache field name/shape is fixed by this owner design; no public export is added.
    f.root.userData.openClinXrSupinePillowWorld = pillow;
    delete f.root.userData.openClinXrSupineRestHeadRoot;
    f.mixer.setTime(0.28);
    before = snapshot();
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(snapshot()).toEqual(before);
    f.root.userData.openClinXrSupineRestHeadRoot = { x: Number.NaN, y: 0, z: 0 };
    before = snapshot();
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(snapshot()).toEqual(before);
    f.root.userData.openClinXrSupineRestHeadRoot = cache;
    f.root.userData.openClinXrSupineInclineDegrees = 45;
    before = snapshot();
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(snapshot()).toEqual(before);
  });

  it("preserves nonzero intentional breathing instead of freezing the entire supine body", async () => {
    const f = await supportFrameFixture();
    const base = f.base();
    f.frame(0, base, 0.7);
    expect(f.root.position.y).toBeCloseTo(base.y + 0.7 * 0.006, 12);
    expect(f.root.scale.y).toBeCloseTo(base.scaleY + 0.7 * 0.006, 12);
    expect(f.root.position.y).not.toBe(base.y);
    expect(f.root.scale.y).not.toBe(base.scaleY);
  });

  it("rejects stale planted-root quaternion identity independently of unchanged incline", async () => {
    const f = await supportFrameFixture();
    expect(f.root.userData.openClinXrSupineRestHeadRoot).toBeDefined();
    const incline = f.root.userData.openClinXrSupineInclineDegrees;
    f.root.userData.openClinXrSupineRootQuat = { x: 0, y: 0.1, z: 0, w: Math.sqrt(0.99) };
    f.mixer.setTime(0.28);
    const before = f.root.position.toArray();
    f.reapplySupineHeadToStoredPillow(f.root);
    expect(f.root.userData.openClinXrSupineInclineDegrees).toBe(incline);
    expect(f.root.position.toArray()).toEqual(before);
  });
});
