import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { boundClipJointTrack } from "./bound-clip-foot-track.js";

/**
 * Two things are proved here and they need different evidence.
 *
 * THE FK MATHS is proved against a CONSTRUCTED two-bone glTF built in this file. It runs on a clean
 * clone and fails if parent order, quaternion composition or interpolation is wrong.
 *
 * THE PHYSICIAN MEASUREMENT is proved against the LANDED REPORT, because the bound GLB is 11.6 MB
 * under `.openclinxr/`, which is gitignored and has no land path. The report carries the GLB's
 * sha256, so a rebake that changes the bytes without re-running the instrument leaves a report that
 * names a file nobody has — which is visible rather than silent.
 */

const REPORT_PATH = path.resolve(process.cwd(), "docs/openclinxr/evidence/bound-clip-foot-plant.json");

async function twoBoneChainGlb(interpolation: "LINEAR" | "CUBICSPLINE"): Promise<string> {
  const document = new Document();
  const buffer = document.createBuffer();
  // Parent one metre up; child one metre forward of the parent. Rotating the PARENT about Y must
  // swing the child; a chain walked in the wrong order leaves the child where it started.
  const child = document.createNode("child").setTranslation([0, 0, 1]);
  const parent = document.createNode("parent").setTranslation([0, 1, 0]).addChild(child);
  document.createScene("Scene").addChild(parent);

  const times = document
    .createAccessor("times")
    .setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const quarterTurnAboutY = Math.SQRT1_2;
  const values = document
    .createAccessor("rotations")
    .setType(Accessor.Type.VEC4)
    .setArray(
      interpolation === "LINEAR"
        ? new Float32Array([0, 0, 0, 1, 0, quarterTurnAboutY, 0, quarterTurnAboutY])
        : // CUBICSPLINE stores in-tangent, value and out-tangent per keyframe.
          new Float32Array([
            0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
            0, 0, 0, 0, 0, quarterTurnAboutY, 0, quarterTurnAboutY, 0, 0, 0, 0,
          ]),
    )
    .setBuffer(buffer);
  const sampler = document
    .createAnimationSampler()
    .setInput(times)
    .setOutput(values)
    .setInterpolation(interpolation);
  const channel = document
    .createAnimationChannel()
    .setTargetNode(parent)
    .setTargetPath("rotation")
    .setSampler(sampler);
  document.createAnimation("probe_clip").addSampler(sampler).addChannel(channel);

  const directory = await mkdtemp(path.join(os.tmpdir(), "openclinxr-fk-"));
  const glbPath = path.join(directory, "chain.glb");
  await new NodeIO().write(glbPath, document);
  return glbPath;
}

describe("forward kinematics over a bound glTF clip", () => {
  it("(1) a rotation on the PARENT swings the child, and the chain is composed root-first", async () => {
    const track = await boundClipJointTrack({
      glbPath: await twoBoneChainGlb("LINEAR"),
      clipName: "probe_clip",
      boneName: "child",
    });
    const [start, end] = [track.samples[0]!, track.samples[track.samples.length - 1]!];
    expect(start.position.x).toBeCloseTo(0, 5);
    expect(start.position.y).toBeCloseTo(1, 5);
    expect(start.position.z).toBeCloseTo(1, 5);
    // A quarter turn about +Y takes the child's local +Z to world +X.
    expect(end.position.x).toBeCloseTo(1, 5);
    expect(end.position.y).toBeCloseTo(1, 5);
    expect(end.position.z).toBeCloseTo(0, 5);
  });

  it("(2) COUNTERWEIGHT: it REFUSES a cubic-spline sampler rather than reading tangents as values", async () => {
    // A CUBICSPLINE accessor stores three vec4s per keyframe. Sampling it with a linear stride
    // returns tangents as rotations, which is a wrong answer wearing the shape of a measurement.
    await expect(
      boundClipJointTrack({
        glbPath: await twoBoneChainGlb("CUBICSPLINE"),
        clipName: "probe_clip",
        boneName: "child",
      }),
    ).rejects.toThrow(/CUBICSPLINE/u);
  });

  it("(3) an absent joint NAMES itself rather than returning an empty track", async () => {
    await expect(
      boundClipJointTrack({
        glbPath: await twoBoneChainGlb("LINEAR"),
        clipName: "probe_clip",
        boneName: "toe1-1.L",
      }),
    ).rejects.toThrow(/no node named toe1-1\.L/u);
  });
});

describe("the bound walk plants its feet on the physician rig", () => {
  it("(4) the toes slide a SMALL fraction of root travel where the root-driven executor slides ALL of it", async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    // The number the clip has to beat, recomputed by the instrument from the same metric.
    expect(report.rootDrivenExecutorBaseline.fractionOfPath).toBeGreaterThan(0.95);
    for (const joint of ["toe1-1.L", "toe1-1.R"]) {
      const row = report.joints.find((entry: { joint: string }) => entry.joint === joint);
      const runtime = row.contactSweep.find((s: { isRuntimeThreshold: boolean }) => s.isRuntimeThreshold);
      expect(runtime.fractionOfRootTravel, `${joint} at the runtime contact height`).toBeLessThan(0.2);
      // Zero slide with zero contact is the metric reporting that it observed nothing, so the
      // contact count travels with the fraction.
      expect(runtime.contactFrames, `${joint} contact frames`).toBeGreaterThan(10);
    }
  });

  it("(5) the clip's own ground speed matches the executor's assumed walking speed", async () => {
    // This is what the 24 fps export defeated. The bind stage inherited Blender's default scene
    // frame rate instead of the BVH's declared Frame Time, so a 120 fps capture exported at 24 fps:
    // a 2.87 s walk became 14.33 s and the rig's ground speed fell from 1.115 to 0.223 m/s. A clip
    // playing five times too slowly under a root advancing at CLINICIAN_WALK_SPEED_MPS drags its
    // feet four fifths of the distance however well it plants, so the plant measurement above is
    // only meaningful beside this one.
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    expect(report.clip.framesPerSecond).toBeCloseTo(120, 0);
    expect(report.executorSpeedMatch.ratio).toBeGreaterThan(0.9);
    expect(report.executorSpeedMatch.ratio).toBeLessThan(1.1);
  });

  it("(6) FINDING: contact height decides the answer, so the report carries a sweep and names the runtime's own", async () => {
    // At 0.10 m the same toes measure roughly half of root travel and their worst single frame
    // exceeds 0.29 m. At 120 fps that is 35 m/s for one frame, which is a swing frame counted as a
    // plant rather than a foot that slipped. The runtime threshold is the one that measures
    // contact; the looser rows are recorded so a future clip is compared on the same terms.
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    const toe = report.joints.find((entry: { joint: string }) => entry.joint === "toe1-1.L");
    const loose = toe.contactSweep.find(
      (s: { contactHeightMeters: number }) => s.contactHeightMeters === 0.1,
    );
    expect(loose.fractionOfRootTravel).toBeGreaterThan(0.4);
    expect(loose.worstFrameSlideMeters).toBeGreaterThan(0.25);
    expect(toe.contactSweep.filter((s: { isRuntimeThreshold: boolean }) => s.isRuntimeThreshold)).toHaveLength(1);
  });

  it("(7) the report NAMES the bytes it measured, so a rebake cannot leave it silently stale", async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    expect(report.asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.asset.bytes).toBeGreaterThan(1_000_000);
    expect(report.asset.clipName).toBe("openclinxr_retarget_cmu_02_01_walk");
  });
});
