import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISPLAYED_WALK_REPORT_PATH,
  classifyDisplayedWalk,
  type DisplayedWalkPass,
} from "./displayed-walk-on-the-loaded-physician.js";

/**
 * Brief §7 step 5: "Capture actual displayed motion, not merely successful loading or a
 * `clipPlayed` flag."
 *
 * The classifier is exercised directly against constructed passes, so the rule that a flag is not
 * evidence runs on a clean clone. The landed report is then read for the measurement itself: the
 * live browser run needs a dev server and a GPU-less chromium, which does not belong in a unit
 * suite, and its numbers are bound to the scenario and actor it names.
 */

const REPORT_PATH = path.resolve(process.cwd(), DISPLAYED_WALK_REPORT_PATH);

function passWithToeSpan(spanMeters: number, playing: boolean): DisplayedWalkPass {
  return {
    locomotionDrive: playing ? 1 : 0,
    actorId: "senior_resident_ward_v1",
    locomotionClipName: "openclinxr_retarget_cmu_02_01_walk",
    clipPlaybackFlag: { clipName: "openclinxr_retarget_cmu_02_01_walk", playing },
    ownedBoneChains: ["foot"],
    joints: [
      {
        joint: "toe1-1.L",
        samples: [
          { frame: 0, position: { x: 0, y: 0, z: 0 } },
          { frame: 1, position: { x: spanMeters, y: 0, z: 0 } },
        ],
        pathLengthMeters: spanMeters,
        spanMeters,
      },
    ],
    skinnedCentre: {
      joint: "skinned_mesh_centre",
      samples: [{ frame: 0, position: { x: 0, y: 1, z: 0 } }],
      pathLengthMeters: 0,
      spanMeters: 0,
    },
    framesSampled: 2,
  };
}

describe("the runtime displays the walk, and a flag is not the evidence", () => {
  it("(1) COUNTERWEIGHT: `playing: true` with no measured motion is UNSATISFIED", () => {
    // The brief names this failure by name. A runtime that set the flag and animated nothing must
    // not read as a pass, so the outcome is decided by joint displacement and the flag is reported
    // beside it rather than believed.
    const verdict = classifyDisplayedWalk({
      driven: passWithToeSpan(0.04, true),
      control: passWithToeSpan(0.038, false),
    });
    expect(verdict.outcome).toBe("unsatisfied");
    expect(verdict.evidence).toMatch(/playing/u);
  });

  it("(2) the control is not zero, so the margin is against ambient motion rather than against nothing", () => {
    // Breathing and sway move a standing figure. A treatment that merely beats zero would pass on
    // an idle actor, so the margin is five times the measured control.
    const verdict = classifyDisplayedWalk({
      driven: passWithToeSpan(0.15, true),
      control: passWithToeSpan(0.038, false),
    });
    expect(verdict.outcome).toBe("unsatisfied");
    expect(classifyDisplayedWalk({
      driven: passWithToeSpan(0.25, true),
      control: passWithToeSpan(0.038, false),
    }).outcome).toBe("satisfied");
  });

  it("(3) no staged actor with a clip is UNKNOWN and names the cast, not a silent pass", () => {
    const verdict = classifyDisplayedWalk({
      driven: null,
      control: null,
      stagedActors: [
        { actorId: "patient_robert_hayes_v1", locomotionClipName: null, playback: null },
      ],
    });
    expect(verdict.outcome).toBe("unknown");
    expect(verdict.evidence).toContain("patient_robert_hayes_v1");
  });

  it("(4) the LANDED run measured a walk on the loaded, posed, skinned physician", async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    expect(report.outcome).toBe("satisfied");
    expect(report.driven.actorId).toBe("senior_resident_ward_v1");
    expect(report.driven.locomotionClipName).toBe("openclinxr_retarget_cmu_02_01_walk");
    const drivenToe = report.driven.joints.find((row: { joint: string }) => row.joint === "toe1-1.L");
    const controlToe = report.control.joints.find((row: { joint: string }) => row.joint === "toe1-1.L");
    expect(drivenToe.spanMeters).toBeGreaterThan(controlToe.spanMeters * 5);
    // EVERY sampled leg joint moved, not just the one the classifier reads. A clip driving one
    // bone would satisfy the classifier and look nothing like a walk.
    for (const row of report.driven.joints) {
      expect(row.spanMeters, `${row.joint} span`).toBeGreaterThan(0.5);
    }
    // And the figure a learner sees moved, not only the skeleton.
    expect(report.driven.skinnedCentre.samples.length).toBeGreaterThan(10);
    expect(report.driven.skinnedCentre.pathLengthMeters).toBeGreaterThan(1);
  });

  it("(5) the drive-off control is genuinely still — every leg joint under 6 cm", async () => {
    // Without this, a report whose control ALSO walked would satisfy clause (4)'s 5x ratio at any
    // scale, and the comparison would be measuring frame count rather than motion.
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    for (const row of report.control.joints) {
      expect(row.spanMeters, `${row.joint} control span`).toBeLessThan(0.06);
    }
    expect(report.control.clipPlaybackFlag?.playing).toBe(false);
  });
});
