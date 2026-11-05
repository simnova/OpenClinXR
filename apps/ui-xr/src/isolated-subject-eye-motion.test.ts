import {
  humanoidBlinkIntervalMs,
  sampleHumanoidBlinkSchedule,
} from "@openclinxr/xr-humanoid-animation";
import { Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

type Frame = {
  tMs: number;
  state: "listening" | "rest";
  blinkClosureInfluence: number | null;
  leftEyeYaw: number | null;
  leftEyePitch: number | null;
};

type Surface = {
  location?: { search: string };
  __openClinXrIsolatedEyeMotionFrames?: Frame[];
  __openClinXrIsolatedEyeMotionFrame?: (nowMs: number) => Frame;
};

function fixtureRoot(): { root: Group; face: Mesh } {
  const root = new Group();
  const head = new Bone();
  head.name = "head";
  head.quaternion.set(0.978, 0.032, -0.155, 0.133).normalize();
  const left = new Bone();
  left.name = "eyeL";
  left.rotation.set(-1.4, 0, 0.41);
  const right = new Bone();
  right.name = "eyeR";
  right.rotation.set(0, 0, -0.37);
  head.add(left, right);
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = {
    "eye-left-closure": 0,
    "eye-right-closure": 1,
    "eye-left-slit": 2,
    "eye-right-slit": 3,
  };
  face.morphTargetInfluences = [0, 0, 0, 0];
  root.add(head, face);
  root.updateMatrixWorld(true);
  return { root, face };
}

function listeningTimeline(durationMs: number): number[] {
  const samples = new Set<number>();
  for (let tMs = 0; tMs <= durationMs; tMs += 1000 / 60) samples.add(tMs);
  let cursorMs = 0;
  for (let blinkIndex = 0; blinkIndex < 100; blinkIndex += 1) {
    const intervalMs = humanoidBlinkIntervalMs("listening", blinkIndex);
    const peakMs = cursorMs + intervalMs - 210;
    if (peakMs > durationMs) break;
    samples.add(peakMs);
    cursorMs += intervalMs;
  }
  return [...samples].sort((left, right) => left - right);
}

describe("the isolated lab uses the product conversational-eye path", () => {
  it("installs nothing when eyeMotion is absent", () => {
    const surface: Surface = { location: { search: "?focus=eyes" } };
    const installed = sampleHumanoidBlinkSchedule.bootIsolatedSubjectEyeMotion(surface);
    expect(installed).toBe(false);
    expect(surface.__openClinXrIsolatedEyeMotionFrame).toBeUndefined();
    expect(surface.__openClinXrIsolatedEyeMotionFrames).toBeUndefined();
  });

  it("applies product listening blinks and eye-bone yaw over ten simulated seconds", () => {
    const surface: Surface = {};
    let renders = 0;
    expect(sampleHumanoidBlinkSchedule.installIsolatedSubjectEyeMotionFrame(surface, {
      state: "listening",
      root: fixtureRoot().root,
      driver: sampleHumanoidBlinkSchedule.applyIsolatedHumanoidEyeMotion,
      render: () => { renders += 1; },
      startedAtMs: 0,
    })).toBe(true);

    const frames = listeningTimeline(10_000).map((nowMs) => surface.__openClinXrIsolatedEyeMotionFrame!(nowMs));
    const firstPeakMs = humanoidBlinkIntervalMs("listening", 0) - 210;
    const peak = frames.find((frame) => frame.tMs === Number(firstPeakMs.toFixed(3)));
    expect(sampleHumanoidBlinkSchedule(firstPeakMs, "listening").intensity).toBe(1);
    expect(peak?.blinkClosureInfluence).toBe(1);
    expect(Math.max(...frames.map((frame) => frame.blinkClosureInfluence ?? 0))).toBe(1);

    const yaw = frames
      .map((frame): number | null => frame.leftEyeYaw)
      .filter((value): value is number => value !== null);
    expect(yaw.length).toBe(frames.length);
    expect(Math.max(...yaw) - Math.min(...yaw)).toBeGreaterThan(0.02);
    expect(surface.__openClinXrIsolatedEyeMotionFrames).toEqual(frames);
    expect(renders).toBe(frames.length);
  });

  it("returns blink slit morphs to the emotion-neutral value within 50 ms of blink end", () => {
    const surface: Surface = {};
    const { root, face } = fixtureRoot();
    sampleHumanoidBlinkSchedule.installIsolatedSubjectEyeMotionFrame(surface, {
      state: "listening",
      root,
      driver: sampleHumanoidBlinkSchedule.applyIsolatedHumanoidEyeMotion,
      render: () => undefined,
      startedAtMs: 0,
    });

    const blinkEndMs = humanoidBlinkIntervalMs("listening", 0);
    surface.__openClinXrIsolatedEyeMotionFrame!(0);
    surface.__openClinXrIsolatedEyeMotionFrame!(blinkEndMs - 210);
    expect(face.morphTargetInfluences?.[2]).toBe(1);
    expect(face.morphTargetInfluences?.[3]).toBe(1);

    const after = surface.__openClinXrIsolatedEyeMotionFrame!(blinkEndMs + 1);
    expect(after.blinkClosureInfluence).toBe(0);
    expect(face.morphTargetInfluences?.[2]).toBe(0);
    expect(face.morphTargetInfluences?.[3]).toBe(0);
  });
});
