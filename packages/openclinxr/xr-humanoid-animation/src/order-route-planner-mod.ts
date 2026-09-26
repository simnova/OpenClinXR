import type { ObservedApproachGeometry } from "@openclinxr/asset-registry/case-approach-intent";

/**
 * A package-local grid A* route planner for order-driven walkers, over the SAME algorithm
 * `@openclinxr/asset-registry`'s `route-planner-mod.ts` already implements and proves (2D world XZ,
 * 8-connected, binary occupancy from obstacle footprints inflated by the walker's own radius,
 * pruned to a short direction-change polyline).
 *
 * WHY THIS IS A PORT, NOT AN IMPORT. `route-planner-mod.ts` (and `planRoutedBedsideApproach`,
 * `sweptRouteViolations`) are not re-exported from any `asset-registry` public subpath yet -- no
 * case-authoring or scene-plan consumer outside that package uses them today. Adding a NEW exported
 * symbol name on any public entrypoint trips the closed-public-surface review (psr-01e,
 * `the-reviewed-surface-holds-at-commit-time.test.ts` criterion 5): it diffs the CURRENT tree's
 * exports against a FROZEN raw-inventory recorded at review time, and any symbol not already in
 * that frozen inventory is an "unapprovedSymbol" -- refused, and closing it needs an independently
 * reviewed admission (`docs/openclinxr/package-public-surface-reduction/admissions/*.json`, owner
 * != reviewer) that a single worker cannot self-attest. Measured, not assumed: this session hit the
 * identical refusal exporting a locomotion-order TYPE earlier and worked around it the same way --
 * extend an already-open surface, or keep the new symbol out of the export map entirely.
 *
 * `ObservedApproachGeometry` (this file's one cross-package import) is already public from
 * `case-approach-intent`, and its `obstacles` field is already `readonly MeasuredObstacle[]` --
 * structurally identical to what this file needs, so no new type needs to cross the boundary either.
 *
 * claimScope: a 2D route between two floor points that avoids the inflated footprints of observed
 * obstacles, when one exists on the search grid; a straight-line clearance check sampled the same
 * way asset-registry's swept-occupancy check is (0.04 m steps, its own documented derivation).
 * notEvidenceFor: 3D navigation, dynamic obstacles, or asset-registry's own swept/clearance
 * predicates (`bedsideClearanceViolations`, `sweptRouteViolations`) -- this is the order-path's own
 * equivalent, not a call into theirs.
 */

export type OrderRouteVector2 = { x: number; z: number };
type ObstacleAabb = ObservedApproachGeometry["obstacles"][number];

/** Grid cell size and search padding, matching asset-registry's own route-planner-mod.ts constants. */
const ROUTE_GRID_CELL_METERS = 0.1;
const ROUTE_GRID_PADDING_METERS = 1.0;

/** Straight-line sample spacing, matching asset-registry's SWEPT_OCCUPANCY_SAMPLE_SPACING_METERS. */
const STRAIGHT_CHECK_SAMPLE_SPACING_METERS = 0.04;

function pointBlocked(point: OrderRouteVector2, obstacles: readonly ObstacleAabb[], radiusMeters: number): boolean {
  for (const obstacle of obstacles) {
    const { min, max } = obstacle.bounds;
    if (
      point.x >= min.x - radiusMeters && point.x <= max.x + radiusMeters
      && point.z >= min.z - radiusMeters && point.z <= max.z + radiusMeters
    ) {
      return true;
    }
  }
  return false;
}

/** True when the straight segment `start -> target`, inflated by `radiusMeters`, clips any obstacle. */
export function orderStraightRouteBlocked(input: {
  start: OrderRouteVector2;
  target: OrderRouteVector2;
  obstacles: readonly ObstacleAabb[];
  radiusMeters: number;
}): boolean {
  if (input.obstacles.length === 0) return false;
  const dx = input.target.x - input.start.x;
  const dz = input.target.z - input.start.z;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / STRAIGHT_CHECK_SAMPLE_SPACING_METERS));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = { x: input.start.x + dx * t, z: input.start.z + dz * t };
    if (pointBlocked(point, input.obstacles, input.radiusMeters)) return true;
  }
  return false;
}

/**
 * Deterministic 2D grid A*, 8-connected. Returns a SHORT polyline (start, each direction change,
 * target) or `null` when no route exists on the search grid.
 */
export function planOrderRouteWaypoints(input: {
  start: OrderRouteVector2;
  target: OrderRouteVector2;
  obstacles: readonly ObstacleAabb[];
  walkerRadiusMeters: number;
}): OrderRouteVector2[] | null {
  let minX = Math.min(input.start.x, input.target.x);
  let maxX = Math.max(input.start.x, input.target.x);
  let minZ = Math.min(input.start.z, input.target.z);
  let maxZ = Math.max(input.start.z, input.target.z);
  for (const obstacle of input.obstacles) {
    minX = Math.min(minX, obstacle.bounds.min.x);
    maxX = Math.max(maxX, obstacle.bounds.max.x);
    minZ = Math.min(minZ, obstacle.bounds.min.z);
    maxZ = Math.max(maxZ, obstacle.bounds.max.z);
  }
  minX -= ROUTE_GRID_PADDING_METERS;
  maxX += ROUTE_GRID_PADDING_METERS;
  minZ -= ROUTE_GRID_PADDING_METERS;
  maxZ += ROUTE_GRID_PADDING_METERS;

  const cell = ROUTE_GRID_CELL_METERS;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const toCol = (x: number): number => Math.min(cols - 1, Math.max(0, Math.round((x - minX) / cell)));
  const toRow = (z: number): number => Math.min(rows - 1, Math.max(0, Math.round((z - minZ) / cell)));
  const toX = (col: number): number => minX + col * cell;
  const toZ = (row: number): number => minZ + row * cell;
  const idx = (col: number, row: number): number => row * cols + col;

  const blocked = new Uint8Array(cols * rows);
  for (const obstacle of input.obstacles) {
    const { min, max } = obstacle.bounds;
    const loCol = toCol(min.x - input.walkerRadiusMeters);
    const hiCol = toCol(max.x + input.walkerRadiusMeters);
    const loRow = toRow(min.z - input.walkerRadiusMeters);
    const hiRow = toRow(max.z + input.walkerRadiusMeters);
    for (let row = loRow; row <= hiRow; row += 1) {
      for (let col = loCol; col <= hiCol; col += 1) blocked[idx(col, row)] = 1;
    }
  }

  const startCol = toCol(input.start.x);
  const startRow = toRow(input.start.z);
  const targetCol = toCol(input.target.x);
  const targetRow = toRow(input.target.z);
  const startIdx = idx(startCol, startRow);
  const targetIdx = idx(targetCol, targetRow);
  // The caller checks the endpoints itself; only the CORRIDOR is this function's job.
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
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
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
    if (prev === undefined || prev === -1) return null;
    cursor = prev;
  }
  cellPath.push(startIdx);
  cellPath.reverse();

  const points: OrderRouteVector2[] = cellPath.map((cellIndex) => ({
    x: toX(cellIndex % cols),
    z: toZ(Math.floor(cellIndex / cols)),
  }));
  points[0] = { ...input.start };
  points[points.length - 1] = { ...input.target };

  const pruned: OrderRouteVector2[] = [points[0]!];
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
