import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import type { ObservedApproachGeometry } from "@openclinxr/asset-registry/case-approach-intent";
import {
  advanceCaseOwnedBedsideApproach,
  applyCaseOwnedStanceLock,
} from "./case-owned-approach-frame-mod.js";
import {
  type CaseOwnedBedsideApproach,
  createCaseOwnedApproachForOrder,
} from "./case-owned-approach-runtime-mod.js";
import { resolveLocomotionClipTimeScale } from "./locomotion-clip-playback-mod.js";
import { worldXyz } from "./stance-lock-ik.js";
import type { GeneratedHumanoidAnimationSlot, HumanoidRuntimeDrive } from "./types.js";

/**
 * A shared, per-actor locomotion entry point: any actor in any scene can be told to walk
 * somewhere, independent of the frozen-plan bedside approach, which keeps driving its own case
 * exactly as before.
 *
 * ## CHANGED 2026-09-26: this used to be a SECOND walker (straight-line kinematics, then the
 * shared stance lock called directly). It was measured to churn -- lurch 128 on the nurse, and a
 * decisive control on the PHYSICIAN himself (same actor, same clip, same route length, his own
 * frozen-plan approach disabled for that run) still measured lurch 4.5 against the frozen-plan
 * producer's own 1.044 on the identical actor/clip. The defect was in the separate walker, not any
 * one actor's rig -- so this module no longer has its own walker. It now instantiates the SAME
 * producer the frozen-plan physician runs (`createCaseOwnedApproachForOrder`,
 * `advanceCaseOwnedBedsideApproach`, `applyCaseOwnedStanceLock` -- `case-owned-approach-runtime-
 * mod.ts` / `case-owned-approach-frame-mod.ts`, unmodified except for the one new factory function
 * added beside `createCaseOwnedBedsideApproach`), per actor, from an order instead of a frozen
 * plan. Orders and frozen plans share one implementation.
 *
 * claimScope: an order-driven actor runs through the same stance-lock-integrated, clip-time-scale-
 * coupled producer the frozen-plan physician does.
 * notEvidenceFor: obstacle avoidance for the ordered route (`createCaseOwnedApproachForOrder`
 * passes `obstacles: []`), the settling turn, or clinical plausibility.
 */

export type LocomotionOrder = {
  actorId: string;
  target: { x: number; z: number };
  /** Facing once arrived. Defaults to facing the target's own direction of travel. */
  facing?: { x: number; z: number } | undefined;
};

/**
 * Per-actor approach state, keyed by actorId. `null` means construction was tried and refused
 * (no bound clip, no measurable ground speed, ...) and is not retried every frame; no entry means
 * "not tried yet". One registry per running scene (main.ts owns the instance).
 */
export type LocomotionOrderRegistry = Map<string, CaseOwnedBedsideApproach | null>;

export function createLocomotionOrderRegistry(): LocomotionOrderRegistry {
  return new Map();
}

/**
 * A static, zero-obstacle geometry for order-driven walks. The frozen-plan physician's producer
 * only ever reads `geometry.floorFrame` (`createCaseOwnedBedsideApproach`'s own body) -- the
 * richer fields (`supportBounds`, `obstacles`, `monitorBounds`, ...) exist for the bedside-target
 * domain an order does not carry. `floorOriginY: 0` matches the convention every other locomotion
 * consumer in this package already assumes (`FOOT_CONTACT_HEIGHT_METERS` callers, `animation-
 * loop.ts`). The revision string never changes, so `advanceCaseOwnedBedsideApproach`'s
 * change-during-travel invalidation never fires for a route that has no geometry to change.
 */
const ORDER_DRIVEN_GEOMETRY_REVISION = "order_driven_static_geometry_v1";
const ORDER_DRIVEN_GEOMETRY: ObservedApproachGeometry = {
  floorFrame: { frameId: "order_driven_floor_v1", originY: 0, originXz: { x: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  supportInstanceId: "",
  supportBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
  obstacles: [],
  monitorBounds: null,
  monitorInstanceId: null,
  roomCentre: { x: 0, y: 0, z: 0 },
};

/**
 * Advance every order-driven actor for this frame and return the drives
 * `updateGeneratedHumanoidAnimations` should apply. Call BEFORE that function, the same order the
 * frozen-plan physician's own `updateStationBedsideApproach` -> `updateGeneratedHumanoidAnimations`
 * runs in. Call `applyLocomotionOrderStanceLocks` AFTER it (see that function's own doc comment for
 * why the split, not one call, matters).
 */
export function stepLocomotionOrders(
  orders: ReadonlyMap<string, { target: { x: number; z: number }; facing?: { x: number; z: number } | undefined }>,
  slotsByActorId: ReadonlyMap<string, GeneratedHumanoidAnimationSlot>,
  registry: LocomotionOrderRegistry,
  nowMs: number,
  deltaSeconds: number,
): ReadonlyMap<string, HumanoidRuntimeDrive> {
  const drives = new Map<string, HumanoidRuntimeDrive>();
  for (const [actorId, order] of orders) {
    const slot = slotsByActorId.get(actorId);
    if (!slot) continue;
    let approach = registry.get(actorId);
    if (approach === undefined) {
      const measurement = resolveLocomotionClipTimeScale(slot);
      if (measurement === null) {
        registry.set(actorId, null);
        continue;
      }
      const start = { x: slot.actorSlot.position.x, y: slot.actorSlot.position.y, z: slot.actorSlot.position.z };
      const created = createCaseOwnedApproachForOrder({
        actorId,
        start,
        target: { x: order.target.x, y: start.y, z: order.target.z },
        ...(order.facing ? { facing: { x: order.facing.x, y: start.y, z: order.facing.z } } : {}),
        geometry: ORDER_DRIVEN_GEOMETRY,
        observedGeometryRevision: ORDER_DRIVEN_GEOMETRY_REVISION,
        runId: `locomotion_order_${actorId}`,
        actorSlot: slot.actorSlot,
        humanoidRoot: slot.root,
        contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
        clipAdvance: { metersPerSecond: measurement.targetSpeedMetersPerSecond, forward: measurement.clipForwardBody },
        clipCycleSeconds: measurement.cycleSeconds / measurement.timeScale,
        stanceLabelSlot: slot,
      });
      approach = "refused" in created ? null : created;
      registry.set(actorId, approach);
    }
    if (approach === null) continue;
    const frame = advanceCaseOwnedBedsideApproach(approach, {
      nowMs,
      deltaSeconds,
      observedGeometryRevision: ORDER_DRIVEN_GEOMETRY_REVISION,
      supportAccepted: true,
    });
    if (frame === null) continue;
    drives.set(actorId, {
      actorId,
      locomotion: frame.locomotion,
      locomotionTimeScaleFactor: frame.locomotionTimeScaleFactor,
      locomotionLegWeight: frame.locomotionLegWeight,
    });
  }
  return drives;
}

/**
 * Apply the stance lock (and, once settling, the clip-driven settling turn) for every order-driven
 * actor. Call AFTER `updateGeneratedHumanoidAnimations`, mirroring `applyStationBedsideStanceLock`
 * for the frozen-plan physician: the lock reads the skeleton's WORLD pose to find the planted toe,
 * and that pose is only current once the mixer has advanced for this frame -- which happens inside
 * `updateGeneratedHumanoidAnimations`'s generic drive-consumption branch (`playLocomotionClip`).
 * Reading it before that call would pin against last frame's pose, cancelling nothing.
 */
export function applyLocomotionOrderStanceLocks(registry: LocomotionOrderRegistry, deltaSeconds: number, nowMs: number): void {
  for (const [actorId, approach] of registry) {
    applyCaseOwnedStanceLock(approach, deltaSeconds);
    publishLocomotionOrderRuntimeEvidence(actorId, approach, nowMs);
    // ROOT CAUSE of the settling stall, MEASURED (2026-09-26): `applyStationIdleSway`
    // (@openclinxr/xr-runtime-state/composed-body-direction) unconditionally overwrites this
    // actor's `actorSlot.rotation.y` every frame with `baseHeadingRadians + sin(...)`, one line
    // after `apps/ui-xr/src/main.ts` calls the stance-lock functions above -- it has no idea an
    // order exists. That composer now skips a nurse carrying this flag (see its own doc comment).
    // Set while actually turning/walking (so the settling turn's own increments are not
    // discarded); cleared once arrived or refused, so ordinary idle sway resumes.
    if (approach !== null && (approach.execution.phase === "walking" || approach.execution.phase === "settling")) {
      (approach.actorSlot.userData as Record<string, unknown>)["openClinXrLocomotionOrderActive"] = true;
    } else if (approach !== null) {
      delete (approach.actorSlot.userData as Record<string, unknown>)["openClinXrLocomotionOrderActive"];
    }
  }
}

/**
 * Opt-in per-actor evidence, mirroring `station-bedside-approach-mod.ts`'s
 * `publishBedsideApproachRuntimeEvidence` (same sample shape: `atMs`, `phase`, toe world XYZ,
 * `stanceFoot`, `correctionMeters`) so `walk-quality-metrics.ts`'s stance-window math applies
 * unchanged to either walker. That publisher is keyed to ONE global
 * (`__openClinXrBedsideApproachEvidence`) because there is exactly one frozen-plan physician; this
 * is keyed by actorId since more than one order-driven actor can be walking at once.
 * `host.__openClinXrLocomotionOrderEvidenceEnabled` gates it off by default -- the shipped runtime
 * never sets that flag, so this costs nothing outside a capture script that sets it first.
 */
function publishLocomotionOrderRuntimeEvidence(actorId: string, approach: CaseOwnedBedsideApproach | null, nowMs: number): void {
  const host = (globalThis as unknown as { window?: Record<string, unknown> }).window
    ?? (globalThis as unknown as Record<string, unknown>);
  if (host["__openClinXrLocomotionOrderEvidenceEnabled"] !== true || approach === null) return;
  const byActor = (host["__openClinXrLocomotionOrderEvidence"] as
    | Record<string, Array<{
      atMs: number;
      phase: string;
      left: { x: number; y: number; z: number } | null;
      right: { x: number; y: number; z: number } | null;
      stanceFoot: "left" | "right" | null;
      correctionMeters: { x: number; z: number };
      // READ-ONLY SETTLING DIAGNOSTICS (2026-09-26): every field below is a plain read off
      // `approach`/`approach.clipTurn` -- nothing here changes what the approach does, only what
      // this opt-in evidence sample reports about it. Added to instrument the nurse's settling
      // stall without editing clip-driven-settling-turn-mod.ts or stance-toe-xz-pin-mod.ts.
      targetHeadingRadians: number;
      observedHeadingRadians: number;
      remainingTurnRadians: number;
      stoppedSeconds: number;
      phaseFoot: "left" | "right" | null;
      phaseBudgetRadians: number;
      phaseElapsedSeconds: number;
      phaseAppliedRadians: number;
      pinLeftWeight: number;
      pinRightWeight: number;
      labelledStance: { left: boolean; right: boolean } | null;
      driveLocomotion: number;
    }>>
    | undefined) ?? {};
  const samples = byActor[actorId] ?? [];
  const targetHeadingRadians = approach.intent.target.headingRadians;
  const observedHeadingRadians = approach.actorSlot.rotation.y;
  const remainingTurnRadians = Math.atan2(
    Math.sin(targetHeadingRadians - observedHeadingRadians),
    Math.cos(targetHeadingRadians - observedHeadingRadians),
  );
  samples.push({
    atMs: nowMs,
    phase: approach.execution.phase,
    left: approach.leftToe ? worldXyz(approach.leftToe) : null,
    right: approach.rightToe ? worldXyz(approach.rightToe) : null,
    stanceFoot: approach.lock.stanceFoot,
    correctionMeters: approach.lock.correctionMeters,
    targetHeadingRadians,
    observedHeadingRadians,
    remainingTurnRadians,
    stoppedSeconds: approach.execution.stoppedSeconds,
    phaseFoot: approach.clipTurn.phaseFoot,
    phaseBudgetRadians: approach.clipTurn.phaseBudgetRadians,
    phaseElapsedSeconds: approach.clipTurn.phaseElapsedSeconds,
    phaseAppliedRadians: approach.clipTurn.phaseAppliedRadians,
    pinLeftWeight: approach.clipTurn.pin.left.weight,
    pinRightWeight: approach.clipTurn.pin.right.weight,
    labelledStance: approach.lock.labelledStance,
    driveLocomotion: approach.execution.drive.locomotion,
  });
  while (samples.length > 4000) samples.shift();
  byActor[actorId] = samples;
  host["__openClinXrLocomotionOrderEvidence"] = byActor;
}
