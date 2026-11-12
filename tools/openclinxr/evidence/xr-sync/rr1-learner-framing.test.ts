import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordEnvironmentGlb, snapshotLearnerPose } from "./rr1-learner-framing.mjs";

describe("RR1 learner framing recorders", () => {
  it("pose snapshot equals its fields and leaves the stand-in deep-equal before/after", () => {
    const standIn = {
      position: { x: 0, y: 1.48, z: 5.35 },
      direction: { x: 0, y: -0.0793, z: -0.9969 },
      fov: 55,
      aspect: 1.6,
      near: 0.1,
      far: 100,
    };
    const before = JSON.parse(JSON.stringify(standIn));
    const snapshot = snapshotLearnerPose(standIn, 1005000);
    expect(snapshot).toEqual({ ...before, wallMs: 1005000 });
    expect(standIn).toEqual(before);
  });

  it("GLB booleans flip exactly at equality (wallMs == ch1Ms -> loadedBeforeCh1 false)", () => {
    const body = Buffer.from("glb-bytes");
    const expectedSha = createHash("sha256").update(body).digest("hex");
    const before = recordEnvironmentGlb({
      url: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
      body,
      wallMs: 999000,
      sceneReadyWallMs: 1000000,
      ch1WallMs: 1005000,
    });
    expect(before).toEqual({
      url: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
      bytes: body.length,
      sha256: expectedSha,
      wallMs: 999000,
      loadedBeforeSceneReady: true,
      loadedBeforeCh1: true,
    });
    const atEquality = recordEnvironmentGlb({
      url: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
      body,
      wallMs: 1005000,
      sceneReadyWallMs: 1000000,
      ch1WallMs: 1005000,
    });
    expect(atEquality.loadedBeforeSceneReady).toBe(false);
    expect(atEquality.loadedBeforeCh1).toBe(false);
  });
});
