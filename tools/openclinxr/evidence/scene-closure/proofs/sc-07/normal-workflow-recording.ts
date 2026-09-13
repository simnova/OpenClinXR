/**
 * SC-07's recording instrument: what a retained normal-workflow run must show before anything may
 * be certified as an activation-to-arrival recording.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE VERIFIER. `verify-core.ts` grades a finished evidence
 * REPORT. This grades the RUN — the telemetry the shipped runtime published and the video the
 * recorder retained — and it is the thing the named behavior test drives. The split matters because
 * the card's failure mode is a report that looks complete over a run that never happened.
 *
 * WHAT IT REFUSES, and this is the whole point of the card:
 *   - a run whose encounter never activated (no case-owned drive, no phase, no samples);
 *   - a run graded on declared flags instead of measured joint motion;
 *   - a run whose stopped observation is shorter than the frozen minimum;
 *   - a run whose arrival or settled heading exceeds `acceptance-v2.md`'s engineering caps.
 *
 * THRESHOLDS ARE QUOTED, NOT CHOSEN HERE. `acceptance-v2.md` fixes "horizontal arrival error at
 * most 0.05 m; settled body-heading error at most 10 degrees; no resumed root travel during a
 * two-second stopped observation". Nothing in this file may widen them; SC-00 owns the rubric and
 * an implementer cannot enlarge a threshold after seeing a failure.
 *
 * claimScope: whether a retained run shows an activated, arrived, stopped encounter with measured
 * skeleton motion.
 * notEvidenceFor: clinical validity, worn-headset readiness, public deployment, gait realism,
 * scoring validity, or visual quality — a person watching the footage owns that judgement.
 */

/** `acceptance-v2.md`'s engineering limits for the bounded demo, quoted rather than restated. */
export const SC07_ARRIVAL_ERROR_MAX_METERS = 0.05;
export const SC07_SETTLED_YAW_ERROR_MAX_DEGREES = 10;
export const SC07_STOPPED_OBSERVATION_MIN_SECONDS = 2;
/**
 * SC-00's frozen perceptual floor, 0.005 m. Quoted from `measurement-rubric.ts:65`
 * (`PERCEPTUAL_FLOOR_METERS`) rather than re-derived, so this instrument cannot drift from the
 * rubric it is supposed to apply.
 */
export const SC07_PERCEPTUAL_FLOOR_METERS = 0.005;
/** SC-00's frozen `maxFrameGapRatio`: twice the median is the smallest ratio a uniform sampler cannot reach. */
export const SC07_MAX_FRAME_GAP_RATIO = 2;

export type WorldPoint = { x: number; y: number; z: number };

/** One published frame of the runtime's own read-only telemetry ring. */
export type RecordedSample = {
  atMs: number;
  phase: string;
  slot: { x: number; y: number; z: number; yaw: number };
  leftToe: WorldPoint | null;
  rightToe: WorldPoint | null;
};

/**
 * The shape `window.__openClinXrBedsideApproachEvidence` publishes, narrowed to what this
 * instrument reads. It is READ, never written: the recorder observes and the runtime decides.
 */
export type RecordedWorkflowTelemetry = {
  driveSource: string | null;
  refusal: string | null;
  phase: string | null;
  physicianActorId: string | null;
  toeBonesResolved: boolean;
  skeletonSampleCount: number;
  samples: RecordedSample[];
  targetWorld: WorldPoint | null;
  targetHeadingRadians: number | null;
  stoppedSeconds: number;
  observedObstacleIds: string[];
};

export type CaptureGaps = {
  sampleCount: number;
  intervalCount: number;
  medianIntervalMs: number;
  maxIntervalMs: number;
  maxOverMedian: number;
  /** Intervals exceeding SC-00's frozen ratio. A gap is reported, never smoothed away. */
  gapCount: number;
  withinFrozenRatio: boolean;
};

export type WorkflowCertification = {
  certified: boolean;
  /** Every reason the run was refused, each naming an observed value rather than a verdict. */
  reasons: string[];
  measured: {
    activationObserved: boolean;
    arrivalObserved: boolean;
    driveSource: string | null;
    physicianActorId: string | null;
    skeletonSampleCount: number;
    walkFrames: number;
    stoppedFrames: number;
    arrivalErrorMeters: number | null;
    settledYawErrorDegrees: number | null;
    stoppedSeconds: number;
    stoppedRootTravelMeters: number | null;
    limbTravelMeters: number | null;
    captureGaps: CaptureGaps | null;
  };
};

const EXPECTED_PHYSICIAN_ACTOR_ID = "senior_resident_ward_v1";
const EXPECTED_DRIVE_SOURCE = "case_owned_bedside_approach";

/** Shortest absolute yaw difference in degrees. */
export function yawErrorDegrees(observed: number, intended: number): number {
  const twoPi = Math.PI * 2;
  const delta = Math.abs(((((observed - intended + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI);
  return (delta * 180) / Math.PI;
}

/**
 * Frame-interval gaps over the published sample clock.
 *
 * `capture-gaps-recorded` is a required check id in `verify-core.ts` and `inspectClosureEvidence`
 * does NOT compute it, so the number has to come from somewhere real. It comes from here, off the
 * run's own timestamps, and a stream that cannot be graded says so rather than returning a pass.
 */
export function captureGapsOf(samples: readonly { atMs: number }[]): CaptureGaps | null {
  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) continue;
    const delta = current.atMs - previous.atMs;
    if (delta > 0) intervals.push(delta);
  }
  if (intervals.length < 2) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianIntervalMs =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? Number.NaN)
      : ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;
  const maxIntervalMs = sorted[sorted.length - 1] ?? Number.NaN;
  const maxOverMedian = maxIntervalMs / medianIntervalMs;
  const limit = medianIntervalMs * SC07_MAX_FRAME_GAP_RATIO;
  return {
    sampleCount: samples.length,
    intervalCount: intervals.length,
    medianIntervalMs,
    maxIntervalMs,
    maxOverMedian,
    gapCount: intervals.filter((interval) => interval > limit).length,
    withinFrozenRatio: maxOverMedian <= SC07_MAX_FRAME_GAP_RATIO,
  };
}

/**
 * Decide whether a retained run is an activation-to-arrival recording.
 *
 * There is no path through this function that certifies a run it did not measure. Absent telemetry
 * is a refusal with a named reason, not an empty pass — "zero sampled bodies" is the case SC-00's
 * rubric requires to fail, and an instrument that returned `certified: true` for a run with no
 * samples would be the defect the whole package exists to prevent.
 */
export function certifyRecordedWorkflow(input: {
  telemetry: RecordedWorkflowTelemetry | null;
  /** True when a locomotion/recorder global was present. An injected drive voids the run. */
  recorderGlobalPresent?: boolean;
}): WorkflowCertification {
  const reasons: string[] = [];
  const telemetry = input.telemetry;
  const empty: WorkflowCertification["measured"] = {
    activationObserved: false,
    arrivalObserved: false,
    driveSource: null,
    physicianActorId: null,
    skeletonSampleCount: 0,
    walkFrames: 0,
    stoppedFrames: 0,
    arrivalErrorMeters: null,
    settledYawErrorDegrees: null,
    stoppedSeconds: 0,
    stoppedRootTravelMeters: null,
    limbTravelMeters: null,
    captureGaps: null,
  };

  if (input.recorderGlobalPresent === true) {
    reasons.push(
      "a locomotion/recorder global was present; an injected drive cannot establish a normal-workflow run",
    );
  }
  if (telemetry === null) {
    reasons.push("the page published no bedside-approach telemetry, so nothing was observed");
    return { certified: false, reasons, measured: empty };
  }

  // ACTIVATION IS THE FIRST GATE, and it is the one this card's runtime currently fails. A run that
  // never activated cannot be a recording of an activation, whatever else it contains.
  const activationObserved =
    telemetry.driveSource === EXPECTED_DRIVE_SOURCE && telemetry.phase !== null;
  if (!activationObserved) {
    reasons.push(
      `the encounter never activated: driveSource=${String(telemetry.driveSource)}, `
        + `phase=${String(telemetry.phase)}, refusal=${String(telemetry.refusal)}`,
    );
  }
  if (telemetry.physicianActorId !== EXPECTED_PHYSICIAN_ACTOR_ID) {
    reasons.push(
      `the approaching actor is ${String(telemetry.physicianActorId)}, not ${EXPECTED_PHYSICIAN_ACTOR_ID}`,
    );
  }
  if (!telemetry.toeBonesResolved) {
    reasons.push("the loaded rig carried no named toe bones, so no stance foot was observed");
  }
  if (telemetry.skeletonSampleCount < 3) {
    reasons.push(
      `only ${telemetry.skeletonSampleCount} frames carried skeleton samples; zero or absent samples `
        + "are the measurement observing nothing, not a pass",
    );
  }

  const samples = telemetry.samples;
  const walk = samples.filter((sample) => sample.phase === "walking");
  const stopped = samples.filter((sample) => sample.phase === "arrived");
  if (walk.length === 0) reasons.push("no frame was observed walking");
  if (stopped.length === 0) reasons.push("no frame was observed stopped");

  const last = samples[samples.length - 1];
  const target = telemetry.targetWorld;
  const arrivalErrorMeters =
    last === undefined || target === null
      ? null
      : Math.hypot(last.slot.x - target.x, last.slot.z - target.z);
  if (arrivalErrorMeters === null) {
    reasons.push("no final pose or target was published, so arrival is unmeasured");
  } else if (arrivalErrorMeters > SC07_ARRIVAL_ERROR_MAX_METERS) {
    reasons.push(
      `arrival error ${arrivalErrorMeters.toFixed(5)} m exceeds the ${SC07_ARRIVAL_ERROR_MAX_METERS} m cap`,
    );
  }

  const settledYawErrorDegrees =
    last === undefined || telemetry.targetHeadingRadians === null
      ? null
      : yawErrorDegrees(last.slot.yaw, telemetry.targetHeadingRadians);
  if (settledYawErrorDegrees === null) {
    reasons.push("no settled heading was published");
  } else if (settledYawErrorDegrees > SC07_SETTLED_YAW_ERROR_MAX_DEGREES) {
    reasons.push(
      `settled heading error ${settledYawErrorDegrees.toFixed(3)} deg exceeds the `
        + `${SC07_SETTLED_YAW_ERROR_MAX_DEGREES} deg cap`,
    );
  }

  if (telemetry.stoppedSeconds < SC07_STOPPED_OBSERVATION_MIN_SECONDS) {
    reasons.push(
      `the stopped observation ran ${telemetry.stoppedSeconds.toFixed(2)} s, under the `
        + `${SC07_STOPPED_OBSERVATION_MIN_SECONDS} s minimum`,
    );
  }

  let stoppedRootTravelMeters: number | null = null;
  if (stopped.length > 1) {
    stoppedRootTravelMeters = 0;
    for (let index = 1; index < stopped.length; index += 1) {
      const a = stopped[index - 1];
      const b = stopped[index];
      if (a === undefined || b === undefined) continue;
      stoppedRootTravelMeters += Math.hypot(b.slot.x - a.slot.x, b.slot.z - a.slot.z);
    }
    if (stoppedRootTravelMeters > SC07_PERCEPTUAL_FLOOR_METERS) {
      reasons.push(
        `the root travelled ${stoppedRootTravelMeters.toFixed(5)} m during the stopped observation, `
          + `over ${SC07_PERCEPTUAL_FLOOR_METERS} m`,
      );
    }
  }

  // A CLIP THAT DECLARED ITSELF PLAYED MUST HAVE MOVED A LIMB, measured in the actor's own frame:
  // a body slid across a room holding a frozen pose moves every joint in world space and has
  // animated nothing. This is the "flag-only motion" control the card names.
  let limbTravelMeters: number | null = null;
  if (walk.length > 1) {
    limbTravelMeters = 0;
    for (let index = 1; index < walk.length; index += 1) {
      const a = walk[index - 1];
      const b = walk[index];
      if (a?.leftToe == null || b?.leftToe == null) continue;
      limbTravelMeters += Math.hypot(
        b.leftToe.x - b.slot.x - (a.leftToe.x - a.slot.x),
        b.leftToe.y - a.leftToe.y,
        b.leftToe.z - b.slot.z - (a.leftToe.z - a.slot.z),
      );
    }
    if (limbTravelMeters <= SC07_PERCEPTUAL_FLOOR_METERS) {
      reasons.push(
        `the locomotion clip moved a contact joint ${limbTravelMeters.toFixed(6)} m in the actor's own `
          + "frame; a flag is not motion",
      );
    }
  }

  if (telemetry.observedObstacleIds.length === 0) {
    reasons.push("the runtime observed no obstacle geometry; an empty list cannot establish a clear route");
  }

  const arrivalObserved =
    stopped.length > 0
    && arrivalErrorMeters !== null
    && arrivalErrorMeters <= SC07_ARRIVAL_ERROR_MAX_METERS;

  return {
    certified: reasons.length === 0,
    reasons,
    measured: {
      activationObserved,
      arrivalObserved,
      driveSource: telemetry.driveSource,
      physicianActorId: telemetry.physicianActorId,
      skeletonSampleCount: telemetry.skeletonSampleCount,
      walkFrames: walk.length,
      stoppedFrames: stopped.length,
      arrivalErrorMeters,
      settledYawErrorDegrees,
      stoppedSeconds: telemetry.stoppedSeconds,
      stoppedRootTravelMeters,
      limbTravelMeters,
      captureGaps: captureGapsOf(samples),
    },
  };
}

/**
 * THE REMOVE-THE-FIX VARIANT, kept beside the real instrument on purpose.
 *
 * This is what grading on declared state alone looks like: it trusts `phase`, `stoppedSeconds` and
 * the runtime's own word that a clip played, and it measures nothing. The card names that shape as
 * a failure — "flag-only motion", "a `clipPlayed` flag without measured limb motion" — and the
 * behavior test uses this function as its controlled counterweight: handed the same real blocked
 * run, this one and `certifyRecordedWorkflow` must disagree.
 *
 * It exists only to be failed against. Nothing may call it to certify anything.
 */
export function certifyOnDeclaredStateOnly(input: {
  telemetry: RecordedWorkflowTelemetry | null;
}): WorkflowCertification {
  const telemetry = input.telemetry;
  const measured: WorkflowCertification["measured"] = {
    activationObserved: telemetry !== null,
    arrivalObserved: telemetry?.phase === "arrived",
    driveSource: telemetry?.driveSource ?? null,
    physicianActorId: telemetry?.physicianActorId ?? null,
    skeletonSampleCount: telemetry?.skeletonSampleCount ?? 0,
    walkFrames: 0,
    stoppedFrames: 0,
    arrivalErrorMeters: null,
    settledYawErrorDegrees: null,
    stoppedSeconds: telemetry?.stoppedSeconds ?? 0,
    stoppedRootTravelMeters: null,
    limbTravelMeters: null,
    captureGaps: null,
  };
  // The defect in miniature: a published telemetry object is treated as a successful run.
  return { certified: telemetry !== null, reasons: [], measured };
}
