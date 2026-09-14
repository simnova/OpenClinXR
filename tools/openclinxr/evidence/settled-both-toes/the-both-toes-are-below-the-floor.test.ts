import { describe, expect, it } from "vitest";
import {
  intentFor,
  measurementFor,
  runApproach,
  stageWard,
} from "../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import { decodePhysician } from "../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import { gradeMotionMeasurement } from "../scene-closure/proofs/sc-00/measurement-rubric.js";

/**
 * Both toes' signed height across the settled and arrived phases of the shipped capture.
 *
 * Card tsk_7a70fe19156af6a8: the rubric grades the deeper of both toes
 * (gradeFloorPenetration, measurement-rubric.ts:462-487) while the settled correction is
 * structurally single-footed (findStanceChain, stance-lock-mod.ts:84). This test measures,
 * BEFORE any source change, whether both toes are below the floor across the settled and
 * arrived phases — the premise the card's fix depends on.
 *
 * The drive is the production `runApproach` over the SHIPPED physician GLB and shipped walk
 * clip through the production executor and stance lock, with `applySettledPostureCorrection`
 * running in its production call sites. Toes are sampled per frame per toe; the rubric
 * attribution (which toe owns the deepest sample) is recomputed with the rubric's own
 * deepest-of-both reduction and recorded, not argued.
 *
 * claimScope: per-toe signed floor height per frame over settled + arrived on the shipped bytes,
 * plus which toe the rubric attributes the deepest sample to and per-toe below-floor counts.
 * notEvidenceFor: browser pixels, gait realism, clinical validity, Quest readiness, or any
 * threshold change (floorPenetrationMaxMeters untouched).
 */

const FLOOR_PENETRATION_LIMIT_METERS = 0.005;

type ToeFrame = {
  index: number;
  phase: string;
  leftY: number;
  rightY: number;
  leftDepth: number;
  rightDepth: number;
};

describe("both toes below the floor across settled and arrived", () => {
  it("both-toes-settled-measurement", async () => {
    const decoded = await decodePhysician();
    const ward = stageWard();
    const intent = intentFor(ward);
    if (intent.refused) throw new Error(`the normal encounter refused its own approach: ${intent.reason}`);
    const floorOriginY = ward.geometry.floorFrame?.originY ?? 0;
    const run = runApproach({ ward, intent, seconds: 12, decoded });
    const walkEnd = run.frames.findIndex((frame) => frame.phase === "settling");
    const stopStart = run.frames.findIndex((frame) => frame.phase === "arrived");
    expect(walkEnd).toBeGreaterThan(0);
    expect(stopStart).toBeGreaterThan(walkEnd);

    const frames: ToeFrame[] = [];
    for (let index = 0; index < run.frames.length; index += 1) {
      const sampleL = run.trackL[index];
      const sampleR = run.trackR[index];
      const frame = run.frames[index];
      if (sampleL === undefined || sampleR === undefined || frame === undefined) continue;
      frames.push({
        index,
        phase: frame.phase,
        leftY: sampleL.position.y,
        rightY: sampleR.position.y,
        leftDepth: floorOriginY - sampleL.position.y,
        rightDepth: floorOriginY - sampleR.position.y,
      });
    }
    expect(frames.length).toBeGreaterThan(0);

    const settled = frames.filter((entry) => entry.phase === "settling");
    const arrived = frames.filter((entry) => entry.phase === "arrived");
    expect(settled.length).toBeGreaterThan(0);
    expect(arrived.length).toBeGreaterThan(0);

    const summarize = (rows: ToeFrame[]): Record<string, number | string> => {
      const leftBelow = rows.filter((entry) => entry.leftDepth > 0).length;
      const rightBelow = rows.filter((entry) => entry.rightDepth > 0).length;
      const leftOver = rows.filter((entry) => entry.leftDepth > FLOOR_PENETRATION_LIMIT_METERS).length;
      const rightOver = rows.filter((entry) => entry.rightDepth > FLOOR_PENETRATION_LIMIT_METERS).length;
      const deepestLeft = Math.max(...rows.map((entry) => entry.leftDepth));
      const deepestRight = Math.max(...rows.map((entry) => entry.rightDepth));
      const deepestRow = rows.reduce((best, entry) =>
        Math.max(entry.leftDepth, entry.rightDepth) > Math.max(best.leftDepth, best.rightDepth) ? entry : best,
      );
      const attributedToe =
        deepestRow.leftDepth >= deepestRow.rightDepth ? "toe1-1.L" : "toe1-1.R";
      return {
        frames: rows.length,
        leftBelowFloor: leftBelow,
        rightBelowFloor: rightBelow,
        leftOverLimit: leftOver,
        rightOverLimit: rightOver,
        deepestLeftMeters: Number(deepestLeft.toFixed(6)),
        deepestRightMeters: Number(deepestRight.toFixed(6)),
        deepestAttributedTo: attributedToe,
        deepestAttributedFrame: deepestRow.index,
        deepestAttributedMeters: Number(
          Math.max(deepestRow.leftDepth, deepestRow.rightDepth).toFixed(6),
        ),
      };
    };

    const settledSummary = summarize(settled);
    const arrivedSummary = summarize(arrived);
    const bothBelowSettled =
      (settledSummary["leftOverLimit"] as number) > 0 && (settledSummary["rightOverLimit"] as number) > 0;
    const bothBelowArrived =
      (arrivedSummary["leftOverLimit"] as number) > 0 && (arrivedSummary["rightOverLimit"] as number) > 0;

    // The rubric's own deepest-of-both reduction over the same intervals, as the grader sees it.
    const settleMeasurement = measurementFor({
      run,
      intent,
      ward,
      decoded,
      from: walkEnd,
      to: stopStart,
      measurementId: "sc05-both-toes-settle",
    });
    const arrivedMeasurement = measurementFor({
      run,
      intent,
      ward,
      decoded,
      from: stopStart,
      to: run.frames.length,
      measurementId: "sc05-both-toes-stop",
    });
    const settleGrade = gradeMotionMeasurement(settleMeasurement);
    const arrivedGrade = gradeMotionMeasurement(arrivedMeasurement);
    const settlePenetration = settleGrade.findings.find((entry) => entry.metric === "floor-penetration");
    const arrivedPenetration = arrivedGrade.findings.find((entry) => entry.metric === "floor-penetration");
    if (settlePenetration === undefined || arrivedPenetration === undefined) {
      throw new Error("the rubric returned no floor-penetration finding");
    }

    console.log("=== BOTH-TOES SETTLED MEASUREMENT ===");
    console.log(`floorOriginY: ${floorOriginY}`);
    console.log(`settledFrames: ${settled.length} arrivedFrames: ${arrived.length}`);
    console.log(`settled: ${JSON.stringify(settledSummary)}`);
    console.log(`arrived: ${JSON.stringify(arrivedSummary)}`);
    console.log(
      `rubricSettle: outcome=${settlePenetration.outcome} observed=${settlePenetration.observed} detail=${settlePenetration.detail}`,
    );
    console.log(
      `rubricArrived: outcome=${arrivedPenetration.outcome} observed=${arrivedPenetration.observed} detail=${arrivedPenetration.detail}`,
    );
    console.log(
      `bothBelowSettled: ${bothBelowSettled} bothBelowArrived: ${bothBelowArrived}`,
    );

    // THE MEASUREMENT ASSERTIONS. The card's premise is that both toes sit below the floor
    // across settled and arrived. The RED below pins the measured outcome: on the current tree
    // NEITHER toe goes below the floor on any settled or arrived frame, so the premise is false
    // and the card directs a stop with no source fix. If a future tree puts both toes below the
    // floor again, this clause fails and names the counts to restore.
    expect(
      settledSummary["leftBelowFloor"] as number,
      "settled frames with the left toe below the floor",
    ).toBe(0);
    expect(
      settledSummary["rightBelowFloor"] as number,
      "settled frames with the right toe below the floor",
    ).toBe(0);
    expect(
      arrivedSummary["leftBelowFloor"] as number,
      "arrived frames with the left toe below the floor",
    ).toBe(0);
    expect(
      arrivedSummary["rightBelowFloor"] as number,
      "arrived frames with the right toe below the floor",
    ).toBe(0);
    expect(
      settlePenetration.outcome,
      `rubric settle floor-penetration ${settlePenetration.observed}`,
    ).toBe("satisfied");
    expect(
      arrivedPenetration.outcome,
      `rubric arrived floor-penetration ${arrivedPenetration.observed}`,
    ).toBe("satisfied");
  }, 300_000);
});
