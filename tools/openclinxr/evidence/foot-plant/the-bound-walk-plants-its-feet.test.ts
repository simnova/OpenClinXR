import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  composeWithGroundAdvance,
  groundSpeedFromStance,
  measureReplacementWalkApproach,
} from "../licence/the-replacement-walk-preserves-approach-behaviour.js";
import { measureBoundClipFootPlant } from "./bound-clip-foot-plant.js";
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
/** SC-04's landed report, which carries the REPLACEMENT clip's measurement beside the CMU control. */
const SC04_REPORT_PATH = path.resolve(
  process.cwd(),
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.json",
);
const PHYSICIAN_GLB = path.resolve(
  process.cwd(),
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
);

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


/**
 * An IN-PLACE walk cycle: the root never moves, one toe holds still in the ground frame while the
 * body advances beneath it, and the other rides along with the body.
 *
 * This is the shape every Mesh2Motion locomotion clip has, and the shape `bound-clip-foot-plant.ts`
 * cannot grade — its denominator is the clip's own root travel, which here is zero.
 */
async function inPlaceWalkFixtureGlb(): Promise<string> {
  const document = new Document();
  const buffer = document.createBuffer();
  const frames = 121;
  const seconds = 1;
  const groundSpeed = 2; // metres per second the body would advance
  const times = new Float32Array(frames);
  const plantedTrack = new Float32Array(frames * 3);
  const ridingTrack = new Float32Array(frames * 3);
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / (frames - 1);
    times[frame] = t * seconds;
    // The planted toe slides BACKWARD in the body frame at exactly the ground speed, which is what
    // a foot on the floor does while the body walks over it. Height stays on the floor.
    plantedTrack[frame * 3 + 1] = -0.88;
    plantedTrack[frame * 3 + 2] = -t * groundSpeed * seconds;
    // The riding toe stays put in the body frame: on the floor and moving with the hips, which is
    // the definition of a skating foot.
    ridingTrack[frame * 3 + 1] = -0.88;
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
  const animation = document.createAnimation("in_place_walk");
  for (const [node, track] of [
    [planted, plantedTrack],
    [riding, ridingTrack],
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "openclinxr-inplace-"));
  const glbPath = path.join(directory, "in-place.glb");
  await new NodeIO().write(glbPath, document);
  return glbPath;
}

describe("the CC0 replacement walk is measured, not assumed", () => {
  it("(9) the in-place instrument reads the ground speed off the stance and separates a plant from a skate", async () => {
    const report = await measureReplacementWalkApproach({
      glbPath: await inPlaceWalkFixtureGlb(),
      clipName: "in_place_walk",
      joints: ["toe.planted", "toe.riding"],
      speedReferenceJoint: "toe.planted",
    });
    // The clip carries no root motion at all, which is exactly why the other instrument cannot
    // grade it: its fractionOfRootTravel would divide by zero and report a perfect score.
    expect(report.clip.rootTravelMeters).toBeCloseTo(0, 6);
    expect(report.clip.inPlace).toBe(true);
    // Speed derived from the stance, not supplied: the fixture's foot gives back 2 m in 1 s.
    expect(report.groundSpeed.groundSpeedMetersPerSecond).toBeCloseTo(2, 3);

    const planted = report.joints.find((row) => row.joint === "toe.planted");
    const riding = report.joints.find((row) => row.joint === "toe.riding");
    const plantedRuntime = planted?.contactSweep.find((row) => row.isRuntimeThreshold);
    const ridingRuntime = riding?.contactSweep.find((row) => row.isRuntimeThreshold);
    expect(plantedRuntime?.fractionOfAdvance).toBeLessThan(0.001);
    expect(plantedRuntime?.contactFrames).toBeGreaterThan(100);
    // The skating foot travels the whole advance while claiming to be on the floor.
    expect(ridingRuntime?.fractionOfAdvance).toBeCloseTo(1, 3);
  });

  it("(10) COUNTERWEIGHT: a clip whose feet never reach the floor has no ground speed, and says so", () => {
    // Zero would be indistinguishable from a body standing still, which is the confusion the whole
    // composed measurement exists to remove.
    expect(() =>
      groundSpeedFromStance([
        { atMs: 0, position: { x: 0, y: 0.5, z: 0 } },
        { atMs: 40, position: { x: 0, y: 0.6, z: -0.1 } },
      ]),
    ).toThrow(/no stance window/u);

    // And the composition is a pure translation: heights are never touched by the advance.
    const composed = composeWithGroundAdvance(
      [
        { atMs: 0, position: { x: 0, y: 0.02, z: 0 } },
        { atMs: 1000, position: { x: 0, y: 0.03, z: -1 } },
      ],
      { groundSpeedMetersPerSecond: 1, forward: { x: 0, z: 1 }, windows: [], contactHeightMeters: 0.06 },
    );
    expect(composed[1]!.position.z).toBeCloseTo(0, 6);
    expect(composed[1]!.position.y).toBeCloseTo(0.03, 6);
  });

  it("(11) the landed SC-04 report carries the replacement's plant beside the CMU control, and declares the regression", async () => {
    const report = JSON.parse(await readFile(SC04_REPORT_PATH, "utf8"));
    const value = (observationId: string): number => {
      const row = report.observations.find((entry: { observationId: string }) => entry.observationId === observationId);
      expect(row, `observation ${observationId}`).toBeDefined();
      return Number(row.value);
    };
    // Both clips measured by the identical procedure, so the comparison is like for like.
    const replacementLeft = value("walk-formal-toe-left-slide-fraction");
    const controlLeft = value("cmu-control-toe-left-slide-fraction");
    const replacementRight = value("walk-formal-toe-right-slide-fraction");
    const controlRight = value("cmu-control-toe-right-slide-fraction");
    for (const fraction of [replacementLeft, controlLeft, replacementRight, controlRight]) {
      expect(fraction).toBeGreaterThan(0);
      expect(fraction).toBeLessThan(1);
    }
    // The contact count travels with the fraction: a zero-contact zero-slide reading is the metric
    // saying it observed nothing, and must not look like a clean plant.
    expect(value("walk-formal-toe-left-contact-frames")).toBeGreaterThan(10);

    // THE FINDING, asserted rather than buried: the replacement plants WORSE than the clip it
    // replaces, and the report says so in its own unresolved defects. If a later slice improves the
    // clip this clause fails and has to be rewritten deliberately — which is the point.
    expect(replacementLeft).toBeGreaterThan(controlLeft);
    expect(replacementRight).toBeGreaterThan(controlRight);
    const declared = report.limits.unresolvedDefects.join("\n");
    expect(declared).toMatch(/FOOT-PLANT REGRESSION/u);
    expect(declared).toMatch(/SPEED MISMATCH/u);
  });

  it("(12) the retired CMU clip is gone from the shipped physician, so the older report cannot read as current", async () => {
    const document = await new NodeIO().read(PHYSICIAN_GLB);
    const clips = document.getRoot().listAnimations().map((animation) => animation.getName());
    expect(clips).not.toContain("openclinxr_retarget_cmu_02_01_walk");
    expect(clips).toContain("openclinxr_retarget_walk_formal_cc0");

    // The historical report still names the CMU clip, which is correct — it measured that clip. The
    // pair of assertions above is what stops it being mistaken for a description of what ships.
    const historical = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    expect(historical.asset.clipName).toBe("openclinxr_retarget_cmu_02_01_walk");
  });
});
