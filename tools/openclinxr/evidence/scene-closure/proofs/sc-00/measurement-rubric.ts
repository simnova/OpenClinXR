/**
 * The scene-closure measurement rubric, frozen by SC-00 before SC-03 and SC-05 are released.
 *
 * WHY THIS EXISTS. acceptance-v2.md: "SC-00, after selected assets are pinned and before SC-03/05
 * are released, independently freezes support/contact, penetration, foot-slide, deformation and
 * timing thresholds in a versioned rubric using the unchanged control and deliberately broken
 * examples ... The implementer cannot enlarge thresholds after seeing a failure." A threshold
 * chosen after seeing what an implementation happens to produce grades nothing.
 *
 * WHY IT DOES NOT IMPORT THE RUNTIME'S OWN MEASUREMENTS. `footSlideMeters` and
 * `planBedsideApproach` are the instruments this card's RED shows to be wrong in three ways: an
 * absolute-world-Y contact test that grades a foot 300 mm underground as a perfect stance, the same
 * test reporting zero contacts for a foot resting on a floor plane at y = 0.15, and a 0.35 m
 * waypoint sampler that walks a body through an IV pole. Grading with the instrument under
 * suspicion reproduces its blind spots. So the geometry here is recomputed, and the runtime's
 * constants are imported only as PROVENANCE — `the-measurement-rubric-rejects-broken-controls.test.ts`
 * asserts the frozen literals still equal them, so a drift in either is a failure rather than a
 * silent migration of this rubric.
 *
 * WHERE EVERY NUMBER COMES FROM. `source` on each threshold is not decoration. A threshold whose
 * source is the measurement it grades is a tautology with units: if the reference moves with the
 * treatment, the assertion passes by construction. Every number below is anchored to one of three
 * things that cannot move when a clip, a body or a placement changes — the display, external
 * anatomy, or arithmetic.
 *
 * claimScope: numeric admissibility of a supplied geometric/temporal measurement against fixed
 * thresholds.
 * notEvidenceFor: that any runtime produced the measurement, that a capture shows what it claims,
 * clinical validity of a pose or gait, or worn-headset behaviour.
 */

import {
  FOOT_CONTACT_HEIGHT_METERS,
} from "../../../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import {
  STANDING_BODY_HEIGHT_METERS,
  STANDING_FOOTPRINT_RADIUS_METERS,
} from "../../../../../../packages/openclinxr/asset-registry/src/bedside-clearance.js";

export const SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION =
  "openclinxr.scene-closure-measurement-rubric.v1";

export type RubricThreshold = {
  readonly value: number;
  readonly unit: string;
  /** Where the number came from. An empty source is a fitted number wearing a citation. */
  readonly source: string;
};

/**
 * The one derived constant everything perceptual hangs off.
 *
 * `agents/rules/MANDATE_VISIBILITY.md` fixes this repo's own noticeability floor as "<3 px on 1920
 * px frame" at "~3.4 m viewer distance", written for garment work months before this card and not
 * adjustable by it. `apps/ui-xr/src/main.ts:2860` constructs the capture camera as
 * `PerspectiveCamera(52, 1, …)` — a 52 degree field at aspect 1, so the horizontal field is 52
 * degrees too. At 3.4 m that frame is 2 x 3.4 x tan(26 deg) = 3.3166 m wide, so one pixel is
 * 1.727 mm and three are 5.18 mm.
 *
 * Rounded DOWN to 5 mm. Rounding a floor up would admit displacement the derivation says is
 * visible; rounding down cannot.
 *
 * This is a property of the display, not of any motion. A clip cannot move it.
 */
export const PERCEPTUAL_FLOOR_METERS = 0.005;

/**
 * Every threshold this rubric freezes. Three are quoted from acceptance-v2.md and are not SC-00's
 * to choose; the rest are derived here and carry their derivation.
 */
export const SCENE_CLOSURE_RUBRIC_THRESHOLDS = {
  arrivalErrorMaxMeters: {
    value: 0.05,
    unit: "m",
    source:
      "FIXED BY acceptance-v2.md 'Geometry and motion rules': 'horizontal arrival error at most 0.05 m'. Not SC-00's to move.",
  },
  settledYawErrorMaxDegrees: {
    value: 10,
    unit: "deg",
    source:
      "FIXED BY acceptance-v2.md: 'settled body-heading error at most 10 degrees'. Not SC-00's to move.",
  },
  stoppedObservationSeconds: {
    value: 2,
    unit: "s",
    source:
      "FIXED BY acceptance-v2.md: 'no resumed root travel during a two-second stopped observation'. Not SC-00's to move.",
  },
  stoppedRootTravelMaxMeters: {
    value: PERCEPTUAL_FLOOR_METERS,
    unit: "m",
    source:
      "Derived: acceptance-v2.md fixes the two-second window but not what counts as stopped. The perceptual floor (3 px at the capture framing = 5.18 mm, rounded down to 5 mm) is the largest travel a viewer cannot see, so anything at or under it is indistinguishable from stopped in the evidence that grades it.",
  },
  floorContactBandMeters: {
    value: 0.06,
    unit: "m",
    source:
      "Existing runtime constant FOOT_CONTACT_HEIGHT_METERS = 0.06 in packages/openclinxr/asset-registry/src/approach-executor.ts, unchanged and predating this card. SC-00 keeps the band and changes only its FRAME: the height is signed relative to the selected floor plane, never absolute world Y.",
  },
  floorPenetrationMaxMeters: {
    value: PERCEPTUAL_FLOOR_METERS,
    unit: "m",
    source:
      "Derived from the perceptual floor. acceptance-v2.md: 'deeply submerged feet cannot count as successful stance'. A foot below the selected floor plane by more than the smallest displacement a viewer can resolve is visibly submerged.",
  },
  supportSeparationMaxMeters: {
    value: PERCEPTUAL_FLOOR_METERS,
    unit: "m",
    source:
      "Derived from the perceptual floor. A body floating above its support by more than the smallest resolvable displacement reads as hovering.",
  },
  supportPenetrationMaxMeters: {
    value: PERCEPTUAL_FLOOR_METERS,
    unit: "m",
    source:
      "Derived from the perceptual floor, signed the other way. Separation and penetration are separate metrics because a mean of the two cancels a body half-sunk at the hips and half-floating at the shoulders.",
  },
  footSlideWorstFrameMaxMeters: {
    value: PERCEPTUAL_FLOOR_METERS,
    unit: "m",
    source:
      "Derived from the perceptual floor. A pop is a single-frame displacement, and one under 3 px at the capture framing cannot be seen. Independent of every clip: it is fixed by the display, so replacing a clip cannot move it.",
  },
  footRollAllowancePerContactWindowMeters: {
    value: 0.0157,
    unit: "m",
    source:
      "External anatomy. A correctly planted toe marker is not perfectly still during stance: it rolls about the heel from heel-strike to foot-flat. That excursion is bounded by footLength x (1 - cos strikeAngle) = 0.26 m x (1 - cos 20 deg) = 0.0157 m. Adult foot length ~0.26 m and a ~20 degree strike angle are external anthropometric and gait figures; neither moves when a clip, a rig or a body changes. The total-slide allowance is this figure times the number of contact windows observed, so it scales with what the clip actually does without being derived from how far the foot actually slid.",
  },
  limbLengthDriftMaxMeters: {
    value: 0.001,
    unit: "m",
    source:
      "Arithmetic. A rigid bone cannot change length; any drift is either deformation or float noise. glTF accessors are float32 (~1e-7 relative), and a four-deep FK chain composed in float64 accumulates far under 1e-5 m on a 0.4 m bone. 1 mm is two orders above that noise and five times below the perceptual floor, so it can neither fail on arithmetic nor admit a visible stretch.",
  },
  sweptBodyRadiusMeters: {
    value: STANDING_FOOTPRINT_RADIUS_METERS,
    unit: "m",
    source:
      "External anthropometry, already recorded in packages/openclinxr/asset-registry/src/bedside-clearance.ts as STANDING_FOOTPRINT_RADIUS_METERS: half a ~0.6 m adult shoulder breadth. Predates this card and is stated there as an anatomical floor rather than a fitted value.",
  },
  sweptBodyHeightMeters: {
    value: STANDING_BODY_HEIGHT_METERS,
    unit: "m",
    source:
      "External anthropometry, STANDING_BODY_HEIGHT_METERS in bedside-clearance.ts: ~1.8 m adult standing height. Gates the vertical band so a ceiling fixture is not reported as blocking a walk.",
  },
  sweptSampleSpacingMaxMeters: {
    value: 0.04,
    unit: "m",
    source:
      "The step the rubric itself sweeps the route at. The narrowest obstacle in the shipped equipment catalogue is an IV pole at ~0.05 m across, a figure bedside-clearance.ts already records and already steps at 0.04 m for its own corridor check. A sweep sampled more finely than the thinnest thing it must find cannot step over one. The shipped 0.35 m waypoint spacing is 7x too coarse, which is this card's RED 2, and the rubric fixes it by resweeping rather than by asking the producer to sample better.",
  },
  minContactFramesPerFoot: {
    value: 3,
    unit: "frames",
    source:
      "Information-theoretic, not a tolerance. Slide is a first difference of position; telling a steady drift from a single pop needs a second difference, which needs three consecutive in-contact samples. Two frames cannot exhibit the metric at all, and one cannot exhibit motion.",
  },
  minSkinnedBodies: {
    value: 1,
    unit: "bodies",
    source:
      "Not a tolerance. Zero is the measurement saying it observed nothing, and acceptance-v2.md requires the rubric to 'reject ... zero sampled bodies'. Zero must fail rather than vacuously pass.",
  },
  minSkinnedVertexSamples: {
    value: 1,
    unit: "samples",
    source:
      "Not a tolerance. A body count above zero with no skinned vertex behind it is a name, not geometry.",
  },
  maxFrameGapRatio: {
    value: 2,
    unit: "ratio",
    source:
      "A uniform sampler's inter-sample interval varies only by float rounding; measured on the shipped physician clip it is 41.667 ms on every frame. Twice the median is the smallest ratio a uniform sampler cannot reach, so it separates a dropped frame from rounding without a fitted margin.",
  },
  floorNormalToleranceDegrees: {
    value: 1,
    unit: "deg",
    source:
      "acceptance-v2.md: 'The first slice may support only its selected flat frame and must reject unsupported floor geometry.' 1 degree is well inside the float noise of a normalized axis and far outside any real slope, so a plane the producer intended as flat passes and a ramp is refused rather than silently graded.",
  },
} as const satisfies Record<string, RubricThreshold>;

/**
 * Every metric this rubric grades. The list is the coverage contract: a grade is complete only when
 * it carries one finding per entry.
 *
 * "deleting a metric or a sample ... must fail rather than evade grading". `gradeMotionMeasurement`
 * always emits all of these, and `rubricCoverageProblems` refuses a findings array that lost one,
 * so a caller cannot shorten the list on the way to a verdict.
 */
export const REQUIRED_RUBRIC_METRICS = [
  "actor-presence",
  "skinned-body-presence",
  "sample-sufficiency",
  "timestamp-monotonicity",
  "floor-frame-supported",
  "signed-floor-contact",
  "floor-penetration",
  "foot-slide",
  "support-contact",
  "support-penetration",
  "support-frame-identity",
  "swept-collision",
  "arrival-error",
  "settled-heading",
  "stopped-observation",
  "limb-integrity",
  "clip-motion-observed",
] as const;

export type RubricMetric = (typeof REQUIRED_RUBRIC_METRICS)[number];

export type RubricOutcome = "satisfied" | "violated" | "refused";

export type RubricFinding = {
  metric: RubricMetric;
  outcome: RubricOutcome;
  /** The measured number or state. Never a bare verdict. */
  observed: number | string;
  /** The predicate, stated so a reader can recompute it. */
  threshold: string;
  detail: string;
};

export type Vector3 = { x: number; y: number; z: number };
export type JointSample = { atMs: number; position: Vector3 };
export type JointTrack = { joint: string; samples: JointSample[] };
export type WorldAabb = { min: Vector3; max: Vector3 };

/** The named floor the signed contact height is measured against. */
export type FloorFrame = {
  frameId: string;
  /** Height of the plane in world metres. */
  originY: number;
  /** Plane normal. Anything more than floorNormalToleranceDegrees off +Y is REFUSED, not graded. */
  normal: Vector3;
};

/** The exact mounted support a body rests on, with the frame it was measured in. */
export type SupportFrame = {
  instanceId: string;
  /** World-metre bounds of the support's deck. */
  bounds: WorldAabb;
  /** Frame basis rows. Must be orthonormal; a scaled or skewed frame is a different measurement. */
  basis: [Vector3, Vector3, Vector3];
};

export type SweptRoute = {
  waypoints: Vector3[];
  /** How finely the producer sampled its own route. Coarser than the thinnest obstacle fails. */
  sampleSpacingMeters: number;
  obstacles: Array<{ id: string; bounds: WorldAabb }>;
};

/**
 * One graded measurement.
 *
 * Note what is NOT here: any field carrying a verdict. There is no `pass`, no `ok`, no
 * `clearanceOk`. `clipDeclaredPlayed` is the single producer-authored assertion the rubric accepts,
 * and it exists only so the rubric can CONTRADICT it — acceptance-v2.md and this card both require
 * "a clipPlayed flag without measured limb motion" to fail.
 */
export type MotionMeasurement = {
  measurementId: string;
  runId: string;
  /** Empty means no actor was observed. acceptance-v2.md requires an absent actor to fail. */
  actorId: string;
  skinnedBodyCount: number;
  skinnedVertexSampleCount: number;
  /** The producer's own claim that a clip ran. Graded against measured motion, never trusted. */
  clipDeclaredPlayed: boolean;
  clipName: string;
  /** Ground advance the CONSUMER applies, in m/s. The driver of the causal chain, not the clip's. */
  groundAdvanceMetersPerSecond: number;
  /** Unit heading of that advance in the XZ plane. */
  forward: { x: number; z: number };
  floor: FloorFrame | null;
  support: SupportFrame | null;
  /** Body points that must rest on the support. Null when nothing was sampled. */
  supportedContactSamples: JointSample[] | null;
  contactTracks: JointTrack[];
  boneLengthSeries: Array<{ bone: string; lengthsMeters: number[] }>;
  route: SweptRoute | null;
  arrival: { errorMeters: number } | null;
  settled: { yawErrorDegrees: number; observedSeconds: number; rootTravelMeters: number } | null;
};

export type RubricGrade = {
  rubricVersion: typeof SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION;
  ok: boolean;
  findings: RubricFinding[];
  /** Metric ids whose outcome is not `satisfied`. Empty when `ok`. */
  failedMetrics: RubricMetric[];
};

function threshold(key: keyof typeof SCENE_CLOSURE_RUBRIC_THRESHOLDS): number {
  return SCENE_CLOSURE_RUBRIC_THRESHOLDS[key].value;
}

/** Composed world position of a foot once the consumer's ground advance is applied. */
function groundComposed(sample: JointSample, measurement: MotionMeasurement): { x: number; z: number } {
  const seconds = sample.atMs / 1000;
  const advance = measurement.groundAdvanceMetersPerSecond * seconds;
  return {
    x: sample.position.x + measurement.forward.x * advance,
    z: sample.position.z + measurement.forward.z * advance,
  };
}

/** XZ overlap depth of a circle against a box, gated on the standing height band. */
function circleBoxOverlapXz(centre: Vector3, radius: number, bounds: WorldAabb, floorY: number): number {
  const bandTop = floorY + threshold("sweptBodyHeightMeters");
  if (!(bounds.max.y > floorY && bounds.min.y < bandTop)) return 0;
  const nearestX = Math.min(Math.max(centre.x, bounds.min.x), bounds.max.x);
  const nearestZ = Math.min(Math.max(centre.z, bounds.min.z), bounds.max.z);
  return radius - Math.hypot(centre.x - nearestX, centre.z - nearestZ);
}

function finding(
  metric: RubricMetric,
  outcome: RubricOutcome,
  observed: number | string,
  thresholdText: string,
  detail: string,
): RubricFinding {
  return { metric, outcome, observed, threshold: thresholdText, detail };
}

function gradeActorPresence(measurement: MotionMeasurement): RubricFinding {
  const present = measurement.actorId.trim() !== "";
  return finding(
    "actor-presence",
    present ? "satisfied" : "violated",
    measurement.actorId || "(none)",
    "a named actor was observed",
    present ? `actor ${measurement.actorId}` : "no actor id; nothing was measured on anybody",
  );
}

function gradeSkinnedBodies(measurement: MotionMeasurement): RubricFinding {
  const bodies = measurement.skinnedBodyCount;
  const vertices = measurement.skinnedVertexSampleCount;
  const ok = bodies >= threshold("minSkinnedBodies") && vertices >= threshold("minSkinnedVertexSamples");
  return finding(
    "skinned-body-presence",
    ok ? "satisfied" : "violated",
    `${bodies} bodies / ${vertices} skinned vertex samples`,
    `bodies >= ${threshold("minSkinnedBodies")} and skinned vertex samples >= ${threshold("minSkinnedVertexSamples")}`,
    ok ? "geometry was observed" : "zero sampled bodies or zero skinned samples is the measurement reporting that it saw nothing",
  );
}

function gradeSampleSufficiency(measurement: MotionMeasurement): RubricFinding {
  const minimum = threshold("minContactFramesPerFoot");
  if (measurement.contactTracks.length === 0) {
    return finding("sample-sufficiency", "violated", 0, `>= 1 contact track with >= ${minimum} samples`, "no contact track was sampled");
  }
  const short = measurement.contactTracks.filter((track) => track.samples.length < minimum);
  return finding(
    "sample-sufficiency",
    short.length === 0 ? "satisfied" : "violated",
    measurement.contactTracks.map((track) => `${track.joint}:${track.samples.length}`).join(" "),
    `every contact track carries >= ${minimum} samples`,
    short.length === 0 ? "every track can exhibit a second difference" : `too few samples on ${short.map((track) => track.joint).join(", ")}`,
  );
}

function gradeTimestamps(measurement: MotionMeasurement): RubricFinding {
  const problems: string[] = [];
  for (const track of measurement.contactTracks) {
    const deltas: number[] = [];
    for (let index = 1; index < track.samples.length; index += 1) {
      const previous = track.samples[index - 1];
      const current = track.samples[index];
      if (previous === undefined || current === undefined) continue;
      const delta = current.atMs - previous.atMs;
      if (delta <= 0) {
        problems.push(`${track.joint} time does not advance at sample ${index} (${previous.atMs} -> ${current.atMs})`);
        continue;
      }
      deltas.push(delta);
    }
    if (deltas.length === 0) continue;
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median === undefined || median <= 0) continue;
    const limit = median * threshold("maxFrameGapRatio");
    const gaps = deltas.filter((delta) => delta >= limit);
    if (gaps.length > 0) {
      problems.push(`${track.joint} has ${gaps.length} gap(s) at or over ${limit.toFixed(3)} ms against a ${median.toFixed(3)} ms median`);
    }
  }
  return finding(
    "timestamp-monotonicity",
    problems.length === 0 ? "satisfied" : "violated",
    problems.length === 0 ? "strictly monotonic, no dropped frames" : problems.join("; "),
    `strictly increasing sample times with no interval >= ${threshold("maxFrameGapRatio")}x the median`,
    problems.length === 0 ? "sampling is uniform and ordered" : "nonmonotonic times or a dropped-frame gap",
  );
}

function gradeFloorFrame(measurement: MotionMeasurement): RubricFinding {
  const floor = measurement.floor;
  if (floor === null) {
    return finding(
      "floor-frame-supported",
      "refused",
      "(none)",
      "a named floor frame is required",
      "acceptance-v2.md: 'Standing requires a named floor frame.' Geometry with no support is refused, never defaulted to world zero",
    );
  }
  const length = Math.hypot(floor.normal.x, floor.normal.y, floor.normal.z);
  if (length === 0) {
    return finding("floor-frame-supported", "refused", "zero-length normal", "a unit +Y plane normal", "the floor normal is degenerate");
  }
  const cosine = floor.normal.y / length;
  const degrees = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
  const flat = degrees <= threshold("floorNormalToleranceDegrees");
  return finding(
    "floor-frame-supported",
    flat ? "satisfied" : "refused",
    `${degrees.toFixed(4)} deg off +Y (frame ${floor.frameId})`,
    `plane normal within ${threshold("floorNormalToleranceDegrees")} deg of +Y`,
    flat
      ? `flat frame ${floor.frameId} at y = ${floor.originY}`
      : "this slice supports only its selected flat frame; unsupported floor geometry is refused rather than graded",
  );
}

function gradeSignedFloorContact(measurement: MotionMeasurement): RubricFinding {
  const floor = measurement.floor;
  if (floor === null) {
    return finding("signed-floor-contact", "violated", "(no floor)", "signed height relative to the selected floor", "contact cannot be measured without a floor frame");
  }
  const minimum = threshold("minContactFramesPerFoot");
  const band = threshold("floorContactBandMeters");
  const counts = measurement.contactTracks.map((track) => ({
    joint: track.joint,
    frames: track.samples.filter((sample) => sample.position.y - floor.originY <= band).length,
  }));
  if (counts.length === 0) {
    return finding("signed-floor-contact", "violated", 0, `every contact track shows >= ${minimum} frames within ${band} m of the floor`, "no contact track was supplied");
  }
  const missing = counts.filter((entry) => entry.frames < minimum);
  return finding(
    "signed-floor-contact",
    missing.length === 0 ? "satisfied" : "violated",
    counts.map((entry) => `${entry.joint}:${entry.frames}`).join(" "),
    `every contact track shows >= ${minimum} frames with signed height <= ${band} m above frame ${floor.frameId}`,
    missing.length === 0
      ? "every foot has a contact window"
      : `missing contact window on ${missing.map((entry) => entry.joint).join(", ")}; zero contacts is the measurement observing nothing, not a pass`,
  );
}

function gradeFloorPenetration(measurement: MotionMeasurement): RubricFinding {
  const floor = measurement.floor;
  if (floor === null) {
    return finding("floor-penetration", "violated", "(no floor)", "signed depth below the selected floor", "penetration cannot be measured without a floor frame");
  }
  const limit = threshold("floorPenetrationMaxMeters");
  let deepest = 0;
  let where = "";
  for (const track of measurement.contactTracks) {
    for (const sample of track.samples) {
      const depth = floor.originY - sample.position.y;
      if (depth > deepest) {
        deepest = depth;
        where = `${track.joint} at ${sample.atMs.toFixed(1)} ms`;
      }
    }
  }
  const ok = deepest <= limit;
  return finding(
    "floor-penetration",
    ok ? "satisfied" : "violated",
    Number(deepest.toFixed(6)),
    `deepest penetration below frame ${floor.frameId} <= ${limit} m`,
    ok ? "no foot is submerged" : `${where} is ${deepest.toFixed(4)} m below the floor plane; a submerged foot is not a stance`,
  );
}

function gradeFootSlide(measurement: MotionMeasurement): RubricFinding {
  const floor = measurement.floor;
  if (floor === null) {
    return finding("foot-slide", "violated", "(no floor)", "slide during floor contact", "contact cannot be identified without a floor frame");
  }
  const band = threshold("floorContactBandMeters");
  const worstLimit = threshold("footSlideWorstFrameMaxMeters");
  const perWindow = threshold("footRollAllowancePerContactWindowMeters");
  const rows: string[] = [];
  let violated = false;
  for (const track of measurement.contactTracks) {
    const inContact = track.samples.map((sample) => sample.position.y - floor.originY <= band);
    let windows = 0;
    for (let index = 0; index < inContact.length; index += 1) {
      if (inContact[index] === true && inContact[index - 1] !== true) windows += 1;
    }
    let total = 0;
    let worst = 0;
    for (let index = 1; index < track.samples.length; index += 1) {
      if (inContact[index] !== true || inContact[index - 1] !== true) continue;
      const previous = track.samples[index - 1];
      const current = track.samples[index];
      if (previous === undefined || current === undefined) continue;
      const a = groundComposed(previous, measurement);
      const b = groundComposed(current, measurement);
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      total += step;
      if (step > worst) worst = step;
    }
    const allowance = perWindow * windows;
    const trackOk = worst <= worstLimit && total <= allowance;
    if (!trackOk) violated = true;
    rows.push(
      `${track.joint} windows=${windows} total=${total.toFixed(5)}m (allow ${allowance.toFixed(5)}m) worst=${worst.toFixed(5)}m (allow ${worstLimit}m)`,
    );
  }
  if (rows.length === 0) {
    return finding("foot-slide", "violated", "(no tracks)", "slide during floor contact", "no contact track was supplied, so slide was not measured");
  }
  return finding(
    "foot-slide",
    violated ? "violated" : "satisfied",
    rows.join(" | "),
    `worst single-frame slide <= ${worstLimit} m and total slide <= ${perWindow} m per contact window, both measured against the consumer's ground advance of ${measurement.groundAdvanceMetersPerSecond} m/s`,
    violated ? "a planted foot travelled further than the display can hide" : "every stance foot stayed put",
  );
}

function supportDeckTop(support: SupportFrame): number {
  return support.bounds.max.y;
}

function gradeSupportContact(measurement: MotionMeasurement): RubricFinding {
  const support = measurement.support;
  const samples = measurement.supportedContactSamples;
  if (support === null || samples === null || samples.length === 0) {
    return finding(
      "support-contact",
      "violated",
      support === null ? "(no support)" : "(no samples)",
      `separation above the deck <= ${threshold("supportSeparationMaxMeters")} m`,
      "a supported body needs both an exact support instance and sampled contact points",
    );
  }
  const limit = threshold("supportSeparationMaxMeters");
  const deck = supportDeckTop(support);
  let worst = 0;
  for (const sample of samples) {
    const separation = sample.position.y - deck;
    if (separation > worst) worst = separation;
  }
  const ok = worst <= limit;
  return finding(
    "support-contact",
    ok ? "satisfied" : "violated",
    Number(worst.toFixed(6)),
    `largest gap above the deck of ${support.instanceId} <= ${limit} m`,
    ok ? "the body rests on its support" : `the body floats ${worst.toFixed(4)} m above ${support.instanceId}`,
  );
}

function gradeSupportPenetration(measurement: MotionMeasurement): RubricFinding {
  const support = measurement.support;
  const samples = measurement.supportedContactSamples;
  if (support === null || samples === null || samples.length === 0) {
    return finding(
      "support-penetration",
      "violated",
      support === null ? "(no support)" : "(no samples)",
      `depth below the deck <= ${threshold("supportPenetrationMaxMeters")} m`,
      "penetration is a separate signed metric and needs the same two inputs",
    );
  }
  const limit = threshold("supportPenetrationMaxMeters");
  const deck = supportDeckTop(support);
  let deepest = 0;
  for (const sample of samples) {
    const depth = deck - sample.position.y;
    if (depth > deepest) deepest = depth;
  }
  const ok = deepest <= limit;
  return finding(
    "support-penetration",
    ok ? "satisfied" : "violated",
    Number(deepest.toFixed(6)),
    `deepest intrusion into ${support.instanceId} <= ${limit} m`,
    ok ? "the body does not sink into its support" : `the body is ${deepest.toFixed(4)} m inside ${support.instanceId}`,
  );
}

function gradeSupportFrameIdentity(measurement: MotionMeasurement): RubricFinding {
  const support = measurement.support;
  const samples = measurement.supportedContactSamples;
  if (support === null) {
    return finding("support-frame-identity", "violated", "(no support)", "an orthonormal frame on the exact support instance", "no support instance was named");
  }
  const problems: string[] = [];
  const [rowX, rowY, rowZ] = support.basis;
  const rows: Array<[string, Vector3]> = [["x", rowX], ["y", rowY], ["z", rowZ]];
  for (const [name, row] of rows) {
    const length = Math.hypot(row.x, row.y, row.z);
    if (Math.abs(length - 1) > 1e-6) problems.push(`basis row ${name} has length ${length.toFixed(6)}, so the frame carries a scale`);
  }
  const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
  if (Math.abs(dot(rowX, rowY)) > 1e-6 || Math.abs(dot(rowX, rowZ)) > 1e-6 || Math.abs(dot(rowY, rowZ)) > 1e-6) {
    problems.push("basis rows are not mutually orthogonal, so the frame is skewed");
  }
  if (samples !== null) {
    const outside = samples.filter(
      (sample) =>
        sample.position.x < support.bounds.min.x
        || sample.position.x > support.bounds.max.x
        || sample.position.z < support.bounds.min.z
        || sample.position.z > support.bounds.max.z,
    );
    if (outside.length > 0) {
      problems.push(`${outside.length} of ${samples.length} contact samples lie outside the plan bounds of ${support.instanceId}, so this is not the support the body is on`);
    }
  }
  return finding(
    "support-frame-identity",
    problems.length === 0 ? "satisfied" : "violated",
    problems.length === 0 ? `${support.instanceId} orthonormal, samples within bounds` : problems.join("; "),
    "an orthonormal, unscaled frame whose plan bounds contain every supported sample",
    problems.length === 0 ? "the named support is the one the body rests on" : "wrong support instance or a malformed frame",
  );
}

function gradeSweptCollision(measurement: MotionMeasurement): RubricFinding {
  const route = measurement.route;
  const floor = measurement.floor;
  if (route === null) {
    return finding("swept-collision", "violated", "(no route)", "a swept occupied volume along the walked route", "no route was supplied, so no collision was tested");
  }
  const spacingLimit = threshold("sweptSampleSpacingMaxMeters");
  const radius = threshold("sweptBodyRadiusMeters");
  const floorY = floor === null ? 0 : floor.originY;
  const problems: string[] = [];
  // The sweep is RECOMPUTED here at the rubric's own step rather than trusting whatever the
  // producer checked. The producer's own spacing is recorded in the detail and is not itself
  // graded: resweeping a straight polyline at 0.04 m is exact regardless of how coarsely its
  // waypoints were laid down, so failing a producer for 0.35 m spacing would be a threshold with
  // no measurement behind it. NOT TESTED: whether the supplied polyline IS the route walked. A
  // producer that hands over only the endpoints of a curved path defeats this from outside.
  let worst = 0;
  let worstId = "";
  for (let index = 1; index < route.waypoints.length; index += 1) {
    const from = route.waypoints[index - 1];
    const to = route.waypoints[index];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(length / spacingLimit));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point: Vector3 = { x: from.x + dx * t, y: floorY, z: from.z + dz * t };
      for (const obstacle of route.obstacles) {
        const overlap = circleBoxOverlapXz(point, radius, obstacle.bounds, floorY);
        if (overlap > worst) {
          worst = overlap;
          worstId = obstacle.id;
        }
      }
    }
  }
  if (worst > 0) problems.push(`the swept body (r=${radius} m) intrudes ${worst.toFixed(4)} m into ${worstId}`);
  return finding(
    "swept-collision",
    problems.length === 0 ? "satisfied" : "violated",
    problems.length === 0
      ? `clear, resweep at ${spacingLimit} m (producer sampled at ${route.sampleSpacingMeters} m)`
      : `${problems.join("; ")} (producer sampled at ${route.sampleSpacingMeters} m)`,
    `route resampled at ${spacingLimit} m with a ${radius} m body radius over a ${threshold("sweptBodyHeightMeters")} m height band; no overlap permitted`,
    problems.length === 0 ? "the occupied volume never touches an obstacle" : "a collision the producer's own sampling missed",
  );
}

function gradeArrival(measurement: MotionMeasurement): RubricFinding {
  const limit = threshold("arrivalErrorMaxMeters");
  const arrival = measurement.arrival;
  if (arrival === null) {
    return finding("arrival-error", "violated", "(none)", `horizontal arrival error <= ${limit} m`, "no arrival was measured");
  }
  const ok = arrival.errorMeters <= limit;
  return finding(
    "arrival-error",
    ok ? "satisfied" : "violated",
    Number(arrival.errorMeters.toFixed(6)),
    `horizontal arrival error <= ${limit} m (fixed by acceptance-v2.md)`,
    ok ? "arrived within the accepted target" : "stopped short of or past the accepted bedside target",
  );
}

function gradeSettledHeading(measurement: MotionMeasurement): RubricFinding {
  const limit = threshold("settledYawErrorMaxDegrees");
  const settled = measurement.settled;
  if (settled === null) {
    return finding("settled-heading", "violated", "(none)", `settled yaw error <= ${limit} deg`, "no settled heading was measured");
  }
  const ok = Math.abs(settled.yawErrorDegrees) <= limit;
  return finding(
    "settled-heading",
    ok ? "satisfied" : "violated",
    Number(settled.yawErrorDegrees.toFixed(4)),
    `settled yaw error <= ${limit} deg (fixed by acceptance-v2.md)`,
    ok ? "the body faces the patient" : "the body settled facing somewhere else",
  );
}

function gradeStoppedObservation(measurement: MotionMeasurement): RubricFinding {
  const seconds = threshold("stoppedObservationSeconds");
  const travelLimit = threshold("stoppedRootTravelMaxMeters");
  const settled = measurement.settled;
  if (settled === null) {
    return finding("stopped-observation", "violated", "(none)", `>= ${seconds} s observed with root travel <= ${travelLimit} m`, "no stopped observation was recorded");
  }
  const problems: string[] = [];
  if (settled.observedSeconds < seconds) problems.push(`observed only ${settled.observedSeconds} s`);
  if (settled.rootTravelMeters > travelLimit) problems.push(`root travelled ${settled.rootTravelMeters.toFixed(5)} m while stopped`);
  return finding(
    "stopped-observation",
    problems.length === 0 ? "satisfied" : "violated",
    `${settled.observedSeconds} s / ${settled.rootTravelMeters} m`,
    `>= ${seconds} s observed with root travel <= ${travelLimit} m`,
    problems.length === 0 ? "the actor stayed stopped" : problems.join("; "),
  );
}

function gradeLimbIntegrity(measurement: MotionMeasurement): RubricFinding {
  const limit = threshold("limbLengthDriftMaxMeters");
  if (measurement.boneLengthSeries.length === 0) {
    return finding("limb-integrity", "violated", "(none)", `bone length drift <= ${limit} m`, "no bone length series was sampled, so deformation was not measured");
  }
  let worst = 0;
  let worstBone = "";
  for (const series of measurement.boneLengthSeries) {
    if (series.lengthsMeters.length === 0) continue;
    const low = Math.min(...series.lengthsMeters);
    const high = Math.max(...series.lengthsMeters);
    const drift = high - low;
    if (drift > worst) {
      worst = drift;
      worstBone = series.bone;
    }
  }
  const ok = worst <= limit;
  return finding(
    "limb-integrity",
    ok ? "satisfied" : "violated",
    Number(worst.toFixed(6)),
    `largest bone length drift <= ${limit} m`,
    ok ? "no limb changed length" : `${worstBone} changed length by ${worst.toFixed(4)} m across the clip`,
  );
}

function gradeClipMotion(measurement: MotionMeasurement): RubricFinding {
  const floorForFloorless = threshold("footSlideWorstFrameMaxMeters");
  let travelled = 0;
  for (const track of measurement.contactTracks) {
    for (let index = 1; index < track.samples.length; index += 1) {
      const previous = track.samples[index - 1];
      const current = track.samples[index];
      if (previous === undefined || current === undefined) continue;
      travelled += Math.hypot(
        current.position.x - previous.position.x,
        current.position.y - previous.position.y,
        current.position.z - previous.position.z,
      );
    }
  }
  if (!measurement.clipDeclaredPlayed) {
    return finding(
      "clip-motion-observed",
      "satisfied",
      Number(travelled.toFixed(6)),
      `a declared clip must move a contact joint by > ${floorForFloorless} m`,
      "no clip was declared played, so there is nothing to contradict",
    );
  }
  const moved = travelled > floorForFloorless;
  return finding(
    "clip-motion-observed",
    moved ? "satisfied" : "violated",
    Number(travelled.toFixed(6)),
    `a declared clip must move a contact joint by > ${floorForFloorless} m in total`,
    moved
      ? `clip ${measurement.clipName} moved a contact joint ${travelled.toFixed(4)} m`
      : `clip ${measurement.clipName} is declared played and every contact joint is still; a flag is not motion`,
  );
}

/**
 * Grade one measurement against the frozen rubric.
 *
 * Always emits exactly one finding per entry of REQUIRED_RUBRIC_METRICS, in that order. A grade is
 * `ok` only when the coverage is complete AND every finding is `satisfied` — `refused` is not a
 * pass, because acceptance-v2.md requires unsupported floor geometry to refuse rather than be
 * graded, and a refusal that counted as a pass would be a silent default.
 */
export function gradeMotionMeasurement(measurement: MotionMeasurement): RubricGrade {
  const findings: RubricFinding[] = [
    gradeActorPresence(measurement),
    gradeSkinnedBodies(measurement),
    gradeSampleSufficiency(measurement),
    gradeTimestamps(measurement),
    gradeFloorFrame(measurement),
    gradeSignedFloorContact(measurement),
    gradeFloorPenetration(measurement),
    gradeFootSlide(measurement),
    gradeSupportContact(measurement),
    gradeSupportPenetration(measurement),
    gradeSupportFrameIdentity(measurement),
    gradeSweptCollision(measurement),
    gradeArrival(measurement),
    gradeSettledHeading(measurement),
    gradeStoppedObservation(measurement),
    gradeLimbIntegrity(measurement),
    gradeClipMotion(measurement),
  ];
  const coverage = rubricCoverageProblems(findings);
  const failedMetrics = findings.filter((entry) => entry.outcome !== "satisfied").map((entry) => entry.metric);
  return {
    rubricVersion: SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
    ok: coverage.length === 0 && failedMetrics.length === 0,
    findings,
    failedMetrics,
  };
}

/**
 * Problems with a findings array's COVERAGE, independent of any verdict inside it.
 *
 * This is the counterweight against evasion: "deleting a metric or a sample ... must fail rather
 * than evade grading". A caller that drops `foot-slide` from a grade to get a clean sheet gets a
 * coverage problem instead of a shorter list of satisfied metrics.
 */
export function rubricCoverageProblems(findings: readonly RubricFinding[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of findings) {
    if (seen.has(entry.metric)) problems.push(`duplicate metric ${entry.metric}`);
    seen.add(entry.metric);
    if (!(REQUIRED_RUBRIC_METRICS as readonly string[]).includes(entry.metric)) {
      problems.push(`unknown metric ${entry.metric}`);
    }
  }
  for (const metric of REQUIRED_RUBRIC_METRICS) {
    if (!seen.has(metric)) problems.push(`missing metric ${metric}`);
  }
  return problems;
}

/** The runtime constants this rubric quotes as provenance, so a drift is caught rather than absorbed. */
export const RUBRIC_PROVENANCE_CONSTANTS = {
  FOOT_CONTACT_HEIGHT_METERS,
  STANDING_FOOTPRINT_RADIUS_METERS,
  STANDING_BODY_HEIGHT_METERS,
} as const;
