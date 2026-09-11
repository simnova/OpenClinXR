import path from "node:path";
import { describe, expect, it } from "vitest";
import { planBedsideApproach } from "../../../../packages/openclinxr/asset-registry/src/bedside-approach-path.js";
import {
  ED_STRETCHER_DECK_BOUNDS,
  bedsideTargetForClinician,
  footSlideMeters,
  stepBedsideApproach,
} from "../../../../packages/openclinxr/asset-registry/src/index.js";
import { jointWorldTrack, parseBvh } from "./bvh-foot-plant.js";

/**
 * Does a locomotion clip actually fix step 4's failing foot-slide number?
 *
 * The root-driven executor slides its feet the entire distance travelled, because nothing drives
 * the legs. That is measured and recorded. The question this answers is whether the walk BVH
 * already on disk would fix it — answered by MEASURING the clip rather than by adopting it and
 * hoping.
 *
 * THE CLIP: `cmu_02_01_walk.bvh`, CMU Graphics Lab mocap. Its ledger row
 * (`asset-licence-records/row-08-cmu-graphics-lab-mocap.json`) reads "CONDITIONAL — not CC0/CC-BY.
 * Free for research and commercial products, but the data may not be resold even converted" and
 * records it as "already used once (walk BVH)". Usable here; the ledger prefers a CC0 source where
 * one exists, and that preference is not overridden by this measurement.
 *
 * THE CONTACT POINT IS THE TOE, not the foot joint. `LeftFoot` in a CMU rig is the ANKLE: its
 * median height is 1.79 units and only 27 of 344 frames fall below 1.0, which reads as "the feet
 * barely touch the floor" and is simply the wrong joint. Measured before it became a conclusion.
 */
const CLIP_PATH = path.resolve(
  process.cwd(),
  "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_02_01_walk.bvh",
);

function rootTravelUnits(): number {
  const clip = parseBvh(CLIP_PATH);
  const hips = jointWorldTrack(clip, "Hips");
  const first = hips[0]!.position;
  const last = hips[hips.length - 1]!.position;
  return Math.hypot(last.x - first.x, last.z - first.z);
}

describe("the walk clip plants its feet, and the root-driven executor does not", () => {
  it("(1) the root-driven executor slides its feet the WHOLE distance — the failing baseline", () => {
    const target = bedsideTargetForClinician({
      patientPosition: { x: -0.9, y: 0, z: -0.1 },
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
    }).position;
    const plan = planBedsideApproach({
      from: { x: 2.6, y: 0, z: 2.2 },
      target,
      facing: { x: -0.9, y: 0, z: -0.1 },
      obstacles: [],
    });
    const samples = [];
    for (let elapsedMs = 0; elapsedMs <= 4000; elapsedMs += 100) {
      const pose = stepBedsideApproach({ plan, elapsedMs });
      samples.push({ atMs: elapsedMs, position: { x: pose.position.x, y: 0.02, z: pose.position.z } });
    }
    const report = footSlideMeters(samples);
    const pathLength = Math.hypot(target.x - 2.6, target.z - 2.2);
    // ~100% of travel. This is the number a locomotion clip has to beat.
    expect(report.slideMeters / pathLength).toBeGreaterThan(0.95);
  });

  it("(2) the walk clip's planted toes slide FAR less, at every tight contact threshold", () => {
    const clip = parseBvh(CLIP_PATH);
    const travel = rootTravelUnits();
    // A SWEEP rather than one threshold, because the answer is threshold-sensitive and picking the
    // single threshold that flatters the clip would be fitting a number to a conclusion.
    for (const contactHeight of [0.4, 0.6, 0.8]) {
      for (const toe of ["LeftToeBase", "RightToeBase"]) {
        const report = footSlideMeters(jointWorldTrack(clip, toe), contactHeight);
        const fraction = report.slideMeters / travel;
        expect(
          fraction,
          `${toe} at contact height ${contactHeight}: ${(fraction * 100).toFixed(1)}% of root travel`,
        ).toBeLessThan(0.2);
        // And it OBSERVED something: a clip whose toes never reach the floor would report zero
        // slide and zero contact, which is not a pass.
        expect(report.contactFrames).toBeGreaterThan(10);
      }
    }
  });

  it("(3) FINDING: the clip is asymmetric — the right toe slides several times the left, at EVERY threshold", () => {
    // This survives the sweep, so it is a property of the clip rather than of the threshold. It is
    // recorded because adopting this clip means adopting that asymmetry, and a reader comparing a
    // future clip needs the number rather than "it looked fine".
    const clip = parseBvh(CLIP_PATH);
    for (const contactHeight of [0.4, 0.6, 0.8, 1.0]) {
      const left = footSlideMeters(jointWorldTrack(clip, "LeftToeBase"), contactHeight);
      const right = footSlideMeters(jointWorldTrack(clip, "RightToeBase"), contactHeight);
      expect(
        right.slideMeters,
        `at ${contactHeight} the right toe should slide more than the left`,
      ).toBeGreaterThan(left.slideMeters);
    }
  });

  it("(4) the ANKLE is not the contact point, and using it would misread the clip", () => {
    // Recorded because it was the first thing measured and it was wrong: the ankle reads as
    // barely touching the floor, which would have concluded the clip does not plant at all.
    const clip = parseBvh(CLIP_PATH);
    const ankle = jointWorldTrack(clip, "LeftFoot").map((sample) => sample.position.y);
    const toe = jointWorldTrack(clip, "LeftToeBase").map((sample) => sample.position.y);
    expect(Math.min(...toe)).toBeLessThan(Math.min(...ankle));
  });
});
