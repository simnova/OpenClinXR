import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { boundClipJointTrack } from "./bound-clip-foot-track.js";
import { measureBoundClipFootPlant } from "./bound-clip-foot-plant.js";

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


/**
 * A rig whose root travels two metres while one toe counter-translates to stay planted and another
 * rides along. Both extremes in one clip, so the metric has to distinguish them.
 */
async function walkingFixtureGlb(): Promise<string> {
  const document = new Document();
  const buffer = document.createBuffer();
  const frames = 121;
  const seconds = 1;
  const travel = 2;
  const times = new Float32Array(frames);
  const rootTrack = new Float32Array(frames * 3);
  const plantedTrack = new Float32Array(frames * 3);
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / (frames - 1);
    // Deliberately NOT starting at zero: a duration computed as last.atMs rather than
    // last.atMs - first.atMs would read 1.5 s here and report 80 fps instead of 120.
    times[frame] = 0.5 + t * seconds;
    rootTrack[frame * 3 + 1] = 0.9;
    rootTrack[frame * 3 + 2] = t * travel;
    // Exactly negates the root's forward motion, so the planted toe's WORLD position never moves.
    plantedTrack[frame * 3 + 1] = -0.88;
    plantedTrack[frame * 3 + 2] = -t * travel;
  }
  const root = document.createNode("root").setTranslation([0, 0.9, 0]);
  const planted = document.createNode("toe.planted").setTranslation([0, -0.88, 0]);
  const riding = document.createNode("toe.riding").setTranslation([0, -0.88, 0]);
  root.addChild(planted).addChild(riding);
  document.createScene("Scene").addChild(root);

  const input = document
    .createAccessor("t")
    .setType(Accessor.Type.SCALAR)
    .setArray(times)
    .setBuffer(buffer);
  const animation = document.createAnimation("fixture_walk");
  for (const [node, track] of [
    [root, rootTrack],
    [planted, plantedTrack],
  ] as const) {
    const sampler = document
      .createAnimationSampler()
      .setInput(input)
      .setOutput(
        document.createAccessor(`${node.getName()}_t`).setType(Accessor.Type.VEC3).setArray(track).setBuffer(buffer),
      )
      .setInterpolation("LINEAR");
    animation.addSampler(sampler);
    animation.addChannel(
      document.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(sampler),
    );
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "openclinxr-walk-"));
  const glbPath = path.join(directory, "walking.glb");
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

  it("(6) FINDING: a loose contact height counts SWING frames as contact, measured against the root", async () => {
    // The bound is derived from the clip's INPUTS, not from a fraction of the number under test.
    // A foot in contact cannot outrun the root that carries it by much, so one frame of a genuine
    // plant is at most a small multiple of the root's own per-frame advance:
    //   root advance per frame = impliedGroundSpeed / framesPerSecond = 1.115 / 120 = 0.0093 m.
    // At the runtime's 0.06 m the worst toe frame stays inside that. At 0.10 m it is 0.308 m —
    // 33x the root's per-frame travel, which is a swing frame counted as a plant rather than a
    // foot that slipped. The sweep is recorded so a future clip is compared on the same terms.
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    const rootAdvancePerFrame =
      report.clip.impliedGroundSpeedMetersPerSecond / report.clip.framesPerSecond;
    const toe = report.joints.find((entry: { joint: string }) => entry.joint === "toe1-1.L");
    const runtime = toe.contactSweep.find((s: { isRuntimeThreshold: boolean }) => s.isRuntimeThreshold);
    const loose = toe.contactSweep.find(
      (s: { contactHeightMeters: number }) => s.contactHeightMeters === 0.1,
    );
    expect(runtime.worstFrameSlideMeters).toBeLessThan(rootAdvancePerFrame * 5);
    expect(loose.worstFrameSlideMeters).toBeGreaterThan(rootAdvancePerFrame * 5);
    // And exactly one row is the runtime's, so "isRuntimeThreshold" cannot silently match none.
    expect(toe.contactSweep.filter((s: { isRuntimeThreshold: boolean }) => s.isRuntimeThreshold)).toHaveLength(1);
  });

  it("(7) the report NAMES the bytes it measured, so a rebake cannot leave it silently stale", async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    expect(report.asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.asset.bytes).toBeGreaterThan(1_000_000);
    expect(report.asset.clipName).toBe("openclinxr_retarget_cmu_02_01_walk");
  });

  it("(8) the INSTRUMENT itself is exercised: a planted toe reads ~0 and a riding toe reads ~100%", async () => {
    // Clauses (4)-(7) read the landed report, so deleting the instrument would leave them green.
    // This one runs measureBoundClipFootPlant against a constructed rig with both extremes in it.
    const report = await measureBoundClipFootPlant({
      glbPath: await walkingFixtureGlb(),
      clipName: "fixture_walk",
      joints: ["toe.planted", "toe.riding"],
    });
    expect(report.clip.rootTravelMeters).toBeCloseTo(2, 4);
    expect(report.clip.framesPerSecond).toBeCloseTo(120, 3);
    const planted = report.joints.find((row) => row.joint === "toe.planted");
    const riding = report.joints.find((row) => row.joint === "toe.riding");
    const plantedRuntime = planted?.contactSweep.find((row) => row.isRuntimeThreshold);
    const ridingRuntime = riding?.contactSweep.find((row) => row.isRuntimeThreshold);
    expect(plantedRuntime?.fractionOfRootTravel).toBeLessThan(0.001);
    expect(plantedRuntime?.contactFrames).toBeGreaterThan(100);
    expect(ridingRuntime?.fractionOfRootTravel).toBeCloseTo(1, 3);
  });
});
