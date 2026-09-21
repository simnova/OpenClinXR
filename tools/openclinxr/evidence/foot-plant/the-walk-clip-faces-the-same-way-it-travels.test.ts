import path from "node:path";
import { describe, expect, it } from "vitest";
import { FOOT_CONTACT_HEIGHT_METERS } from "../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import { measureStanceGroundAdvance } from "../../../../packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime.js";
import { boundClipJointTrack } from "./bound-clip-foot-track.js";

/**
 * The shipped physician walk travels opposite the way the rest toes point.
 *
 * Diagnosis (review 2026-09-20 T3, FK via boundClipJointTrack on
 * mpfb-clinical-physician-adult.glb #openclinxr_retarget_walk_formal_cc0):
 * rest `toe1-1.L − foot.L` z = +0.128 m; longest stance-window travel
 * forward = {x: −0.0122, z: −0.9999}. Missing `--source-orientation` is a
 * different defect (feet Y 0.72–1.31 m). Do not treat that flag as a 180° yaw fix.
 *
 * Diagnosis and measured tables in this planted header are IMMUTABLE. Flip the
 * assertion and append a `## FIXED` block below. Do not rewrite the original
 * paths or numbers.
 *
 * ## FIXED (tsk_f68d658c9938ce74)
 * Node graft of existing Walk_Formal sampler outputs reversed in time via
 * `rebindBoundClipTravelHeading` in graft-bound-clip.ts. Stance-window travel z
 * now matches rest toe−ankle +Z. inPlace / rootTravelMeters 0 unchanged.
 * Rest z stays > 0.05 m. Not a 180 yaw, not --source-orientation, not IK bake.
 *
 * claimScope: clip-space heading of Walk_Formal on the shipped physician.
 * notEvidenceFor: foot plant, gait, Quest, browser A08, factory IK bake.
 */

const PHYSICIAN_GLB = path.resolve(
  process.cwd(),
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
);
const CLIP = "openclinxr_retarget_walk_formal_cc0";

describe("the walk clip faces the same way it travels", () => {
  it("(1) rest left toe sits in +Z of the left foot (known-good column)", async () => {
    const [toe, foot] = await Promise.all([
      boundClipJointTrack({ glbPath: PHYSICIAN_GLB, clipName: CLIP, boneName: "toe1-1.L" }),
      boundClipJointTrack({ glbPath: PHYSICIAN_GLB, clipName: CLIP, boneName: "foot.L" }),
    ]);
    const restToe = toe.samples[0]!.position;
    const restFoot = foot.samples[0]!.position;
    expect(restToe.z - restFoot.z).toBeGreaterThan(0.05);
  });

  it(
    "(2) longest stance-window travel has the same sign as rest toe−ankle z",
    async () => {
      const [toe, foot] = await Promise.all([
        boundClipJointTrack({ glbPath: PHYSICIAN_GLB, clipName: CLIP, boneName: "toe1-1.L" }),
        boundClipJointTrack({ glbPath: PHYSICIAN_GLB, clipName: CLIP, boneName: "foot.L" }),
      ]);
      const restDeltaZ = toe.samples[0]!.position.z - foot.samples[0]!.position.z;
      const advance = measureStanceGroundAdvance(toe.samples, {
        contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
        floorOriginY: 0,
      });
      expect(advance.windowFrames).toBeGreaterThan(1);
      expect(advance.metersPerSecond).toBeGreaterThan(0);
      expect(Math.sign(advance.forward.z)).toBe(Math.sign(restDeltaZ));
    },
  );
});
