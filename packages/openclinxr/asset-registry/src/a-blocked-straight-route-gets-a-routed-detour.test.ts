import { createHash } from "node:crypto";
import { resolveBedsideLayoutFromSeed } from "@openclinxr/asset-registry/layout-solve";
import { describe, expect, it } from "vitest";

// No local type imports: every literal below is checked structurally against
// `resolveBedsideLayoutFromSeed`'s own (public) parameter types, so this file does not need
// `MeasuredObstacle` / `SupportBounds` / `Vector3` in scope — those are reachable-but-unexported
// internals, and importing them here would count as a SECOND internal test import (this
// package's `testInternalImports` ceiling is 1, already spent by `asset-writer.test.ts`).
type Vector3 = { x: number; y: number; z: number };
type SupportBounds = { min: Vector3; max: Vector3 };
type MeasuredObstacle = { id: string; bounds: { min: Vector3; max: Vector3 } };

/**
 * ed-reanchor-refreeze investigation (2026-09-26). ED's real walker start, once
 * `resolveActorFramedPosition` fixed the freeze-vs-runtime start mismatch (see
 * `encounter-actor-framing.ts`), produces a route whose STRAIGHT line to the bedside crosses the
 * stretcher — a genuine capability gap ("the approach should route around fixtures", not a room
 * defect), closed by the grid-A* planner in `route-planner-mod.ts`.
 *
 * This drives `resolveBedsideLayoutFromSeed` (the public entrypoint) with a synthetic obstacle
 * placed directly on the straight line between `start` and the intent-pinned target, with a clear
 * detour available around it. It must resolve with a routed `routeWaypoints` polyline, not refuse.
 *
 * `intent` pins side/standoff/along-offset to exactly one candidate, so this test is about the
 * ROUTE stage, not the search stage that `authored-intent-is-not-substituted.test.ts` covers.
 */
function seedFor(scenarioId: string): string {
  return createHash("sha256")
    .update(["openclinxr.layout-variation-seed.v1", scenarioId, "test", "openclinxr.bedside-layout-solver.v1", "0"].join(" "))
    .digest("hex");
}

describe("a straight route blocked by a fixture gets a routed detour, not a refusal", () => {
  const patientPosition: Vector3 = { x: 0, y: 0, z: 0 };
  // Narrow in X (0.6 m), long in Z (2 m): bedsideTargetForClinician's "narrow support" branch,
  // so patient_left at standoff 1.0 m lands the target at exactly (-1.3, 0, 0).
  const supportBounds: SupportBounds = {
    min: { x: -0.3, y: 0, z: -1 },
    max: { x: 0.3, y: 0, z: 1 },
  };
  const start: Vector3 = { x: 1.3, y: 0, z: 0 };
  // Blocks the straight line from (1.3, 0, 0) to (-1.3, 0, 0) at x in [-0.3, 0.3], z in
  // [-0.2, 0.2] — squarely on the segment — while leaving z > 0.2 and z < -0.2 clear for a detour
  // well within the planner's default 1.0 m padding.
  const blockingObstacle: MeasuredObstacle = {
    id: "test:wall",
    bounds: {
      min: { x: -0.3, y: 0, z: -0.2 },
      max: { x: 0.3, y: 1.2, z: 0.2 },
    },
  };

  it("resolves with a routed polyline when the straight line is blocked", () => {
    const result = resolveBedsideLayoutFromSeed({
      seed: seedFor("route-planner-test-case-v1"),
      patientPosition,
      supportBounds,
      obstacles: [blockingObstacle],
      intent: { approachSide: "patient_left", standoffMeters: 1.0, alongOffsetMeters: 0 },
      start,
      floorY: 0,
    });
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.target.position).toEqual({ x: -1.3, y: 0, z: 0 });
    expect(result.routeWaypoints).toBeDefined();
    const waypoints = result.routeWaypoints;
    if (waypoints === undefined) return;
    expect(waypoints.length).toBeGreaterThanOrEqual(2);
    expect(waypoints[0]).toEqual({ x: start.x, z: start.z });
    expect(waypoints[waypoints.length - 1]).toEqual({ x: -1.3, z: 0 });
    // The detour actually goes AROUND the obstacle: at least one interior corner sits outside the
    // obstacle's blocked X range, at a |z| large enough to have cleared it plus the walker radius.
    const clearsAround = waypoints.some((point) => Math.abs(point.z) >= 0.2 + 0.3 - 1e-6);
    expect(clearsAround).toBe(true);
  });

  it("still resolves the direct line when nothing blocks it (no routeWaypoints)", () => {
    const result = resolveBedsideLayoutFromSeed({
      seed: seedFor("route-planner-test-case-v1"),
      patientPosition,
      supportBounds,
      obstacles: [],
      intent: { approachSide: "patient_left", standoffMeters: 1.0, alongOffsetMeters: 0 },
      start,
      floorY: 0,
    });
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.routeWaypoints).toBeUndefined();
  });

  it("still refuses when even a routed detour cannot clear the obstacle", () => {
    // A slab covering the ENTIRE area the planner's grid can reach (its own bounds set the grid's
    // extent, so padding cannot open a gap beyond it): every cell is blocked except the two
    // endpoint cells the planner always unblocks, and those are not adjacent. No detour exists, so
    // the candidate must still be refused, not silently accepted.
    const impassableWall: MeasuredObstacle = {
      id: "test:impassable-wall",
      bounds: {
        min: { x: -10, y: 0, z: -10 },
        max: { x: 10, y: 1.2, z: 10 },
      },
    };
    const result = resolveBedsideLayoutFromSeed({
      seed: seedFor("route-planner-test-case-v1"),
      patientPosition,
      supportBounds,
      obstacles: [impassableWall],
      intent: { approachSide: "patient_left", standoffMeters: 1.0, alongOffsetMeters: 0 },
      start,
      floorY: 0,
    });
    expect(result.resolved).toBe(false);
  });
});
