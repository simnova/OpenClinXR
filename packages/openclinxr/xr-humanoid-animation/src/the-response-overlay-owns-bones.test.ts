import { AnimationClip, AnimationMixer, Bone, Group, LoopOnce, QuaternionKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
// Own-test binds the public entrypoint by relative path. A self specifier
// would count this package as another consumer class of the entrypoint.
import { playManifestMotionClip } from "./manifest-motion-clip-playback.js";
import { applySupinePoseHoldingIncline, boneIsOwned } from "@openclinxr/xr-pose";

function rig() {
  const root = new Group();
  const upper = new Bone();
  upper.name = "upperarmR";
  const fore = new Bone();
  fore.name = "forearmR";
  const pelvis = new Bone();
  pelvis.name = "pelvis";
  const head = new Bone();
  head.name = "head";
  root.add(upper, fore, pelvis, head);
  root.userData["openClinXrActorPosture"] = "supine";
  const times = [0, 0.28, 0.85];
  const upperValues = [0, 0, 0, 1, 0.05, 0, 0, 1, 0, 0, 0, 1];
  const foreValues = [0, 0, 0, 1, 0.03, 0, 0, 1, 0, 0, 0, 1];
  const clip = new AnimationClip("rlq_guard_withdraw", -1, [
    new QuaternionKeyframeTrack("upperarmR.quaternion", times, upperValues),
    new QuaternionKeyframeTrack("forearmR.quaternion", times, foreValues),
  ]);
  const mixer = new AnimationMixer(root);
  return { root, upper, fore, pelvis, head, clip, mixer };
}

describe("manifest overlay claims response bones and releases on settle", () => {
  it("owns only response bones while held via production playManifestMotionClip", () => {
    const { root, clip, mixer } = rig();
    expect(root.userData["openClinXrOwnedBoneChains"]).toBeUndefined();
    playManifestMotionClip({ mixer, manifestAddress: { clipId: clip.name }, clips: [clip], overlayRoot: root });
    mixer.existingAction(clip)!.setLoop(LoopOnce, 1);
    mixer.existingAction(clip)!.clampWhenFinished = true;
    const owned = root.userData["openClinXrOwnedBoneChains"] as { ownerId: string; boneNames: string[] }[];
    const claim = owned.find((c) => c.ownerId === "one_shot_response_clip")!;
    expect(claim.boneNames.some((n) => /upperarm|forearm/i.test(n))).toBe(true);
    expect(claim.boneNames.some((n) => /pelvis|thigh|shin|foot|toe|head/i.test(n))).toBe(false);
    expect(boneIsOwned(owned, "upperarmR")).toBe(true);
    expect(boneIsOwned(owned, "pelvis")).toBe(false);
  });

  it("drives the response through mixer.update then FULL applySupinePoseHoldingIncline", () => {
    const { root, clip, mixer, upper, pelvis } = rig();
    playManifestMotionClip({ mixer, manifestAddress: { clipId: clip.name }, clips: [clip], overlayRoot: root });
    mixer.existingAction(clip)!.setLoop(LoopOnce, 1);
    mixer.existingAction(clip)!.clampWhenFinished = true;
    const baseline = upper.quaternion.clone();
    const pelvisBase = pelvis.quaternion.clone();
    mixer.update(0.28);
    applySupinePoseHoldingIncline(root);
    expect(upper.quaternion.angleTo(baseline)).toBeGreaterThan(0.01);
    expect(pelvis.quaternion.angleTo(pelvisBase)).toBeLessThan(1e-6);
  });

  it("releases ownership on finish/stop with no accumulation", () => {
    const { root, clip, mixer, upper } = rig();
    playManifestMotionClip({ mixer, manifestAddress: { clipId: clip.name }, clips: [clip], overlayRoot: root });
    mixer.existingAction(clip)!.setLoop(LoopOnce, 1);
    mixer.existingAction(clip)!.clampWhenFinished = true;
    const baseline = upper.quaternion.clone();
    mixer.update(0.28);
    expect(upper.quaternion.angleTo(baseline)).toBeGreaterThan(0.01);
    mixer.update(clip.duration + 0.2);
    mixer.existingAction(clip)!.fadeOut(0.12);
    mixer.update(0.2);
    mixer.existingAction(clip)?.stop();
    applySupinePoseHoldingIncline(root);
    expect(root.userData["openClinXrOwnedBoneChains"]).toBeUndefined();
    expect(upper.quaternion.angleTo(baseline)).toBeLessThan(0.05);
    // Second production play after release claims fresh without accumulation.
    playManifestMotionClip({ mixer, manifestAddress: { clipId: clip.name }, clips: [clip], overlayRoot: root });
    const owned = root.userData["openClinXrOwnedBoneChains"] as { ownerId: string; boneNames: string[] }[];
    expect(owned.filter((c) => c.ownerId === "one_shot_response_clip")).toHaveLength(1);
  });

  it("keeps MPFB spine03 ancestry owned by support through FULL hold while the arm responds", () => {
    const root = new Group();
    const spine03 = new Bone();
    spine03.name = "spine03";
    spine03.position.set(0, 0.5, 0);
    const spine01 = new Bone();
    spine01.name = "spine01";
    spine01.position.set(0, 0.3, 0.05);
    const head = new Bone();
    head.name = "head";
    head.position.set(0, 0.25, 0.02);
    const upper = new Bone();
    upper.name = "upperarm01R";
    upper.position.set(0.2, 0.1, 0);
    spine03.add(spine01);
    spine01.add(head);
    spine01.add(upper);
    root.add(spine03);
    root.userData["openClinXrActorPosture"] = "supine";
    applySupinePoseHoldingIncline(root);
    root.updateMatrixWorld(true);
    const times = [0, 0.28, 0.85];
    const spineValues = [0, 0, 0, 1, 0.2, 0, 0, 1, 0, 0, 0, 1];
    const armValues = [0, 0, 0, 1, 0.3, 0, 0, 1, 0, 0, 0, 1];
    const clip = new AnimationClip("rlq_guard_withdraw_spine", -1, [
      new QuaternionKeyframeTrack("spine03.quaternion", times, spineValues),
      new QuaternionKeyframeTrack("upperarm01R.quaternion", times, armValues),
    ]);
    const mixer = new AnimationMixer(root);
    playManifestMotionClip({ mixer, manifestAddress: { clipId: clip.name }, clips: [clip], overlayRoot: root });
    mixer.existingAction(clip)!.setLoop(LoopOnce, 1);
    mixer.existingAction(clip)!.clampWhenFinished = true;
    const owned = root.userData["openClinXrOwnedBoneChains"] as { ownerId: string; boneNames: string[] }[];
    const claim = owned.find((c) => c.ownerId === "one_shot_response_clip")!;
    expect(claim.boneNames.some((n) => /upperarm/i.test(n))).toBe(true);
    expect(claim.boneNames.some((n) => /spine03|spine01|head/i.test(n))).toBe(false);
    root.updateMatrixWorld(true);
    const headBase = head.getWorldPosition(head.position.clone());
    const armBase = upper.quaternion.clone();
    mixer.update(0.28);
    applySupinePoseHoldingIncline(root);
    root.updateMatrixWorld(true);
    expect(upper.quaternion.angleTo(armBase)).toBeGreaterThan(0.05);
    expect(head.getWorldPosition(head.position.clone()).distanceTo(headBase)).toBeLessThan(1e-6);
    mixer.update(clip.duration + 0.2);
    mixer.existingAction(clip)?.stop();
    applySupinePoseHoldingIncline(root);
    expect(root.userData["openClinXrOwnedBoneChains"]).toBeUndefined();
  });
});
