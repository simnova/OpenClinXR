import { describe, expect, it } from "vitest";
import {
  CLINICIAN_WALK_SPEED_MPS,
  FOOT_CONTACT_HEIGHT_METERS,
  footSlideMeters,
} from "../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import {
  STANDING_BODY_HEIGHT_METERS,
  STANDING_FOOTPRINT_RADIUS_METERS,
} from "../../../../packages/openclinxr/asset-registry/src/bedside-clearance.js";
import { planBedsideApproach } from "../../../../packages/openclinxr/asset-registry/src/bedside-approach-path.js";
import {
  bedsideTargetForClinician,
  ED_STRETCHER_DECK_BOUNDS,
} from "../../../../packages/openclinxr/asset-registry/src/index.js";
import {
  gradeMotionMeasurement,
  PERCEPTUAL_FLOOR_METERS,
  REQUIRED_RUBRIC_METRICS,
  rubricCoverageProblems,
  SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
  SCENE_CLOSURE_RUBRIC_THRESHOLDS,
} from "./proofs/sc-00/measurement-rubric.js";
import {
  buildRubricControls,
  knownGoodMeasurement,
  SHIPPED_PATIENT_GLB,
  SHIPPED_PATIENT_STANDING_EXTENT,
  thinObstacleBetweenWaypoints,
} from "./proofs/sc-00/rubric-controls.js";
import { censusSkinnedGeometry } from "./proofs/sc-00/selected-asset-measurement.js";

/**
 * SC-00's named behaviour test. Card `tsk_86cee0308d7f6b2a`, A-row A08.
 *
 * WHAT IS UNDER TEST: the independent measurement instrument this card owns, exercised on the
 * ACTUAL selected SC-04 bodies, rig and clip. Not a fixture, and not SC-05's motion — the whole
 * point of this card is that the rubric is frozen BEFORE SC-03 and SC-05 run, so their thresholds
 * cannot be chosen after seeing what their implementation happens to produce.
 *
 * THE RED, reproduced here as a live control rather than described. At this card's baseline
 * (`40090435`) the repository's own measurement instruments report SUCCESS on three real broken
 * behaviours, all recorded in `.../store/sc-00/red-baseline-40090435.log`:
 *
 *  1. `footSlideMeters` grades a foot 0.30 m BELOW the floor identically to a perfect stance —
 *     same `contactFrames`, same zero slide — because it tests ABSOLUTE world Y. acceptance-v2.md:
 *     "deeply submerged feet cannot count as successful stance."
 *  2. The same call reports `contactFrames: 0` for a foot resting exactly on a floor plane at
 *     y = 0.15. Both directions of the same defect, which proof-contract-v2.md names on
 *     `approach-executor.ts`: "its contact metric uses absolute world Y rather than a signed
 *     floor-frame distance."
 *  3. `planBedsideApproach` reports `pathViolations: []` and `arrivesAtTarget: true` for a route
 *     whose swept body passes 0.275 m from a 0.05 m IV pole, because its 0.35 m waypoint sampler
 *     has a blind spot wider than the pole.
 *
 * None of those is an import error, an absent file or a missing report. Each is the instrument
 * answering a question wrongly, which is the only RED an instrument card can have.
 *
 * claimScope: that the frozen rubric accepts a real unchanged known-good and rejects each named
 * broken control on its own named metric.
 * notEvidenceFor: that any encounter ran, that any capture shows what it claims, or that the
 * shipped locomotion clip is fit to ship — it is measured here and it FAILS.
 */

describe("the measurement rubric rejects broken controls", () => {
  it("SC-00-required-behavior", async () => {
    // ---------------------------------------------------------------- the RED, live
    // Real stance geometry off the shipped physician, then the same geometry submerged.
    const good = await knownGoodMeasurement();
    const stanceTrack = good.contactTracks[0];
    expect(stanceTrack).toBeDefined();
    if (stanceTrack === undefined) throw new Error("the known-good lost its contact track");
    const planted = stanceTrack.samples.slice(0, 30);
    const submerged = planted.map((sample) => ({
      atMs: sample.atMs,
      position: { ...sample.position, y: sample.position.y - 0.3 },
    }));

    const baselineOnPlanted = footSlideMeters(planted);
    const baselineOnSubmerged = footSlideMeters(submerged);
    // RED 1: the baseline instrument cannot tell them apart.
    expect(baselineOnSubmerged).toStrictEqual(baselineOnPlanted);
    expect(baselineOnSubmerged.contactFrames).toBe(30);
    expect(baselineOnSubmerged.slideMeters).toBe(0);

    // RED 1b: the same planted foot on a floor plane at y = 0.15 reports NO contacts at all.
    const raised = planted.map((sample) => ({
      atMs: sample.atMs,
      position: { ...sample.position, y: sample.position.y + 0.15 },
    }));
    expect(footSlideMeters(raised).contactFrames).toBe(0);

    // RED 2: the baseline planner walks a body through a pole in its sampling blind spot.
    const patientPosition = { x: -0.42, y: 0, z: -0.08 };
    const target = bedsideTargetForClinician({ patientPosition, supportBounds: ED_STRETCHER_DECK_BOUNDS }).position;
    const from = { x: target.x, y: 0, z: target.z + 3.5 };
    const bareRoute = good.route;
    expect(bareRoute).not.toBeNull();
    if (bareRoute === null) throw new Error("the known-good lost its route");
    const pole = thinObstacleBetweenWaypoints(bareRoute);
    const baselinePlan = planBedsideApproach({ from, target, facing: patientPosition, obstacles: [pole] });
    expect(baselinePlan.pathViolations).toStrictEqual([]);
    expect(baselinePlan.arrivesAtTarget).toBe(true);

    // ---------------------------------------------------------------- the fix, on the same inputs
    const controls = await buildRubricControls();
    const byId = new Map(controls.map((control) => [control.controlId, control]));

    const submergedControl = byId.get("penetrating-foot-fails");
    expect(submergedControl).toBeDefined();
    if (submergedControl === undefined) throw new Error("the penetrating-foot control is missing");
    const submergedGrade = gradeMotionMeasurement(submergedControl.measurement);
    expect(submergedGrade.ok).toBe(false);
    expect(submergedGrade.failedMetrics).toContain("floor-penetration");

    const blockedControl = byId.get("thin-obstacle-between-waypoints-fails");
    expect(blockedControl).toBeDefined();
    if (blockedControl === undefined) throw new Error("the thin-obstacle control is missing");
    const blockedGrade = gradeMotionMeasurement(blockedControl.measurement);
    expect(blockedGrade.ok).toBe(false);
    expect(blockedGrade.failedMetrics).toStrictEqual(["swept-collision"]);

    // Signed contact is measured against the SELECTED floor, so a raised frame is graded, not lost.
    const raisedFrame = {
      ...good,
      floor: { frameId: "raised_floor_v1", originY: 0.15, normal: { x: 0, y: 1, z: 0 } },
      contactTracks: good.contactTracks.map((track) => ({
        joint: track.joint,
        samples: track.samples.map((sample) => ({ atMs: sample.atMs, position: { ...sample.position, y: sample.position.y + 0.15 } })),
      })),
      supportedContactSamples: good.supportedContactSamples,
    };
    const raisedGrade = gradeMotionMeasurement(raisedFrame);
    expect(raisedGrade.failedMetrics).not.toContain("signed-floor-contact");
    expect(raisedGrade.failedMetrics).not.toContain("floor-penetration");

    // ---------------------------------------------------------------- the good control PASSES
    // A rubric that rejects everything is not a gate. This is real unchanged shipped geometry.
    const goodGrade = gradeMotionMeasurement(good);
    expect(goodGrade.failedMetrics).toStrictEqual([]);
    expect(goodGrade.ok).toBe(true);
    expect(goodGrade.rubricVersion).toBe(SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION);
    expect(goodGrade.findings).toHaveLength(REQUIRED_RUBRIC_METRICS.length);

    // ---------------------------------------------------------------- every control on its metric
    const namedMetrics = new Set<string>();
    for (const control of controls) {
      const grade = gradeMotionMeasurement(control.measurement);
      if (control.expectation.kind === "pass") {
        expect(grade.ok, `${control.controlId} should pass; failed ${grade.failedMetrics.join(",")}`).toBe(true);
        continue;
      }
      if (control.expectation.kind === "coverage") {
        const trimmed = grade.findings.filter((item) => item.metric !== control.expectation.dropMetric);
        // Deleting a metric must FAIL rather than evade grading: the shortened list is refused.
        expect(rubricCoverageProblems(grade.findings)).toStrictEqual([]);
        expect(rubricCoverageProblems(trimmed)).toContain(`missing metric ${control.expectation.dropMetric}`);
        namedMetrics.add(control.expectation.dropMetric);
        continue;
      }
      const metric = control.expectation.metric;
      const entry = grade.findings.find((candidate) => candidate.metric === metric);
      expect(entry, `${control.controlId} has no ${metric} finding`).toBeDefined();
      expect(entry?.outcome, `${control.controlId} expected ${metric} to be ${control.expectation.kind}`).toBe(
        control.expectation.kind === "refuse" ? "refused" : "violated",
      );
      expect(grade.ok, `${control.controlId} must not grade ok`).toBe(false);
      namedMetrics.add(metric);
    }

    // Coverage of the CONTROLS, not just of a grade: every metric has a named broken control.
    for (const metric of REQUIRED_RUBRIC_METRICS) {
      expect(namedMetrics.has(metric), `no broken control names ${metric}`).toBe(true);
    }

    // ---------------------------------------------------------------- the oracle has no pass flag
    // The only producer-authored assertion the rubric accepts is `clipDeclaredPlayed`, and it
    // exists so the rubric can contradict it. A still track labelled as a played walk fails.
    const flagged = { ...good, clipDeclaredPlayed: true, clipName: "openclinxr_retarget_walk_formal_cc0" };
    expect(gradeMotionMeasurement(flagged).failedMetrics).toStrictEqual(["clip-motion-observed"]);

    // ---------------------------------------------------------------- the SHIPPED clip FAILS
    // SC-04 replaced a CONDITIONAL CMU walk with CC0 Walk_Formal and declared the plant about 3x
    // worse. The rubric was not softened to admit it. Measured on the shipped bytes at the advance
    // the executor actually applies.
    const shipped = byId.get("shipped-walk-formal-fails-foot-slide");
    expect(shipped).toBeDefined();
    if (shipped === undefined) throw new Error("the shipped-walk control is missing");
    const shippedGrade = gradeMotionMeasurement(shipped.measurement);
    expect(shippedGrade.failedMetrics).toStrictEqual(["foot-slide"]);
    expect(shipped.measurement.groundAdvanceMetersPerSecond).toBe(CLINICIAN_WALK_SPEED_MPS);
    // Everything else about the shipped clip is sound, which is what makes the one failure legible.
    const shippedLimb = shippedGrade.findings.find((entry) => entry.metric === "limb-integrity");
    expect(shippedLimb?.outcome).toBe("satisfied");
    expect(Number(shippedLimb?.observed)).toBeLessThanOrEqual(SCENE_CLOSURE_RUBRIC_THRESHOLDS.limbLengthDriftMaxMeters.value);
    const shippedPenetration = shippedGrade.findings.find((entry) => entry.metric === "floor-penetration");
    expect(shippedPenetration?.outcome).toBe("satisfied");

    // ---------------------------------------------------------------- provenance is live, not copied
    // Every threshold names its source. A source that drifts must be a failure, not a silent
    // migration of this rubric onto a number nobody re-derived.
    for (const [name, entry] of Object.entries(SCENE_CLOSURE_RUBRIC_THRESHOLDS)) {
      expect(entry.source.trim().length, `${name} has an empty source`).toBeGreaterThan(40);
      expect(Number.isFinite(entry.value), `${name} is not a finite number`).toBe(true);
    }
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.floorContactBandMeters.value).toBe(FOOT_CONTACT_HEIGHT_METERS);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.sweptBodyRadiusMeters.value).toBe(STANDING_FOOTPRINT_RADIUS_METERS);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.sweptBodyHeightMeters.value).toBe(STANDING_BODY_HEIGHT_METERS);
    // Fixed by acceptance-v2.md and not SC-00's to move.
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.arrivalErrorMaxMeters.value).toBe(0.05);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.settledYawErrorMaxDegrees.value).toBe(10);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.stoppedObservationSeconds.value).toBe(2);
    // The perceptual floor is 3 px at the capture framing, rounded DOWN. Rounding a floor up would
    // admit displacement the derivation calls visible.
    const framedWidthMeters = 2 * 3.4 * Math.tan((52 * Math.PI) / 180 / 2);
    expect(PERCEPTUAL_FLOOR_METERS).toBeLessThanOrEqual((3 * framedWidthMeters) / 1920);
    expect(PERCEPTUAL_FLOOR_METERS).toBeGreaterThan(0);

    // Pin the VALUES, not only the behaviour they currently happen to produce. A two-sided probe on
    // 2026-09-09 widened `footSlideWorstFrameMaxMeters` 24 times and every control still behaved,
    // because each also failed on total slide. A number that is load-bearing in the rubric and in no
    // assertion is exactly the threshold-nobody-probed failure this card exists to prevent.
    for (const name of [
      "floorPenetrationMaxMeters",
      "supportSeparationMaxMeters",
      "supportPenetrationMaxMeters",
      "footSlideWorstFrameMaxMeters",
      "stoppedRootTravelMaxMeters",
    ] as const) {
      expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS[name].value, `${name} drifted off the perceptual floor`)
        .toBe(PERCEPTUAL_FLOOR_METERS);
    }
    // Anatomy: 0.26 m foot length x (1 - cos 20 deg).
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.footRollAllowancePerContactWindowMeters.value)
      .toBeCloseTo(0.26 * (1 - Math.cos((20 * Math.PI) / 180)), 4);
    // Strictly below the narrowest catalogue obstacle, a ~0.05 m IV pole. A sweep at or above that
    // width can step over one, and on this route it did so only by a float-rounding accident:
    // `ceil(0.35 / 0.35)` is 1 on some segments and 2 on others, so a coarse resweep found the pole
    // on the segment the control happens to use. Pinned here rather than left to arithmetic luck.
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.sweptSampleSpacingMaxMeters.value).toBeLessThan(0.05);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.minContactFramesPerFoot.value).toBe(3);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.maxFrameGapRatio.value).toBe(2);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.limbLengthDriftMaxMeters.value).toBe(0.001);
    expect(SCENE_CLOSURE_RUBRIC_THRESHOLDS.floorNormalToleranceDegrees.value).toBe(1);

    // The worst-frame threshold is load-bearing on its own: this control's total slide is INSIDE
    // the per-window allowance and only its single-frame step is over.
    const pop = byId.get("single-frame-pop-fails");
    expect(pop).toBeDefined();
    if (pop === undefined) throw new Error("the single-frame-pop control is missing");
    expect(gradeMotionMeasurement(pop.measurement).failedMetrics).toStrictEqual(["foot-slide"]);

    // ---------------------------------------------------------------- the body behind the numbers
    // The supported-contact line spans the patient's real decoded extent, so a body swap breaks
    // this rather than silently regrading against a different person.
    const patientCensus = await censusSkinnedGeometry(SHIPPED_PATIENT_GLB);
    expect(patientCensus.skinnedBodyCount).toBeGreaterThan(0);
    expect(patientCensus.skinNames).toContain(SHIPPED_PATIENT_STANDING_EXTENT.meshName);
    expect(SHIPPED_PATIENT_STANDING_EXTENT.heightMeters).toBeLessThan(
      ED_STRETCHER_DECK_BOUNDS.max.x - ED_STRETCHER_DECK_BOUNDS.min.x,
    );
  }, 120_000);
});
