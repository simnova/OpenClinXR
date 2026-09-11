/**
 * The named good and broken controls that fix the rubric.
 *
 * acceptance-v2.md requires SC-00 to freeze its thresholds "using the unchanged control and
 * deliberately broken examples" and to "reject visible defects, absent contact windows and zero
 * sampled bodies". This card's contract adds: "Each broken control fails its own named metric";
 * "The good controls pass. A rubric that rejects everything is not a gate."
 *
 * THE KNOWN-GOOD IS REAL BYTES, NOT A CONSTRUCTION. It is the shipped physician's
 * `ClinicalIdleConversation` clip on the shipped physician GLB: 90 frames at a uniform 41.667 ms,
 * both toes at a constant 0.00853 m above the floor, and a measured total horizontal travel of
 * exactly 0.000000 m. A standing clinician's feet do not move, and the rubric says so. Every broken
 * control is that same measurement with ONE named thing damaged, so a failure names its own cause.
 *
 * WHAT IS SYNTHESIZED, AND WHY IT IS LABELLED. Support, route, arrival and settled heading do not
 * exist in any shipped asset — they are properties of a placement and a run that SC-03 and SC-05
 * own and that do not exist at this card's baseline. The known-good supplies them from real
 * measured dimensions (the shipped stretcher deck bounds, the decoded patient body extent, the
 * production bedside target and route planner) placed deterministically. proof-contract-v2.md for
 * SC-00: "This is calibration, not a claim that the later SC-05 normal workflow exists. Existing
 * isolated controls are allowed and labeled." These controls test the INSTRUMENT. None of them is
 * evidence that any encounter ran.
 */

import { CLINICIAN_WALK_SPEED_MPS } from "../../../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import { planBedsideApproach } from "../../../../../../packages/openclinxr/asset-registry/src/bedside-approach-path.js";
import {
  bedsideTargetForClinician,
  ED_STRETCHER_DECK_BOUNDS,
} from "../../../../../../packages/openclinxr/asset-registry/src/index.js";
import {
  type MotionMeasurement,
  type RubricMetric,
  SCENE_CLOSURE_RUBRIC_THRESHOLDS,
  type SweptRoute,
  type Vector3,
} from "./measurement-rubric.js";
import {
  measureSelectedAssetClip,
  SHIPPED_PHYSICIAN_LEG_BONES,
} from "./selected-asset-measurement.js";

export const SHIPPED_PHYSICIAN_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
export const SHIPPED_PATIENT_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
export const SHIPPED_WALK_CLIP = "openclinxr_retarget_walk_formal_cc0";
export const SHIPPED_IDLE_CLIP = "ClinicalIdleConversation";
export const SHIPPED_CONTACT_JOINTS = ["toe1-1.L", "toe1-1.R"] as const;

/** The floor the encounter's selected room places its actors on. Flat, at world zero. */
export const SELECTED_FLOOR_FRAME = { frameId: "scene_closure_room_floor_v1", originY: 0 } as const;

/**
 * The patient's decoded standing extent, measured off `mpfb_robert_reference_body` in the shipped
 * patient GLB. Recorded as a literal so the known-good's supported-contact line has a real body
 * length behind it rather than a guessed one; the named behaviour test re-decodes the mesh and
 * asserts these still hold, so a body swap is a failure rather than a silent drift.
 */
export const SHIPPED_PATIENT_STANDING_EXTENT = {
  meshName: "mpfb_robert_reference_body",
  vertexCount: 9791,
  heightMeters: 1.7756,
  breadthMeters: 1.1228,
} as const;

export type ControlExpectation =
  | { kind: "pass" }
  | { kind: "fail"; metric: RubricMetric }
  | { kind: "refuse"; metric: RubricMetric }
  | { kind: "coverage"; dropMetric: RubricMetric };

export type RubricControl = {
  controlId: string;
  /** What was done to the known-good measurement to make this control. */
  trigger: string;
  expectation: ControlExpectation;
  measurement: MotionMeasurement;
};

export const SC00_MEASUREMENT_RUN_ID = "sc-00-2026-09-09";

function deepCopy(measurement: MotionMeasurement): MotionMeasurement {
  return JSON.parse(JSON.stringify(measurement)) as MotionMeasurement;
}

/** The bedside route the production planner lays down for the selected room. */
function selectedRoute(extraObstacles: SweptRoute["obstacles"]): SweptRoute {
  const patientPosition: Vector3 = { x: -0.42, y: 0, z: -0.08 };
  const target = bedsideTargetForClinician({ patientPosition, supportBounds: ED_STRETCHER_DECK_BOUNDS }).position;
  const from: Vector3 = { x: target.x, y: 0, z: target.z + 3.5 };
  const plan = planBedsideApproach({ from, target, facing: patientPosition, obstacles: [] });
  return {
    waypoints: plan.waypoints.map((waypoint) => ({ ...waypoint.position })),
    sampleSpacingMeters: 0.35,
    obstacles: extraObstacles,
  };
}

/**
 * An IV pole placed in the blind spot of the shipped 0.35 m waypoint sampler.
 *
 * The geometry is not a guess. With a 0.3 m standing footprint and 0.35 m waypoints, the circles at
 * consecutive waypoints stop covering the segment once the lateral offset exceeds
 * sqrt(0.09 - 0.0306) = 0.244 m. At 0.30 m lateral the nearest corner of a 0.05 m pole sits
 * 0.347 m from each waypoint — outside both circles — while the swept body passes 0.275 m from it,
 * a 0.025 m intrusion. The baseline planner reports `pathViolations: []` and `arrivesAtTarget:
 * true` on exactly this arrangement; that measurement is this card's RED 2.
 */
export function thinObstacleBetweenWaypoints(route: SweptRoute): SweptRoute["obstacles"][number] {
  const a = route.waypoints[3];
  const b = route.waypoints[4];
  if (a === undefined || b === undefined) throw new Error("rubric-controls: the selected route is too short to place a between-sample obstacle");
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const dirX = b.x - a.x;
  const dirZ = b.z - a.z;
  const length = Math.hypot(dirX, dirZ);
  const lateralX = -dirZ / length;
  const lateralZ = dirX / length;
  const offset = 0.3;
  const half = 0.025;
  const centre = { x: mid.x + lateralX * offset, z: mid.z + lateralZ * offset };
  return {
    id: "iv_pole_between_waypoint_samples",
    bounds: {
      min: { x: centre.x - half, y: 0, z: centre.z - half },
      max: { x: centre.x + half, y: 1.6, z: centre.z + half },
    },
  };
}

/** A supported-contact line at the deck top, spanning the patient's real decoded body length. */
function supportedContactSamplesOnDeck(offsetMeters: number): MotionMeasurement["supportedContactSamples"] {
  const deckTop = ED_STRETCHER_DECK_BOUNDS.max.y;
  const centreX = (ED_STRETCHER_DECK_BOUNDS.min.x + ED_STRETCHER_DECK_BOUNDS.max.x) / 2;
  const centreZ = (ED_STRETCHER_DECK_BOUNDS.min.z + ED_STRETCHER_DECK_BOUNDS.max.z) / 2;
  const halfBody = SHIPPED_PATIENT_STANDING_EXTENT.heightMeters / 2;
  const samples = [];
  /** Nine points head to foot. Enough to span the body; the count is not a threshold. */
  const count = 9;
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    samples.push({
      atMs: index * 41.667,
      position: { x: centreX - halfBody + t * SHIPPED_PATIENT_STANDING_EXTENT.heightMeters, y: deckTop + offsetMeters, z: centreZ },
    });
  }
  return samples;
}

/**
 * The known-good: real shipped idle geometry, a real support, a real cleared route, and placement
 * facts supplied at exactly the accepted limits' good side.
 */
export async function knownGoodMeasurement(): Promise<MotionMeasurement> {
  const measurement = await measureSelectedAssetClip({
    measurementId: "known-good-idle-stance",
    runId: SC00_MEASUREMENT_RUN_ID,
    actorId: "senior_resident_ward_v1",
    glbPath: SHIPPED_PHYSICIAN_GLB,
    clipName: SHIPPED_IDLE_CLIP,
    contactJoints: SHIPPED_CONTACT_JOINTS,
    bones: SHIPPED_PHYSICIAN_LEG_BONES,
    floorOriginY: SELECTED_FLOOR_FRAME.originY,
    floorFrameId: SELECTED_FLOOR_FRAME.frameId,
    // A standing actor's ground advance is zero, and that is a measured fact about the idle clip,
    // not a convenience: nothing in it translates the root.
    groundAdvanceMetersPerSecond: 0,
    forward: { x: 0, z: -1 },
    clipDeclaredPlayed: false,
  });
  return {
    ...measurement,
    support: {
      instanceId: "ed_stretcher_deck_v1",
      bounds: ED_STRETCHER_DECK_BOUNDS,
      basis: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    },
    supportedContactSamples: supportedContactSamplesOnDeck(0),
    route: selectedRoute([]),
    arrival: { errorMeters: 0.0121 },
    settled: { yawErrorDegrees: 3.4, observedSeconds: 2.5, rootTravelMeters: 0.0008 },
  };
}

/** The shipped locomotion clip, graded at the ground advance the executor actually applies. */
export async function shippedWalkMeasurement(groundAdvanceMetersPerSecond: number): Promise<MotionMeasurement> {
  const good = await knownGoodMeasurement();
  const walk = await measureSelectedAssetClip({
    measurementId: `shipped-walk-formal-at-${groundAdvanceMetersPerSecond}`,
    runId: SC00_MEASUREMENT_RUN_ID,
    actorId: "senior_resident_ward_v1",
    glbPath: SHIPPED_PHYSICIAN_GLB,
    clipName: SHIPPED_WALK_CLIP,
    contactJoints: SHIPPED_CONTACT_JOINTS,
    bones: SHIPPED_PHYSICIAN_LEG_BONES,
    floorOriginY: SELECTED_FLOOR_FRAME.originY,
    floorFrameId: SELECTED_FLOOR_FRAME.frameId,
    groundAdvanceMetersPerSecond,
    // Measured off the clip's own longest stance window: it walks very nearly along -Z.
    forward: { x: -0.0122, z: -0.9999 },
    clipDeclaredPlayed: true,
  });
  return { ...walk, support: good.support, supportedContactSamples: good.supportedContactSamples, route: good.route, arrival: good.arrival, settled: good.settled };
}

/**
 * Every control, built from the real known-good.
 *
 * The list is complete by construction and the named behaviour test proves it: every metric in
 * REQUIRED_RUBRIC_METRICS is the named expectation of at least one broken control here.
 */
export async function buildRubricControls(): Promise<RubricControl[]> {
  const good = await knownGoodMeasurement();
  const controls: RubricControl[] = [];

  controls.push({
    controlId: "known-good-support-passes",
    trigger: "the shipped physician's ClinicalIdleConversation clip, unmodified, on the shipped stretcher deck with a cleared route",
    expectation: { kind: "pass" },
    measurement: good,
  });

  const slid = deepCopy(good);
  for (const track of slid.contactTracks) {
    for (let index = 0; index < track.samples.length; index += 1) {
      const sample = track.samples[index];
      if (sample === undefined) continue;
      sample.position.x += index * 0.012;
    }
  }
  controls.push({
    controlId: "sliding-foot-fails",
    trigger: "the known-good stance with each in-contact frame displaced 12 mm along +X, 2.4x the 5 mm worst-frame allowance",
    expectation: { kind: "fail", metric: "foot-slide" },
    measurement: slid,
  });

  // Isolates the WORST-FRAME threshold from the total. A two-sided probe on 2026-09-09 widened
  // `footSlideWorstFrameMaxMeters` 24x and every control still behaved, because each also failed on
  // total slide — so the worst-frame number was load-bearing in the rubric and in no assertion. One
  // 10 mm pop is under the 15.7 mm per-window total allowance and over the 5 mm per-frame one, so
  // this control fails on worst-frame alone.
  const popped = deepCopy(good);
  for (const track of popped.contactTracks) {
    const sample = track.samples[10];
    const later = track.samples.slice(11);
    if (sample !== undefined) sample.position.x += 0.01;
    for (const rest of later) rest.position.x += 0.01;
  }
  controls.push({
    controlId: "single-frame-pop-fails",
    trigger: "the known-good stance with one 10 mm step, under the per-window total allowance and over the per-frame one",
    expectation: { kind: "fail", metric: "foot-slide" },
    measurement: popped,
  });

  const submerged = deepCopy(good);
  for (const track of submerged.contactTracks) {
    for (const sample of track.samples) sample.position.y -= 0.3;
  }
  controls.push({
    controlId: "penetrating-foot-fails",
    trigger: "the known-good stance lowered 0.30 m below the selected floor plane; the baseline instrument grades this identically to the known-good",
    expectation: { kind: "fail", metric: "floor-penetration" },
    measurement: submerged,
  });

  const airborne = deepCopy(good);
  for (const track of airborne.contactTracks) {
    for (const sample of track.samples) sample.position.y += 0.5;
  }
  controls.push({
    controlId: "missing-contact-windows-fails",
    trigger: "the known-good stance raised 0.5 m, so no frame falls inside the contact band",
    expectation: { kind: "fail", metric: "signed-floor-contact" },
    measurement: airborne,
  });

  const unskinned = deepCopy(good);
  unskinned.skinnedBodyCount = 0;
  unskinned.skinnedVertexSampleCount = 0;
  controls.push({
    controlId: "zero-skinned-samples-fails",
    trigger: "the known-good with zero skinned bodies and zero skinned vertex samples",
    expectation: { kind: "fail", metric: "skinned-body-presence" },
    measurement: unskinned,
  });

  const nobody = deepCopy(good);
  nobody.actorId = "";
  controls.push({
    controlId: "absent-actor-fails",
    trigger: "the known-good with no actor id",
    expectation: { kind: "fail", metric: "actor-presence" },
    measurement: nobody,
  });

  const blocked = deepCopy(good);
  const blockedRoute = blocked.route;
  if (blockedRoute === null) throw new Error("rubric-controls: the known-good lost its route");
  blockedRoute.obstacles = [thinObstacleBetweenWaypoints(blockedRoute)];
  controls.push({
    controlId: "thin-obstacle-between-waypoints-fails",
    trigger: "a 0.05 m IV pole placed in the blind spot between two 0.35 m waypoints; the baseline planner reports the route clear",
    expectation: { kind: "fail", metric: "swept-collision" },
    measurement: blocked,
  });

  const wrongSupport = deepCopy(good);
  wrongSupport.support = {
    instanceId: "ed_vitals_cart_v1",
    bounds: { min: { x: 1.6, y: 0, z: 1.2 }, max: { x: 2.1, y: 0.9, z: 1.7 } },
    basis: [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
  };
  controls.push({
    controlId: "wrong-support-frame-fails",
    trigger: "the known-good body samples attributed to a different mounted instance, whose plan bounds do not contain them",
    expectation: { kind: "fail", metric: "support-frame-identity" },
    measurement: wrongSupport,
  });

  const flagWithoutMotion = deepCopy(good);
  flagWithoutMotion.clipDeclaredPlayed = true;
  flagWithoutMotion.clipName = SHIPPED_WALK_CLIP;
  controls.push({
    controlId: "clip-flag-without-motion-fails",
    trigger: "the measured-still idle track relabelled as the walk clip with clipDeclaredPlayed true",
    expectation: { kind: "fail", metric: "clip-motion-observed" },
    measurement: flagWithoutMotion,
  });

  controls.push({
    controlId: "deleting-a-metric-fails-rather-than-evades",
    trigger: "the known-good graded, then the foot-slide finding removed from the result",
    expectation: { kind: "coverage", dropMetric: "foot-slide" },
    measurement: good,
  });

  const ramp = deepCopy(good);
  ramp.floor = { frameId: "ramped_floor_v1", originY: 0, normal: { x: 0, y: Math.cos((12 * Math.PI) / 180), z: Math.sin((12 * Math.PI) / 180) } };
  controls.push({
    controlId: "unsupported-floor-geometry-refuses",
    trigger: "the known-good on a floor frame tilted 12 degrees; this slice supports only its selected flat frame",
    expectation: { kind: "refuse", metric: "floor-frame-supported" },
    measurement: ramp,
  });

  const tooFew = deepCopy(good);
  for (const track of tooFew.contactTracks) track.samples = track.samples.slice(0, 2);
  controls.push({
    controlId: "too-few-samples-fails",
    trigger: "the known-good truncated to two frames per track, one below the three a second difference needs",
    expectation: { kind: "fail", metric: "sample-sufficiency" },
    measurement: tooFew,
  });

  const nonmonotonic = deepCopy(good);
  const firstTrack = nonmonotonic.contactTracks[0];
  const swapA = firstTrack?.samples[4];
  const swapB = firstTrack?.samples[5];
  if (swapA !== undefined && swapB !== undefined) {
    const held = swapA.atMs;
    swapA.atMs = swapB.atMs;
    swapB.atMs = held;
  }
  controls.push({
    controlId: "nonmonotonic-times-fail",
    trigger: "two adjacent sample times swapped on one track",
    expectation: { kind: "fail", metric: "timestamp-monotonicity" },
    measurement: nonmonotonic,
  });

  const dropped = deepCopy(good);
  for (const track of dropped.contactTracks) {
    track.samples = track.samples.filter((_sample, index) => index < 20 || index > 24);
  }
  controls.push({
    controlId: "dropped-frame-gap-fails",
    trigger: "five consecutive frames removed from every track, leaving a gap six times the median interval",
    expectation: { kind: "fail", metric: "timestamp-monotonicity" },
    measurement: dropped,
  });

  const floating = deepCopy(good);
  floating.supportedContactSamples = supportedContactSamplesOnDeck(0.04);
  controls.push({
    controlId: "body-floating-above-support-fails",
    trigger: "the supported contact line raised 40 mm above the deck top, 8x the 5 mm separation allowance",
    expectation: { kind: "fail", metric: "support-contact" },
    measurement: floating,
  });

  const sunk = deepCopy(good);
  sunk.supportedContactSamples = supportedContactSamplesOnDeck(-0.06);
  controls.push({
    controlId: "body-sunk-into-support-fails",
    trigger: "the supported contact line lowered 60 mm into the deck, 12x the 5 mm penetration allowance",
    expectation: { kind: "fail", metric: "support-penetration" },
    measurement: sunk,
  });

  const deformed = deepCopy(good);
  for (const series of deformed.boneLengthSeries) {
    for (let index = 0; index < series.lengthsMeters.length; index += 1) {
      const current = series.lengthsMeters[index];
      if (current === undefined) continue;
      series.lengthsMeters[index] = current * (1 + index * 0.001);
    }
  }
  controls.push({
    controlId: "deformed-limb-fails",
    trigger: "every leg segment stretched progressively across the clip, far past the 1 mm float-noise allowance",
    expectation: { kind: "fail", metric: "limb-integrity" },
    measurement: deformed,
  });

  const overshoot = deepCopy(good);
  overshoot.arrival = { errorMeters: 0.14 };
  controls.push({
    controlId: "arrival-error-over-cap-fails",
    trigger: "arrival error 0.14 m against the acceptance contract's 0.05 m cap",
    expectation: { kind: "fail", metric: "arrival-error" },
    measurement: overshoot,
  });

  const misfaced = deepCopy(good);
  misfaced.settled = { yawErrorDegrees: 27.5, observedSeconds: 2.5, rootTravelMeters: 0.0008 };
  controls.push({
    controlId: "settled-yaw-over-cap-fails",
    trigger: "settled yaw error 27.5 degrees against the acceptance contract's 10 degree cap",
    expectation: { kind: "fail", metric: "settled-heading" },
    measurement: misfaced,
  });

  const creeping = deepCopy(good);
  creeping.settled = { yawErrorDegrees: 3.4, observedSeconds: 2.5, rootTravelMeters: 0.031 };
  controls.push({
    controlId: "root-resumes-travel-fails",
    trigger: "31 mm of root travel during the two-second stopped observation",
    expectation: { kind: "fail", metric: "stopped-observation" },
    measurement: creeping,
  });

  controls.push({
    controlId: "shipped-walk-formal-fails-foot-slide",
    trigger: `the SHIPPED openclinxr_retarget_walk_formal_cc0 clip on the shipped physician GLB, graded at the executor's ${CLINICIAN_WALK_SPEED_MPS} m/s advance. This is not a damaged control: it is the asset SC-04 landed, and it fails.`,
    expectation: { kind: "fail", metric: "foot-slide" },
    measurement: await shippedWalkMeasurement(CLINICIAN_WALK_SPEED_MPS),
  });

  return controls;
}

/** Thresholds re-exported for report authoring, so a report cannot restate them by hand. */
export const FROZEN_THRESHOLDS = SCENE_CLOSURE_RUBRIC_THRESHOLDS;
