import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MPFB_WALK_JOINTS,
  sampleWalkClip,
} from "../index.js";
import {
  walkContactPhases,
  type WalkContactPhases,
} from "./walk_contact_phases.js";

/**
 * Footstep-plan S1 O3: the tracked contact-phase JSON matches a fresh
 * sampleWalkClip reduction of the bound physician walk.
 *
 * The JSON is build-time data for the S2 planner (per-foot plant/lift as
 * cycle fractions, step length, stance duration). Any clip-byte change must
 * turn this test red via the sha pin, never silently shift the planner.
 */
const PHYSICIAN_GLB = "../../../apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
const CLIP = "openclinxr_retarget_walk_source";
const JSON_PATH = "src/motion_retarget/physician-walk-contact-phases.json";

function close(got: number, want: number): void {
  expect(got).toBeCloseTo(want, 9);
}

describe("bound physician walk contact phases (S1 O3)", () => {
  it("matches a fresh sampleWalkClip reduction and the 1.708 s cycle", async () => {
    const { sample, frames, sha256 } = await sampleWalkClip({
      glbPath: PHYSICIAN_GLB,
      clipName: CLIP,
      joints: MPFB_WALK_JOINTS,
    });
    const fresh = walkContactPhases(sample, MPFB_WALK_JOINTS);
    const doc = JSON.parse(readFileSync(JSON_PATH, "utf8")) as WalkContactPhases & {
      schema: string;
      provenance: { glb: string; clip: string; sha256: string; frames: number };
    };

    // Pinned to the clip bytes: a rebind must fail here, not drift the planner.
    expect(doc.schema).toBe("openclinxr.walk-contact-phases.v1");
    expect(doc.provenance.clip).toBe(CLIP);
    expect(doc.provenance.frames).toBe(frames);
    expect(doc.provenance.sha256).toBe(sha256);
    expect(doc.provenance.sha256).toBe(
      createHash("sha256").update(readFileSync(PHYSICIAN_GLB)).digest("hex"),
    );

    // The 1.708 s cycle (mixer loop period) within 1 %.
    expect(fresh.cycleS).toBeCloseTo(1.708, 2);
    close(doc.cycleS, fresh.cycleS);

    // One contact window per foot: the S2 half-cycle mapping assumption.
    expect(fresh.contactWindows).toEqual({ left: 1, right: 1 });
    expect(doc.contactWindows).toEqual({ left: 1, right: 1 });

    // Every number matches the fresh reduction exactly.
    for (const side of ["left", "right"] as const) {
      for (const key of [
        "plantS",
        "liftS",
        "plantPhase",
        "liftPhase",
        "stepLengthM",
        "stanceDurationS",
        "contactFraction",
      ] as const) {
        close(doc[side][key], fresh[side][key]);
      }
    }
    close(doc.stepFractionLeftToRight, fresh.stepFractionLeftToRight);
    close(doc.stepFractionRightToLeft, fresh.stepFractionRightToLeft);

    // L/R steps are not equal length (P4): the planner must not assume symmetry.
    expect(Math.abs(fresh.left.stepLengthM - fresh.right.stepLengthM)).toBeGreaterThan(0.01);
    process.stdout.write(
      `[contact] cycleS=${fresh.cycleS.toFixed(6)} ` +
        `L plant=${fresh.left.plantPhase.toFixed(4)} lift=${fresh.left.liftPhase.toFixed(4)} step=${fresh.left.stepLengthM.toFixed(4)}m stance=${fresh.left.stanceDurationS.toFixed(4)}s ` +
        `R plant=${fresh.right.plantPhase.toFixed(4)} lift=${fresh.right.liftPhase.toFixed(4)} step=${fresh.right.stepLengthM.toFixed(4)}m stance=${fresh.right.stanceDurationS.toFixed(4)}s\n`,
    );
  });
});
