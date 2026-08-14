/**
 * Dark-factory B — motion-bind stage contract.
 *
 * Fails if the stage output clip is missing or has zero channels.
 *
 * NOT TESTED: visual walk quality, clinical usefulness of a locomotion clip on a
 * standing peds parent, runtime mixer playback in ui-xr, whether Automatic
 * identification would have worked without the injected MPFB2 map, Mesh2Motion
 * CC0 clip salvage, mixamo_unity rebake of the actor (MADR 0052 rig decision
 * is not this slice).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT,
  DEFAULT_REPORT,
  inspectMotionBindOutput,
  isRetargetClipName,
  PREEXISTING_CLIPS,
} from "./motion-bind-cli.js";

describe("motion-bind stage emits a non-empty retarget clip", () => {
  it("inspect helper treats a missing file as zero clips (the fail shape)", async () => {
    const empty = await inspectMotionBindOutput("/tmp/openclinxr-no-such-motion-bind.glb");
    expect(empty.animationCount).toBe(0);
    expect(empty.retargetClip).toBeNull();
    expect(empty.meshCount).toBe(0);
    expect(isRetargetClipName("ClinicalIdleConversation")).toBe(false);
    expect(PREEXISTING_CLIPS.has("ClinicalIdleConversation")).toBe(true);
  });

  it("output GLB exists and is larger than an empty container", () => {
    expect(existsSync(DEFAULT_OUTPUT), `output missing: ${DEFAULT_OUTPUT}`).toBe(true);
    expect(statSync(DEFAULT_OUTPUT).size, "output bytes").toBeGreaterThan(64);
  });

  it("output clip is present with more than zero channels", async () => {
    const inspect = await inspectMotionBindOutput(DEFAULT_OUTPUT);
    expect(inspect.retargetClip, `clips=${JSON.stringify(inspect.clips)}`).not.toBeNull();
    expect(inspect.retargetClip?.channelCount ?? 0, "retarget clip channel count").toBeGreaterThan(0);
  });

  it("output GLB carries at least one mesh (not armature-only)", async () => {
    const inspect = await inspectMotionBindOutput(DEFAULT_OUTPUT);
    expect(inspect.meshCount, "mesh count").toBeGreaterThanOrEqual(1);
  });

  it("stage report names the operator and a positive driven-bone count", () => {
    expect(existsSync(DEFAULT_REPORT), `report missing: ${DEFAULT_REPORT}`).toBe(true);
    const report = JSON.parse(readFileSync(DEFAULT_REPORT, "utf8")) as {
      verdict?: string;
      operator?: string;
      drivenBoneCount?: number;
      clipName?: string;
    };
    expect(report.verdict).toBe("ok");
    expect(report.operator).toMatch(/mcp\.load_and_retarget/);
    expect(report.drivenBoneCount ?? 0).toBeGreaterThan(0);
    expect(report.clipName).toBeTruthy();
  });
});
