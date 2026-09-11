import { planBedsideApproach } from "@openclinxr/asset-registry/bedside-approach-path";
import { resolveBedsideLayout } from "@openclinxr/asset-registry/layout-variation";
import { describe, expect, it } from "vitest";
import {
  bedsideClearanceViolations,
  ED_STRETCHER_DECK_BOUNDS,
} from "./index.js";

/**
 * Brief §3, deterministic solving: "Apply hard constraints before ranking valid alternatives, break
 * equal scores by stable anchor ID, and fail unsatisfied explicit intent rather than substituting a
 * different target."
 *
 * The resolver tried BOTH sides and every standoff unconditionally, so a case authoring "approach
 * from the patient's left" was silently given the right side whenever the left was blocked. The
 * seed made the substitution look deliberate, and nothing reported it.
 *
 * WHAT THIS FILE DOES NOT CLAIM. "break equal scores by stable anchor ID" has nothing to break: the
 * resolver is first-fit over a seed-ordered candidate list and computes no scores at all. Clause (5)
 * records that as the current state rather than asserting a tiebreak that does not exist — an
 * assertion over an absent ranking would be green about nothing.
 */

const PATIENT = { x: -0.9, y: 0, z: -0.1 };
const SEED_INPUT = {
  scenarioId: "ed_chest_pain_priority_v2",
  assetRevision: "2026-09-09",
  solverVersion: "bedside-layout.v1",
  variationIndex: 0,
} as const;

/** A wall of obstacles down one side, so that side cannot clear at any standoff. */
function blockSide(side: "patient_left" | "patient_right") {
  const sign = side === "patient_left" ? -1 : 1;
  return Array.from({ length: 9 }, (_unused, index) => ({
    id: `${side}_block_${index}`,
    bounds: {
      min: { x: PATIENT.x - 3, y: 0, z: PATIENT.z + sign * (0.3 + index * 0.25) - 0.12 },
      max: { x: PATIENT.x + 3, y: 2, z: PATIENT.z + sign * (0.3 + index * 0.25) + 0.12 },
    },
  }));
}

describe("authored intent is refused, never substituted", () => {
  it("(1) an authored side that cannot clear returns UNSATISFIED — the other side is not offered", () => {
    const blocked = blockSide("patient_left");
    const result = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: blocked,
      intent: { approachSide: "patient_left" },
    });
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    // Every unsatisfied row must name the AUTHORED side. A row for the other side would mean the
    // resolver went looking there.
    expect(result.unsatisfied.length).toBeGreaterThan(0);
    for (const row of result.unsatisfied) expect(row.approachSide).toBe("patient_left");
  });

  it("(2) COUNTERWEIGHT: the same obstacles resolve WITHOUT intent, by taking the open side", () => {
    // Without this, clause (1) would pass on obstacles that block everything, and would be
    // measuring the fixture rather than the intent.
    const result = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: blockSide("patient_left"),
    });
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.approachSide).toBe("patient_right");
  });

  it("(3) an authored side that CAN clear is honoured even when the seed prefers the other", () => {
    const withoutIntent = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: [],
    });
    expect(withoutIntent.resolved).toBe(true);
    if (!withoutIntent.resolved) return;
    const other = withoutIntent.approachSide === "patient_left" ? "patient_right" : "patient_left";
    const withIntent = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: [],
      intent: { approachSide: other },
    });
    expect(withIntent.resolved).toBe(true);
    if (!withIntent.resolved) return;
    expect(withIntent.approachSide).toBe(other);
    // The seed is unchanged: intent narrows the search, it does not re-seed it.
    expect(withIntent.seed).toBe(withoutIntent.seed);
  });

  it("(4) an authored STANDOFF is the only one tried, so a nearer one is not substituted", () => {
    const result = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: [],
      intent: { standoffMeters: 0.9 },
    });
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.standoffMeters).toBe(0.9);
  });

  it("(5) HARD CONSTRAINTS ARE APPLIED FIRST, and there is no ranking for a tiebreak to order", () => {
    // Recorded rather than asserted away. The resolver returns the first candidate whose measured
    // clearance violations are empty; it computes no score, so "break equal scores by stable anchor
    // ID" has nothing to break yet. Asserting a tiebreak over an absent ranking would be vacuous.
    const result = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: [],
    });
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    // The returned target really does satisfy the hard constraint, measured again here rather than
    // trusted from the resolver's own report.
    expect(bedsideClearanceViolations({ standingPosition: result.target.position, obstacles: [] })).toEqual([]);
  });

  it("(6) the physician's START is a different place from the bedside destination", () => {
    // Brief §3 first planner slice: "the physician starts separately from the bedside destination",
    // and §3 step 3: "Keep actor starting poses separate from later destination poses."
    const resolved = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
      obstacles: [],
    });
    expect(resolved.resolved).toBe(true);
    if (!resolved.resolved) return;
    const doorway = { x: 2.6, y: 0, z: 2.2 };
    const plan = planBedsideApproach({
      from: doorway,
      target: resolved.target.position,
      facing: PATIENT,
      obstacles: [],
    });
    const travelled = Math.hypot(
      resolved.target.position.x - doorway.x,
      resolved.target.position.z - doorway.z,
    );
    expect(travelled).toBeGreaterThan(1);
    expect(plan.waypoints.length).toBeGreaterThan(1);
    expect(plan.waypoints[0]?.position).toEqual(doorway);
  });
});
