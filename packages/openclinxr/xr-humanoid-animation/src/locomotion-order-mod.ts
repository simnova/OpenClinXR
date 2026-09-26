import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import type { ObservedApproachGeometry } from "@openclinxr/asset-registry/case-approach-intent";
import type { Object3D } from "three";
import {
  advanceCaseOwnedBedsideApproach,
  applyCaseOwnedStanceLock,
} from "./case-owned-approach-frame-mod.js";
import {
  type CaseOwnedBedsideApproach,
  createCaseOwnedApproachForOrder,
} from "./case-owned-approach-runtime-mod.js";
import { resolveLocomotionClipTimeScale } from "./locomotion-clip-playback-mod.js";
import { observeMountedApproachGeometry } from "./mounted-approach-geometry-mod.js";
import {
  orderStraightRouteBlocked,
  type OrderRouteVector2,
  planOrderRouteWaypoints,
} from "./order-route-planner-mod.js";
import { worldXyz } from "./stance-lock-ik.js";
import type { GeneratedHumanoidAnimationSlot, HumanoidRuntimeDrive, LocomotionOrderInput } from "./types.js";

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
 * ## CHANGED 2026-09-26 (obstacle avoidance): measured on scene_closure's nurse -- her ordered
 * route walked straight through the room's white shelving unit, because `createCaseOwnedApproachForOrder`
 * validated against a hardcoded `obstacles: []`. This module now observes the REAL room
 * (`observeMountedApproachGeometry`, the same call the frozen-plan physician's
 * `station-bedside-approach-mod.ts` makes) once per order, checks the straight line first
 * (`order-route-planner-mod.ts`'s `orderStraightRouteBlocked`), and falls back to a grid-A*-routed
 * detour (`planOrderRouteWaypoints`) only when the straight line is blocked -- the same two-pass
 * preference asset-registry's own `resolveBedsideLayoutFromSeed` uses (straight preferred, routed
 * fallback, never the reverse). A route is walked one straight LEG at a time, corner to corner,
 * each leg its own `createCaseOwnedApproachForOrder` call (the shared, footprint-checked, single-
 * target producer) reused rather than taught a second multi-segment geometry; a corner is only
 * turned at once the current leg's OWN settling turn reaches it, so a multi-corner order turns
 * exactly the way the final arrival always has. An order with no clear straight OR routed path
 * refuses with a named reason instead of walking through the obstacle or silently doing nothing.
 *
 * claimScope: an order-driven actor runs through the same stance-lock-integrated, clip-time-scale-
 * coupled producer the frozen-plan physician does, validated leg by leg against the room's real,
 * currently-observed obstacle footprints.
 * notEvidenceFor: 3D navigation (steps, ramps, doorways), dynamic obstacles appearing mid-walk (the
 * room is observed once per order, not re-observed every frame the way the physician's approach
 * is), or clinical plausibility.
 */

export type LocomotionOrder = {
  actorId: string;
  target: { x: number; z: number };
  /** Facing once arrived. Defaults to facing the target's own direction of travel. */
  facing?: { x: number; z: number } | undefined;
};

type Vector3 = { x: number; y: number; z: number };

/**
 * One actor's order-driven run: the CURRENT leg's approach (a straight, footprint-checked
 * `createCaseOwnedApproachForOrder` producer), plus the corners still to walk once this leg
 * arrives. `null` means construction was tried and refused (no bound clip, no measurable ground
 * speed, no clear straight or routed path, ...) and is not retried every frame; no entry means
 * "not tried yet". One registry per running scene (main.ts owns the instance).
 */
type LocomotionOrderRunState = {
  approach: CaseOwnedBedsideApproach;
  /** 2D corners after the CURRENT leg's target, in walking order, ending at the order's own target. */
  remainingCorners: readonly OrderRouteVector2[];
  /** The order's own facing, applied only once the FINAL leg is reached. */
  finalFacing: Vector3 | undefined;
  observedGeometryRevision: string;
  /** The geometry every leg of THIS order is checked against; observed once, not re-observed per leg. */
  geometry: ObservedApproachGeometry;
};
export type LocomotionOrderRegistry = Map<string, LocomotionOrderRunState | null>;

export function createLocomotionOrderRegistry(): LocomotionOrderRegistry {
  return new Map();
}

/** The walker's own standing-footprint radius, matching asset-registry's SC-00-derived convention
 * (`ROUTE_PLANNER_WALKER_RADIUS_METERS` in `layout-solve-mod.ts`) -- not imported, since that
 * package internal is not exported across the boundary (see `order-route-planner-mod.ts`'s own
 * doc comment for why); the same measured value is used here rather than a different one. */
const ORDER_WALKER_RADIUS_METERS = 0.3;

/**
 * A static, zero-obstacle geometry, used ONLY when the caller supplies no scene to observe (a unit
 * test stubbing `HumanoidAnimationRuntimeContext` with no real THREE scene) -- the shipped runtime
 * always has a scene, so this is the pre-2026-09-26 always-empty behaviour preserved for a caller
 * that genuinely has no room to observe, not a default any real walk falls back to silently.
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
 * Real, once-per-order-resolution room geometry (`observeMountedApproachGeometry`, the same call
 * the frozen-plan physician's own producer makes) when a scene is available, or the static empty
 * geometry above when it is not.
 */
function observedOrderGeometry(scene: Object3D | undefined): { geometry: ObservedApproachGeometry; revision: string } {
  if (scene === undefined) return { geometry: ORDER_DRIVEN_GEOMETRY, revision: ORDER_DRIVEN_GEOMETRY_REVISION };
  const geometry = observeMountedApproachGeometry(scene, { supportInstanceId: "" });
  return { geometry, revision: `order_driven_observed_${geometry.obstacles.length}_v1` };
}

/**
 * Publish a REFUSAL reason for one actor, mirroring `publishLocomotionOrderRuntimeEvidence`'s own
 * opt-in gate. A refusal is silent to the shipped runtime (an actor simply does not walk) but must
 * be observable to a capture script proving "refuses with a named reason" -- this is that proof
 * surface, keyed by actorId the same way the sample evidence is.
 */
function publishLocomotionOrderRefusal(actorId: string, reason: string): void {
  const host = (globalThis as unknown as { window?: Record<string, unknown> }).window
    ?? (globalThis as unknown as Record<string, unknown>);
  if (host["__openClinXrLocomotionOrderEvidenceEnabled"] !== true) return;
  const byActor = (host["__openClinXrLocomotionOrderRefusals"] as Record<string, string> | undefined) ?? {};
  byActor[actorId] = reason;
  host["__openClinXrLocomotionOrderRefusals"] = byActor;
}

/**
 * Advance every order-driven actor for this frame and return the drives
 * `updateGeneratedHumanoidAnimations` should apply. Call BEFORE that function, the same order the
 * frozen-plan physician's own `updateStationBedsideApproach` -> `updateGeneratedHumanoidAnimations`
 * runs in. Call `applyLocomotionOrderStanceLocks` AFTER it (see that function's own doc comment for
 * why the split, not one call, matters).
 */
/**
 * Build ONE LEG's approach: `target`/`facing` are the leg's own endpoint and the direction to face
 * on arrival there (the next corner, or the order's final facing on the last leg). Refuses with a
 * named reason exactly like the frozen-plan physician does when the leg's own straight line clips
 * an obstacle (`createCaseOwnedApproachForOrder`'s real-obstacle `planBedsideApproach` call).
 */
function createOrderLeg(
  actorId: string,
  slot: GeneratedHumanoidAnimationSlot,
  start: Vector3,
  target: Vector3,
  facing: Vector3 | undefined,
  geometry: ObservedApproachGeometry,
  observedGeometryRevision: string,
): CaseOwnedBedsideApproach | { refused: true; reason: string } | null {
  const measurement = resolveLocomotionClipTimeScale(slot);
  if (measurement === null) return null;
  const created = createCaseOwnedApproachForOrder({
    actorId,
    start,
    target,
    ...(facing ? { facing } : {}),
    geometry,
    observedGeometryRevision,
    runId: `locomotion_order_${actorId}_${Math.round(start.x * 1000)}_${Math.round(start.z * 1000)}`,
    actorSlot: slot.actorSlot,
    humanoidRoot: slot.root,
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    clipAdvance: { metersPerSecond: measurement.targetSpeedMetersPerSecond, forward: measurement.clipForwardBody },
    clipCycleSeconds: measurement.cycleSeconds / measurement.timeScale,
    stanceLabelSlot: slot,
  });
  return created;
}

/**
 * Resolve a fresh order: observe the room, prefer a straight line, fall back to a grid-A*-routed
 * detour, and refuse with a named reason when neither clears. Returns the FIRST leg's run state, or
 * `null` when construction should not be retried this session (clip unmeasurable, or no path at
 * all -- a refusal is published either way `publishLocomotionOrderRefusal` is reachable from).
 */
function resolveLocomotionOrder(
  actorId: string,
  order: LocomotionOrderInput,
  slot: GeneratedHumanoidAnimationSlot,
  scene: Object3D | undefined,
): LocomotionOrderRunState | null {
  const start = { x: slot.actorSlot.position.x, y: slot.actorSlot.position.y, z: slot.actorSlot.position.z };
  const finalTarget: Vector3 = { x: order.target.x, y: start.y, z: order.target.z };
  const finalFacing: Vector3 | undefined = order.facing ? { x: order.facing.x, y: start.y, z: order.facing.z } : undefined;
  const { geometry, revision } = observedOrderGeometry(scene);
  const obstacles = geometry.obstacles;
  const startXz: OrderRouteVector2 = { x: start.x, z: start.z };
  const targetXz: OrderRouteVector2 = { x: finalTarget.x, z: finalTarget.z };
  const straightBlocked = orderStraightRouteBlocked({
    start: startXz,
    target: targetXz,
    obstacles,
    radiusMeters: ORDER_WALKER_RADIUS_METERS,
  });

  let legTarget = finalTarget;
  let legFacing = finalFacing;
  let remainingCorners: readonly OrderRouteVector2[] = [];
  if (straightBlocked) {
    const corners = planOrderRouteWaypoints({
      start: startXz,
      target: targetXz,
      obstacles,
      walkerRadiusMeters: ORDER_WALKER_RADIUS_METERS,
    });
    if (corners === null || corners.length < 2) {
      publishLocomotionOrderRefusal(
        actorId,
        `no clear path from (${start.x.toFixed(2)}, ${start.z.toFixed(2)}) to `
          + `(${finalTarget.x.toFixed(2)}, ${finalTarget.z.toFixed(2)}) around ${obstacles.length} observed `
          + "obstacle(s): the straight route is blocked and the grid A* planner found no detour around "
          + "the inflated fixture footprints",
      );
      return null;
    }
    // corners[0] is the start and corners[last] is the target (2D); only interior corners are new.
    legTarget = { x: corners[1]!.x, y: start.y, z: corners[1]!.z };
    legFacing = corners.length > 2 ? { x: corners[2]!.x, y: start.y, z: corners[2]!.z } : finalFacing;
    remainingCorners = corners.slice(2);
  }

  const created = createOrderLeg(actorId, slot, start, legTarget, legFacing, geometry, revision);
  if (created === null) return null;
  if ("refused" in created) {
    publishLocomotionOrderRefusal(actorId, created.reason);
    return null;
  }
  return { approach: created, remainingCorners, finalFacing, observedGeometryRevision: revision, geometry };
}

export function stepLocomotionOrders(
  orders: ReadonlyMap<string, LocomotionOrderInput>,
  slotsByActorId: ReadonlyMap<string, GeneratedHumanoidAnimationSlot>,
  registry: LocomotionOrderRegistry,
  nowMs: number,
  deltaSeconds: number,
  scene?: Object3D | undefined,
): ReadonlyMap<string, HumanoidRuntimeDrive> {
  const drives = new Map<string, HumanoidRuntimeDrive>();
  for (const [actorId, order] of orders) {
    const slot = slotsByActorId.get(actorId);
    if (!slot) continue;
    let state = registry.get(actorId);
    if (state === undefined) {
      state = resolveLocomotionOrder(actorId, order, slot, scene);
      registry.set(actorId, state);
    }
    if (state === null) continue;
    const frame = advanceCaseOwnedBedsideApproach(state.approach, {
      nowMs,
      deltaSeconds,
      observedGeometryRevision: state.observedGeometryRevision,
      supportAccepted: true,
    });
    if (frame === null) continue;
    // CORNER TURN: this leg has arrived (the same stop-turn-hold the final target always used) and
    // there is more route to walk -- start the next leg from here, turning to face it exactly the
    // way the settling turn always has, rather than teaching the executor a second geometry.
    if (frame.phase === "arrived" && state.remainingCorners.length > 0) {
      const here = state.approach.actorSlot.position;
      const nextStart: Vector3 = { x: here.x, y: here.y, z: here.z };
      const rest = state.remainingCorners;
      const nextTarget: Vector3 = { x: rest[0]!.x, y: here.y, z: rest[0]!.z };
      const nextFacing: Vector3 | undefined = rest.length > 1
        ? { x: rest[1]!.x, y: here.y, z: rest[1]!.z }
        : state.finalFacing;
      const created = createOrderLeg(
        actorId,
        slot,
        nextStart,
        nextTarget,
        nextFacing,
        state.geometry,
        state.observedGeometryRevision,
      );
      if (created !== null && !("refused" in created)) {
        state = {
          approach: created,
          remainingCorners: rest.slice(1),
          finalFacing: state.finalFacing,
          observedGeometryRevision: state.observedGeometryRevision,
          geometry: state.geometry,
        };
        registry.set(actorId, state);
      } else {
        if (created !== null && "refused" in created) publishLocomotionOrderRefusal(actorId, created.reason);
        registry.set(actorId, null);
        continue;
      }
    }
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
  for (const [actorId, state] of registry) {
    const approach = state?.approach ?? null;
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
