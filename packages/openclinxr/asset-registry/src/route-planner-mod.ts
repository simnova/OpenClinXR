import type { MeasuredObstacle } from "./bedside-clearance.js";

/**
 * A deterministic grid A* route planner over fixture footprints, inflated by the walker's own
 * radius.
 *
 * WHY THIS EXISTS (ed-reanchor-refreeze investigation, 2026-09-26). `bedside-approach-path-mod.ts`
 * says plainly of its own straight-line route: *"a straight polyline... is not a planner and will
 * not route around an obstacle — it REPORTS that the route is blocked and stops."* Measured on
 * `ed_chest_pain_priority_v1` with the walker's REAL staged start (0.64, 0, 0.3): the straight route
 * to every candidate bedside spot crosses `ed_exam_bay_v1:stretcher`, `:wall_board`, `:monitor` or
 * `:door_leaf` — a genuine capability gap, not a room defect, because a human walking that room
 * would simply step around the stretcher. This module is that step-around.
 *
 * WHAT IT IS: 2D (world XZ) grid A*, 8-connected, over a binary occupancy grid built from each
 * obstacle's world AABB projected onto the floor plane and inflated by `walkerRadiusMeters` on every
 * side. The output is a SHORT polyline — start, each direction change, target — not one point per
 * grid cell; see `planRouteWaypoints`'s pruning pass.
 *
 * WHAT IT IS NOT: a 3D planner (Y is carried through unchanged from the caller's start/target, the
 * grid only reasons about X/Z); a replanner (the grid is built once per call, no dynamic obstacles);
 * or a substitute for the swept-occupancy check — `bedside-approach-path-mod.ts`'s
 * `sweptRouteViolations` still runs along whatever polyline this returns and can still refuse it,
 * because a corridor wide enough for the grid's cell centres can still clip a 0.3 m standing
 * footprint at the cell resolution used here.
 *
 * claimScope: a 2D route between two floor points that avoids the inflated footprints of named
 * obstacles, when one exists on the search grid.
 * notEvidenceFor: 3D navigation (steps, ramps, doorways with sills), dynamic obstacle avoidance,
 * or that a routed candidate clears the swept-occupancy check — that is measured separately.
 */

export type PlannerVector2 = { x: number; z: number };

/** One obstacle's floor footprint, in world XZ. */
export type ObstacleFootprint = { id: string; minX: number; maxX: number; minZ: number; maxZ: number };

export function obstacleFootprintFromMeasured(obstacle: MeasuredObstacle): ObstacleFootprint {
  return {
    id: obstacle.id,
    minX: obstacle.bounds.min.x,
    maxX: obstacle.bounds.max.x,
    minZ: obstacle.bounds.min.z,
    maxZ: obstacle.bounds.max.z,
  };
}

/** Grid cell size. Half the narrowest catalogued obstacle's width (SC-00's IV pole, ~0.05 m). */
export const ROUTE_GRID_CELL_METERS = 0.1;

/** Extra margin around the start/target/obstacle bounding box, so the grid has room to route around. */
export const ROUTE_GRID_PADDING_METERS = 1.0;

export function planRouteWaypoints(input: {
  start: PlannerVector2;
  target: PlannerVector2;
  obstacles: readonly MeasuredObstacle[];
  walkerRadiusMeters: number;
  cellMeters?: number | undefined;
  paddingMeters?: number | undefined;
}): PlannerVector2[] | null {
  const cell = input.cellMeters ?? ROUTE_GRID_CELL_METERS;
  const padding = input.paddingMeters ?? ROUTE_GRID_PADDING_METERS;
  const footprints = input.obstacles.map(obstacleFootprintFromMeasured);

  let minX = Math.min(input.start.x, input.target.x);
  let maxX = Math.max(input.start.x, input.target.x);
  let minZ = Math.min(input.start.z, input.target.z);
  let maxZ = Math.max(input.start.z, input.target.z);
  for (const footprint of footprints) {
    minX = Math.min(minX, footprint.minX);
    maxX = Math.max(maxX, footprint.maxX);
    minZ = Math.min(minZ, footprint.minZ);
    maxZ = Math.max(maxZ, footprint.maxZ);
  }
  minX -= padding;
  maxX += padding;
  minZ -= padding;
  maxZ += padding;

  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const toCol = (x: number): number => Math.min(cols - 1, Math.max(0, Math.round((x - minX) / cell)));
  const toRow = (z: number): number => Math.min(rows - 1, Math.max(0, Math.round((z - minZ) / cell)));
  const toX = (col: number): number => minX + col * cell;
  const toZ = (row: number): number => minZ + row * cell;
  const idx = (col: number, row: number): number => row * cols + col;

  const blocked = new Uint8Array(cols * rows);
  for (const footprint of footprints) {
    const loCol = toCol(footprint.minX - input.walkerRadiusMeters);
    const hiCol = toCol(footprint.maxX + input.walkerRadiusMeters);
    const loRow = toRow(footprint.minZ - input.walkerRadiusMeters);
    const hiRow = toRow(footprint.maxZ + input.walkerRadiusMeters);
    for (let row = loRow; row <= hiRow; row += 1) {
      for (let col = loCol; col <= hiCol; col += 1) {
        blocked[idx(col, row)] = 1;
      }
    }
  }

  const startCol = toCol(input.start.x);
  const startRow = toRow(input.start.z);
  const targetCol = toCol(input.target.x);
  const targetRow = toRow(input.target.z);
  const startIdx = idx(startCol, startRow);
  const targetIdx = idx(targetCol, targetRow);
  // The caller already validated the ENDPOINT footprints (bedsideClearanceViolations on the target,
  // the walker's own staged start). Only the CORRIDOR between them is this function's job, so an
  // endpoint that straddles a fixture's inflated boundary at grid resolution is unblocked here
  // rather than reported as unreachable.
  blocked[startIdx] = 0;
  blocked[targetIdx] = 0;

  if (startIdx === targetIdx) return [{ ...input.start }, { ...input.target }];

  const gScore = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const fScore = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const inOpen = new Uint8Array(cols * rows);
  const heuristic = (col: number, row: number): number => Math.hypot(col - targetCol, row - targetRow);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startCol, startRow);
  const open: number[] = [startIdx];
  inOpen[startIdx] = 1;

  const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];

  while (open.length > 0) {
    let bestPos = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (fScore[open[i]!]! < fScore[open[bestPos]!]!) bestPos = i;
    }
    const current = open[bestPos]!;
    if (current === targetIdx) break;
    open.splice(bestPos, 1);
    inOpen[current] = 0;
    const curCol = current % cols;
    const curRow = Math.floor(current / cols);
    for (const [dc, dr, cost] of NEIGHBORS) {
      const nCol = curCol + dc;
      const nRow = curRow + dr;
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;
      const nIdx = idx(nCol, nRow);
      if (blocked[nIdx] === 1) continue;
      // Never cut a blocked corner diagonally.
      if (dc !== 0 && dr !== 0 && blocked[idx(curCol + dc, curRow)] === 1 && blocked[idx(curCol, curRow + dr)] === 1) {
        continue;
      }
      const tentative = gScore[current]! + cost;
      if (tentative < gScore[nIdx]!) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + heuristic(nCol, nRow);
        if (inOpen[nIdx] !== 1) {
          open.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  if (gScore[targetIdx] === Number.POSITIVE_INFINITY) return null;

  const cellPath: number[] = [];
  let cursor = targetIdx;
  while (cursor !== startIdx) {
    cellPath.push(cursor);
    const prev = cameFrom[cursor];
    if (prev === undefined || prev === -1) return null; // Defensive: unreachable per gScore should not hit this.
    cursor = prev;
  }
  cellPath.push(startIdx);
  cellPath.reverse();

  const points: PlannerVector2[] = cellPath.map((cellIndex) => ({
    x: toX(cellIndex % cols),
    z: toZ(Math.floor(cellIndex / cols)),
  }));
  points[0] = { ...input.start };
  points[points.length - 1] = { ...input.target };

  // Prune to direction changes only — a "short waypoint polyline", not one point per grid cell.
  const pruned: PlannerVector2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = pruned[pruned.length - 1]!;
    const current = points[i]!;
    const next = points[i + 1]!;
    const d1x = current.x - prev.x;
    const d1z = current.z - prev.z;
    const d2x = next.x - current.x;
    const d2z = next.z - current.z;
    const cross = d1x * d2z - d1z * d2x;
    if (Math.abs(cross) > 1e-9) pruned.push(current);
  }
  pruned.push(points[points.length - 1]!);
  return pruned;
}
