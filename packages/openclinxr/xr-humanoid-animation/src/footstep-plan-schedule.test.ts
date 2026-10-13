import { describe, expect, it } from "vitest";
import { halfCycleTravelMeters, planFootsteps } from "./footstep-plan.js";

// Committed table literals (footstep-plan-schedule.ts): scale-1 step travel
// 0.5935 m, minimum uniform scale 0.7. Pinned here as literals so the tests
// pin the values without importing the constants off the public surface.
const STEP_TRAVEL_M = 0.5935;
const MIN_SCALE = 0.7;

describe("footstep-plan schedule", () => {
  it("plans SC-05 1.31 m as 3 whole halves at one scale >= 0.7", () => {
    const plan = planFootsteps(1.31);
    if ("refused" in plan) throw new Error(`refused 1.31 m: ${plan.reason}`);
    expect(plan.steps).toBe(3);
    expect(plan.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(plan.scale).toBeLessThanOrEqual(1);
    expect(plan.scale).toBeCloseTo(0.707, 3);
    expect(plan.plannedTravelM).toBeCloseTo(1.31, 9);
  });

  it("plans the 2.0 m route as 4 whole halves at one scale >= 0.7", () => {
    const plan = planFootsteps(2.0);
    if ("refused" in plan) throw new Error(`refused 2.0 m: ${plan.reason}`);
    expect(plan.steps).toBe(4);
    expect(plan.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(plan.scale).toBeLessThanOrEqual(1);
    expect(plan.scale).toBeCloseTo(0.8369, 3);
    expect(plan.plannedTravelM).toBeCloseTo(2.0, 9);
  });

  it("solves the uniform scale from the per-foot model, not the shared table", () => {
    // M2: k halves ending R,L,R,... solve s from the M1 affines, so the
    // planned travel is the per-foot sum by construction and every plan in
    // [0.9, 6.0] carries a scale in [0.7, 1.0].
    for (const route of [0.9, 1.31, 2.0, 6.0]) {
      const plan = planFootsteps(route);
      if ("refused" in plan) throw new Error(`refused ${route} m: ${plan.reason}`);
      expect(plan.scale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(plan.scale).toBeLessThanOrEqual(1);
      expect(plan.plannedTravelM).toBeCloseTo(route, 9);
    }
    // 6.0 m plans 11 halves (6 R-ends, 5 L-ends) inside the scale range.
    const six = planFootsteps(6.0);
    if ("refused" in six) throw new Error(`refused 6.0 m: ${six.reason}`);
    expect(six.steps).toBe(11);
    expect(six.scale).toBeCloseTo(0.9557, 3);
  });

  it("G6 probe: modelScale seeds the plan solve (correction keeps TRUE model)", () => {
    // ?footstepProbeModel=1.2 multiplies the affines before solving: 2.0 m
    // collapses to k=3 at 0.989, 6.0 m to k=10 at 0.8368. The executor's
    // struct coefficients stay TRUE (frame fill), which is what lets the
    // late correction recover in the G6 legs.
    const two = planFootsteps(2.0, 1.2);
    if ("refused" in two) throw new Error(`refused seeded 2.0 m: ${two.reason}`);
    expect(two.steps).toBe(3);
    expect(two.scale).toBeCloseTo(0.989, 3);
    const seededSix = planFootsteps(6.0, 1.2);
    if ("refused" in seededSix) throw new Error(`refused seeded 6.0 m: ${seededSix.reason}`);
    expect(seededSix.steps).toBe(9);
    expect(seededSix.scale).toBeCloseTo(0.9815, 3);
    // Unseeded plans are unaffected by the optional parameter.
    const plain = planFootsteps(2.0);
    if ("refused" in plain) throw new Error("refused 2.0 m");
    expect(plain.scale).toBeCloseTo(0.8369, 4);
  });

  it("refuses a short route that would need a middle step under 0.7", () => {
    const plan = planFootsteps(0.7);
    if (!("refused" in plan)) throw new Error(`planned 0.7 m at scale ${plan.scale}`);
    expect(plan.reason).toMatch(/under 0\.7/);
    // The per-foot intercepts keep short routes refused below ~0.89 m: the
    // M6 parser accepts 0.8 m but the planner still stops it loudly here.
    const short = planFootsteps(0.8);
    if (!("refused" in short)) throw new Error(`planned 0.8 m at scale ${short.scale}`);
    expect(short.reason).toMatch(/under 0\.7/);
  });

  it("refuses non-positive route lengths", () => {
    for (const route of [0, -1.31]) {
      const plan = planFootsteps(route);
      if (!("refused" in plan)) throw new Error(`planned ${route} m`);
    }
  });

  it("half-cycle table stays linear in scale from the committed value", () => {
    // The legacy table read is unchanged by M2 (the planner no longer calls
    // it, but the S2 gates still grade against it).
    expect(halfCycleTravelMeters(1)).toBeCloseTo(STEP_TRAVEL_M, 9);
    expect(halfCycleTravelMeters(0)).toBe(0);
    expect(halfCycleTravelMeters(0.5)).toBeCloseTo(STEP_TRAVEL_M / 2, 9);
  });

  it("D1 check: the per-foot model predicts D1's measured 0.486 m half", () => {
    // D1 (s2-lead2 frames 12/28) measured one half-cycle at 0.486 m against
    // the old table's 0.4366 m prediction (+11% excess). Under M2 the plan
    // scale for 1.31 m is 0.7070 and the M1 L affine (literals pinned in the
    // M1 test below) predicts 0.3152 x 0.7070 + 0.2620 = 0.4849 m for an
    // L-ending half: within 2 mm of D1's measurement. The excess was the
    // missing foot term, not table noise. The table mapping itself is
    // unchanged: 0.486 / 0.5935 still inverts exactly.
    expect(halfCycleTravelMeters(0.486 / STEP_TRAVEL_M)).toBeCloseTo(0.486, 9);
    const nominal = planFootsteps(1.31);
    if ("refused" in nominal) throw new Error(`refused 1.31 m: ${nominal.reason}`);
    expect(0.3152 * nominal.scale + 0.262).toBeCloseTo(0.486, 2);
  });

  it("M1 travel table is self-consistent and its scales match the planner", () => {
    // Stop-any-route O1: the per-foot affine fit lives in the committed
    // data table (.openclinxr/evidence/stop-fit/half-travel-table.json) with
    // the audit trail (build shas, exclusions, method). The fit points are
    // repeated here as literals (no node:fs in this package's tests) so the
    // table cannot drift silently: the recomputed fit must match the
    // table's reported a/b/rms. No new public symbol: the model is
    // module-private, consumed by planFootsteps in the same file.
    const lPoints: Array<[number, number]> = [[0.7334, 0.4943], [0.8425, 0.5246], [0.919, 0.5533]];
    const rPoints: Array<[number, number]> = [[0.7334, 0.4292], [0.8425, 0.4669], [0.919, 0.5191]];
    const leastSquares = (points: Array<[number, number]>): { a: number; b: number; rmsMm: number } => {
      const n = points.length;
      const sumX = points.reduce((s, p) => s + p[0], 0);
      const sumY = points.reduce((s, p) => s + p[1], 0);
      const sumXX = points.reduce((s, p) => s + p[0] * p[0], 0);
      const sumXY = points.reduce((s, p) => s + p[0] * p[1], 0);
      const a = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const b = (sumY - a * sumX) / n;
      const rms = Math.sqrt(points.reduce((s, p) => s + (p[1] - (a * p[0] + b)) ** 2, 0) / n);
      return { a, b, rmsMm: rms * 1000 };
    };
    const l = leastSquares(lPoints);
    expect(l.a).toBeCloseTo(0.3152, 3);
    expect(l.b).toBeCloseTo(0.262, 3);
    expect(l.rmsMm).toBeCloseTo(2.05, 1);
    const r = leastSquares(rPoints);
    expect(r.a).toBeCloseTo(0.4749, 3);
    expect(r.b).toBeCloseTo(0.0768, 3);
    expect(r.rmsMm).toBeCloseTo(7.1, 1);
    // Table scales are the runs' historical uniform scales (old shared-table
    // arithmetic): every one sits inside the planner's [0.7, 1.0] range, and
    // every table route still takes a plan under the per-foot solver.
    for (const scale of [0.7335, 0.8425, 0.919]) {
      expect(scale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(scale).toBeLessThanOrEqual(1);
    }
    for (const route of [1.306, 2.0, 6.0]) {
      const plan = planFootsteps(route);
      if ("refused" in plan) throw new Error(`refused table route ${route} m: ${plan.reason}`);
    }
  });
});
