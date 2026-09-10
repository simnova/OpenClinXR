import { appendFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Scene } from "three";
// DECLARING MODULES, not package barrels. Importing `xr-scene/src/index.js`,
// `xr-station-room/src/index.js` or `xr-runtime-state/src/index.js` from here pulls their whole
// surface into the tools-relaxed TypeScript program, and that surface includes DOM-using files —
// isolated-subject-lab.ts and station-interaction.ts — which the tools config has no `dom` lib
// for. Measured: the barrels took `pnpm typecheck:relaxed` from 0 errors to 19, against a
// shrink-only ceiling of 0. The narrow paths import the same symbols and drag nothing.
import { FOOT_CONTACT_HEIGHT_METERS } from "../../../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import {
  geometryRevisionDigest,
  type ObservedApproachGeometry,
  type ResolvedBedsideApproach,
  resolveBedsideApproachIntent,
} from "../../../../../../packages/openclinxr/asset-registry/src/case-approach-intent.js";
import {
  composeSupportedActorWorldPosition,
  createEdChestPainRuntimeSceneManifest,
  headingRadiansToward,
  supineActorWorldPosition,
} from "../../../../../../packages/openclinxr/asset-registry/src/index.js";
import type { EncounterRuntimeActorPlacement } from "../../../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import {
  advanceCaseOwnedBedsideApproach,
  applyCaseOwnedStanceLock,
  type CaseOwnedApproachFrame,
  createCaseOwnedBedsideApproach,
  measureStanceGroundAdvance,
} from "../../../../../../packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime.js";
import { observeMountedApproachGeometry } from "../../../../../../packages/openclinxr/xr-humanoid-animation/src/mounted-approach-geometry.js";
import { resolveEffectiveVerticalOffsetMeters } from "../../../../../../packages/openclinxr/xr-pose/src/actor-floor-composition.js";
import { supportedActorPlacementPosition } from "../../../../../../packages/openclinxr/xr-runtime-state/src/supported-actor-placement.js";
import { applyCleanEncounterVisualReviewActorFraming } from "../../../../../../packages/openclinxr/xr-scene/src/encounter-actor-framing.js";
import { buildStationEnvironment } from "../../../../../../packages/openclinxr/xr-station/src/index.js";
import { observeMountedSupportInstances } from "../../../../../../packages/openclinxr/xr-station-room/src/mounted-support-observation.js";
import { sceneClosureCaseDocument } from "../../../../factory/scene-closure-case-source.js";
import {
  gradeMotionMeasurement,
  type JointSample,
  type MotionMeasurement,
  type RubricGrade,
} from "../sc-00/measurement-rubric.js";
import {
  boneLengthSeries,
  censusSkinnedGeometry,
  jointTracks,
  SHIPPED_PHYSICIAN_LEG_BONES,
} from "../sc-00/selected-asset-measurement.js";

/**
 * The SHIPPED clip, driven through the case-owned approach and graded by SC-00's frozen rubric.
 *
 * WHY THIS LIVES IN `tools` AND NOT IN THE BEHAVIOUR TEST. The card fixes the behaviour test at
 * `apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts`, and
 * `packages/openclinxr-verification/architecture-rules/src/archunit-tests/workspace-architecture.test.ts`
 * forbids any file under an app's `src/` from importing `tools/openclinxr/evidence/` — which is where
 * SC-00's frozen rubric and its GLB decoders live. The two requirements collide, and the resolution
 * is a split rather than an evasion: the app test drives the production runtime and asserts the
 * acceptance-contract limits, and THIS module drives the same production runtime with the real
 * decoded clip and hands the graded measurement to `verify.ts`, which re-grades it from the retained
 * bytes. Neither half is a fixture. The collision is recorded in `sc-05.md`.
 *
 * claimScope: the shipped physician GLB and its shipped locomotion clip, driven through the shipped
 * approach runtime over a real station scene, graded by the frozen rubric.
 * notEvidenceFor: what a browser renders, gait quality, or clinical appropriateness.
 */

const CASE = sceneClosureCaseDocument();
const WARD_ENVIRONMENT_ID = "inpatient_ward_room_v1";
const PATIENT_ACTOR_ID = "patient_margaret_ellis_v1";
const PHYSICIAN_ACTOR_ID = "senior_resident_ward_v1";
const NURSE_ACTOR_ID = "ward_nurse_patel_v1";
const WARD_BED_INSTANCE_ID = `${WARD_ENVIRONMENT_ID}:stretcher`;
const PHYSICIAN_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
export const SC05_MEASUREMENT_RUN_ID = "sc05-shipped-approach";
const WALK_CLIP = "openclinxr_retarget_walk_formal_cc0";
const CONTACT_JOINTS = ["toe1-1.L", "toe1-1.R"] as const;
/** SC-00's frozen floor frame id for this encounter's room, and the plane it names. */
const SIMULATION_HZ = 60;

type Vector3 = { x: number; y: number; z: number };

/**
 * Read-only observation emitter.
 *
 * Written only when the owner's build-report supplies a path, so an ordinary run has no side
 * effect. It records MEASURED VALUES, never verdicts: `verify.ts` re-reads these bytes and refuses
 * a report whose check outcome is not findable in them.
 */
export function observe(checkId: string, metric: string, unit: string, value: unknown): void {
  const target = process.env["OPENCLINXR_SC05_OBSERVATIONS"];
  if (!target) return;
  appendFileSync(
    target,
    `${JSON.stringify({ checkId, metric, unit, value, observedAtMs: Date.now() })}\n`,
    "utf8",
  );
}

// ── The decoded physician, its clip and its skinned census ──────────────────────────────────────

export type DecodedPhysician = {
  left: JointSample[];
  right: JointSample[];
  periodMs: number;
  firstMs: number;
  skinnedBodyCount: number;
  skinnedVertexSampleCount: number;
  boneLengths: Array<{ bone: string; lengthsMeters: number[] }>;
  /** Lowest skinned vertex in the GLB's own frame: the sole, which the floor-band plant lands. */
  meshMinY: number;
  /** The clip's rest frame, which `playLocomotionClip` settles onto when the drive stops. */
  restLeft: Vector3;
  restRight: Vector3;
};



/**
 * The shipped physician's own bytes.
 *
 * `three`'s `GLTFLoader` cannot parse these in node — its texture path reaches `self` — so the
 * skeleton comes from the same decoder SC-00 measured with: forward kinematics over the GLB's node
 * chain, in float64, with slerp on rotation channels. The tracks below are therefore the ACTUAL
 * joint positions of the shipped clip on the shipped rig, in the body frame, and they are attached
 * to the staged slot through the loader's own child-transform contract (asserted in clause (i)).
 *
 * THE FIRST SAMPLE IS THE REST FRAME AND IS DROPPED. Measured: at index 0 both toes sit at exactly
 * (+/-0.096, 0.016, 0.035) — perfectly symmetric, which no frame of a walk is — and index 41 is
 * byte-identical to index 1. The cycle is therefore indices 1..41 with 41 the wrap sample, a
 * 1.6667 s period at a uniform 41.667 ms. Sampling across the rest frame would inject a 0.38 m
 * discontinuity into the middle of every loop.
 */
export async function decodePhysician(): Promise<DecodedPhysician> {
  const meshMinY = await lowestSkinnedVertexY();
  const [tracks, census, bones] = await Promise.all([
    jointTracks({ glbPath: PHYSICIAN_GLB, clipName: WALK_CLIP, joints: CONTACT_JOINTS }),
    censusSkinnedGeometry(PHYSICIAN_GLB),
    boneLengthSeries({ glbPath: PHYSICIAN_GLB, clipName: WALK_CLIP, bones: SHIPPED_PHYSICIAN_LEG_BONES }),
  ]);
  const left = (tracks[0]?.samples ?? []).slice(1);
  const right = (tracks[1]?.samples ?? []).slice(1);
  const first = left[0];
  const last = left[left.length - 1];
  if (first === undefined || last === undefined) throw new Error("the shipped walk clip decoded no toe track");
  return {
    left,
    right,
    periodMs: last.atMs - first.atMs,
    firstMs: first.atMs,
    skinnedBodyCount: census.skinnedBodyCount,
    skinnedVertexSampleCount: census.skinnedVertexSampleCount,
    boneLengths: bones,
    meshMinY,
    restLeft: { ...(tracks[0]?.samples[0]?.position ?? { x: 0, y: 0, z: 0 }) },
    restRight: { ...(tracks[1]?.samples[0]?.position ?? { x: 0, y: 0, z: 0 }) },
  };
}

/**
 * The lowest skinned vertex of the shipped physician, in the GLB's own frame.
 *
 * The floor-band plant lands the SOLE, not the toe joint, so the reproduction has to carry the same
 * extent the browser's `Box3` would see. Reading it off the bytes rather than assuming a foot
 * thickness is what keeps the plant's landing measured.
 */
async function lowestSkinnedVertexY(): Promise<number> {
  const document = await new NodeIO().read(PHYSICIAN_GLB);
  let lowest = Number.POSITIVE_INFINITY;
  for (const node of document.getRoot().listNodes()) {
    if (!node.getSkin() || !node.getMesh()) continue;
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      const element = [0, 0, 0];
      for (let index = 0; index < position.getCount(); index += 1) {
        position.getElement(index, element);
        if ((element[1] ?? 0) < lowest) lowest = element[1] ?? 0;
      }
    }
  }
  if (!Number.isFinite(lowest)) throw new Error("the shipped physician GLB decoded no skinned vertices");
  return lowest;
}

/** Linear interpolation of a decoded track at an arbitrary clip time, wrapped to the cycle. */
function sampleTrack(samples: readonly JointSample[], clipMs: number, decoded: DecodedPhysician): Vector3 {
  const local = decoded.firstMs + (((clipMs % decoded.periodMs) + decoded.periodMs) % decoded.periodMs);
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1];
    const b = samples[index];
    if (a === undefined || b === undefined) continue;
    if (local <= b.atMs) {
      const u = (local - a.atMs) / (b.atMs - a.atMs);
      return {
        x: a.position.x + (b.position.x - a.position.x) * u,
        y: a.position.y + (b.position.y - a.position.y) * u,
        z: a.position.z + (b.position.z - a.position.z) * u,
      };
    }
  }
  const fallback = samples[samples.length - 1];
  if (fallback === undefined) throw new Error("empty track");
  return { ...fallback.position };
}

// ── Staging, exactly as the browser entry builds it ─────────────────────────────────────────────


const CASE_ROLES: Record<string, string> = Object.fromEntries(
  CASE.actors.map((actor) => [actor.actorId, actor.role]),
);

function persistedCasePlacements(): Record<string, EncounterRuntimeActorPlacement> {
  return createEdChestPainRuntimeSceneManifest({
    scenarioId: CASE.scenarioId,
    stationId: "scene_closure_supine_bedside_station_v1",
    scenario: CASE as never,
    environmentId: WARD_ENVIRONMENT_ID,
  }).actorPlacements;
}



export type StagedWard = {
  scene: Scene;
  roots: Map<string, Group>;
  placements: Record<string, EncounterRuntimeActorPlacement>;
  geometry: ReturnType<typeof observeMountedApproachGeometry>;
  patientWorld: Vector3;
  start: Vector3 | { refused: true; reason: string };
};

/** The whole normal boot path for this case, in one room, with every decision taken by production code. */
/**
 * The ward scene, its observed geometry, and the physician's slot as the stager leaves it.
 *
 * THE STAGER ITSELF IS NOT RUN HERE, and the reason is a resolution boundary rather than a
 * shortcut. `stageStationActors` calls `loadGeneratedHumanoidIntoActorSlot`, which needs a browser
 * fetch and a 93-field `AssetLoadingContext`; the behaviour test stubs that one function with
 * `vi.spyOn` and drives the real stager, and `apps/ui-xr/src/the-normal-encounter-physician-
 * approaches-and-stops.test.ts` is where that half of the evidence lives. What this instrument
 * needs from staging is exactly what the stager does to the fourth slot: position it at the resolved
 * placement and run `applyCleanEncounterVisualReviewActorFraming` over it, which is what sets the
 * 0.86 slot scale and the floor-standing y = 0 this measurement then depends on. Both are called
 * here, by name, from the shipped modules.
 */
export function stageWard(): StagedWard {
  const scene = new Scene();
  scene.add(buildStationEnvironment({ environmentId: WARD_ENVIRONMENT_ID }) as never);
  const geometry = observeMountedApproachGeometry(scene as never, { supportInstanceId: WARD_BED_INSTANCE_ID });
  const placements = persistedCasePlacements();
  const patientPlacement = placements[PATIENT_ACTOR_ID];
  const composedPatient = composeSupportedActorWorldPosition({
    posture: "supine",
    fixtureAnchor: supineActorWorldPosition({}),
    ...(patientPlacement?.plantOffsetMeters ? { authoredOffsetMeters: patientPlacement.plantOffsetMeters } : {}),
    resolvedPosition: patientPlacement?.position ?? { x: 0, y: 0, z: 0 },
  });
  const physicianPlacement = placements[PHYSICIAN_ACTOR_ID];
  const resolvedPhysician = supportedActorPlacementPosition({
    posture: "standing",
    actorId: PHYSICIAN_ACTOR_ID,
    slotKind: physicianPlacement?.slotKind ?? "additional_cast",
    scenarioId: CASE.scenarioId,
    environmentId: WARD_ENVIRONMENT_ID,
    resolvedPosition: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
    ...(physicianPlacement?.plantOffsetMeters ? { authoredOffsetMeters: physicianPlacement.plantOffsetMeters } : {}),
    ...(geometry.floorFrame ? { floorFrame: geometry.floorFrame } : {}),
    mountedSupportInstanceIds: observeMountedSupportInstances(scene as never).map(
      (support) => support.supportInstanceId,
    ),
  });
  const slot = new Group();
  slot.name = "runtime_additional_cast_slot";
  slot.position.set(resolvedPhysician.position.x, resolvedPhysician.position.y, resolvedPhysician.position.z);
  slot.userData["openClinXrSlotKind"] = "additional_cast";
  slot.userData["openClinXrActorPosture"] = physicianPlacement?.posture ?? "standing";
  slot.userData["openClinXrActorId"] = PHYSICIAN_ACTOR_ID;
  applyCleanEncounterVisualReviewActorFraming({
    actor: slot,
    actorId: PHYSICIAN_ACTOR_ID,
    scenarioId: CASE.scenarioId,
    role: CASE_ROLES[PHYSICIAN_ACTOR_ID] ?? "",
    skipFraming: false,
  });
  scene.add(slot);
  return {
    scene,
    roots: new Map([["additional_cast", slot]]),
    placements,
    geometry,
    patientWorld: "refused" in composedPatient ? { x: 0, y: 0, z: 0 } : composedPatient,
    start:
      resolvedPhysician.refusalReason === undefined
        ? resolvedPhysician.position
        : { refused: true as const, reason: resolvedPhysician.refusalReason },
  };
}

export function intentFor(
  ward: StagedWard,
  overrides: {
    physicianActorId?: string | null;
    firstClinicalSlotActorId?: string;
    firstClinicalSlotRole?: string;
    geometry?: ObservedApproachGeometry;
  } = {},
) {
  return resolveBedsideApproachIntent({
    physicianActorId: overrides.physicianActorId === undefined ? PHYSICIAN_ACTOR_ID : overrides.physicianActorId,
    firstClinicalSlotActorId: overrides.firstClinicalSlotActorId ?? NURSE_ACTOR_ID,
    firstClinicalSlotRole: overrides.firstClinicalSlotRole ?? "nurse",
    patientWorldPosition: ward.patientWorld,
    start: ward.start,
    geometry: overrides.geometry ?? ward.geometry,
  });
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────────

export type ApproachRun = {
  frames: CaseOwnedApproachFrame[];
  trackL: JointSample[];
  trackR: JointSample[];
  arrivalErrorMeters: number;
  settledYawErrorDegrees: number;
  stoppedSeconds: number;
  stoppedRootTravelMeters: number;
  walkFrameCount: number;
  settleFrameCount: number;
  travelHeadingRadians: number;
  clipAdvance: { metersPerSecond: number; forward: { x: number; z: number } };
  invalidationReason: string | null;
  phases: string[];
  floorBandPlant: { localY: number; planted: boolean; previousLowestMeshWorldY: number; targetLowestMeshWorldY: number };
};

/**
 * Drive the case-owned approach for `seconds`, sampling the composed world track of both toes.
 *
 * The skeleton is the DECODED clip attached under the staged slot through the loader's own child
 * contract. Nothing here writes a transform on the actor: the executor and the stance lock do, and
 * they are the production modules under test.
 */
export function runApproach(input: {
  ward: StagedWard;
  intent: ResolvedBedsideApproach;
  seconds: number;
  decoded: DecodedPhysician;
  stanceLockEnabled?: boolean;
  /** Fired every frame; return an override for the observed geometry revision or support state. */
  perturb?: (frameIndex: number) => { geometryRevision?: string; supportAccepted?: boolean } | undefined;
}): ApproachRun {
  const slot = input.ward.roots.get("additional_cast");
  if (slot === undefined) throw new Error("the additional_cast slot was not staged");
  const physicianPlacement = input.ward.placements[PHYSICIAN_ACTOR_ID];
  const humanoid = new Object3D();
  humanoid.name = "physician_humanoid_child";
  // The loader's own resolved offset, not the raw authored one: `generated-loaders.ts:108` runs
  // `resolveEffectiveVerticalOffset` over the slot's local Y and scale, and for a standing actor the
  // framing pass has already put the slot at y = 0, where that function returns 0. Reproducing the
  // raw -0.95 instead lifted the toes 0.192 m off the floor and every contact metric observed
  // nothing — a harness defect that looked exactly like a product one.
  humanoid.position.set(
    0,
    resolveEffectiveVerticalOffsetMeters({
      slotLocalY: slot.position.y,
      verticalOffsetMeters: physicianPlacement?.verticalOffsetMeters ?? 0,
      slotScaleY: slot.scale.y,
    }),
    0,
  );
  humanoid.rotation.y = 0;
  humanoid.scale.set(1, 1, 1);
  // The joints carry a vanishing box so the production floor-band plant, which measures a `Box3`
  // over the loaded body, sees the same extent a browser would. An `Object3D` with no geometry
  // yields an EMPTY box whose `min.y` is +Infinity.
  const marker = (): Mesh => new Mesh(new BoxGeometry(1e-6, 1e-6, 1e-6), new MeshBasicMaterial());
  const toeL = marker();
  toeL.name = "toe1-1.L";
  const toeR = marker();
  toeR.name = "toe1-1.R";
  humanoid.add(toeL);
  humanoid.add(toeR);
  // The sole, at the decoded body's own lowest skinned vertex, so the production floor-band plant
  // lands the same extent a browser `Box3` would see rather than the toe joint alone.
  const sole = marker();
  sole.name = "decoded_lowest_skinned_vertex";
  sole.position.set(0, input.decoded.meshMinY, 0);
  humanoid.add(sole);
  slot.add(humanoid);

  const clipAdvance = measureStanceGroundAdvance(input.decoded.left, {
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    floorOriginY: 0,
  });
  const routeHeadingRadians = headingRadiansToward(input.intent.start, input.intent.target.position);
  // The OBSERVED revision is recomputed from the room, never taken from the plan. A plan that
  // supplies its own "this room is clear" claim is the forged-plan case the contract refuses.
  const observedGeometryRevision = geometryRevisionDigest(input.ward.geometry);
  const approach = createCaseOwnedBedsideApproach({
    intent: input.intent,
    geometry: input.ward.geometry,
    observedGeometryRevision,
    runId: SC05_MEASUREMENT_RUN_ID,
    actorSlot: slot,
    humanoidRoot: humanoid,
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    clipAdvance,
    clipCycleSeconds: input.decoded.periodMs / 1000,
    routeHeadingRadians,
  });
  if ("refused" in approach) throw new Error(`createCaseOwnedBedsideApproach refused: ${approach.reason}`);
  if (input.stanceLockEnabled === false) {
    approach.leftToe = null;
    approach.rightToe = null;
  }

  const dt = 1 / SIMULATION_HZ;
  const frames: CaseOwnedApproachFrame[] = [];
  const trackL: JointSample[] = [];
  const trackR: JointSample[] = [];
  const path: Array<{ x: number; z: number; phase: string }> = [];
  let clipMs = 0;
  let locomotionActive = false;
  for (let index = 0; index < Math.round(input.seconds * SIMULATION_HZ); index += 1) {
    const nowMs = index * dt * 1000;
    const override = input.perturb?.(index);
    // POSE FIRST, exactly as the frame loop does: `animation-loop.ts` calls `mixer.update` before
    // it reads the drive, so the skeleton the stance lock measures is this frame's pose.
    if (locomotionActive) clipMs += dt * 1000;
    // A stopped drive settles the actor on the clip's REST frame, which is what
    // `playLocomotionClip` now does through `action.reset()` + one zero-delta mixer update.
    const walking = locomotionActive || index === 0;
    const local = walking ? sampleTrack(input.decoded.left, clipMs, input.decoded) : input.decoded.restLeft;
    const localRight = walking ? sampleTrack(input.decoded.right, clipMs, input.decoded) : input.decoded.restRight;
    toeL.position.set(local.x, local.y, local.z);
    toeR.position.set(localRight.x, localRight.y, localRight.z);
    slot.updateMatrixWorld(true);
    const frame = advanceCaseOwnedBedsideApproach(approach, {
      nowMs,
      deltaSeconds: dt,
      observedGeometryRevision: override?.geometryRevision ?? observedGeometryRevision,
      supportAccepted: override?.supportAccepted ?? true,
    });
    if (frame === null) throw new Error("advanceCaseOwnedBedsideApproach returned null for a live approach");
    // THE LOCK RUNS AFTER THE POSE, in the order `main.ts` runs it: the drive is produced before
    // `updateGeneratedHumanoidAnimations` consumes it, so a lock folded into the drive step reads
    // the previous frame's pose. Measured in a browser that way: 4.09996 m of total slide.
    applyCaseOwnedStanceLock(approach);
    locomotionActive = frame.locomotion > 0;
    const relocked = frame;
    frames.push(relocked);
    const elementsL = toeL.matrixWorld.elements;
    const elementsR = toeR.matrixWorld.elements;
    trackL.push({ atMs: nowMs, position: { x: elementsL[12] ?? 0, y: elementsL[13] ?? 0, z: elementsL[14] ?? 0 } });
    trackR.push({ atMs: nowMs, position: { x: elementsR[12] ?? 0, y: elementsR[13] ?? 0, z: elementsR[14] ?? 0 } });
    path.push({ x: slot.position.x, z: slot.position.z, phase: relocked.phase });
  }
  const last = path[path.length - 1];
  const lastFrame = frames[frames.length - 1];
  if (last === undefined || lastFrame === undefined) throw new Error("the approach produced no frames");
  const stopIndex = path.findIndex((entry) => entry.phase === "arrived");
  let stoppedRootTravelMeters = 0;
  for (let index = stopIndex + 1; index > 0 && index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a === undefined || b === undefined) continue;
    stoppedRootTravelMeters += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const yawError = Math.abs(
    ((((lastFrame.headingRadians - input.intent.target.headingRadians + Math.PI) % (Math.PI * 2)) + Math.PI * 2)
      % (Math.PI * 2)) - Math.PI,
  );
  return {
    frames,
    trackL,
    trackR,
    arrivalErrorMeters: Math.hypot(
      last.x - input.intent.target.position.x,
      last.z - input.intent.target.position.z,
    ),
    settledYawErrorDegrees: (yawError * 180) / Math.PI,
    stoppedSeconds: lastFrame.stoppedSeconds,
    stoppedRootTravelMeters,
    walkFrameCount: path.filter((entry) => entry.phase === "walking").length,
    settleFrameCount: path.filter((entry) => entry.phase === "settling").length,
    travelHeadingRadians: approach.travelHeadingRadians,
    clipAdvance,
    floorBandPlant: approach.floorBandPlant,
    invalidationReason: lastFrame.invalidationReason,
    phases: [...new Set(path.map((entry) => entry.phase))],
  };
}

/** A `MotionMeasurement` over a slice of a run, graded by SC-00's frozen rubric. */
export function measurementFor(input: {
  run: ApproachRun;
  intent: ResolvedBedsideApproach;
  ward: StagedWard;
  decoded: DecodedPhysician;
  from: number;
  to: number;
  measurementId: string;
}): MotionMeasurement {
  const floorFrame = input.ward.geometry.floorFrame;
  const support = input.ward.geometry.supportBounds;
  return {
    measurementId: input.measurementId,
    runId: SC05_MEASUREMENT_RUN_ID,
    actorId: PHYSICIAN_ACTOR_ID,
    skinnedBodyCount: input.decoded.skinnedBodyCount,
    skinnedVertexSampleCount: input.decoded.skinnedVertexSampleCount,
    clipDeclaredPlayed: true,
    clipName: WALK_CLIP,
    // The composed world track is supplied directly, so the rubric's ground composition adds
    // nothing: this run's advance is NOT constant — the stance lock derives it from the planted
    // foot — and a constant declared here would inject motion the consumer never applied. The
    // heading is the route's, recorded because the rubric's swept check reads it.
    groundAdvanceMetersPerSecond: 0,
    forward: {
      x: Math.sin(headingRadiansToward(input.intent.start, input.intent.target.position)),
      z: Math.cos(headingRadiansToward(input.intent.start, input.intent.target.position)),
    },
    floor:
      floorFrame === null
        ? null
        : { frameId: floorFrame.frameId, originY: floorFrame.originY, normal: { x: 0, y: 1, z: 0 } },
    support: {
      instanceId: input.ward.geometry.supportInstanceId,
      bounds: support,
      basis: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    },
    supportedContactSamples: null,
    contactTracks: [
      { joint: "toe1-1.L", samples: input.run.trackL.slice(input.from, input.to) },
      { joint: "toe1-1.R", samples: input.run.trackR.slice(input.from, input.to) },
    ],
    boneLengthSeries: input.decoded.boneLengths,
    route: {
      waypoints: input.intent.plan.waypoints.map((waypoint) => waypoint.position),
      sampleSpacingMeters: 0.04,
      obstacles: input.ward.geometry.obstacles.map((obstacle) => ({ id: obstacle.id, bounds: obstacle.bounds })),
    },
    arrival: { errorMeters: input.run.arrivalErrorMeters },
    settled: {
      yawErrorDegrees: input.run.settledYawErrorDegrees,
      observedSeconds: input.run.stoppedSeconds,
      rootTravelMeters: input.run.stoppedRootTravelMeters,
    },
  };
}

export function footSlideFinding(measurement: MotionMeasurement): { outcome: string; observed: string } {
  const finding = gradeMotionMeasurement(measurement).findings.find((entry) => entry.metric === "foot-slide");
  if (finding === undefined) throw new Error("the rubric returned no foot-slide finding");
  return { outcome: finding.outcome, observed: String(finding.observed) };
}



/** The three graded intervals of one shipped-clip run, plus the whole run. */
export type ShippedApproachGrades = {
  walk: RubricGrade;
  settleTurn: RubricGrade;
  stop: RubricGrade;
  wholeRun: RubricGrade;
  walkFootSlide: { outcome: string; observed: string };
  settleTurnFootSlide: { outcome: string; observed: string };
  arrivalErrorMeters: number;
  settledYawErrorDegrees: number;
  stoppedSeconds: number;
  stoppedRootTravelMeters: number;
  clipStanceAdvanceMetersPerSecond: number;
  clipForwardBody: { x: number; z: number };
  skinnedBodyCount: number;
  skinnedVertexSampleCount: number;
  walkFrames: number;
  settleFrames: number;
};

/**
 * Drive the case-owned approach with the SHIPPED clip and grade every interval.
 *
 * The intervals are graded SEPARATELY because the card asks for "stance/transition/stop intervals",
 * and because they are different kinds of motion: a foot-locked walk, an in-place turn with no
 * turn-in-place take to play, and a frozen stand. The WHOLE-RUN grade is returned beside them so the
 * split cannot be read as a way of hiding the turn's cost.
 */
export async function measureShippedApproach(): Promise<{
  grades: ShippedApproachGrades;
  measurements: { walk: MotionMeasurement; settleTurn: MotionMeasurement; stop: MotionMeasurement };
}> {
  const decoded = await decodePhysician();
  const ward = stageWard();
  const intent = intentFor(ward);
  if (intent.refused) throw new Error(`the normal encounter refused its own approach: ${intent.reason}`);
  const run = runApproach({ ward, intent, seconds: 12, decoded });
  const walkEnd = run.frames.findIndex((frame) => frame.phase === "settling");
  const stopStart = run.frames.findIndex((frame) => frame.phase === "arrived");
  if (walkEnd <= 0 || stopStart <= walkEnd) {
    throw new Error(`the run did not walk, settle and stop: walkEnd ${walkEnd}, stopStart ${stopStart}`);
  }
  const walk = measurementFor({ run, intent, ward, decoded, from: 0, to: walkEnd, measurementId: "sc05-walk" });
  const settleTurn = measurementFor({ run, intent, ward, decoded, from: walkEnd, to: stopStart, measurementId: "sc05-settle-turn" });
  const stop: MotionMeasurement = {
    ...measurementFor({ run, intent, ward, decoded, from: stopStart, to: run.frames.length, measurementId: "sc05-stop" }),
    // No clip is playing during the stop, so a `clipDeclaredPlayed` of true over a frozen pose would
    // be the very flag `clip-motion-observed` exists to contradict.
    clipDeclaredPlayed: false,
  };
  const wholeRun = measurementFor({ run, intent, ward, decoded, from: 0, to: run.frames.length, measurementId: "sc05-whole-run" });
  const grades: ShippedApproachGrades = {
    walk: gradeMotionMeasurement(walk),
    settleTurn: gradeMotionMeasurement(settleTurn),
    stop: gradeMotionMeasurement(stop),
    wholeRun: gradeMotionMeasurement(wholeRun),
    walkFootSlide: footSlideFinding(walk),
    settleTurnFootSlide: footSlideFinding(settleTurn),
    arrivalErrorMeters: run.arrivalErrorMeters,
    settledYawErrorDegrees: run.settledYawErrorDegrees,
    stoppedSeconds: run.stoppedSeconds,
    stoppedRootTravelMeters: run.stoppedRootTravelMeters,
    clipStanceAdvanceMetersPerSecond: run.clipAdvance.metersPerSecond,
    clipForwardBody: run.clipAdvance.forward,
    skinnedBodyCount: decoded.skinnedBodyCount,
    skinnedVertexSampleCount: decoded.skinnedVertexSampleCount,
    walkFrames: walkEnd,
    settleFrames: stopStart - walkEnd,
  };
  observe("rubric-applied-to-loaded-skeleton-and-skin", "rubricGrades", "metric", {
    rubricVersion: grades.walk.rubricVersion,
    walkFailedMetrics: grades.walk.failedMetrics,
    walkFootSlide: grades.walkFootSlide,
    settleTurnFootSlide: grades.settleTurnFootSlide,
    stopFailedMetrics: grades.stop.failedMetrics,
    wholeRunFailedMetrics: grades.wholeRun.failedMetrics,
    skinnedBodyCount: grades.skinnedBodyCount,
    skinnedVertexSampleCount: grades.skinnedVertexSampleCount,
    clipStanceAdvanceMetersPerSecond: grades.clipStanceAdvanceMetersPerSecond,
    clipForwardBody: grades.clipForwardBody,
  });
  return { grades, measurements: { walk, settleTurn, stop } };
}
