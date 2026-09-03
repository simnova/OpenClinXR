/**
 * THE MOTION EVIDENCE GATES — seven deterministic validators, aggregated once.
 *
 * Card: M3 deterministic evidence aggregation (BothyBoard issue #0). A compiled motion clip may
 * not reach a learner unless SEVEN named deterministic gates have measured it and said yes. This
 * module owns the aggregation and the verdict precedence. It does NOT derive clip artifacts: the
 * measurement pipeline that fills a clip's fields is owned by the downstream seven-validator card.
 *
 * PRECEDENCE, as a property of code that runs, not of a filename:
 *   - the deterministic verdict is authoritative over any advisory visual/VLM finding;
 *   - an advisory finding may ADD a finding, it may never satisfy a gate that did not run, and it
 *     may never flip a deterministic refusal to an acceptance;
 *   - an advisory refusal may not overturn a deterministic acceptance either — advisory means
 *     NEITHER direction decides.
 * `combineMotionVerdict` enforces that by construction: the deterministic verdict and the per-gate
 * results are returned untouched, and the advisory channel's own verdict is PRESERVED on the report
 * (`advisoryVisualVerdict`) so a downstream human-review gate can act on it without the combiner
 * having rewritten the deterministic result.
 *
 * BLINDNESS TRAVELS WITH THE VERDICT. Each gate carries its own `cannotSee` string into the report:
 * two instruments agreeing is not correctness (six of seven shipped humanoids once rendered
 * head-down while two independent AABB instruments agreed at 1e-4), and seven greens are evidence
 * about seven NAMED defect classes and nothing else. A gate that reports a verdict without its
 * `cannotSee` would lose the lesson the first time someone reads a green.
 *
 * NO THRESHOLD IS INVENTED HERE. Every tolerance is an input (`MotionGateSpec`), supplied by the
 * caller. A number written into a module becomes the design target of the thing being measured;
 * this module states none.
 */

export type Vec3 = readonly [number, number, number];

export type EffectorKey = {
  frame: number;
  effector: string;
  targetWorld: Vec3;
  achievedWorld: Vec3;
};

export type DeclaredContact = {
  frame: number;
  effector: string;
  surfaceId: string;
  effectorPointWorld: Vec3;
  surfacePointWorld: Vec3;
};

/**
 * Minimal clip shape the gates consume. Field formulas, so no field is defined in prose:
 *   effectorTargetErrorM = |achievedWorld - targetWorld|            (metres, per keyed frame)
 *   contactErrorM        = |effectorPointWorld - surfacePointWorld| (metres, per declared contact)
 *   jointFlexionRad      = max over frames of |rotationRad[joint]|  (radians, per joint)
 *   supportDriftM        = |rootTranslation[last] - rootTranslation[0]| projected on the XZ plane
 *   minSeparationM       = min over sampled frames of proxy-pair separation (negative = overlap)
 */
export type MotionClipFixture = {
  id: string;
  fps: number;
  frameCount: number;
  rootTranslationPerFrame: readonly Vec3[];
  jointFlexionRad: Readonly<Record<string, number>>;
  effectorKeys: readonly EffectorKey[];
  contacts: readonly DeclaredContact[];
  proxyMinSeparationM: number;
  trackFrameCounts: readonly number[];
  hasNaN: boolean;
  runtimeLoadedClipName: string | null;
};

/** Caller-supplied tolerances. The gates read these; nothing here chooses a product threshold. */
export type MotionGateSpec = {
  effectorTargetErrorToleranceM: number;
  contactErrorToleranceM: number;
  jointLimitsRad: Readonly<Record<string, number>>;
  supportDriftToleranceM: number;
  minProxySeparationM: number;
  expectedRuntimeClipName: string;
};

export const MOTION_GATE_IDS = [
  "effector_target_error",
  "contact_error",
  "joint_limit",
  "support_drift",
  "collision",
  "clip_integrity",
  "runtime_smoke",
] as const;

export type MotionGateId = (typeof MOTION_GATE_IDS)[number];

export type GateVerdict = "pass" | "fail";
export type MotionVerdict = "accept" | "refuse";

export type GateResult = {
  id: MotionGateId;
  verdict: GateVerdict;
  measured: number;
  threshold: number;
  unit: string;
  cannotSee: string;
};

export type MotionEvidenceReport = {
  schemaVersion: string;
  verdict: MotionVerdict;
  gates: GateResult[];
  visualFindingsAdvisoryOnly: boolean;
  /**
   * The advisory channel's own verdict, PRESERVED rather than applied. Without somewhere to record
   * it, "the advisory finding did not decide" and "the advisory finding was thrown away" are
   * indistinguishable on the artifact.
   */
  advisoryVisualVerdict?: MotionVerdict | null;
};

const SCHEMA_VERSION = "openclinxr.motion-evidence-report.v1";

function distanceM(a: Vec3, b: Vec3): number {
  const [ax = 0, ay = 0, az = 0] = a;
  const [bx = 0, by = 0, bz = 0] = b;
  return Math.hypot(ax - bx, ay - by, az - bz);
}

/**
 * (1) effector_target_error — measures |achieved - target| for an effector at a keyed frame.
 */
function effectorTargetErrorGate(clip: MotionClipFixture, spec: MotionGateSpec): GateResult {
  let measured = 0;
  for (const key of clip.effectorKeys) {
    measured = Math.max(measured, distanceM(key.achievedWorld, key.targetWorld));
  }
  const threshold = spec.effectorTargetErrorToleranceM;
  return {
    id: "effector_target_error",
    verdict: measured <= threshold ? "pass" : "fail",
    measured,
    threshold,
    unit: "m",
    cannotSee:
      "how the chain got there: a hand that reaches the target through an inverted elbow, a twisted forearm or a mirrored assignment scores zero error, and a target that is itself misplaced is invisible too",
  };
}

/**
 * (2) contact_error — measures |effector point - surface point| at declared contact frames.
 */
function contactErrorGate(clip: MotionClipFixture, spec: MotionGateSpec): GateResult {
  let measured = 0;
  for (const contact of clip.contacts) {
    measured = Math.max(measured, distanceM(contact.effectorPointWorld, contact.surfacePointWorld));
  }
  const threshold = spec.contactErrorToleranceM;
  return {
    id: "contact_error",
    verdict: measured <= threshold ? "pass" : "fail",
    measured,
    threshold,
    unit: "m",
    cannotSee:
      "which SIDE of the surface the effector is on: resting on the surface and embedded 0 mm into it are the same number, and contact that should exist but was never declared is not measured, so omission reads as clean",
  };
}

/**
 * (3) joint_limit — bounds each joint's rotation magnitude against its per-joint range. A joint
 * absent from the limit table is UNCHECKED (documented blindness, not an omission to fix here).
 */
function jointLimitGate(clip: MotionClipFixture, spec: MotionGateSpec): GateResult {
  let worstJoint: string | null = null;
  let worstFlexion = 0;
  let worstLimit = 0;
  for (const [joint, flexion] of Object.entries(clip.jointFlexionRad)) {
    const limit = spec.jointLimitsRad[joint];
    if (limit === undefined) continue;
    const flexionAbs = Math.abs(flexion);
    if (worstJoint === null || flexionAbs / limit > worstFlexion / worstLimit) {
      worstJoint = joint;
      worstFlexion = flexionAbs;
      worstLimit = limit;
    }
  }
  const measured = worstJoint === null ? 0 : worstFlexion;
  const threshold = worstJoint === null ? 0 : worstLimit;
  return {
    id: "joint_limit",
    verdict: measured <= threshold ? "pass" : "fail",
    measured,
    threshold,
    unit: "rad",
    cannotSee:
      "combinations or ORDER: shoulder, elbow and wrist each inside range while the arm passes through the torso is seven greens; a joint absent from the limit table is unchecked, and a limit table that is itself wrong reads as clean",
  };
}

/**
 * (4) support_drift — measures support/root translation across the clip, projected on the XZ
 * plane. The Y component is dropped: a root that stays planted at its standing height while the
 * body translates is the drift this gate exists to bound.
 */
function supportDriftGate(clip: MotionClipFixture, spec: MotionGateSpec): GateResult {
  let measured = 0;
  const samples = clip.rootTranslationPerFrame;
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first !== undefined && last !== undefined) {
      const [firstX = 0, , firstZ = 0] = first;
      const [lastX = 0, , lastZ = 0] = last;
      measured = Math.hypot(lastX - firstX, lastZ - firstZ);
    }
  }
  const threshold = spec.supportDriftToleranceM;
  return {
    id: "support_drift",
    verdict: measured <= threshold ? "pass" : "fail",
    measured,
    threshold,
    unit: "m",
    cannotSee:
      "direction or distribution: sliding forward and sliding backward measure identically, and one large jump is indistinguishable from the same total accumulated in per-frame increments below notice; it cannot see FEET that skate while the root is pinned, because the root is the thing measured",
  };
}

/**
 * (5) collision — classifies the sampled minimum proxy separation carried by the clip. Negative
 * separation means interpenetration at some sampled frame.
 */
function collisionGate(clip: MotionClipFixture, spec: MotionGateSpec): GateResult {
  const measured = clip.proxyMinSeparationM;
  const threshold = spec.minProxySeparationM;
  return {
    id: "collision",
    verdict: measured >= threshold ? "pass" : "fail",
    measured,
    threshold,
    unit: "m",
    cannotSee:
      "anything outside the proxy set - garment, hair, equipment, a second actor - and nothing BETWEEN samples: passing at sampled frames says nothing about the frames in between, and a capsule proxy cannot resolve an interpenetration finer than the capsule",
  };
}

/**
 * (6) clip_integrity — checks STRUCTURE: frame count, fps, per-track frame counts and NaN freedom.
 */
function clipIntegrityGate(clip: MotionClipFixture): GateResult {
  let defects = 0;
  if (clip.frameCount <= 0) defects += 1;
  if (clip.fps <= 0) defects += 1;
  if (clip.hasNaN) defects += 1;
  if (clip.trackFrameCounts.length === 0) defects += 1;
  if (clip.trackFrameCounts.some((count) => count !== clip.frameCount)) defects += 1;
  return {
    id: "clip_integrity",
    verdict: defects === 0 ? "pass" : "fail",
    measured: defects,
    threshold: 0,
    unit: "defects",
    cannotSee:
      "CONTENT: a structurally perfect T-pose held for 200 frames passes every integrity check, as does a clip whose joint names match the target while its values drive a different skeleton",
  };
}

/**
 * (7) runtime_smoke — proves the runtime loaded the intended clip. The runtime harnesses that
 * prove a clip LOADS AND PLAYS live outside this package (clinical-touch-smoke and
 * bvh-retarget-lab-smoke); this gate consumes what they report.
 */
function runtimeSmokeGate(clip: MotionClipFixture, spec: MotionGateSpec): GateResult {
  const measured = clip.runtimeLoadedClipName === spec.expectedRuntimeClipName ? 0 : 1;
  return {
    id: "runtime_smoke",
    verdict: measured === 0 ? "pass" : "fail",
    measured,
    threshold: 0,
    unit: "defects",
    cannotSee:
      "WHETHER WHAT PLAYS IS RIGHT: it cannot tell an upright figure from an inverted one, a frustum-culled actor from a rendered one, or a mixer silently playing a fallback clip from the intended one",
  };
}

/**
 * Run all seven gates and aggregate. EVERY gate runs unconditionally - the report carries all seven
 * results so a later reader can see which gates fired, and a gate set that short-circuits after the
 * first failure would accept by omission exactly the way a skipped gate does.
 */
export function runMotionEvidenceGates(clip: MotionClipFixture, spec: MotionGateSpec): MotionEvidenceReport {
  const gates: GateResult[] = [
    effectorTargetErrorGate(clip, spec),
    contactErrorGate(clip, spec),
    jointLimitGate(clip, spec),
    supportDriftGate(clip, spec),
    collisionGate(clip, spec),
    clipIntegrityGate(clip),
    runtimeSmokeGate(clip, spec),
  ];
  const verdict: MotionVerdict = gates.every((gate) => gate.verdict === "pass") ? "accept" : "refuse";
  return {
    schemaVersion: SCHEMA_VERSION,
    verdict,
    gates,
    visualFindingsAdvisoryOnly: true,
  };
}

/**
 * Combine a deterministic report with an advisory visual/VLM finding. The deterministic verdict
 * and the per-gate results decide, unchanged, in BOTH directions: an advisory acceptance may not
 * lift a deterministic refusal, and an advisory refusal may not overturn a deterministic
 * acceptance. The advisory channel's verdict is preserved on the returned report so a downstream
 * human-review gate can act on it - a channel that cannot decide must still be recorded, or a
 * reviewer never sees it.
 */
export function combineMotionVerdict(
  deterministic: MotionEvidenceReport,
  advisory: { verdict: MotionVerdict },
): MotionEvidenceReport {
  return {
    ...deterministic,
    gates: deterministic.gates,
    visualFindingsAdvisoryOnly: true,
    advisoryVisualVerdict: advisory.verdict,
  };
}
